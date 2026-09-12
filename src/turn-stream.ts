import { readSSE } from "./sse.js";
const terminal = new Set(["completed", "failed", "ignored", "configured", "session"]);
const allowed = new Set([...terminal, "started", "status", "text.delta", "text.replace", "tool.status"]);

/** Keep the platform replay cursor, expose only app data, and close this turn. */
export function turnStream(upstream: Response, messageId: string): Response {
  if (!upstream.ok || !upstream.body) return upstream;
  const cancel = new AbortController();
  const iterator = readSSE(upstream.body, cancel.signal);
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (true) {
          const next = await iterator.next();
          if (cancel.signal.aborted) return;
          if (next.done) { controller.close(); return; }
          const frame = next.value;
          if (!frame.data) { controller.enqueue(encoder.encode(": keep-alive\n\n")); return; }
          const envelope = JSON.parse(frame.data);
          const payload = envelope.data;
          if (envelope.message_id !== messageId || payload?.messageId !== messageId || !allowed.has(payload.type)) continue;
          controller.enqueue(encoder.encode(`${frame.id ? `id: ${frame.id}\n` : ""}event: ${payload.type}\ndata: ${JSON.stringify(payload)}\n\n`));
          if (terminal.has(payload.type)) { controller.close(); await iterator.return(); }
          return;
        }
      } catch (error) { controller.error(error); await iterator.return().catch(() => undefined); }
    },
    async cancel() { cancel.abort(); await iterator.return(); },
  });
  return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" } });
}
