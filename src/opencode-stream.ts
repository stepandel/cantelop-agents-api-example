import type { Progress } from "./contracts.js";
import { readSSE } from "./sse.js";
type RecordValue = Record<string, any>;
const record = (value: unknown): value is RecordValue => value !== null && typeof value === "object";

/** Supports both OpenCode's part snapshots and separate v2 text deltas. */
export class OpenCodeProgress {
  private assistants = new Set<string>();
  private parts = new Map<string, { messageId: string; type: string; text: string; status?: string }>();
  constructor(private sessionId: string) {}
  accept(value: unknown): Progress[] {
    if (!record(value) || !record(value.properties)) return [];
    const p = value.properties;
    if (value.type === "message.updated" && p.info?.sessionID === this.sessionId && p.info.role === "assistant") {
      if (this.assistants.size > 10000) throw new Error("Too many streamed messages");
      this.assistants.add(p.info.id); return [];
    }
    if (value.type === "message.part.updated") {
      const part = p.part;
      if (!record(part) || part.sessionID !== this.sessionId || !this.assistants.has(part.messageID) || typeof part.id !== "string") return [];
      if (this.parts.size > 10000) throw new Error("Too many streamed parts");
      const old = this.parts.get(part.id);
      if (part.type === "text" && typeof part.text === "string") {
        this.parts.set(part.id, { messageId: part.messageID, type: "text", text: part.text });
        const prior = old?.text ?? "";
        if (prior === part.text) return [];
        return [{ type: part.text.startsWith(prior) ? "text.delta" : "text.replace",
          data: { partId: part.id, text: part.text.startsWith(prior) ? part.text.slice(prior.length) : part.text } }];
      }
      if (part.type === "tool" && record(part.state) && ["pending", "running", "completed", "error"].includes(part.state.status)) {
        if (old?.status === part.state.status) return [];
        this.parts.set(part.id, { messageId: part.messageID, type: "tool", text: "", status: part.state.status });
        // Never forward inputs, output, error text, titles, metadata or reasoning.
        return [{ type: "tool.status", data: { partId: part.id, tool: String(part.tool).slice(0, 100), status: part.state.status } }];
      }
    }
    if (value.type === "message.part.delta" && p.sessionID === this.sessionId && p.field === "text" && typeof p.delta === "string") {
      const part = this.parts.get(p.partID);
      if (!part || part.type !== "text" || part.messageId !== p.messageID || !this.assistants.has(p.messageID)) return [];
      part.text += p.delta;
      return p.delta ? [{ type: "text.delta", data: { partId: p.partID, text: p.delta } }] : [];
    }
    return [];
  }
}

export async function withOpenCodeStream<T>(options: {
  url: string; directory: string; sessionId: string; signal: AbortSignal;
  emit: (event: Progress) => Promise<void>;
  prompt: (signal: AbortSignal) => Promise<T>;
  finalEvents?: (result: NoInfer<T>) => unknown[];
}): Promise<T> {
  const controller = new AbortController();
  const signal = AbortSignal.any([options.signal, controller.signal]);
  // Await response headers before sending the prompt so its first tokens cannot
  // race subscription setup. Do not silently reconnect without upstream replay.
  const connectTimer = setTimeout(() => controller.abort(), 30000);
  let response: Response;
  try { response = await fetch(`${options.url}/event?directory=${encodeURIComponent(options.directory)}`, { signal, headers: { accept: "text/event-stream" } });
  } finally { clearTimeout(connectTimer); }
  if (!response.ok || !response.body) throw new Error("OpenCode stream unavailable");
  const progress = new OpenCodeProgress(options.sessionId);
  let finishing = false;
  const pump = (async () => {
    for await (const frame of readSSE(response.body!, signal)) {
      if (!frame.data) continue;
      const event: unknown = JSON.parse(frame.data);
      for (const update of progress.accept(event)) await options.emit(update);
    }
    if (!finishing) throw new Error("OpenCode stream ended before prompt completion");
  })();
  // Attach the rejection handler before starting any other async operation.
  void pump.catch(() => undefined);
  let result: T;
  try {
    result = await Promise.race([options.prompt(signal), pump.then(() => { throw new Error("OpenCode stream interrupted"); })]);
  } finally {
    finishing = true;
    controller.abort();
    await pump.catch(error => { if (!signal.aborted) throw error; });
  }
  // HTTP completion may race the last SSE frames. Reconcile final snapshots
  // after the pump has stopped, emitting only text not already delivered.
  for (const event of options.finalEvents?.(result) ?? []) {
    for (const update of progress.accept(event)) await options.emit(update);
  }
  return result;
}
