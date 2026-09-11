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
  const actual = agentEnvironment("/workspace", { ...env, API_TOKEN: "private-api", GITHUB_WEBHOOK_SECRET: "private-webhook", ANTHROPIC_API_KEY: "unused", OPENAI_API_KEY: "unused" });
  assert.equal(actual.API_TOKEN, undefined);
  assert.equal(actual.GITHUB_WEBHOOK_SECRET, undefined);
  assert.equal(actual.ANTHROPIC_API_KEY, undefined);
  assert.equal(actual.OPENAI_API_KEY, undefined);
  assert.equal(actual.OPENROUTER_API_KEY, "test-openrouter");
  assert.deepEqual(JSON.parse(actual.OPENCODE_CONFIG_CONTENT!).enabled_providers, ["openrouter"]);
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
