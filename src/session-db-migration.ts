import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { withWorkspaceLock } from "./lock.js";
import { readJSON, saveJSON } from "./runtime.js";
import { sessionId } from "./contracts.js";
import type { SessionDatabase, StoredSession } from "./session-db.js";

/** Also repairs the query index after a database outage. Never runs agent side effects. */
export async function backfillSessions(root: string, database: SessionDatabase, signal: AbortSignal) {
  return withWorkspaceLock(root, signal, async () => {
    const directory = path.join(root, ".agent-api", "sessions");
    let files: string[];
    try { files = await readdir(directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0; throw error; }
    let count = 0;
    for (const name of files.filter(name => name.endsWith(".json")).sort()) {
      signal.throwIfAborted();
      const file = path.join(directory, name);
      const stored = await readJSON<StoredSession>(file);
      if (!stored || `${sessionId(stored.sessionId)}.json` !== name) throw new Error("Invalid session snapshot");
      // Old snapshots have no timestamps. Use their mtime, then persist it so reruns are stable.
      const timestamp = (await stat(file)).mtime.toISOString();
      stored.createdAt ??= timestamp;
      stored.updatedAt ??= timestamp;
      await saveJSON(file, stored);
      await database.save(stored);
      count++;
    }
    return count;
  });
}
