import { readFile, readdir } from "node:fs/promises";
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
    const stored = JSON.parse(await readFile(file, "utf8")) as StoredSession;
    if (!stored || `${sessionId(stored.sessionId)}.json` !== name) throw new Error("Invalid session snapshot");
    // Import without rewriting snapshots that live turns may be updating.
    await database.save(stored);
    count++;
  }
  return count;
}
