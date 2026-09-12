import { defineSessionBehaviour } from "@cantelop/sdk/session";
import type { Command, Event } from "./contracts.js";
import { handle } from "./worker.js";
import { Inbox } from "./inbox.js";

type SessionCommand = Command | { type: "drain" };
export function createBehaviour(run = handle, timeoutMs = 30 * 60 * 1000, root = process.cwd()) {
  let inbox: Inbox;
  let current: { controller: AbortController; interruptible: boolean; steering: boolean } | undefined;
  return defineSessionBehaviour<SessionCommand, Event>(async ({ message, session, env, signal, output, activity }) => {
    inbox ??= new Inbox(root, session.id);
    if (message.payload.type === "cancel") {
      const cancelled = activity.cancel({ code: "turn_cancelled" });
      console.info(JSON.stringify({ component: "agent-api", event: "session.cancelled", messageId: message.id, sessionId: session.id, cancelled }));
      await output.send({ type: "cancelled", messageId: message.id, sessionId: session.id,
        data: { cancelled, pendingPreserved: true } });
      return;
    }
    if (message.payload.type === "inspect") {
      const event = await run(root, message.payload, message.id, env, signal);
      await output.send({ ...event, data: { ...(event.data as object ?? {}), messages: await inbox.snapshot() } });
      return;
    }
    if (message.payload.type !== "drain") {
      let admission;
      try { admission = await inbox.admit(message.payload, message.id); }
      catch (error) {
        if (!(error instanceof Error) || error.message !== "queue_full") throw error;
        await output.send({ type: "failed", messageId: message.id, data: { code: "queue_full", error: "Session queue has 100 pending messages." } });
        return;
      }
      if (admission.duplicate && admission.job.result) {
        await output.send(admission.job.result);
        return;
      }
      // Save before interrupting, so an accepted steering message cannot be lost.
      if (!admission.duplicate && message.payload.type === "prompt" && message.payload.mode === "steer") {
        if (current) {
          current.steering = true;
          if (current.interruptible) current.controller.abort({ code: "turn_steered" });
        }
      }
      if (activity.active) {
        await output.send({ type: "queued", messageId: message.id, sessionId: session.id,
          data: { mode: message.payload.type === "prompt" ? message.payload.mode ?? "queue" : "queue" } });
        return;
      }
    }
    if (activity.active || !(await inbox.snapshot()).some(job => job.state === "queued")) return;
    activity.start(async ({ signal: activitySignal, output: turnOutput, send }) => {
      try {
        while (!activitySignal.aborted) {
          // Install the controller before admission can interleave with take().
          current = { controller: new AbortController(), interruptible: false, steering: false };
          const job = await inbox.take();
          if (!job) break;
          current.interruptible = job.command.type === "prompt";
          if (current.steering && current.interruptible) current.controller.abort({ code: "turn_steered" });
          activity.extend(timeoutMs);
          const turnSignal = AbortSignal.any([activitySignal, current.controller.signal]);
          console.info(JSON.stringify({ component: "agent-api", event: "session.started", messageId: job.messageId, sessionId: session.id, command: job.command.type }));
          let event: Event;
          try {
            await turnOutput.send({ type: "started", messageId: job.messageId, sessionId: session.id, data: {} });
            event = await run(root, job.command, job.messageId, env, turnSignal, undefined, async event => {
              // Creation must save its session before a follow-up can interrupt it.
              if (current && event.type === "status" && (event.data as { phase?: string })?.phase === "checkout") {
                current.interruptible = true;
                if (current.steering) current.controller.abort({ code: "turn_steered" });
              }
              await turnOutput.send(event);
            });
          } catch {
            event = { type: "failed", messageId: job.messageId, sessionId: session.id,
              data: { code: turnSignal.aborted ? "turn_cancelled" : "command_failed", error: "Command failed; inspect session state" } };
          }
          if (current.controller.signal.aborted) event = { type: "failed", messageId: job.messageId, sessionId: session.id,
            data: { code: "turn_steered", error: "Interrupted by a steering message; the new instruction runs next." } };
          else if (activitySignal.aborted && activitySignal.reason?.code === "turn_cancelled") event = {
            type: "cancelled", messageId: job.messageId, sessionId: session.id,
            data: { code: "turn_cancelled", pendingPreserved: true },
          };
          current = undefined;
          await inbox.finish(job.messageId, event);
          console[event.type === "failed" ? "error" : "info"](JSON.stringify({ component: "agent-api", event: `session.${event.type}`, messageId: job.messageId, sessionId: session.id }));
          if (!activitySignal.aborted) await turnOutput.send(event);
        }
      } finally {
        current = undefined;
        // Delivered by Cantelop only after this activity settles, closing the
        // race where admission happens just as the drain finds an empty queue.
        // On cancellation leave pending work saved for the next request.
        if (!activitySignal.aborted) send({ type: "drain" });
      }
    }, { timeoutMs });
  });
}

export default createBehaviour();
