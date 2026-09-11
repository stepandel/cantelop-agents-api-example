import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import api from "../src/api.js";
import type { CantelopApp } from "@cantelop/sdk/api";
import type { Command } from "../src/contracts.js";
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
const model = { providerID: "provider", modelID: "requested-model" };
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
  assert.deepEqual(h.opens[0], { id: first.spec.sessionId, workspaceSlug: "agents", keepAliveSeconds: 3600 });
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
  assert.deepEqual(h.opens, [{ id: "session-one", workspaceSlug: "agents", keepAliveSeconds: 3600 }]);
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
