import { createClient, type Client, type InValue } from "@libsql/client/web";
import { sessionId, type SessionSpec } from "./contracts.js";

export interface StoredSession extends SessionSpec {
  /** The exact user input, before steering context is added to the agent prompt. */
  requestPrompt?: string;
  opencodeId?: string;
  status: "running" | "completed" | "failed";
  response?: string;
  diagnostic?: unknown;
  createdAt?: string;
  updatedAt?: string;
}
export interface SessionQuery {
  repository?: string;
  status?: StoredSession["status"];
  limit: number;
  before?: [string, string];
}
export const schema = [
  `CREATE TABLE IF NOT EXISTS agent_sessions (
    workspace TEXT NOT NULL, session_id TEXT NOT NULL, repository TEXT NOT NULL,
    model TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('running','completed','failed')),
    prompt_preview TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    snapshot TEXT NOT NULL, PRIMARY KEY (workspace, session_id)
  )`,
  `CREATE INDEX IF NOT EXISTS agent_sessions_created ON agent_sessions(workspace, created_at DESC, session_id DESC)`,
  `CREATE INDEX IF NOT EXISTS agent_sessions_repository ON agent_sessions(workspace, repository, created_at DESC, session_id DESC)`,
  `CREATE INDEX IF NOT EXISTS agent_sessions_status ON agent_sessions(workspace, status, created_at DESC, session_id DESC)`,
];

export function parseSessionQuery(params: URLSearchParams): SessionQuery {
  const rawLimit = params.get("limit") ?? "50";
  if (!/^[1-9][0-9]*$/.test(rawLimit) || Number(rawLimit) > 100) throw new TypeError("Invalid limit (1-100)");
  const status = params.get("status");
  if (status !== null && !["running", "completed", "failed"].includes(status)) throw new TypeError("Invalid status");
  let before: [string, string] | undefined;
  if (params.has("cursor")) {
    try {
      const cursor = params.get("cursor")!;
      if (cursor.length > 300) throw new Error();
      const value: unknown = JSON.parse(atob(cursor));
      if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== "string" ||
          new Date(value[0]).toISOString() !== value[0]) throw new Error();
      before = [value[0], sessionId(value[1])];
    } catch { throw new TypeError("Invalid cursor"); }
  }
  return { limit: Number(rawLimit), status: (status ?? undefined) as SessionQuery["status"], before };
}

export class SessionDatabase {
  constructor(readonly client: Client, readonly workspace: string) {}
  async initialize() { await this.client.batch(schema, "write"); }
  async save(session: StoredSession) {
    if (!session.createdAt || !session.updatedAt) throw new Error("Session timestamps are required");
    await this.client.execute({
      sql: `INSERT INTO agent_sessions (workspace, session_id, repository, model, status, prompt_preview, created_at, updated_at, snapshot) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(workspace, session_id) DO UPDATE SET
          repository=excluded.repository, model=excluded.model, status=excluded.status,
          prompt_preview=excluded.prompt_preview, updated_at=excluded.updated_at,
          snapshot=excluded.snapshot
        WHERE excluded.updated_at >= agent_sessions.updated_at`,
      args: [this.workspace, session.sessionId, session.repository, session.model, session.status,
        (session.requestPrompt ?? session.prompt).slice(0, 200), session.createdAt, session.updatedAt, JSON.stringify(session)],
    });
  }
  async get(id: string): Promise<StoredSession | null> {
    const result = await this.client.execute({ sql: "SELECT snapshot FROM agent_sessions WHERE workspace=? AND session_id=?", args: [this.workspace, id] });
    return result.rows[0] ? JSON.parse(String(result.rows[0].snapshot)) as StoredSession : null;
  }
  async list(query: SessionQuery) {
    const clauses = ["workspace=?"];
    const args: InValue[] = [this.workspace];
    if (query.repository) { clauses.push("repository=?"); args.push(query.repository); }
    if (query.status) { clauses.push("status=?"); args.push(query.status); }
    if (query.before) { clauses.push("(created_at, session_id) < (?, ?)"); args.push(...query.before); }
    args.push(query.limit + 1);
    const result = await this.client.execute({
      sql: `SELECT session_id, repository, model, status, prompt_preview, created_at, updated_at
        FROM agent_sessions WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC, session_id DESC LIMIT ?`, args,
    });
    const sessions = result.rows.slice(0, query.limit).map(row => ({
      sessionId: String(row.session_id), repository: String(row.repository), model: String(row.model),
      status: String(row.status), promptPreview: String(row.prompt_preview),
      createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    }));
    const last = sessions.at(-1);
    return { sessions, nextCursor: result.rows.length > query.limit && last ? btoa(JSON.stringify([last.createdAt, last.sessionId])) : null };
  }
}

export function sessionDatabase(env: Readonly<Record<string, string | undefined>>): SessionDatabase | undefined {
  if (!env.SESSION_DATABASE_URL) return undefined;
  // HTTP works in both the Edge API and Node worker; no filesystem/native imports in the API bundle.
  const url = new URL(env.SESSION_DATABASE_URL);
  if (!["libsql:", "https:", "http:"].includes(url.protocol)) throw new Error("Unsupported session database URL");
  return new SessionDatabase(createClient({ url: url.toString(), authToken: env.SESSION_DATABASE_AUTH_TOKEN }), env.WORKSPACE_SLUG ?? "agents");
}
