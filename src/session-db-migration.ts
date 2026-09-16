import { open, readdir } from "node:fs/promises";
import path from "node:path";
import { sessionId } from "./contracts.js";
import type { SessionDatabase, StoredSession } from "./session-db.js";

/** Also repairs the query index after a database outage. Never runs agent side effects. */
export async function backfillSessions(root: string, database: SessionDatabase, signal: AbortSignal) {
  signal.throwIfAborted();
  const directory = path.join(root, ".agent-api", "sessions");
  let files: string[];
  try { files = await readdir(directory); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0; throw error; }
  let count = 0;
  for (const name of files.filter(name => name.endsWith(".json")).sort()) {
    signal.throwIfAborted();
    const file = path.join(directory, name);
    // Read metadata and contents from the same inode even if a turn replaces it.
    const snapshot = await open(file, "r");
    let stored: StoredSession;
    let timestamp: string;
    try {
      timestamp = (await snapshot.stat()).mtime.toISOString();
      stored = JSON.parse(await snapshot.readFile("utf8")) as StoredSession;
    } finally { await snapshot.close(); }
    if (!stored || `${sessionId(stored.sessionId)}.json` !== name) throw new Error("Invalid session snapshot");
    // Do not rewrite snapshots: a live turn may have saved a newer version.
    stored.createdAt ??= timestamp;
    stored.updatedAt ??= timestamp;
    await database.save(stored);
    count++;
  }
  return count;
}
