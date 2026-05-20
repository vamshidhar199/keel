import { getMetaDb } from "../db";
import type { JobInput } from "./types";

export async function enqueue(job: JobInput): Promise<void> {
  await getMetaDb().query(
    `INSERT INTO jobs (type, payload) VALUES ($1, $2)`,
    [job.type, job]
  );
  // Fire and forget — if this fails, cron picks up the job within 1 minute.
  const secret = process.env.QUEUE_SECRET;
  fetch(`${process.env.NEXTAUTH_URL}/api/queue/drain`, {
    method: "POST",
    headers: secret ? { "x-queue-secret": secret } : {},
  }).catch(() => {});
}
