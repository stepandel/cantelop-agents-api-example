import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createSessionRuntimeHandler } from "@cantelop/sdk/runtime";
import { createBehaviour } from "../src/session.js";
import { Inbox } from "../src/inbox.js";
import type { handle } from "../src/worker.js";

async function harness(t: TestContext, run: typeof handle, root?: string) {
  root ??= await mkdtemp(path.join(tmpdir(), "agent-inbox-"));
  const sandbox = `sbx-${"a".repeat(32)}`;
  const server = createServer(createSessionRuntimeHandler(createBehaviour(run, 5000, root), { sandboxId: sandbox, executionTimeoutMs: 100 }));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); server.close(); await rm(root!, { recursive: true, force: true }); });
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/__cantelop/v2`;
  const request = async (route: string, body?: unknown): Promise<any> => {
    const response = await fetch(base + route, { method: body === undefined ? "GET" : "POST", headers: { "x-cantelop-sandbox-id": sandbox, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    assert.ok(response.ok, await response.clone().text());
    return response.json();
  };
  const id = (n: number) => `msg_${String(n).padStart(32, "0")}`;
  const send = (n: number, payload: unknown) => request("/messages", { session: { id: "one", workspace_id: `wsp_${"b".repeat(32)}`, keep_alive_seconds: 300 }, message: { id: id(n), payload } });
  const events: any[] = [];
  let cursor = 0;
  const until = async (predicate: () => boolean | Promise<boolean>) => {
    for (let n = 0; n < 200; n++) {
      const page = await request(`/runtime/events?after=${cursor}&wait=0`);
      if (page.events.length) {
        events.push(...page.events.map((entry: any) => entry.event));
        cursor = page.events.at(-1).cursor;
        await request("/runtime/events/ack", { through: cursor });
      }
      if (await predicate()) return;
      await delay(5);
    }
    assert.fail("Timed out waiting for session");
  };
  return { send, request, events, until, id, root };
}

test("queues FIFO beyond message deadlines, permits inspection, and continues after failure", async t => {
  let release!: () => void;
  const work = new Promise<void>(resolve => { release = resolve; });
  const prompts: string[] = [];
  const h = await harness(t, async (_root, command, messageId) => {
    if (command.type === "inspect") return { type: "session", messageId, data: { status: "running" } };
    const prompt = command.type === "prompt" ? command.prompt : "";
    prompts.push(prompt);
    if (prompt === "first") await work;
    if (prompt === "fail") throw new Error("private provider failure");
    return { type: "completed", messageId };
  });
  t.after(release);
  const receipt = await h.send(1, { type: "prompt", sessionId: "one", prompt: "first" });
  await h.until(() => prompts.length === 1);
  await delay(150);
  assert.equal((await h.request(`/messages/${receipt.message_id}`)).state, "succeeded");
  await h.send(2, { type: "prompt", sessionId: "one", prompt: "fail" });
  await h.send(3, { type: "prompt", sessionId: "one", prompt: "third" });
  await h.send(4, { type: "inspect", sessionId: "one" });
  await h.until(() => h.events.some(event => event.type === "session"));
  assert.deepEqual(prompts, ["first"]);
  assert.equal(h.events.filter(event => event.type === "queued").length, 2);
  const snapshot = h.events.find(event => event.type === "session").data;
  assert.deepEqual(snapshot.messages.map((job: any) => job.state), ["running", "queued", "queued"]);
  release();
  await h.until(() => h.events.some(event => event.type === "completed" && event.messageId === h.id(3)));
  assert.deepEqual(prompts, ["first", "fail", "third"]);
  assert.ok(h.events.some(event => event.type === "failed" && event.messageId === h.id(2)));
  assert.doesNotMatch(JSON.stringify(h.events), /private provider failure/);
  await h.until(async () => (await h.request("/runtime")).quiescent);
});

test("steering interrupts, waits for cleanup, takes priority, and retains queued work", async t => {
  const prompts: string[] = [];
  let cleaned = false;
  const h = await harness(t, async (_root, command, messageId, _env, signal) => {
    assert.equal(command.type, "prompt");
    if (command.type !== "prompt") throw new Error();
    prompts.push(command.prompt);
    if (command.prompt === "first") {
      await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
      assert.equal(signal.reason.code, "turn_steered");
      await delay(25); cleaned = true;
      throw new Error("interrupted");
    }
    assert.ok(cleaned);
    return { type: "completed", messageId };
  });
  await h.send(1, { type: "prompt", sessionId: "one", prompt: "first" });
  await h.until(() => prompts.length === 1);
  await h.send(2, { type: "prompt", sessionId: "one", prompt: "queued" });
  await h.send(3, { type: "prompt", sessionId: "one", prompt: "steer", mode: "steer" });
  await h.until(() => h.events.some(event => event.type === "completed" && event.messageId === h.id(2)));
  assert.deepEqual(prompts, ["first", "steer", "queued"]);
  assert.equal(h.events.find(event => event.type === "failed").data.code, "turn_steered");
  await h.until(async () => (await h.request("/runtime")).quiescent);
});

test("durable inbox deduplicates, preserves pending work and never replays running work after restart", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "agent-recovery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = new Inbox(root, "one");
  const prompt = { type: "prompt", sessionId: "one", prompt: "go" } as const;
  await first.admit(prompt, "first");
  assert.equal((await first.admit(prompt, "first")).duplicate, true);
  await first.admit(prompt, "second");
  assert.equal((await first.take())?.messageId, "first");
  const restarted = new Inbox(root, "one");
  const snapshot = await restarted.snapshot();
  assert.equal(snapshot[0]?.state, "finished");
  assert.equal((snapshot[0]?.result?.data as any).code, "turn_interrupted");
  assert.equal((await restarted.take())?.messageId, "second");
  assert.equal(await restarted.take(), undefined);
});

test("steering waits for initial session persistence before cancellation", async t => {
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  let creating = false;
  let creationSignal: AbortSignal | undefined;
  const h = await harness(t, async (_root, command, messageId, _env, signal, _deps, emit) => {
    if (command.type === "create") {
      creating = true; creationSignal = signal;
      await ready;
      assert.equal(signal.aborted, false);
      await emit!({ type: "status", messageId, data: { phase: "checkout" } });
      assert.equal(signal.aborted, true);
      throw signal.reason;
    }
    return { type: "completed", messageId };
  });
  t.after(release);
  await h.send(1, { type: "create", spec: { sessionId: "one", repository: "owner/repo", model: "chosen", prompt: "go" } });
  await h.until(() => creating);
  await h.send(2, { type: "prompt", sessionId: "one", mode: "steer", prompt: "redirect" });
  await h.until(() => h.events.some(event => event.type === "queued"));
  assert.equal(creationSignal?.aborted, false);
  release();
  await h.until(() => h.events.some(event => event.type === "completed" && event.messageId === h.id(2)));
  assert.equal(h.events.find(event => event.type === "failed").data.code, "turn_steered");
  await h.until(async () => (await h.request("/runtime")).quiescent);
});

test("activity cancellation preserves the queue until another work request", async t => {
  const prompts: string[] = [];
  const h = await harness(t, async (_root, command, messageId, _env, signal) => {
    if (command.type !== "prompt") throw new Error();
    prompts.push(command.prompt);
    if (command.prompt === "first") {
      await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
      throw signal.reason;
    }
    return { type: "completed", messageId };
  });
  await h.send(1, { type: "prompt", sessionId: "one", prompt: "first" });
  await h.until(() => prompts.length === 1);
  await h.send(2, { type: "prompt", sessionId: "one", prompt: "second" });
  await h.until(() => h.events.some(event => event.type === "queued"));
  const runtime = await h.request("/runtime");
  await h.request("/runtime/activity/cancel", { activity_id: runtime.activity.id });
  await h.until(async () => (await h.request("/runtime")).quiescent);
  assert.deepEqual(prompts, ["first"]);
  await h.send(3, { type: "prompt", sessionId: "one", prompt: "third" });
  await h.until(() => h.events.some(event => event.type === "completed" && event.messageId === h.id(3)));
  assert.deepEqual(prompts, ["first", "second", "third"]);
  await h.until(async () => (await h.request("/runtime")).quiescent);
});
