import { defineSessionBehaviour } from "@cantelop/sdk/session";
import type { Command, Event } from "./contracts.js";
import { handle } from "./worker.js";

export default defineSessionBehaviour<Command, Event>(async ({ message, env, signal, output }) => {
  // Each conversation has its own actor. The worker locks the shared workspace
  // across the complete turn, including checkout, tools, and durable state updates.
  const turnSignal = AbortSignal.any([signal, AbortSignal.timeout(30 * 60 * 1000)]);
  let event: Event;
  try {
    event = await handle(process.cwd(), message.payload, message.id, env, turnSignal);
  } catch {
    // Do not expose provider responses or subprocess output: they can contain secrets.
    event = { type: "failed", messageId: message.id, data: { error: "Command failed; inspect session state" } };
  }
  await output.send(event);
  if (event.type === "failed") throw new Error("Agent command failed");
});
