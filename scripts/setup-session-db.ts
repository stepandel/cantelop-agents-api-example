import path from "node:path";
import { sessionDatabase, type SessionDatabase } from "../src/session-db.js";
import { backfillSessions } from "../src/session-db-migration.js";

let database: SessionDatabase | undefined;
try {
  database = sessionDatabase(process.env);
  if (!database) throw new Error("Set SESSION_DATABASE_URL before running db:setup");
  await database.initialize();
  if (process.argv[2]) {
    const count = await backfillSessions(path.resolve(process.argv[2]), database, AbortSignal.timeout(30 * 60 * 1000));
    console.log(`Indexed ${count} session snapshots.`);
  } else console.log("Session database schema is ready. Pass a workspace path to backfill snapshots.");
} catch {
  console.error("Session database setup failed. Check database configuration, connectivity and workspace access.");
  process.exitCode = 1;
} finally { database?.client.close(); }
