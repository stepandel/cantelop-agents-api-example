import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import api from "../src/api.js";
import type { CantelopApp } from "@cantelop/sdk/api";
import type { Command } from "../src/contracts.js";
import { ui } from "../src/ui.js";
function harness() {
  const commands: Command[] = [];
  const opens: unknown[] = [];
  const app = { sessions: { open(config: unknown) { opens.push(config); return {
    async dispatch(command: Command) { commands.push(command); return { id: "message-1" }; },
    async events() { return new Response("events"); },
  }; } } } as unknown as CantelopApp<Command>;
  const router = api.create({ app, env: { API_TOKEN: "api-secret", GITHUB_WEBHOOK_SECRET: "webhook-secret", GITHUB_REPOSITORIES: "owner/repo" } });
  return { commands, opens, request: (path: string, body: unknown, headers: Record<string, string> = { authorization: "Bearer api-secret" }, method = "POST") => router.handle(new Request(`https://example.com${path}`, { method, headers, body: JSON.stringify(body) })) };
}
const model = "anthropic/claude-sonnet-4.5";
test("new session requires a model and authentication; opens a distinct actor in the shared workspace", async () => {
  const h = harness();
  const spec = { repository: "owner/repo", prompt: "Fix tests", model };
  assert.equal((await h.request("/sessions", spec, {})).status, 401);
  assert.equal((await h.request("/sessions", { ...spec, model: undefined })).status, 400);
  assert.equal((await h.request("/sessions", spec)).status, 202);
  assert.equal(h.commands.length, 1);
  assert.deepEqual(h.commands[0]?.type === "create" && h.commands[0].spec.model, model);
  const first = h.commands[0];
  assert.ok(first?.type === "create");
  assert.deepEqual(h.opens[0], { id: first.spec.sessionId, workspaceSlug: "agents", keepAliveSeconds: 300 });
  await h.request("/sessions", spec);
  assert.notDeepEqual(h.opens[0], h.opens[1]);
  await h.request("/sessions/messages", { sessionId: first.spec.sessionId, prompt: "Continue" });
  assert.deepEqual(h.opens[0], h.opens[2]);
});
test("rejects unlisted repositories and unsafe session IDs", async () => {
  const h = harness();
  assert.equal((await h.request("/sessions", { repository: "other/repo", prompt: "fix", model })).status, 400);
  assert.equal((await h.request("/sessions/messages", { sessionId: "../escape", prompt: "fix" })).status, 400);
  assert.equal(h.commands.length, 0);
});
test("verifies raw webhook signatures, ignores other actions and untrusted authors", async () => {
  const h = harness();
  const payload = { action: "opened", repository: { full_name: "owner/repo" }, issue: { number: 1, title: "Bug", body: null, author_association: "OWNER" } };
  const headers = (value: unknown) => ({ "x-github-event": "issues", "x-github-delivery": "delivery-1", "x-hub-signature-256": `sha256=${createHmac("sha256", "webhook-secret").update(JSON.stringify(value)).digest("hex")}` });
  assert.equal((await h.request("/webhooks/github", payload, {})).status, 401);
  assert.equal((await h.request("/webhooks/github", { ...payload, action: "edited" }, headers(payload))).status, 401);
  const edited = { ...payload, action: "edited" };
  assert.equal((await h.request("/webhooks/github", edited, headers(edited))).status, 200);
  const untrusted = { ...payload, issue: { ...payload.issue, author_association: "NONE" } };
  assert.equal((await h.request("/webhooks/github", untrusted, headers(untrusted))).status, 200);
  assert.equal((await h.request("/webhooks/github", payload, headers(payload))).status, 202);
  assert.equal(h.commands.length, 1);
  assert.equal(h.commands[0]?.type, "issue");
});
test("rejects oversized bodies", async () => {
  assert.equal((await harness().request("/sessions", { prompt: "x".repeat(1000001) })).status, 413);
});
test("events require a session ID and route to its actor", async () => {
  const h = harness();
  assert.equal((await h.request("/events", undefined, { authorization: "Bearer api-secret" }, "GET")).status, 400);
  assert.equal((await h.request("/events?sessionId=session-one", undefined, { authorization: "Bearer api-secret" }, "GET")).status, 200);
  assert.deepEqual(h.opens, [{ id: "session-one", workspaceSlug: "agents", keepAliveSeconds: 300 }]);
});
test("issue redeliveries route to the same issue actor", async () => {
  const h = harness();
  const payload = { action: "opened", repository: { full_name: "owner/repo" }, issue: { number: 3, title: "Bug", body: null, author_association: "OWNER" } };
  const headers = { "x-github-event": "issues", "x-github-delivery": "first", "x-hub-signature-256": `sha256=${createHmac("sha256", "webhook-secret").update(JSON.stringify(payload)).digest("hex")}` };
  const first = await (await h.request("/webhooks/github", payload, headers)).json() as { sessionId: string; events: string };
  const second = await (await h.request("/webhooks/github", payload, { ...headers, "x-github-delivery": "second" })).json() as { sessionId: string };
  assert.equal(first.sessionId, second.sessionId);
  assert.ok(first.sessionId.startsWith("issue-"));
  assert.equal(first.events, `/events?sessionId=${first.sessionId}`);
  assert.deepEqual(h.opens[0], h.opens[1]);
});
test("rejects provider objects for sessions and issue rules", async () => {
  const h = harness();
  for (const value of [{ providerID: "anthropic", modelID: "chosen" }, { providerID: "openrouter", modelID: "chosen" }, "", null]) {
    assert.equal((await h.request("/sessions", { repository: "owner/repo", prompt: "Fix", model: value })).status, 400);
    assert.equal((await h.request("/github/issue-rules", { repository: "owner/repo", model: value }, { authorization: "Bearer api-secret" }, "PUT")).status, 400);
  }
  assert.equal(h.commands.length, 0);
});

test("dispatch returns a turn stream URL; turn streaming validates identity and authentication", async () => {
  const h = harness();
  const created = await (await h.request("/sessions", { repository: "owner/repo", prompt: "Hello", model })).json() as { sessionId: string; stream: string };
  assert.equal(created.stream, `/turns/events?sessionId=${created.sessionId}&messageId=message-1`);
  assert.equal((await h.request("/turns/events?sessionId=one", undefined, {}, "GET")).status, 401);
  assert.equal((await h.request("/turns/events?sessionId=one", undefined, { authorization: "Bearer api-secret" }, "GET")).status, 400);
  const response = await h.request(`/turns/events?sessionId=one&messageId=msg_${"1".repeat(32)}`, undefined, { authorization: "Bearer api-secret" }, "GET");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/event-stream");
  await response.body?.cancel();
});

test("webhook logs explain rejection and decisions without payloads or credentials", async t => {
  const logs: { level: string; entry: Record<string, unknown> }[] = [];
  for (const level of ["info", "warn", "error"] as const) {
    t.mock.method(console, level, (line: string) => logs.push({ level, entry: JSON.parse(line) }));
  }
  const h = harness();
  const payload = { action: "opened", repository: { full_name: "other/repo" }, issue: { number: 42, title: "private-title", body: "private-body", author_association: "OWNER" } };
  const headers = (value: unknown) => ({ "x-github-event": "issues", "x-github-delivery": "delivery-log-test", authorization: "Bearer private-token", "x-hub-signature-256": `sha256=${createHmac("sha256", "webhook-secret").update(JSON.stringify(value)).digest("hex")}` });
  assert.equal((await h.request("/webhooks/github", payload, headers(payload))).status, 400);
  assert.deepEqual(logs.at(-1), { level: "warn", entry: { component: "agent-api", event: "webhook.rejected", method: "POST", path: "/webhooks/github", status: 400, deliveryId: "delivery-log-test", githubEvent: "issues", action: "opened", repository: "other/repo", issue: 42, reason: "repository_not_enabled" } });
  assert.equal(h.commands.length, 0);
  await h.request("/webhooks/github", payload, {});
  assert.equal(logs.at(-1)?.entry.reason, "invalid_signature");
  const ignored = { ...payload, action: "edited" };
  await h.request("/webhooks/github", ignored, headers(ignored));
  assert.equal(logs.at(-1)?.entry.event, "webhook.ignored");
  assert.equal(logs.at(-1)?.entry.reason, "unsupported_action");
  const accepted = { ...payload, repository: { full_name: "owner/repo" } };
  await h.request("/webhooks/github", accepted, headers(accepted));
  assert.equal(logs.at(-1)?.entry.event, "webhook.accepted");
  assert.ok(logs.some(x => x.entry.event === "session.dispatched" && x.entry.messageId === "message-1"));
  const serialized = JSON.stringify(logs);
  for (const secret of ["private-title", "private-body", "private-token", "webhook-secret", "sha256="]) assert.equal(serialized.includes(secret), false);
});

test("unexpected dispatch errors are logged without exception secrets", async t => {
  const logs: string[] = [];
  t.mock.method(console, "error", (line: string) => logs.push(line));
  const app = { sessions: { open() { return { dispatch() { throw new Error("upstream credential: private-secret"); } }; } } } as unknown as CantelopApp<Command>;
  const router = api.create({ app, env: { API_TOKEN: "api-secret", GITHUB_REPOSITORIES: "owner/repo" } });
  const response = await router.handle(new Request("https://example.com/sessions", { method: "POST", headers: { authorization: "Bearer api-secret" }, body: JSON.stringify({ repository: "owner/repo", model, prompt: "private-prompt" }) }));
  assert.equal(response.status, 503);
  assert.equal(JSON.parse(logs[0]!).reason, "service_unavailable");
  assert.equal(JSON.parse(logs[0]!).event, "request.failed");
  assert.equal(logs.join().includes("private-"), false);
});

test("serves the operator console without authentication and without embedding secrets", async () => {
  const h = harness();
  const response = await h.request("/", undefined, {}, "GET");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html/);
  assert.match(response.headers.get("content-security-policy") ?? "", /connect-src 'self'/);
  const html = await response.text();
  assert.match(html, /<title>Agent Console<\/title>/);
  assert.match(html, /id="steer"[^>]*>Steer/);
  assert.match(html, /id="send"[^>]*>Queue/);
  assert.match(html, /case 'queued'/);
  assert.match(html, /prompt: prompt, mode: mode/);
  for (const secret of ["api-secret", "webhook-secret"]) assert.equal(html.includes(secret), false);
  assert.equal(h.commands.length, 0);
});

test("operator console browser script is valid JavaScript", () => {
  const script = ui.match(/<script>([\s\S]*)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Function(script));
});

test("reindex requires authentication and dispatches to a dedicated workspace actor", async () => {
  const h = harness();
  assert.equal((await h.request("/sessions/reindex", {}, {})).status, 401);
  const response = await h.request("/sessions/reindex", {});
  assert.equal(response.status, 202);
  assert.deepEqual(h.commands, [{ type: "reindex" }]);
  assert.match((await response.json() as { sessionId: string }).sessionId, /^reindex-/);
});

test("follow-up mode supports queue and steer and rejects invalid modes", async () => {
  const h = harness();
  for (const mode of ["queue", "steer"] as const) {
    assert.equal((await h.request("/sessions/messages", { sessionId: "one", prompt: "Continue", mode })).status, 202);
    assert.deepEqual(h.commands.at(-1), { type: "prompt", sessionId: "one", prompt: "Continue", mode });
  }
  for (const mode of ["interrupt", "", null, 1]) {
    assert.equal((await h.request("/sessions/messages", { sessionId: "one", prompt: "Continue", mode })).status, 400);
  }
});
