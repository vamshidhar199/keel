import { syncGmail } from "./sync";

type Job = { type: "sync_gmail"; userId: string };

// Module-level singleton queue (in-process, MVP only).
const queue: Job[] = [];
let draining = false;

export function enqueue(job: Job): void {
  queue.push(job);
  void drain();
}

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  while (queue.length > 0) {
    const job = queue.shift()!;
    try {
      await run(job);
    } catch (err) {
      console.error(`[queue] ${job.type} for ${job.userId} failed:`, err);
    }
  }
  draining = false;
}

async function run(job: Job): Promise<void> {
  if (job.type === "sync_gmail") {
    const result = await syncGmail(job.userId);
    console.log(
      `[queue] sync_gmail user=${job.userId} new=${result.newMessages}`
    );
  }
}
