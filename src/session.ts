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
      console.warn(JSON.stringify({ component: "agent-api", event: "session.rejected", messageId: message.id, reason: "session_busy" }));
      await output.send({ type: "failed", messageId: message.id,
        data: { code: "session_busy", error: "A turn is still active. Retry after it finishes." } });
      throw new Error("Session is busy");
    }
    activity.start(async ({ signal: turnSignal, output: turnOutput }) => {
      console.info(JSON.stringify({ component: "agent-api", event: "session.started", messageId: message.id, command: message.payload.type }));
      let event: Event;
      try {
        await turnOutput.send({ type: "started", messageId: message.id, data: {} });
        event = await run(process.cwd(), message.payload, message.id, env, turnSignal, undefined, event => turnOutput.send(event));
      } catch {
        event = { type: "failed", messageId: message.id,
          data: { code: turnSignal.aborted ? "turn_cancelled" : "command_failed", error: "Command failed; inspect session state" } };
      }
      // The worker persists outcomes before output. On cancellation the SDK closes
      // output too; state remains inspectable even when delivery cannot succeed.
      const log = JSON.stringify({ component: "agent-api", event: `session.${event.type}`, messageId: message.id, sessionId: event.sessionId, cancelled: turnSignal.aborted });
      if (event.type === "failed") console.error(log); else console.info(log);
      if (!turnSignal.aborted) await turnOutput.send(event);
      if (event.type === "failed") throw new Error("Agent command failed");
    }, { timeoutMs });
  });
}

export default createBehaviour();
