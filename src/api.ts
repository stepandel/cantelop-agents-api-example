import { turnStream } from "./turn-stream.js";
import { defineApi } from "@cantelop/sdk/api";
import { issueSessionId, model, object, repository, sessionId, text, type Command } from "./contracts.js";

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
export default defineApi<Command>(({ app, env, router }) => {
  const worker = (id: string) => app.sessions.open({ id, workspaceSlug: env.WORKSPACE_SLUG ?? "agents", keepAliveSeconds: 300 });
  async function dispatch(command: Command) {
    const id = command.type === "create" ? command.spec.sessionId
      : command.type === "issue" ? await issueSessionId(command.issue.repository, command.issue.number)
      : command.type === "rule" ? `rule-${crypto.randomUUID()}` : command.sessionId;
    const message = await worker(id).dispatch(command);
    return Response.json({ messageId: message.id, state: "accepted", sessionId: id, events: `/events?sessionId=${encodeURIComponent(id)}`, stream: `/turns/events?sessionId=${encodeURIComponent(id)}&messageId=${encodeURIComponent(message.id)}` }, { status: 202 });
  }
  function route(method: "GET" | "POST" | "PUT", path: string, auth: boolean, handler: (request: Request) => Promise<Response>) {
    router.route(method, path, async ({ request }) => {
      if (auth && (!env.API_TOKEN || request.headers.get("authorization") !== `Bearer ${env.API_TOKEN}`)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      try { return await handler(request); }
      catch (error) {
        const status = error instanceof RangeError ? 413 : error instanceof TypeError || error instanceof SyntaxError ? 400 : 503;
        return Response.json({ error: status === 503 ? "Service unavailable" : (error as Error).message }, { status });
      }
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
  route("POST", "/webhooks/github", false, async request => {
    if (!env.GITHUB_WEBHOOK_SECRET) return Response.json({ error: "Webhook not configured" }, { status: 503 });
    const raw = await bodyBytes(request);
    if (!await verifySignature(raw, request.headers.get("x-hub-signature-256"), env.GITHUB_WEBHOOK_SECRET)) return Response.json({ error: "Invalid signature" }, { status: 401 });
    if (request.headers.get("x-github-event") !== "issues") return Response.json({ ignored: true });
    const v = object(JSON.parse(new TextDecoder().decode(raw)));
    if (v.action !== "opened") return Response.json({ ignored: true });
    const issue = object(v.issue);
    const repo = repository(object(v.repository).full_name, env.GITHUB_REPOSITORIES);
    const association = text(issue.author_association, "author_association", 30);
    if (!["OWNER", "MEMBER", "COLLABORATOR"].includes(association)) return Response.json({ ignored: true, reason: "untrusted issue author" });
    if (!Number.isSafeInteger(issue.number) || Number(issue.number) <= 0) throw new TypeError("Invalid issue number");
    return dispatch({ type: "issue", deliveryId: text(request.headers.get("x-github-delivery"), "delivery ID", 100), issue: { repository: repo, number: Number(issue.number), title: text(issue.title, "title", 1000), body: issue.body == null || issue.body === "" ? "" : text(issue.body, "body"), association } });
  });
});
