import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runAgent, AgentError, stderrHints } from "../src/runtime.js";

test("OpenCode startup exit preserves safe diagnostics without stderr secrets", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "opencode-exit-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "opencode"), '#!/bin/sh\necho "secret-token private-prompt: out of memory" >&2\nexit 42\n', { mode: 0o700 });
  await assert.rejects(runAgent({ root, directory: root, env: { PATH: root, HOME: root, XDG_DATA_HOME: root, XDG_CONFIG_HOME: root }, model: "test/model", prompt: "private-prompt", signal: AbortSignal.timeout(5000), onCreated: async () => {} }), error => {
    assert.ok(error instanceof AgentError);
    assert.equal(error.diagnostic.phase, "startup");
    assert.equal(error.diagnostic.exitCode, 42);
    assert.deepEqual(error.diagnostic.stderrHints, ["memory_error"]);
    assert.doesNotMatch(JSON.stringify(error), /secret-token|private-prompt/);
    return true;
  });
});
test("stderr classification never returns arbitrary provider output", () => {
  assert.deepEqual(stderrHints("Authorization: Bearer abc123"), []);
  assert.deepEqual(stderrHints("EACCES /private/repo"), ["permission_denied"]);
});
