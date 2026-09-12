export type Model = string;
export interface SessionSpec { sessionId: string; repository: string; model: Model; prompt: string }
export interface Issue { number: number; title: string; body: string; repository: string; association: string }
export type Command =
  | { type: "reindex" }
  | { type: "create"; spec: SessionSpec }
  | { type: "prompt"; sessionId: string; prompt: string; mode?: "queue" | "steer" }
  | { type: "cancel"; sessionId: string }
  | { type: "inspect"; sessionId: string }
  | { type: "rule"; repository: string; model: Model }
  | { type: "issue"; deliveryId: string; issue: Issue }
  | { type: "issue_comment"; deliveryId: string; repository: string; number: number; commentId: number; body: string; association: string };
export const issueReplyMarker = "<!-- cantelop-agent-reply -->";
export function isAgentReply(body: string): boolean {
  return body.includes(issueReplyMarker) || /^Cantelop session `[^`]+`/.test(body.trimStart());
}
export type Progress = { type: "queued" | "started" | "status" | "text.delta" | "text.replace" | "tool.status"; data: unknown };
export interface Event {
  type: "completed" | "cancelled" | "failed" | "ignored" | "configured" | "session" | Progress["type"];
  messageId: string;
  sessionId?: string;
  data?: unknown;
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Expected an object");
  return value as Record<string, unknown>;
}
export function text(value: unknown, name: string, max = 50000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new TypeError(`Invalid ${name}`);
  return value;
}
export function model(value: unknown): Model {
  return text(value, "OpenRouter model ID", 200);
}
export function sessionId(value: unknown): string {
  const id = text(value, "sessionId", 100);
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new TypeError("Invalid sessionId");
  return id;
}
export function repository(value: unknown, allowlist: string | undefined): string {
  const repo = text(value, "repository", 200).toLowerCase();
  if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(repo) || repo.split("/").some(p => p === "." || p === "..")) throw new TypeError("Invalid repository");
  if (!(allowlist ?? "").split(",").map(v => v.trim().toLowerCase()).includes(repo)) throw new TypeError("Repository is not enabled");
  return repo;
}

export async function issueSessionId(repo: string, number: number): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`issue:${repo}:${number}`));
  return `issue-${Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("").slice(0, 24)}`;
}
