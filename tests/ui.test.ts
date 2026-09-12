import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { ui } from "../src/ui.js";

function harness() {
  const source = ui.slice(ui.indexOf('  function applySnapshot('), ui.indexOf('  // Older snapshots'));
  return runInNewContext(`
    var active = {}, current = 'issue-1';
    function save() {} function show() {} function renderSidebar() {}
    function time(value) { return Date.parse(value); }
    ${source}
    ({ applySnapshot, active });
  `);
}
test("opening a webhook snapshot discovers its stream and restores completed tools", () => {
  const h = harness();
  const session: any = { id: "issue-1", turns: [] };
  const snapshot = { messageId: "msg_" + "a".repeat(32), prompt: "Issue task", status: "running" };
  h.applySnapshot(session, snapshot);
  assert.equal(session.turns[0].stream, `/turns/events?sessionId=issue-1&messageId=${snapshot.messageId}`);
  assert.equal(session.turns[0].status, "running");
  const tools = [{ partId: "p1", tool: "bash", status: "completed" }];
  h.applySnapshot(session, { ...snapshot, status: "completed", response: "Done", tools });
  assert.deepEqual(session.turns[0].tools, tools);
  h.applySnapshot(session, { ...snapshot, messageId: "msg_" + "b".repeat(32) });
  assert.equal(session.turns.length, 2);
});
test("legacy cached summaries upgrade without duplicating the turn", () => {
  const h = harness();
  const session: any = { id: "issue-1", turns: [{ messageId: "stored", status: "completed", tools: [] }] };
  const tools = [{ partId: "p1", tool: "read", status: "completed" }];
  h.applySnapshot(session, { messageId: "msg_" + "a".repeat(32), prompt: "Issue", status: "completed", tools });
  assert.equal(session.turns.length, 1);
  assert.deepEqual(session.turns[0].tools, tools);
});

test("running snapshots restore diagnostic phase and tools without replay", () => {
  const h = harness();
  const session: any = { id: "issue-1", turns: [] };
  const runtimeStatus = { phase: "opencode_retry", attempt: 2 };
  const tools = [{ partId: "p", tool: "read", status: "running" }];
  h.applySnapshot(session, { messageId: "m1", prompt: "Issue", status: "running", runtimeStatus, tools });
  assert.equal(session.turns[0].phase, "opencode_retry");
  assert.deepEqual(session.turns[0].runtimeStatus, runtimeStatus);
  assert.deepEqual(session.turns[0].tools, tools);
});

function streamHarness(fetch: any, state: any = {}) {
  const source = ui.slice(ui.indexOf('  async function streamRequest('), ui.indexOf('  // ---------- Sessions ----------'));
  return runInNewContext(`${source}; ({ streamRequest, state });`, {
    state, fetch, URL, location: { origin: "https://example.com" },
    headers: (extra: object = {}) => extra, save() {},
    setTimeout: (fn: () => void) => fn(),
    readEvents: async (body: any, receive: any) => { for (const frame of body) if (receive(frame)) return true; return false; },
  });
}
test("follow-ups inherit session cursor and reconnect retains the exact turn cursor", async () => {
  const calls: any[] = [];
  const h = streamHarness(async (url: string, options: any) => {
    calls.push({ url, headers: options.headers });
    return { ok: true, body: [{ id: String(calls.length + 40), data: JSON.stringify({ type: "completed" }) }] };
  });
  const first = '/turns/events?sessionId=one&messageId=first';
  const second = '/turns/events?sessionId=one&messageId=second';
  for (const url of [first, second, first]) await h.streamRequest(url, () => true, assert.fail);
  assert.equal(calls[0].headers['last-event-id'], undefined);
  assert.equal(calls[1].headers['last-event-id'], '41');
  assert.equal(calls[2].headers['last-event-id'], '41');
});
test("expired replay polls only the requested turn through waiting to completion", async () => {
  let n = 0;
  const events: any[] = [];
  const calls: string[] = [];
  const h = streamHarness(async (url: string) => {
    calls.push(url); n++;
    if (n === 1) return { status: 409, json: async () => ({ error: { code: 'event_cursor_expired' } }) };
    if (n === 2) return { status: 404 }; // not yet admitted/indexed
    if (n === 3) return { ok: true, json: async () => ({ turn: { progress: { type: 'status', messageId: 'second', data: { phase: 'waiting_for_workspace' } } } }) };
    return { ok: true, json: async () => ({ turn: { result: { type: 'completed', messageId: 'second', data: { response: 'Second result' } } } }) };
  });
  assert.equal(await h.streamRequest('/turns/events?sessionId=one&messageId=second', (e: any) => events.push(e), assert.fail), true);
  assert.deepEqual(events.map(e => e.type), ['status', 'completed']);
  assert.ok(calls.slice(1).every(url => url === '/turns/inspect?sessionId=one&messageId=second'));
});
