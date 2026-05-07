import { syncGmail, syncSlack } from "./sync";
import { processRawEvent } from "./pipeline";
import { getMetaDb } from "./db";

// On startup: reset any jobs that were left in 'processing' due to a crash or restart.
export async function resetStuckJobs(): Promise<void> {
  const db = getMetaDb();
  const result = await db.query(
    `UPDATE raw_events SET extraction_status = 'pending'
     WHERE extraction_status = 'processing'`
  );
  if (result.rowCount && result.rowCount > 0) {
    console.log(`[queue] reset ${result.rowCount} stuck job(s) → pending`);
  }
}

type Job =
  | { type: "sync_gmail"; userId: string }
  | { type: "sync_slack"; userId: string }
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
    if (result.newMessages > 0) {
      enqueue({ type: "extract_emails", userId: job.userId, limit: result.newMessages });
    }
  }

  if (job.type === "sync_slack") {
    const result = await syncSlack(job.userId);
    console.log(`[queue] sync_slack user=${job.userId} new=${result.newMessages}`);
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
      console.log(`[queue] event=${id} status=${result.status} pages=${result.pagesWritten.join(",")}${result.error ? ` error=${result.error}` : ""}`);
    }
  }
}
