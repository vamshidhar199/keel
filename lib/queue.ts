import { syncGmail } from "./sync";
import { processRawEvent } from "./pipeline";
import { getMetaDb } from "./db";

type Job =
  | { type: "sync_gmail"; userId: string }
  | { type: "extract_emails"; userId: string; limit: number };

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
    console.log(`[queue] sync_gmail user=${job.userId} new=${result.newMessages}`);
    // Auto-trigger extraction after every sync if there are pending events.
    if (result.newMessages > 0) {
      enqueue({ type: "extract_emails", userId: job.userId, limit: result.newMessages });
    }
  }

  if (job.type === "extract_emails") {
    const db = getMetaDb();
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM raw_events
       WHERE user_id = $1 AND extraction_status = 'pending'
       ORDER BY date_sent DESC NULLS LAST
       LIMIT $2`,
      [job.userId, job.limit]
    );

    console.log(`[queue] extract_emails user=${job.userId} count=${rows.length}`);
    for (const { id } of rows) {
      const result = await processRawEvent(job.userId, id);
      console.log(`[queue] event=${id} status=${result.status} pages=${result.pagesWritten.join(",")}`);
    }
  }
}
