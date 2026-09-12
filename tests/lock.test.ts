import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { withWorkspaceLock } from "../src/lock.js";

test("workspace lock excludes another process and releases after work", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "workspace-lock-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const signal = new AbortController().signal;
  await withWorkspaceLock(root, signal, async () => {
    const code = `import { withWorkspaceLock } from './src/lock.ts';
      try { await withWorkspaceLock(process.argv[1], AbortSignal.timeout(300), async () => { process.exitCode = 2; }); }
      catch (error) { if (error.name !== 'AbortError') throw error; }`;
    const child = spawn(process.execPath, [...(process.versions.bun ? [] : ["--import", "tsx"]), "--input-type=module", "-e", code, root], { stdio: "pipe" });
    let errors = "";
    child.stderr.on("data", chunk => { errors += chunk; });
    const exit = await new Promise<number | null>((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
    assert.equal(exit, 0, errors);
    await access(path.join(root, ".agent-api/workspace.lock/owner.json"));
  });
  let acquired = false;
  await withWorkspaceLock(root, signal, async () => { acquired = true; });
  assert.equal(acquired, true);
});

test("failed work releases the lock", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "workspace-lock-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const signal = new AbortController().signal;
  await assert.rejects(withWorkspaceLock(root, signal, async () => { throw new Error("test failure"); }), /test failure/);
  await withWorkspaceLock(root, AbortSignal.timeout(1000), async () => undefined);
});
