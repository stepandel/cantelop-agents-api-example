// Run inside the built image with this project mounted read-only at /app.
// No provider credentials, model calls, or GitHub writes are needed.
import { createOpencodeServer, createOpencodeClient } from "@opencode-ai/sdk";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
await mkdir("/tmp/opencode-smoke", { recursive: true });
process.chdir("/tmp/opencode-smoke");
process.env.HOME = "/tmp/opencode-smoke";
const config = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT ?? "{}");
const server = await createOpencodeServer({ port: 0, timeout: 30000, config });
try {
  const client = createOpencodeClient({ baseUrl: server.url, throwOnError: true });
  const effective = await client.config.get();
  if (config.permission) assert.deepEqual(effective.data?.permission, config.permission);
  if (config.permission?.["*"] === "allow") {
    const build = (await client.app.agents()).data?.find(agent => agent.name === "build");
    assert.ok(Array.isArray(build?.permission));
    for (const tool of ["bash", "edit", "webfetch", "external_directory", "doom_loop", "read", "question"]) {
      const rule = build.permission.findLast(rule => (rule.permission === "*" || rule.permission === tool) && rule.pattern === "*");
      assert.equal(rule?.action, tool === "question" ? "deny" : "allow", `Unexpected ${tool} permission`);
    }
  }
  const result = await client.session.create({ body: { title: "Scaffold smoke test" }, query: { directory: process.cwd() } });
  if (!result.data?.id) throw new Error("No session ID returned");
  const loaded = await client.session.get({ path: { id: result.data.id }, query: { directory: process.cwd() } });
  if (loaded.data?.id !== result.data.id) throw new Error("Session could not be retrieved");
  console.log("OpenCode startup, permission configuration, session creation, and retrieval passed.");
} finally {
  server.close();
}
