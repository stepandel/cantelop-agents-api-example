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
test("new session requires a model and authentication; opens only the shared actor", async () => {
  const h = harness();
  const spec = { repository: "owner/repo", prompt: "Fix tests", model };
  assert.equal((await h.request("/sessions", spec, {})).status, 401);
  assert.equal((await h.request("/sessions", { ...spec, model: undefined })).status, 400);
  assert.equal((await h.request("/sessions", spec)).status, 202);
  assert.equal(h.commands.length, 1);
  assert.deepEqual(h.commands[0]?.type === "create" && h.commands[0].spec.model, model);
  assert.deepEqual(h.opens, [{ id: "agent-coordinator", workspaceSlug: "agents", keepAliveSeconds: 3600 }]);
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
