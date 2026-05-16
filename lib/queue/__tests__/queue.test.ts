import { describe, test, expect, beforeEach, afterAll, vi } from "vitest";
import { enqueue } from "../enqueue";
import { drain, reapStuckJobs } from "../drain";
import { runners } from "../runners";
import { getMetaDb } from "../../db";

// Stub all runners so tests never hit external services.
beforeEach(async () => {
  runners.sync_gmail = vi.fn(async () => {});
  runners.sync_slack = vi.fn(async () => {});
  runners.extract_emails = vi.fn(async () => {});
  await getMetaDb().query("DELETE FROM jobs");
});

afterAll(async () => {
  await getMetaDb().end();
});

describe("Postgres job queue", () => {
  test("enqueued job is claimed and completed", async () => {
    await enqueue({ type: "sync_gmail", userId: "11111111-1111-1111-1111-111111111111" });
    const result = await drain();
    expect(result.claimed).toBe(1);
    expect(result.completed).toBe(1);
    expect(result.failed).toBe(0);
  });

  test("two concurrent drains never claim the same job (SKIP LOCKED)", async () => {
    for (let i = 0; i < 10; i++) {
      await enqueue({ type: "sync_gmail", userId: `00000000-0000-0000-0000-00000000000${i}` });
    }
    const [a, b] = await Promise.all([drain(), drain()]);
    const total = a.claimed + b.claimed;

    // Each drain claims at most CONCURRENCY=3, so two drains claim at most 6.
    expect(total).toBeLessThanOrEqual(6);

    // The real safety property: every claimed job appears in jobs exactly once
    // in 'completed' or 'processing'. No job double-claimed (would show as 2 rows).
    const { rows } = await getMetaDb().query<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM jobs WHERE status IN ('completed', 'processing')`
    );
    expect(parseInt(rows[0].cnt, 10)).toBe(total);
  });

  test("per-user cap blocks more than PER_USER_CAP=2 in flight", async () => {
    const userId = "22222222-2222-2222-2222-222222222222";
    // Seed 2 jobs already in 'processing' for this user.
    await getMetaDb().query(
      `INSERT INTO jobs (type, payload, status, claimed_at, claim_expires_at, attempts)
       VALUES ('sync_gmail', $1, 'processing', now(), now() + interval '5 minutes', 1),
              ('sync_gmail', $1, 'processing', now(), now() + interval '5 minutes', 1)`,
      [JSON.stringify({ type: "sync_gmail", userId })]
    );
    // Enqueue a third job for the same user.
    await enqueue({ type: "sync_gmail", userId });
    const result = await drain();
    // Should claim 0 more for this user (cap=2, already 2 in flight).
    expect(result.claimed).toBe(0);
  });

  test("failed job retries with backoff (attempts < max_attempts)", async () => {
    runners.sync_gmail = vi.fn(async () => { throw new Error("transient error"); });
    await enqueue({ type: "sync_gmail", userId: "33333333-3333-3333-3333-333333333333" });
    const result = await drain();
    expect(result.retried).toBe(1);
    expect(result.failed).toBe(0);

    const { rows } = await getMetaDb().query(
      `SELECT status, attempts, scheduled_at FROM jobs ORDER BY created_at DESC LIMIT 1`
    );
    expect(rows[0].status).toBe("pending");
    expect(rows[0].attempts).toBe(1);
    // scheduled_at should be ~60s in the future.
    expect(new Date(rows[0].scheduled_at).getTime()).toBeGreaterThan(Date.now() + 50_000);
  });

  test("max_attempts hit → status becomes 'failed'", async () => {
    runners.sync_gmail = vi.fn(async () => { throw new Error("permanent error"); });
    // Insert a job already at max_attempts - 1 so next failure crosses the threshold.
    await getMetaDb().query(
      `INSERT INTO jobs (type, payload, status, attempts, max_attempts)
       VALUES ('sync_gmail', $1, 'pending', 2, 3)`,
      [JSON.stringify({ type: "sync_gmail", userId: "44444444-4444-4444-4444-444444444444" })]
    );
    const result = await drain();
    expect(result.failed).toBe(1);
    expect(result.retried).toBe(0);

    const { rows } = await getMetaDb().query(
      `SELECT status, last_error FROM jobs ORDER BY created_at DESC LIMIT 1`
    );
    expect(rows[0].status).toBe("failed");
    expect(rows[0].last_error).toContain("permanent error");
  });

  test("reaper unstucks jobs whose claim_expires_at has passed", async () => {
    // Insert a job stuck in 'processing' with an expired claim.
    await getMetaDb().query(
      `INSERT INTO jobs (type, payload, status, claimed_at, claim_expires_at, attempts)
       VALUES ('sync_gmail', $1, 'processing', now() - interval '10 minutes',
               now() - interval '1 minute', 1)`,
      [JSON.stringify({ type: "sync_gmail", userId: "55555555-5555-5555-5555-555555555555" })]
    );
    // drain() calls reapStuckJobs first, then claims the now-pending job.
    const result = await drain();
    expect(result.claimed).toBe(1);
    expect(result.completed).toBe(1);
  });

  test("reaper resets abandoned raw_events but not those of live workers", async () => {
    const liveUser = "66666666-6666-6666-6666-666666666666";
    const abandonedUser = "77777777-7777-7777-7777-777777777777";
    const db = getMetaDb();

    try {
      // liveUser: stuck raw_event + a live extract_emails job (claim still valid)
      await db.query(
        `INSERT INTO raw_events (user_id, source, source_ref, extraction_status)
         VALUES ($1, 'gmail', 'live-test-ref', 'processing')
         ON CONFLICT (user_id, source, source_ref) DO UPDATE SET extraction_status = 'processing'`,
        [liveUser]
      );
      await db.query(
        `INSERT INTO jobs (type, payload, status, claimed_at, claim_expires_at, attempts)
         VALUES ('extract_emails', $1, 'processing', now(), now() + interval '5 minutes', 1)`,
        [JSON.stringify({ type: "extract_emails", userId: liveUser, limit: 10 })]
      );

      // abandonedUser: stuck raw_event but no live job
      await db.query(
        `INSERT INTO raw_events (user_id, source, source_ref, extraction_status)
         VALUES ($1, 'gmail', 'abandoned-test-ref', 'processing')
         ON CONFLICT (user_id, source, source_ref) DO UPDATE SET extraction_status = 'processing'`,
        [abandonedUser]
      );

      await reapStuckJobs();

      const live = await db.query(
        `SELECT extraction_status FROM raw_events WHERE user_id = $1 AND source_ref = 'live-test-ref'`,
        [liveUser]
      );
      const abandoned = await db.query(
        `SELECT extraction_status FROM raw_events WHERE user_id = $1 AND source_ref = 'abandoned-test-ref'`,
        [abandonedUser]
      );

      // Live worker exists → raw_event left alone
      expect(live.rows[0].extraction_status).toBe("processing");
      // No live worker → raw_event reset for retry
      expect(abandoned.rows[0].extraction_status).toBe("pending");
    } finally {
      await db.query(`DELETE FROM raw_events WHERE user_id = ANY($1)`, [[liveUser, abandonedUser]]);
    }
  });
});
