import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { readSSE } from "../src/sse.js";
import { turnStream } from "../src/turn-stream.js";
import { OpenCodeProgress, withOpenCodeStream } from "../src/opencode-stream.js";
import type { Progress } from "../src/contracts.js";
const encode = new TextEncoder();

test("SSE decoding handles split UTF-8, CRLF and multiline data", async () => {
  const bytes = encode.encode('id: cursor:1\r\nevent: text.delta\r\ndata: {"text":\r\ndata: "你好"}\r\n\r\n');
  const body = new ReadableStream<Uint8Array>({ start(c) { for (const byte of bytes) c.enqueue(Uint8Array.of(byte)); c.close(); } });
  const frames = [];
  for await (const frame of readSSE(body)) frames.push(frame);
  assert.equal(frames.length, 1);
  assert.equal(frames[0]?.id, "cursor:1");
  assert.deepEqual(JSON.parse(frames[0]!.data), { text: "你好" });
});

test("turn stream filters other requests, strips transport metadata and closes upstream on terminal", async () => {
  let cancelled = false;
  const frame = (messageId: string, type: string, n: number) => encode.encode(`id: cursor:${n}\ndata: ${JSON.stringify({ message_id: "activity-owner", source_sandbox_id: "private-sandbox", data: { type, messageId, data: { text: "hello" } } })}\n\n`);
  const source = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(frame("other", "completed", 1)); c.enqueue(frame("wanted", "queued", 2)); c.enqueue(frame("wanted", "text.delta", 2)); c.enqueue(frame("wanted", "completed", 3)); }, cancel() { cancelled = true; } });
  const response = turnStream(new Response(source), "wanted");
  const output = await response.text();
  assert.match(output, /event: queued/);
  assert.match(output, /event: text.delta/);
  assert.match(output, /id: cursor:3\nevent: completed/);
  assert.doesNotMatch(output, /private-sandbox|other|source_sandbox_id/);
  assert.equal(cancelled, true);
});

test("disconnect cancels a pending upstream read", async () => {
  let cancelled = false;
  const response = turnStream(new Response(new ReadableStream({ cancel() { cancelled = true; } })), "wanted");
  const reader = response.body!.getReader();
  const pending = reader.read();
  await delay(5);
  await reader.cancel();
  await pending;
  assert.equal(cancelled, true);
});

test("OpenCode mapping isolates assistant text, suppresses snapshot duplicates and sanitizes tool progress", () => {
  const map = new OpenCodeProgress("session");
  const updated = (part: unknown) => ({ type: "message.part.updated", properties: { part } });
  const text = { sessionID: "session", messageID: "assistant", id: "part", type: "text", text: "" };
  assert.deepEqual(map.accept(updated({ ...text, text: "user secret" })), []);
  map.accept({ type: "message.updated", properties: { info: { sessionID: "session", id: "assistant", role: "assistant" } } });
  map.accept(updated(text));
  assert.deepEqual(map.accept({ type: "message.part.delta", properties: { sessionID: "session", messageID: "assistant", partID: "part", field: "text", delta: "Hello" } }), [{ type: "text.delta", data: { partId: "part", text: "Hello" } }]);
  assert.deepEqual(map.accept(updated({ ...text, text: "Hello" })), []);
  assert.deepEqual(map.accept(updated({ ...text, text: "Hello world" })), [{ type: "text.delta", data: { partId: "part", text: " world" } }]);
  assert.deepEqual(map.accept(updated({ ...text, text: "Correction" })), [{ type: "text.replace", data: { partId: "part", text: "Correction" } }]);
  assert.deepEqual(map.accept(updated({ ...text, sessionID: "other", text: "private" })), []);
  assert.deepEqual(map.accept(updated({ ...text, id: "reasoning", type: "reasoning", text: "private" })), []);
  const tool = { ...text, id: "tool", type: "tool", tool: "bash", state: { status: "running", input: { command: "private" }, title: "private", output: "secret" } };
  assert.deepEqual(map.accept(updated(tool)), [{ type: "tool.status", data: { partId: "tool", tool: "bash", status: "running" } }]);
  assert.deepEqual(map.accept(updated(tool)), []);
});

test("OpenCode subscription precedes prompt and emits text while prompt is still running", async t => {
  let connected = false, finished = false;
  let stream: import("node:http").ServerResponse;
  const server = createServer((req, res) => {
    assert.ok(req.url?.startsWith("/event?directory="));
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write('data: {"type":"server.connected","properties":{}}\n\n');
    connected = true; stream = res;
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address(); assert.ok(address && typeof address !== "string");
  let sawDelta!: () => void;
  const delta = new Promise<void>(resolve => { sawDelta = resolve; });
  const emitted: Progress[] = [];
  const result = await withOpenCodeStream({ url: `http://127.0.0.1:${address.port}`, directory: "/test dir", sessionId: "session", signal: AbortSignal.timeout(5000),
    async emit(event) { if (!emitted.length) assert.equal(finished, false); emitted.push(event); sawDelta(); },
    finalEvents: () => [{ type: "message.part.updated", properties: { part: { id: "p", messageID: "a", sessionID: "session", type: "text", text: "Streaming tail" } } }],
    async prompt() {
      assert.equal(connected, true);
      for (const event of [
        { type: "message.updated", properties: { info: { id: "a", sessionID: "session", role: "assistant" } } },
        { type: "message.part.updated", properties: { part: { id: "p", messageID: "a", sessionID: "session", type: "text", text: "Streaming" } } },
      ]) stream.write(`data: ${JSON.stringify(event)}\n\n`);
      await delta;
      finished = true; return "done";
    },
  });
  assert.equal(result, "done");
  assert.deepEqual(emitted, [{ type: "text.delta", data: { partId: "p", text: "Streaming" } }, { type: "text.delta", data: { partId: "p", text: " tail" } }]);
});
