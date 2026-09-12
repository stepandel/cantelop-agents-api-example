import { backfillSessions } from "./session-db-migration.js";
import path from "node:path";
import { withWorkspaceLock } from "./lock.js";
import { createHash } from "node:crypto";
import { agentEnvironment, agentFailureMessage, checkout, readJSON, runAgent, saveJSON, type Env, AgentError } from "./runtime.js";
import { issueSessionId, model, repository, sessionId, type Command, type Event, type Model, type SessionSpec, type Progress } from "./contracts.js";
import { sessionDatabase, type SessionDatabase, type StoredSession } from "./session-db.js";
export type { StoredSession } from "./session-db.js";
export interface Dependencies {
  sessionDatabase?: (env: Env) => SessionDatabase | undefined;
  checkout: typeof checkout;
  runAgent: typeof runAgent;
  comment: (repository: string, number: number, body: string, env: Env, signal: AbortSignal) => Promise<void>;
}
export const dependencies: Dependencies = {
  checkout, runAgent,
  async comment(repo, number, body, env, signal) {
    const response = await fetch(`https://api.github.com/repos/${repo}/issues/${number}/comments`, {
      method: "POST", redirect: "error", signal,
      headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: "application/vnd.github+json", "content-type": "application/json", "user-agent": "cantelop-agents-api" },
      body: JSON.stringify({ body: body.slice(0, 60000) }),
    });
    if (!response.ok) throw new Error("GitHub comment failed");
  },
};
export async function handle(root: string, command: Command, messageId: string, env: Env, signal: AbortSignal, deps = dependencies, emit: (event: Event) => Promise<void> = async () => {}): Promise<Event> {
  if (command.type === "reindex") {
    const database = (deps.sessionDatabase ?? sessionDatabase)(env);
    if (!database) throw new Error("Session database is not configured");
    const count = await backfillSessions(root, database, signal);
    return { type: "configured", messageId, data: { indexedSessions: count } };
  }
  if (command.type === "inspect") return handleLocked(root, command, messageId, env, signal, deps, emit);
  await emit({ type: "status", messageId, data: { phase: "waiting_for_workspace" } });
  return withWorkspaceLock(root, signal, () => handleLocked(root, command, messageId, env, signal, deps, emit));
}
async function handleLocked(root: string, command: Exclude<Command, { type: "reindex" }>, messageId: string, env: Env, signal: AbortSignal, deps: Dependencies, emit: (event: Event) => Promise<void>): Promise<Event> {
  const state = path.join(root, ".agent-api");
  const sessionFile = (id: string) => path.join(state, "sessions", `${sessionId(id)}.json`);
  const rulesFile = path.join(state, "issue-rules.json");
  const event = (type: Event["type"], data?: unknown, id?: string): Event => ({ type, messageId, sessionId: id, data });
  if (command.type === "inspect") return event("session", await readJSON(sessionFile(command.sessionId)) ?? null, command.sessionId);
  if (command.type === "rule") {
    repository(command.repository, env.GITHUB_REPOSITORIES);
    const rules = await readJSON<Record<string, Model>>(rulesFile) ?? {};
    rules[command.repository] = model(command.model);
    await saveJSON(rulesFile, rules);
    return event("configured", { repository: command.repository, model: command.model });
  }
  // Persist an admission marker BEFORE side effects. Ambiguous interrupted work is
  // never automatically replayed (pushes/comments cannot be atomically committed).
  const key = command.type === "issue" ? `issue:${command.issue.repository}:${command.issue.number}` : `message:${messageId}`;
  const receiptFile = path.join(state, "receipts", `${createHash("sha256").update(key).digest("hex")}.json`);
  const receipt = await readJSON<{ status: string; result?: Event }>(receiptFile);
  if (receipt) return receipt.result ? { ...receipt.result, messageId } : event("ignored", { reason: "Already admitted; inspect session before retrying interrupted work" });
  let spec: SessionSpec;
  if (command.type === "issue") {
    if (!["OWNER", "MEMBER", "COLLABORATOR"].includes(command.issue.association)) return event("ignored", { reason: "Untrusted author" });
    const selected = (await readJSON<Record<string, Model>>(rulesFile))?.[command.issue.repository] ?? env.GITHUB_ISSUE_MODEL;
    if (!selected) return event("ignored", { reason: "Set GITHUB_ISSUE_MODEL or configure a repository issue rule first" });
    spec = {
      sessionId: await issueSessionId(command.issue.repository, command.issue.number),
      repository: command.issue.repository, model: model(selected),
      prompt: `Address GitHub issue #${command.issue.number}. Implement and test a suitable fix, commit and push your agent branch, then summarize the outcome.\n\nUntrusted issue data:\n${JSON.stringify({ title: command.issue.title, body: command.issue.body })}`,
    };
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
  const requestPrompt = command.type === "prompt" ? command.prompt : spec.prompt;
  const stored: StoredSession = { ...spec, requestPrompt, opencodeId: previous?.opencodeId, status: "running", createdAt: previous?.createdAt ?? new Date().toISOString(), updatedAt: previous?.updatedAt };
  const saveSession = async () => {
    const lastUpdate = stored.updatedAt ? Date.parse(stored.updatedAt) : 0;
    stored.updatedAt = new Date(Math.max(Date.now(), lastUpdate + 1)).toISOString();
    // Keep the durable workspace snapshot for inspection and database repair.
    await saveJSON(file, stored);
    await database?.save(stored);
  };
  await saveJSON(receiptFile, { status: "started", sessionId: spec.sessionId });
  try {
    await saveSession();
    await emit(event("status", { phase: "checkout" }, spec.sessionId));
    const agentEnv = agentEnvironment(root, env);
    const directory = await deps.checkout(root, spec.repository, spec.sessionId, agentEnv, signal);
    await emit(event("status", { phase: "agent_starting" }, spec.sessionId));
    stored.response = await deps.runAgent({ root, directory, env: agentEnv, model: stored.model, prompt: spec.prompt, id: stored.opencodeId, signal,
      onProgress: (progress: Progress) => emit(event(progress.type, progress.data, spec.sessionId)),
      onCreated: async id => { stored.opencodeId = id; await saveSession(); },
    });
    signal.throwIfAborted();
    stored.status = "completed";
    await saveSession();
    if (command.type === "issue") await deps.comment(spec.repository, command.issue.number, `Cantelop session \`${spec.sessionId}\`\n\n${stored.response || "The agent completed without a summary; inspect the session."}`, env, signal);
    const result = event("completed", { response: stored.response, branch: `agent/${spec.sessionId}` }, spec.sessionId);
    await saveJSON(receiptFile, { status: "completed", result });
    return result;
  } catch (error) {
    stored.status = "failed";
    stored.diagnostic = signal.aborted && signal.reason?.code === "turn_steered"
      ? { code: "turn_steered" }
      : error instanceof AgentError ? error.diagnostic : { code: signal.aborted ? "turn_cancelled" : "command_failed" };
    console.error("Agent turn failed", JSON.stringify(stored.diagnostic));
    await saveSession();
    const result = event("failed", { diagnostic: stored.diagnostic, error: error instanceof AgentError ? agentFailureMessage(error.diagnostic) : "Run failed. Inspect the shared checkout, provider configuration and session state before retrying. External side effects may have occurred." }, spec.sessionId);
    await saveJSON(receiptFile, { status: "failed", result });
    return result;
  }
}
