// Run inside the built image with this project mounted read-only at /app.
// No provider credentials, model calls, or GitHub writes are needed.
import { createOpencodeServer, createOpencodeClient } from "@opencode-ai/sdk";
import { mkdir } from "node:fs/promises";
await mkdir("/tmp/opencode-smoke", { recursive: true });
process.chdir("/tmp/opencode-smoke");
process.env.HOME = "/tmp/opencode-smoke";
const server = await createOpencodeServer({ port: 0, timeout: 30000 });
try {
  const client = createOpencodeClient({ baseUrl: server.url, throwOnError: true });
  const result = await client.session.create({ body: { title: "Scaffold smoke test" }, query: { directory: process.cwd() } });
  if (!result.data?.id) throw new Error("No session ID returned");
  const loaded = await client.session.get({ path: { id: result.data.id }, query: { directory: process.cwd() } });
  if (loaded.data?.id !== result.data.id) throw new Error("Session could not be retrieved");
  console.log("OpenCode startup, session creation, and retrieval passed.");
} finally {
  server.close();
}
