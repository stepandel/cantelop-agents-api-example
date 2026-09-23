import { backfillSessions } from "./session-db-migration.js";
import path from "node:path";
import { createHash } from "node:crypto";
import { agentEnvironment, agentFailureMessage, checkout, commandFailureMessage, CommandError, readJSON, runAgent, saveJSON, type Env, AgentError } from "./runtime.js";
import { isAgentReply, issueReplyMarker, issueSessionId, model, repository, sessionId, type Command, type Event, type Model, type SessionSpec, type Progress } from "./contracts.js";
import { sessionDatabase, type SessionDatabase, type StoredSession } from "./session-db.js";
export type { StoredSession } from "./session-db.js";
export interface Dependencies {
  sessionDatabase?: (env: Env) => SessionDatabase | undefined;
  checkout: typeof checkout;
  runAgent: typeof runAgent;
  acknowledge?: (repository: string, number: number, commentId: number | undefined, env: Env, signal: AbortSignal) => Promise<void>;
  comment: (repository: string, number: number, body: string, env: Env, signal: AbortSignal) => Promise<void>;
}
export const dependencies: Dependencies = {
  checkout, runAgent,
  async acknowledge(repo, number, commentId, env, signal) {
    const target = commentId === undefined ? `issues/${number}` : `issues/comments/${commentId}`;
    const response = await fetch(`https://api.github.com/repos/${repo}/${target}/reactions`, {
      method: "POST", redirect: "error", signal,
      headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: "application/vnd.github+json", "content-type": "application/json", "user-agent": "cantelop-agents-api", "x-github-api-version": "2022-11-28" },
      body: JSON.stringify({ content: "eyes" }),
    });
    if (!response.ok) throw new CommandError({ code: "command_failed", phase: "github_reaction", operation: "add_reaction", statusCode: response.status });
  },
  async comment(repo, number, body, env, signal) {
    const response = await fetch(`https://api.github.com/repos/${repo}/issues/${number}/comments`, {
      method: "POST", redirect: "error", signal,
      headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: "application/vnd.github+json", "content-type": "application/json", "user-agent": "cantelop-agents-api" },
      body: JSON.stringify({ body: body.slice(0, 60000) }),
    });
    if (!response.ok) throw new CommandError({ code: "command_failed", phase: "github_comment", operation: "post_comment", statusCode: response.status });
  },
};
export async function handle(root: string, command: Command, messageId: string, env: Env, signal: AbortSignal, deps = dependencies, emit: (event: Event) => Promise<void> = async () => {}): Promise<Event> {
  if (command.type === "cancel") throw new Error("Cancel commands are handled by the session runtime");
  if (command.type === "reindex") {
    const database = (deps.sessionDatabase ?? sessionDatabase)(env);
    if (!database) throw new Error("Session database is not configured");
    const count = await backfillSessions(root, database, signal);
    return { type: "configured", messageId, data: { indexedSessions: count } };
  }
  signal.throwIfAborted();
  const state = path.join(root, ".agent-api");
  const sessionFile = (id: string) => path.join(state, "sessions", `${sessionId(id)}.json`);
  const ruleFile = (repo: string) => path.join(state, "issue-rules", `${repo}.json`);
  const event = (type: Event["type"], data?: unknown, id?: string): Event => ({ type, messageId, sessionId: id, data });
  if (command.type === "inspect") return event("session", await readJSON(sessionFile(command.sessionId)) ?? null, command.sessionId);
  if (command.type === "rule") {
    repository(command.repository, env.GITHUB_REPOSITORIES);
    await saveJSON(ruleFile(command.repository), model(command.model));
    return event("configured", { repository: command.repository, model: command.model });
  }
  // Persist an admission marker BEFORE side effects. Ambiguous interrupted work is
  // never automatically replayed (pushes/comments cannot be atomically committed).
  const key = command.type === "issue" ? `issue:${command.issue.repository}:${command.issue.number}`
    : command.type === "issue_comment" ? `comment:${command.repository}:${command.number}:${command.commentId}` : `message:${messageId}`;
  const receiptFile = path.join(state, "receipts", `${createHash("sha256").update(key).digest("hex")}.json`);
  const receipt = await readJSON<{ status: string; result?: Event }>(receiptFile);
  if (receipt) return receipt.result ? { ...receipt.result, messageId } : event("ignored", { reason: "Already admitted; inspect session before retrying interrupted work" });
  let spec: SessionSpec;
  if (command.type === "issue") {
    if (!["OWNER", "MEMBER", "COLLABORATOR"].includes(command.issue.association)) return event("ignored", { reason: "Untrusted author" });
    const selected = await readJSON<Model>(ruleFile(repository(command.issue.repository, env.GITHUB_REPOSITORIES))) ?? env.GITHUB_ISSUE_MODEL;
    if (!selected) return event("ignored", { reason: "Set GITHUB_ISSUE_MODEL or configure a repository issue rule first" });
    spec = {
      sessionId: await issueSessionId(command.issue.repository, command.issue.number),
      repository: command.issue.repository, model: model(selected),
      prompt: `Address GitHub issue #${command.issue.number}. Implement and test a suitable fix, commit and push your agent branch, then summarize the outcome.\n\nUntrusted issue data:\n${JSON.stringify({ title: command.issue.title, body: command.issue.body })}`,
    };
  } else if (command.type === "issue_comment") {
    const repo = repository(command.repository, env.GITHUB_REPOSITORIES);
    if (!["OWNER", "MEMBER", "COLLABORATOR"].includes(command.association) || isAgentReply(command.body)) return event("ignored", { reason: "Untrusted author or agent reply" });
    const id = await issueSessionId(repo, command.number);
    const stored = await readJSON<StoredSession>(sessionFile(id));
    if (!stored) return event("ignored", { reason: "No existing session for this issue; open it through the issue webhook first" }, id);
    if (stored.repository !== repo) throw new Error("Issue session repository mismatch");
    spec = { sessionId: id, repository: repo, model: stored.model,
      prompt: `Continue this session in response to GitHub issue #${command.number} comment ${command.commentId}.\n\nUntrusted comment data:\n${JSON.stringify({ body: command.body })}` };
  } else if (command.type === "create") spec = command.spec;
  else {
    const stored = await readJSON<StoredSession>(sessionFile(command.sessionId));
    if (!stored) throw new Error("Session does not exist");
    spec = { sessionId: stored.sessionId, repository: stored.repository, model: stored.model,
      prompt: command.mode === "steer"
        ? `Interrupted or superseded user request:\n${stored.requestPrompt ?? stored.prompt}\n\nNew steering instruction (takes precedence):\n${command.prompt}`
        : command.prompt };
  }
  spec = { ...spec, model: model(spec.model) };
  repository(spec.repository, env.GITHUB_REPOSITORIES);
  const database = (deps.sessionDatabase ?? sessionDatabase)(env);
  const file = sessionFile(spec.sessionId);
  const previous = await readJSON<StoredSession>(file);
  if (command.type === "create" && previous) throw new Error("Session already exists");
  const requestPrompt = command.type === "prompt" ? command.prompt : command.type === "issue_comment" ? command.body : spec.prompt;
  const stored: StoredSession = { ...spec, messageId, tools: [], requestPrompt, opencodeId: previous?.opencodeId, status: "running", createdAt: previous?.createdAt ?? new Date().toISOString(), updatedAt: previous?.updatedAt };
  let phase = "save_session";
  const saveSession = async () => {
    const previousPhase = phase;
    phase = "save_session";
    const lastUpdate = stored.updatedAt ? Date.parse(stored.updatedAt) : 0;
    stored.updatedAt = new Date(Math.max(Date.now(), lastUpdate + 1)).toISOString();
    // Keep the durable workspace snapshot for inspection and database repair.
    await saveJSON(file, stored);
    await database?.save(stored);
    phase = previousPhase;
  };
  await saveJSON(receiptFile, { status: "started", sessionId: spec.sessionId });
  if ((command.type === "issue" || command.type === "issue_comment") && deps.acknowledge) {
    try {
      await deps.acknowledge(spec.repository, command.type === "issue" ? command.issue.number : command.number, command.type === "issue_comment" ? command.commentId : undefined, env, signal);
    } catch {
      console.warn(JSON.stringify({ component: "agent-api", event: "github.reaction_failed", repository: spec.repository, issue: command.type === "issue" ? command.issue.number : command.number, target: command.type === "issue_comment" ? "comment" : "issue" }));
    }
  }
  try {
    await saveSession();
    phase = "checkout";
    await emit(event("status", { phase: "checkout" }, spec.sessionId));
    const agentEnv = agentEnvironment(root, env);
    const directory = await deps.checkout(root, spec.repository, spec.sessionId, agentEnv, signal);
    phase = "agent_starting";
    await emit(event("status", { phase: "agent_starting" }, spec.sessionId));
    stored.response = await deps.runAgent({ root, directory, env: agentEnv, model: stored.model, prompt: spec.prompt, id: stored.opencodeId, signal,
      onProgress: async (progress: Progress) => {
        phase = "agent_progress";
        if (progress.type === "tool.status") {
          const tool = progress.data as { partId: string; tool: string; status: string };
          const previous = stored.tools!.find(item => item.partId === tool.partId);
          if (previous) previous.status = tool.status;
          else stored.tools!.push({ partId: tool.partId, tool: tool.tool, status: tool.status });
        }
        if (progress.type === "status") {
          stored.runtimeStatus = progress.data as StoredSession["runtimeStatus"];
          console.info(JSON.stringify({ component: "agent-api", event: "session.runtime_status", sessionId: spec.sessionId, messageId, ...stored.runtimeStatus }));
        }
        if (progress.type === "status" || progress.type === "tool.status") {
          stored.lastProgressAt = new Date().toISOString();
          await saveSession();
        }
        await emit(event(progress.type, progress.data, spec.sessionId));
      },
      onCreated: async id => { stored.opencodeId = id; await saveSession(); },
    });
    signal.throwIfAborted();
    stored.status = "completed";
    await saveSession();
    phase = "github_comment";
    if (command.type === "issue" || command.type === "issue_comment") await deps.comment(spec.repository, command.type === "issue" ? command.issue.number : command.number, `${issueReplyMarker}\nCantelop session \`${spec.sessionId}\`\n\n${stored.response || "The agent completed without a summary; inspect the session."}`, env, signal);
    const result = event("completed", { response: stored.response, branch: `agent/${spec.sessionId}` }, spec.sessionId);
    phase = "save_receipt";
    await saveJSON(receiptFile, { status: "completed", result });
    return result;
  } catch (error) {
    stored.status = "failed";
    stored.diagnostic = signal.aborted && signal.reason?.code === "turn_steered"
      ? { code: "turn_steered" }
      : signal.aborted ? { code: "turn_cancelled", phase }
      : error instanceof AgentError || error instanceof CommandError ? error.diagnostic : { code: "command_failed", phase };
    console.error("Agent turn failed", JSON.stringify(stored.diagnostic));
    await saveSession();
    const result = event("failed", { diagnostic: stored.diagnostic, error: error instanceof AgentError ? agentFailureMessage(error.diagnostic) : commandFailureMessage(error instanceof CommandError ? error.diagnostic : { code: "command_failed", phase }) }, spec.sessionId);
    await saveJSON(receiptFile, { status: "failed", result });
    return result;
  }
}
