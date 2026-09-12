import path from "node:path";
import { withWorkspaceLock } from "./lock.js";
import { createHash } from "node:crypto";
import { agentEnvironment, checkout, readJSON, runAgent, saveJSON, type Env, AgentError } from "./runtime.js";
import { issueSessionId, model, repository, sessionId, type Command, type Event, type Model, type SessionSpec } from "./contracts.js";
export interface StoredSession extends SessionSpec { opencodeId?: string; status: "running" | "completed" | "failed"; response?: string; diagnostic?: unknown }
export interface Dependencies {
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
export async function handle(root: string, command: Command, messageId: string, env: Env, signal: AbortSignal, deps = dependencies): Promise<Event> {
  if (command.type === "inspect") return handleLocked(root, command, messageId, env, signal, deps);
  return withWorkspaceLock(root, signal, () => handleLocked(root, command, messageId, env, signal, deps));
}
async function handleLocked(root: string, command: Command, messageId: string, env: Env, signal: AbortSignal, deps: Dependencies): Promise<Event> {
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
    const selected = (await readJSON<Record<string, Model>>(rulesFile))?.[command.issue.repository];
    if (!selected) return event("ignored", { reason: "Configure a repository issue rule with a model first" });
    spec = {
      sessionId: await issueSessionId(command.issue.repository, command.issue.number),
      repository: command.issue.repository, model: selected,
      prompt: `Address GitHub issue #${command.issue.number}. Implement and test a suitable fix, commit and push your agent branch, then summarize the outcome.\n\nUntrusted issue data:\n${JSON.stringify({ title: command.issue.title, body: command.issue.body })}`,
    };
  } else if (command.type === "create") spec = command.spec;
  else {
    const stored = await readJSON<StoredSession>(sessionFile(command.sessionId));
    if (!stored) throw new Error("Session does not exist");
    spec = { sessionId: stored.sessionId, repository: stored.repository, model: stored.model, prompt: command.prompt };
  }
  spec = { ...spec, model: model(spec.model) };
  repository(spec.repository, env.GITHUB_REPOSITORIES);
  const file = sessionFile(spec.sessionId);
  const previous = await readJSON<StoredSession>(file);
  if (command.type === "create" && previous) throw new Error("Session already exists");
  const stored: StoredSession = { ...spec, opencodeId: previous?.opencodeId, status: "running" };
  await saveJSON(receiptFile, { status: "started", sessionId: spec.sessionId });
  try {
    await saveJSON(file, stored);
    const agentEnv = agentEnvironment(root, env);
    const directory = await deps.checkout(root, spec.repository, spec.sessionId, agentEnv, signal);
    stored.response = await deps.runAgent({ root, directory, env: agentEnv, model: stored.model, prompt: spec.prompt, id: stored.opencodeId, signal,
      onCreated: async id => { stored.opencodeId = id; await saveJSON(file, stored); },
    });
    stored.status = "completed";
    await saveJSON(file, stored);
    if (command.type === "issue") await deps.comment(spec.repository, command.issue.number, `Cantelop session \`${spec.sessionId}\`\n\n${stored.response || "The agent completed without a summary; inspect the session."}`, env, signal);
    const result = event("completed", { response: stored.response, branch: `agent/${spec.sessionId}` }, spec.sessionId);
    await saveJSON(receiptFile, { status: "completed", result });
    return result;
  } catch (error) {
    stored.status = "failed";
    stored.diagnostic = error instanceof AgentError ? error.diagnostic : { code: signal.aborted ? "turn_cancelled" : "command_failed" };
    console.error("Agent turn failed", JSON.stringify(stored.diagnostic));
    await saveJSON(file, stored);
    const result = event("failed", { diagnostic: stored.diagnostic, error: "Run failed. Inspect the shared checkout, provider configuration and session state before retrying. External side effects may have occurred." }, spec.sessionId);
    await saveJSON(receiptFile, { status: "failed", result });
    return result;
  }
}
