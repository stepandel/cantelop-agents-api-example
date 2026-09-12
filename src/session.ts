import { defineSessionBehaviour } from "@cantelop/sdk/session";
import type { Command, Event } from "./contracts.js";
import { handle } from "./worker.js";

export function createBehaviour(run = handle, timeoutMs = 30 * 60 * 1000) {
  return defineSessionBehaviour<Command, Event>(async ({ message, env, signal, output, activity }) => {
    // Atomic session snapshots are safe to read while a turn holds the workspace lock.
    if (message.payload.type === "inspect") {
      await output.send(await run(process.cwd(), message.payload, message.id, env, signal));
      return;
    }
    // Do not silently accept a follow-up into a volatile background queue.
    if (activity.active) {
      await output.send({ type: "failed", messageId: message.id,
        data: { code: "session_busy", error: "A turn is still active. Retry after it finishes." } });
      throw new Error("Session is busy");
    }
    activity.start(async ({ signal: turnSignal, output: turnOutput }) => {
      let event: Event;
      try {
        event = await run(process.cwd(), message.payload, message.id, env, turnSignal);
      } catch {
        event = { type: "failed", messageId: message.id,
          data: { code: turnSignal.aborted ? "turn_cancelled" : "command_failed", error: "Command failed; inspect session state" } };
      }
      // The worker persists outcomes before output. On cancellation the SDK closes
      // output too; state remains inspectable even when delivery cannot succeed.
      if (!turnSignal.aborted) await turnOutput.send(event);
      if (event.type === "failed") throw new Error("Agent command failed");
    }, { timeoutMs });
  });
}

export default createBehaviour();
