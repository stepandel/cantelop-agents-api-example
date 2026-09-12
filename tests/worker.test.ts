import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { handle, type Dependencies } from "../src/worker.js";
import { agentEnvironment, checkout, git } from "../src/runtime.js";
import type { Command } from "../src/contracts.js";
const env = { GITHUB_TOKEN: "test-only", OPENROUTER_API_KEY: "test-openrouter", GITHUB_REPOSITORIES: "owner/repo" };
const model = "anthropic/claude-sonnet-4.5";
async function harness(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "cantelop-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runs: Parameters<Dependencies["runAgent"]>[0][] = [];
  const comments: unknown[] = [];
  const deps: Dependencies = {
    async checkout() { return root; },
    async runAgent(options) { runs.push(options); if (!options.id) await options.onCreated("opencode-1"); return "Done"; },
    async comment(...args) { comments.push(args); },
  };
  return { root, deps, runs, comments, run: (command: Command, id: string) => handle(root, command, id, env, new AbortController().signal, deps) };
}
test("persists selected model and OpenCode conversation across follow-ups", async t => {
  const h = await harness(t);
  await h.run({ type: "create", spec: { sessionId: "one", model, repository: "owner/repo", prompt: "Start" } }, "m1");
  await h.run({ type: "prompt", sessionId: "one", prompt: "Continue" }, "m2");
  assert.equal(h.runs.length, 2);
  assert.deepEqual(h.runs[1]?.model, model);
  assert.equal(h.runs[1]?.id, "opencode-1");
  const status = await h.run({ type: "inspect", sessionId: "one" }, "m3");
  assert.equal((status.data as { status: string }).status, "completed");
});
test("issue model comes from API rule; redeliveries cannot rerun or repost", async t => {
  const h = await harness(t);
  const issue: Command = { type: "issue", deliveryId: "d1", issue: { repository: "owner/repo", number: 7, title: "Bug", body: "Fix", association: "OWNER" } };
  assert.equal((await h.run(issue, "m1")).type, "ignored");
  await h.run({ type: "rule", repository: "owner/repo", model }, "m2");
  assert.equal((await h.run(issue, "m3")).type, "completed");
  await h.run({ ...issue, deliveryId: "d2" }, "m4");
  assert.equal(h.runs.length, 1);
  assert.equal(h.comments.length, 1);
  assert.deepEqual(h.runs[0]?.model, model);
});
test("failed side effects are not automatically replayed", async t => {
  const h = await harness(t);
  h.deps.runAgent = async () => { throw new Error("secret provider error"); };
  const command: Command = { type: "create", spec: { sessionId: "failed", repository: "owner/repo", model, prompt: "Start" } };
  const failed = await h.run(command, "m1");
  assert.equal(failed.type, "failed");
  assert.equal(JSON.stringify(failed).includes("secret provider error"), false);
  h.deps.runAgent = async () => { assert.fail("must not rerun"); };
  assert.equal((await h.run(command, "m1")).type, "failed");
});
test("API and webhook secrets are absent from agent subprocess environment", () => {
  const actual = agentEnvironment("/workspace", { ...env, SESSION_DATABASE_AUTH_TOKEN: "private-db", SESSION_DATABASE_URL: "https://private-db.example", API_TOKEN: "private-api", GITHUB_WEBHOOK_SECRET: "private-webhook", ANTHROPIC_API_KEY: "unused", OPENAI_API_KEY: "unused" });
  assert.equal(actual.SESSION_DATABASE_AUTH_TOKEN, undefined);
  assert.equal(actual.SESSION_DATABASE_URL, undefined);
  assert.equal(actual.API_TOKEN, undefined);
  assert.equal(actual.GITHUB_WEBHOOK_SECRET, undefined);
  assert.equal(actual.ANTHROPIC_API_KEY, undefined);
  assert.equal(actual.OPENAI_API_KEY, undefined);
  assert.equal(actual.OPENROUTER_API_KEY, "test-openrouter");
  assert.deepEqual(JSON.parse(actual.OPENCODE_CONFIG_CONTENT!).enabled_providers, ["openrouter"]);
  assert.deepEqual(JSON.parse(actual.OPENCODE_CONFIG_CONTENT!).permission, { "*": "allow", question: "deny" });
  assert.equal(actual.OPENCODE_CONFIG_CONTENT?.includes("model"), false);
});
test("shared checkout refuses switching branches when changes remain", async t => {
  const h = await harness(t);
  const { mkdir, writeFile } = await import("node:fs/promises");
  const directory = path.join(h.root, "repositories", "owner", "repo");
  await mkdir(directory, { recursive: true });
  const gitEnv = agentEnvironment(h.root, env);
  const signal = new AbortController().signal;
  await git(directory, ["init", "-b", "agent/one"], gitEnv, signal);
  await writeFile(path.join(directory, "work.txt"), "unfinished");
  assert.equal(await checkout(h.root, "owner/repo", "one", gitEnv, signal), directory);
  await assert.rejects(checkout(h.root, "owner/repo", "two", gitEnv, signal), /uncommitted changes/);
});
test("OpenRouter key is required even when another provider key exists", () => {
  assert.throws(() => agentEnvironment("/workspace", { GITHUB_TOKEN: "test", OPENAI_API_KEY: "unused" }), /OpenRouter credentials/);
});

test("inspection remains available during work; cancellation persists failure and releases the lock", async t => {
  const h = await harness(t);
  const controller = new AbortController();
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  h.deps.runAgent = async ({ signal }) => {
    started();
    await new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    return "unreachable";
  };
  const command: Command = { type: "create", spec: { sessionId: "cancel", repository: "owner/repo", model, prompt: "start" } };
  const pending = handle(h.root, command, "cancel-1", env, controller.signal, h.deps);
  await ready;
  const live = await handle(h.root, { type: "inspect", sessionId: "cancel" }, "inspect-live", env, AbortSignal.timeout(500), h.deps);
  assert.equal((live.data as { status: string }).status, "running");
  controller.abort();
  assert.equal((await pending).type, "failed");
  const failed = await h.run({ type: "inspect", sessionId: "cancel" }, "inspect-failed");
  assert.equal((failed.data as { diagnostic: { code: string } }).diagnostic.code, "turn_cancelled");
  h.deps.runAgent = async () => "Recovered";
  assert.equal((await h.run({ type: "prompt", sessionId: "cancel", prompt: "continue" }, "cancel-2")).type, "completed");
  const recovered = await h.run({ type: "inspect", sessionId: "cancel" }, "inspect-recovered");
  assert.equal((recovered.data as { diagnostic?: unknown }).diagnostic, undefined);
});

for (const override of [false, true]) {
  test(`issue uses ${override ? "repository override" : "default model"} and preserves it for follow-ups`, async t => {
    const h = await harness(t);
    const fallback = "openai/gpt-4.1";
    if (override) await h.run({ type: "rule", repository: "owner/repo", model }, "rule");
    const issue: Command = { type: "issue", deliveryId: "default-delivery", issue: { repository: "owner/repo", number: 8, title: "Bug", body: "Fix", association: "OWNER" } };
    const result = await handle(h.root, issue, "issue", { ...env, GITHUB_ISSUE_MODEL: fallback }, new AbortController().signal, h.deps);
    assert.equal(result.type, "completed");
    assert.equal(h.runs[0]?.model, override ? model : fallback);
    await h.run({ type: "prompt", sessionId: result.sessionId!, prompt: "Continue" }, "follow-up");
    assert.equal(h.runs[1]?.model, override ? model : fallback);
  });
}

test("model failure gives actionable UI feedback and persists safe diagnostics", async t => {
  const h = await harness(t);
  const { AgentError } = await import("../src/runtime.js");
  h.deps.runAgent = async () => { throw new AgentError({ code: "opencode_failed", phase: "validate_model", stderrHints: [], reason: "model_not_found" }); };
  const result = await h.run({ type: "create", spec: { sessionId: "bad-model", repository: "owner/repo", model: "moonshot/kimi-k3", prompt: "Hello" } }, "bad-model-1");
  assert.equal(result.type, "failed");
  assert.match((result.data as { error: string }).error, /Start a new session.*moonshotai\/kimi-k3/);
  const stored = await h.run({ type: "inspect", sessionId: "bad-model" }, "inspect-1");
  assert.equal((stored.data as { diagnostic: { reason: string } }).diagnostic.reason, "model_not_found");
});

test("steering preserves the previous task, model and conversation", async t => {
  const h = await harness(t);
  await h.run({ type: "create", spec: { sessionId: "one", model, repository: "owner/repo", prompt: "Fix the API" } }, "m1");
  await h.run({ type: "prompt", sessionId: "one", prompt: "Start with tests", mode: "steer" }, "m2");
  assert.equal(h.runs[1]?.id, "opencode-1");
  assert.equal(h.runs[1]?.model, model);
  assert.match(h.runs[1]!.prompt, /Fix the API/);
  assert.match(h.runs[1]!.prompt, /takes precedence\):\nStart with tests/);
  const stored = await h.run({ type: "inspect", sessionId: "one" }, "m3");
  assert.equal((stored.data as { requestPrompt: string }).requestPrompt, "Start with tests");
});

test("webhook and API turns persist stream identity and tool summaries", async t => {
  const h = await harness(t);
  h.deps.runAgent = async options => {
    for (const status of ["running", "completed"]) await options.onProgress?.({
      type: "tool.status", data: { partId: "tool-1", tool: "bash", status, input: "not persisted" },
    });
    return "Done";
  };
  await h.run({ type: "rule", repository: "owner/repo", model }, "rule");
  const commands: Command[] = [
    { type: "create", spec: { sessionId: "api-tools", repository: "owner/repo", model, prompt: "Start" } },
    { type: "issue", deliveryId: "delivery", issue: { repository: "owner/repo", number: 99, title: "Fix", body: "", association: "OWNER" } },
  ];
  for (const [i, command] of commands.entries()) {
    const result = await h.run(command, `message-${i}`);
    const snapshot = (await h.run({ type: "inspect", sessionId: result.sessionId! }, "inspect")).data as import("../src/session-db.js").StoredSession;
    assert.equal(snapshot.messageId, `message-${i}`);
    assert.deepEqual(snapshot.tools, [{ partId: "tool-1", tool: "bash", status: "completed" }]);
    await h.run({ type: "prompt", sessionId: result.sessionId!, prompt: "Continue" }, `followup-${i}`);
    const next = (await h.run({ type: "inspect", sessionId: result.sessionId! }, "inspect")).data as import("../src/session-db.js").StoredSession;
    assert.equal(next.messageId, `followup-${i}`);
    assert.equal(next.tools?.length, 1);
  }
});

test("runtime status and tool activity are inspectable before the turn finishes", async t => {
  const h = await harness(t);
  h.deps.runAgent = async options => {
    await options.onProgress!({ type: "status", data: { phase: "opencode_retry", attempt: 2 } });
    await options.onProgress!({ type: "tool.status", data: { partId: "p", tool: "read", status: "running" } });
    const result = await h.run({ type: "inspect", sessionId: "live" }, "inspect");
    const stored = result.data as any;
    assert.equal(stored.status, "running");
    assert.deepEqual(stored.runtimeStatus, { phase: "opencode_retry", attempt: 2 });
    assert.equal(stored.tools[0].status, "running");
    assert.ok(stored.lastProgressAt);
    return "Done";
  };
  await h.run({ type: "create", spec: { sessionId: "live", model, repository: "owner/repo", prompt: "Start" } }, "m1");
});
