/** Incremental SSE decoder shared by the upstream and public stream adapters. */
export async function* readSSE(body: ReadableStream<Uint8Array>, signal?: AbortSignal) {
  const reader = body.getReader();
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const decoder = new TextDecoder();
  let buffer = "";
  let data: string[] = [], id = "", event = "";
  try {
    while (true) {
      const chunk = await reader.read();
      buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        if (!line) {
          if (data.length) yield { id, event, data: data.join("\n") };
          else yield { id: "", event: "", data: "" };
          data = []; event = "";
        } else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
        else if (line.startsWith("id:") && !line.includes("\0")) id = line.slice(3).replace(/^ /, "");
        else if (line.startsWith("event:")) event = line.slice(6).replace(/^ /, "");
        if (data.reduce((n, value) => n + value.length, 0) > 2_000_000) throw new Error("SSE event too large");
      }
      if (buffer.length > 2_000_000) throw new Error("SSE line too large");
      if (chunk.done) break;
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
