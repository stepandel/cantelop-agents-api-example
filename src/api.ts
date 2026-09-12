import { sessionDatabase, parseSessionQuery, type SessionDatabase } from "./session-db.js";
import { turnStream } from "./turn-stream.js";
import { defineApi } from "@cantelop/sdk/api";
import { issueSessionId, model, object, repository, sessionId, text, type Command } from "./contracts.js";

type RequestLog = { reason?: string; repository?: string; issue?: number; deliveryId?: string; githubEvent?: string; action?: string };
function label(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-zA-Z0-9_./-]{1,200}$/.test(value) ? value : undefined;
}
function errorReason(error: unknown): string {
  // Never log raw exception messages: JSON errors and SDK failures may contain inputs or credentials.
  if (error instanceof SyntaxError) return "invalid_json";
  const known: Record<string, string> = {
    "Repository is not enabled": "repository_not_enabled", "Invalid repository": "invalid_repository",
    "Body exceeds 1 MB": "body_too_large", "Invalid issue number": "invalid_issue_number",
    "Invalid delivery ID": "invalid_delivery_id", "Invalid OpenRouter model ID": "invalid_model",
    "Invalid sessionId": "invalid_session_id", "Invalid messageId": "invalid_message_id",
    "Invalid title": "invalid_title", "Invalid body": "invalid_body", "Invalid prompt": "invalid_prompt",
    "Invalid author_association": "invalid_author_association", "Expected an object": "invalid_object",
    "Turn streams require SSE": "sse_required",
  };
  if (error instanceof Error && Object.hasOwn(known, error.message)) return known[error.message]!;
  return error instanceof TypeError || error instanceof RangeError ? "invalid_request" : "service_unavailable";
}

export async function verifySignature(body: Uint8Array, signature: string | null, secret: string): Promise<boolean> {
  if (!signature || !/^sha256=[0-9a-f]{64}$/.test(signature)) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const bytes = Uint8Array.from(signature.slice(7).match(/../g)!, pair => parseInt(pair, 16));
  return crypto.subtle.verify("HMAC", key, bytes, body as Uint8Array<ArrayBuffer>);
}
async function bodyBytes(request: Request): Promise<Uint8Array> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 1000000) { await reader.cancel(); throw new RangeError("Body exceeds 1 MB"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
export const createApi = (databaseFactory = sessionDatabase) => defineApi<Command>(({ app, env, router }) => {
  const worker = (id: string) => app.sessions.open({ id, workspaceSlug: env.WORKSPACE_SLUG ?? "agents", keepAliveSeconds: 300 });
  async function dispatch(command: Command) {
    const id = command.type === "create" ? command.spec.sessionId
      : command.type === "issue" ? await issueSessionId(command.issue.repository, command.issue.number)
      : command.type === "rule" ? `rule-${crypto.randomUUID()}` : command.sessionId;
    const message = await worker(id).dispatch(command);
    console.info(JSON.stringify({ component: "agent-api", event: "session.dispatched", command: command.type, sessionId: id, messageId: message.id }));
    return Response.json({ messageId: message.id, state: "accepted", sessionId: id, events: `/events?sessionId=${encodeURIComponent(id)}`, stream: `/turns/events?sessionId=${encodeURIComponent(id)}&messageId=${encodeURIComponent(message.id)}` }, { status: 202 });
  }
  function route(method: "GET" | "POST" | "PUT", path: string, auth: boolean, handler: (request: Request, context: RequestLog) => Promise<Response>) {
    router.route(method, path, async ({ request }) => {
      const webhook = path === "/webhooks/github";
      const context: RequestLog = webhook ? { deliveryId: label(request.headers.get("x-github-delivery")), githubEvent: label(request.headers.get("x-github-event")) } : {};
      let response: Response;
      try {
        if (auth && (!env.API_TOKEN || request.headers.get("authorization") !== `Bearer ${env.API_TOKEN}`)) {
          context.reason = "unauthorized";
          response = Response.json({ error: "Unauthorized" }, { status: 401 });
        } else response = await handler(request, context);
      } catch (error) {
        const status = error instanceof RangeError ? 413 : error instanceof TypeError || error instanceof SyntaxError ? 400 : 503;
        context.reason = errorReason(error);
        response = Response.json({ error: status === 503 ? "Service unavailable" : (error as Error).message }, { status });
      }
      if (webhook || response.status >= 400) {
        const outcome = response.status >= 500 ? "failed" : response.status >= 400 ? "rejected" : response.status === 202 ? "accepted" : "ignored";
        const log = JSON.stringify({ component: "agent-api", event: `${webhook ? "webhook" : "request"}.${outcome}`, method, path, status: response.status, ...context });
        if (response.status >= 500) console.error(log);
        else if (response.status >= 400) console.warn(log);
        else console.info(log);
      }
      return response;
    });
  }
  const body = async (request: Request) => object(JSON.parse(new TextDecoder().decode(await bodyBytes(request))));
  route("GET", "/health", false, async () => Response.json({ status: "ok" }));
  route("GET", "/events", true, request => worker(sessionId(new URL(request.url).searchParams.get("sessionId"))).events(request));
  route("GET", "/turns/events", true, async request => {
    if (request.headers.get("upgrade")) throw new TypeError("Turn streams require SSE");
    const url = new URL(request.url);
    const id = sessionId(url.searchParams.get("sessionId"));
    const messageId = text(url.searchParams.get("messageId"), "messageId", 100);
    if (!/^msg_[a-f0-9]{32}$/.test(messageId)) throw new TypeError("Invalid messageId");
    return turnStream(await worker(id).events(request), messageId);
  });
  const readDatabase = async <T>(read: (db: SessionDatabase) => Promise<T>): Promise<T> => {
    try {
      const db = databaseFactory(env);
      if (!db) throw new Error("Session database is not configured");
      return await read(db);
    } catch {
      // SDK/network failures may be TypeErrors and contain connection details.
      throw new Error("Session database unavailable");
    }
  };
  const queryResponse = (value: unknown, status = 200) => Response.json(value, { status, headers: { "cache-control": "no-store" } });
  route("GET", "/sessions", true, async request => {
    const params = new URL(request.url).searchParams;
    const query = parseSessionQuery(params);
    if (params.has("repository")) query.repository = repository(params.get("repository"), env.GITHUB_REPOSITORIES);
    return queryResponse(await readDatabase(db => db.list(query)));
  });
  route("GET", "/sessions/inspect", true, async request => {
    const id = sessionId(new URL(request.url).searchParams.get("sessionId"));
    const session = await readDatabase(db => db.get(id));
    return session ? queryResponse({ session }) : queryResponse({ error: "Session not found" }, 404);
  });
  route("POST", "/sessions", true, async request => {
    const v = await body(request);
    return dispatch({ type: "create", spec: { sessionId: crypto.randomUUID(), repository: repository(v.repository, env.GITHUB_REPOSITORIES), model: model(v.model), prompt: text(v.prompt, "prompt") } });
  });
  route("POST", "/sessions/messages", true, async request => {
    const v = await body(request);
    return dispatch({ type: "prompt", sessionId: sessionId(v.sessionId), prompt: text(v.prompt, "prompt") });
  });
  route("POST", "/sessions/inspect", true, async request => {
    const v = await body(request);
    return dispatch({ type: "inspect", sessionId: sessionId(v.sessionId) });
  });
  route("PUT", "/github/issue-rules", true, async request => {
    const v = await body(request);
    return dispatch({ type: "rule", repository: repository(v.repository, env.GITHUB_REPOSITORIES), model: model(v.model) });
  });
  route("POST", "/webhooks/github", false, async (request, context) => {
    if (!env.GITHUB_WEBHOOK_SECRET) { context.reason = "webhook_not_configured"; return Response.json({ error: "Webhook not configured" }, { status: 503 }); }
    const raw = await bodyBytes(request);
    if (!await verifySignature(raw, request.headers.get("x-hub-signature-256"), env.GITHUB_WEBHOOK_SECRET)) { context.reason = "invalid_signature"; return Response.json({ error: "Invalid signature" }, { status: 401 }); }
    if (request.headers.get("x-github-event") !== "issues") { context.reason = "unsupported_event"; return Response.json({ ignored: true }); }
    const v = object(JSON.parse(new TextDecoder().decode(raw)));
    context.action = label(v.action);
    if (v.action !== "opened") { context.reason = "unsupported_action"; return Response.json({ ignored: true }); }
    const issue = object(v.issue);
    context.repository = label(object(v.repository).full_name);
    context.issue = Number.isSafeInteger(issue.number) && Number(issue.number) > 0 ? Number(issue.number) : undefined;
    const repo = repository(object(v.repository).full_name, env.GITHUB_REPOSITORIES);
    const association = text(issue.author_association, "author_association", 30);
    if (!["OWNER", "MEMBER", "COLLABORATOR"].includes(association)) { context.reason = "untrusted_issue_author"; return Response.json({ ignored: true, reason: "untrusted issue author" }); }
    if (!Number.isSafeInteger(issue.number) || Number(issue.number) <= 0) throw new TypeError("Invalid issue number");
    return dispatch({ type: "issue", deliveryId: text(request.headers.get("x-github-delivery"), "delivery ID", 100), issue: { repository: repo, number: Number(issue.number), title: text(issue.title, "title", 1000), body: issue.body == null || issue.body === "" ? "" : text(issue.body, "body"), association } });
  });
});

export default createApi();
