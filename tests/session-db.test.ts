import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createClient } from "@libsql/client";
import type { CantelopApp } from "@cantelop/sdk/api";
import { createApi } from "../src/api.js";
import { SessionDatabase, parseSessionQuery, type StoredSession } from "../src/session-db.js";
import { backfillSessions } from "../src/session-db-migration.js";
import { handle, type Dependencies } from "../src/worker.js";
import { readJSON, saveJSON } from "../src/runtime.js";
import type { Command } from "../src/contracts.js";

const env = { API_TOKEN: "token", GITHUB_REPOSITORIES: "owner/repo", GITHUB_TOKEN: "github", OPENROUTER_API_KEY: "router", GITHUB_ISSUE_MODEL: "model" };
const snapshot = (id: string, changes: Partial<StoredSession> = {}): StoredSession => ({
  sessionId: id, repository: "owner/repo", model: "model", prompt: "Start", status: "running",
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", ...changes,
});
async function harness(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "sessions-db-"));
  const url = `file:${path.join(root, "sessions.db")}`;
  const client = createClient({ url });
  t.after(async () => { client.close(); await rm(root, { recursive: true, force: true }); });
  const db = new SessionDatabase(client, "agents");
  await db.initialize();
  const router = createApi(() => db).create({ app: {} as CantelopApp<Command>, env });
  const request = (query: string, token = "token") => router.handle(new Request(`https://example.com${query}`, { headers: { authorization: `Bearer ${token}` } }));
  return { root, db, url, request };
}

test("SQL snapshots survive reopening and stale writes cannot overwrite newer results", async t => {
  const h = await harness(t);
  await h.db.initialize(); // migration is idempotent
  await h.db.save(snapshot("one"));
  await h.db.save(snapshot("one", { status: "completed", response: "Done", updatedAt: "2026-01-02T00:00:00.000Z" }));
  await h.db.save(snapshot("one"));
  const other = createClient({ url: h.url });
  try {
    assert.equal((await new SessionDatabase(other, "agents").get("one"))?.response, "Done");
    assert.equal(await new SessionDatabase(other, "other").get("one"), null);
  } finally { other.close(); }
});

test("authenticated GET reads snapshots and paginates ties without duplication", async t => {
  const h = await harness(t);
  for (const id of ["a", "b", "c"]) await h.db.save(snapshot(id, { response: "private result" }));
  assert.equal((await h.request("/sessions", "wrong")).status, 401);
  assert.equal((await h.request("/sessions/inspect?sessionId=a", "wrong")).status, 401);
  const response = await h.request("/sessions?limit=2");
  assert.equal(response.headers.get("cache-control"), "no-store");
  const first = await response.json();
  assert.deepEqual(first.sessions.map((s: StoredSession) => s.sessionId), ["c", "b"]);
  assert.ok(!JSON.stringify(first).includes("private result"));
  const next = await (await h.request(`/sessions?limit=2&cursor=${encodeURIComponent(first.nextCursor)}`)).json();
  assert.deepEqual(next.sessions.map((s: StoredSession) => s.sessionId), ["a"]);
  assert.equal(next.nextCursor, null);
  assert.equal((await (await h.request("/sessions/inspect?sessionId=a")).json()).session.response, "private result");
  assert.equal((await h.request("/sessions/inspect?sessionId=missing")).status, 404);
});

test("query filters are parameterized, bounded, validated and workspace scoped", async t => {
  const h = await harness(t);
  await h.db.save(snapshot("a"));
  await h.db.save(snapshot("b", { status: "failed" }));
  await new SessionDatabase(h.db.client, "other").save(snapshot("c"));
  const filtered = await (await h.request("/sessions?status=failed&repository=OWNER/REPO")).json();
  assert.deepEqual(filtered.sessions.map((s: StoredSession) => s.sessionId), ["b"]);
  assert.equal((await h.db.list({ limit: 50, repository: "' OR 1=1 --" })).sessions.length, 0);
  for (const query of ["limit=0", "limit=101", "limit=1.2", "limit=1e2", "limit=", "status=queued", "cursor=oops", "repository=other/repo"]) {
    assert.equal((await h.request(`/sessions?${query}`)).status, 400, query);
  }
  assert.equal((await h.request("/sessions/inspect?sessionId=../bad")).status, 400);
  assert.equal(parseSessionQuery(new URLSearchParams()).limit, 50);
});

test("database failures and missing configuration return sanitized 503 responses", async t => {
  const h = await harness(t);
  t.mock.method(h.db, "list", async () => { throw new TypeError("secret database token"); });
  const failed = await h.request("/sessions");
  assert.equal(failed.status, 503);
  assert.deepEqual(await failed.json(), { error: "Service unavailable" });
  const router = createApi(() => undefined).create({ app: {} as CantelopApp<Command>, env });
  assert.equal((await router.handle(new Request("https://example.com/sessions", { headers: { authorization: "Bearer token" } }))).status, 503);
});

test("worker indexes running, OpenCode ID, completion, follow-up and failure snapshots", async t => {
  const h = await harness(t);
  const deps: Dependencies = {
    sessionDatabase: () => h.db,
    async checkout() { assert.equal((await h.db.get("one"))?.status, "running"); return h.root; },
    async runAgent(options) {
      if (!options.id) await options.onCreated("opencode-1");
      assert.equal((await h.db.get("one"))?.opencodeId, "opencode-1");
      return "Done";
    },
    async comment() {},
  };
  const run = (command: Command, id: string) => handle(h.root, command, id, env, new AbortController().signal, deps);
  assert.equal((await run({ type: "create", spec: snapshot("one") }, "m1")).type, "completed");
  const createdAt = (await h.db.get("one"))?.createdAt;
  assert.equal((await run({ type: "prompt", sessionId: "one", prompt: "Again" }, "m2")).type, "completed");
  assert.equal((await h.db.get("one"))?.prompt, "Again");
  assert.equal((await h.db.get("one"))?.createdAt, createdAt);
  deps.runAgent = async () => { throw new Error("secret failure"); };
  assert.equal((await run({ type: "prompt", sessionId: "one", prompt: "Fail" }, "m3")).type, "failed");
  assert.equal((await h.db.get("one"))?.status, "failed");
  assert.ok(!JSON.stringify(await h.db.get("one")).includes("secret failure"));
});

test("GitHub issue sessions are queryable and duplicate deliveries do not rerun", async t => {
  const h = await harness(t);
  let runs = 0;
  const deps: Dependencies = { sessionDatabase: () => h.db, async checkout() { return h.root; }, async runAgent() { runs++; return "Fixed"; }, async comment() {} };
  const command: Command = { type: "issue", deliveryId: "delivery", issue: { number: 1, repository: "owner/repo", title: "Fix", body: "", association: "OWNER" } };
  await handle(h.root, command, "m1", env, new AbortController().signal, deps);
  await handle(h.root, command, "m2", env, new AbortController().signal, deps);
  const result = await h.db.list({ limit: 50 });
  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0]?.status, "completed");
  assert.equal(runs, 1);
});

test("backfill migrates legacy timestamps and repairs an index after an outage", async t => {
  const h = await harness(t);
  const file = path.join(h.root, ".agent-api", "sessions", "old.json");
  await saveJSON(file, snapshot("old", { createdAt: undefined, updatedAt: undefined, status: "completed" }));
  assert.equal(await backfillSessions(h.root, h.db, new AbortController().signal), 1);
  const first = await h.db.get("old");
  assert.ok(first?.createdAt);
  await backfillSessions(h.root, h.db, new AbortController().signal);
  assert.deepEqual(await h.db.get("old"), first);
  await saveJSON(file, { ...first, updatedAt: "2099-01-01T00:00:00.000Z", status: "failed" });
  await backfillSessions(h.root, h.db, new AbortController().signal);
  assert.equal((await h.db.get("old"))?.status, "failed");
});

test("an unavailable database prevents agent side effects and preserves inspectable failure", async t => {
  const h = await harness(t);
  t.mock.method(h.db, "save", async () => { throw new Error("database unavailable"); });
  const deps: Dependencies = { sessionDatabase: () => h.db, async checkout() { assert.fail("must not start"); }, async runAgent() { assert.fail("must not run"); }, async comment() {} };
  await assert.rejects(handle(h.root, { type: "create", spec: snapshot("one") }, "m1", env, new AbortController().signal, deps));
  assert.equal((await readJSON<StoredSession>(path.join(h.root, ".agent-api", "sessions", "one.json")))?.status, "failed");
});
