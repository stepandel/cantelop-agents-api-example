import path from "node:path";
import { readJSON, saveJSON } from "./runtime.js";
import { sessionId, type Command, type Event } from "./contracts.js";

type Work = Exclude<Command, { type: "inspect" }>;
export interface Job { messageId: string; command: Work; state: "queued" | "running" | "finished"; result?: Event }
interface State { jobs: Job[] }

/** One writer per session actor; serialize admission against activity completion. */
export class Inbox {
  private tail: Promise<unknown> = Promise.resolve();
  private state?: State;
  constructor(private root: string, private id: string) {}
  async transaction<T>(work: (state: State) => T): Promise<T> {
    const result = this.tail.then(async () => {
      const file = path.join(this.root, ".agent-api", "inboxes", `${sessionId(this.id)}.json`);
      if (!this.state) {
        this.state = await readJSON<State>(file) ?? { jobs: [] };
        // Never replay admitted work after process loss: its external effects are unknown.
        for (const job of this.state.jobs) if (job.state === "running") {
          job.state = "finished";
          job.result = { type: "failed", messageId: job.messageId, sessionId: this.id,
            data: { code: "turn_interrupted", error: "Worker restarted during this turn; inspect before retrying." } };
        }
      }
      // Only publish the in-memory update after its atomic disk write succeeds.
      const next = structuredClone(this.state);
      const value = work(next);
      await saveJSON(file, next);
      this.state = next;
      return value;
    });
    this.tail = result.catch(() => undefined);
    return result;
  }
  admit(command: Work, messageId: string) {
    return this.transaction(state => {
      const existing = state.jobs.find(job => job.messageId === messageId);
      if (existing) return { job: existing, duplicate: true };
      if (state.jobs.filter(job => job.state === "queued").length >= 100) throw new Error("queue_full");
      const job: Job = { command, messageId, state: "queued" };
      state.jobs.push(job);
      return { job, duplicate: false };
    });
  }
  take() {
    return this.transaction(state => {
      const pending = state.jobs.filter(job => job.state === "queued");
      const first = pending[0];
      const job = first && first.command.type !== "prompt" ? first
        : pending.find(job => job.command.type === "prompt" && job.command.mode === "steer") ?? first;
      if (job) job.state = "running";
      return job;
    });
  }
  finish(messageId: string, result: Event) {
    return this.transaction(state => {
      const job = state.jobs.find(job => job.messageId === messageId)!;
      job.state = "finished"; job.result = result;
    });
  }
  snapshot() {
    return this.transaction(state => state.jobs.map(({ messageId, command, state, result }) => ({
      messageId, mode: command.type === "prompt" ? command.mode ?? "queue" : "queue", state, result,
    })));
  }
}
