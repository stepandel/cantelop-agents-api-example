import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout } from "node:timers/promises";

// Atomic directory creation coordinates independent processes sharing the workspace.
// Never expire/steal this lock: a paused owner may still be running Git or tools.
export async function withWorkspaceLock<T>(root: string, signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  const directory = path.join(root, ".agent-api");
  const lock = path.join(directory, "workspace.lock");
  await mkdir(directory, { recursive: true });
  while (true) {
    signal.throwIfAborted();
    try { await mkdir(lock); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await setTimeout(250, undefined, { signal });
    }
  }
  try {
    await writeFile(path.join(lock, "owner.json"), JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }));
    signal.throwIfAborted();
    return await work();
  } finally {
    await rm(lock, { recursive: true });
  }
}
