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
