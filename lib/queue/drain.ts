import { hostname } from "os";
import { randomBytes } from "crypto";
import { getMetaDb } from "../db";
import { runners } from "./runners";
import type { Job } from "./types";

const CLAIMER_ID = `${hostname()}-${randomBytes(3).toString("hex")}`;
const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY ?? "3", 10);
const PER_USER_CAP = 2;
const BACKOFF_SECONDS = [60, 300, 900]; // 1m, 5m, 15m

export interface DrainResult {
  claimed: number;
  completed: number;
  failed: number;
  retried: number;
}

const CLAIM_QUERY = `
WITH per_user_active AS (
  SELECT payload->>'userId' AS user_id, COUNT(*) AS n
  FROM jobs
  WHERE status = 'processing' AND claim_expires_at > now()
  GROUP BY payload->>'userId'
),
claimable AS (
  SELECT j.id
  FROM jobs j
  LEFT JOIN per_user_active pua
    ON pua.user_id = j.payload->>'userId'
  WHERE j.status = 'pending'
    AND j.scheduled_at <= now()
    AND COALESCE(pua.n, 0) < $1
  ORDER BY j.scheduled_at, j.id
  LIMIT $2
  FOR UPDATE SKIP LOCKED
)
UPDATE jobs SET
  status = 'processing',
  claimed_at = now(),
  claimed_by = $3,
  claim_expires_at = now() + interval '5 minutes',
  attempts = attempts + 1
WHERE id IN (SELECT id FROM claimable)
RETURNING id, type, payload, attempts, max_attempts
`;

export async function drain(): Promise<DrainResult> {
  await reapStuckJobs();

  const db = getMetaDb();
  const { rows: claimed } = await db.query<Job>(CLAIM_QUERY, [
    PER_USER_CAP,
    CONCURRENCY,
    CLAIMER_ID,
  ]);

  let completed = 0, failed = 0, retried = 0;

  await Promise.all(
    claimed.map(async (job) => {
      try {
        const runner = runners[job.type];
        if (!runner) throw new Error(`No runner for job type "${job.type}"`);
        await runner(job.payload);
        await db.query(
          `UPDATE jobs SET status = 'completed', completed_at = now() WHERE id = $1`,
          [job.id]
        );
        completed++;
      } catch (err: any) {
        const errorMsg = String(err?.message ?? err).slice(0, 500);
        console.error(`[queue] job=${job.id} type=${job.type} failed:`, errorMsg);
        if (job.attempts >= job.max_attempts) {
          await db.query(
            `UPDATE jobs SET status = 'failed', failed_at = now(), last_error = $1 WHERE id = $2`,
            [errorMsg, job.id]
          );
          failed++;
        } else {
          const backoff = BACKOFF_SECONDS[Math.min(job.attempts - 1, BACKOFF_SECONDS.length - 1)];
          await db.query(
            `UPDATE jobs SET status = 'pending',
                            scheduled_at = now() + ($1 * interval '1 second'),
                            last_error = $2,
                            claimed_at = NULL, claimed_by = NULL, claim_expires_at = NULL
             WHERE id = $3`,
            [backoff, errorMsg, job.id]
          );
          retried++;
        }
      }
    })
  );

  return { claimed: claimed.length, completed, failed, retried };
}

export async function reapStuckJobs(): Promise<void> {
  const db = getMetaDb();

  const jobsRes = await db.query(
    `UPDATE jobs
     SET status = 'pending', claimed_at = NULL, claimed_by = NULL,
         claim_expires_at = NULL, last_error = 'reaper: claim expired'
     WHERE status = 'processing' AND claim_expires_at < now()`
  );
  if (jobsRes.rowCount && jobsRes.rowCount > 0) {
    console.log(`[queue] reaped ${jobsRes.rowCount} stuck job(s)`);
  }

  // Reset raw_events that pipeline.ts marked 'processing' but no live worker is handling.
  // A raw_event is "abandoned" if there's no extract_emails job currently in 'processing'
  // with a valid claim for the same user. Run AFTER the jobs reap so we see the post-reap
  // state (a worker that just got reaped above no longer counts as live).
  const rawRes = await db.query(
    `UPDATE raw_events SET extraction_status = 'pending'
     WHERE extraction_status = 'processing'
       AND user_id NOT IN (
         SELECT (payload->>'userId')::uuid FROM jobs
         WHERE type = 'extract_emails'
           AND status = 'processing'
           AND claim_expires_at > now()
       )`
  );
  if (rawRes.rowCount && rawRes.rowCount > 0) {
    console.log(`[queue] reset ${rawRes.rowCount} abandoned raw_event(s) → pending`);
  }
}
