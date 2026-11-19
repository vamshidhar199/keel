# Phase 2 — Postgres-backed job queue

> **Status:** implemented (kept for the *why*).
> **Scope:** ONLY the queue replacement. Splitting web/worker into separate services is Phase 3 (out of scope here, but the file structure below leaves the door open).
> **Audience:** Claude Sonnet (or any engineer) implementing this end-to-end.
> **Depends on:** Phase 1 (`docs/shared-db-rls.md`) — this doc assumes the shared DB + RLS pattern is in place.

---

## 1. Why this change

Today `lib/queue.ts:22` is an in-memory `Job[]` array drained by a single async loop. This breaks in three ways the moment Personal Agent has more than one user or one container:

1. **Jobs vanish on restart / deploy.** Only `resetStuckJobs()` partially recovers (re-marks `processing → pending` in `raw_events`, but never recovers the queued job itself).
2. **Single-instance only.** Two Next.js instances would have separate queues with no coordination — the same `sync_gmail` for the same user could run twice in parallel and corrupt state.
3. **One user blocks all others.** Drain is sequential. If user A's Slack sync takes 10 minutes, user B's 30-second Gmail sync waits behind it.

Plus: the existing scheduler already uses Railway Cron + an HTTP endpoint (see `instrumentation.ts:13` — in-process `setInterval` was abandoned because **Railway suspends idle containers**). The queue has the same constraint and needs the same trigger model.

---

## 2. Goals

When done:
1. Jobs persist across restarts (stored in Postgres).
2. Multiple Next.js instances can run safely in parallel — no double-claims (`SELECT … FOR UPDATE SKIP LOCKED`).
3. One user with 1000 pending jobs cannot starve other users (per-user concurrency cap).
4. Failed jobs retry with exponential backoff; jobs stuck in `processing` (e.g. crashed worker) get unstuck automatically.
5. Queue depth, failure rate, latency-per-type are all visible via plain SQL.
6. The drain logic is structured so Phase 3 (separate worker process) is a deploy change, not a code change.
7. Survives Railway's idle-container suspends (cron-driven, not in-process polling).

## Non-goals (do NOT do these in this phase)

- ❌ Separate worker process / second Railway service (Phase 3)
- ❌ Per-user LLM API keys forced (Phase 4)
- ❌ Moving `raw_events.raw_json` to object storage (Phase 5)
- ❌ A general-purpose job framework. Three job types only: `sync_gmail`, `sync_slack`, `extract_emails`. Don't build a framework.
- ❌ Priority queues, delayed jobs beyond simple retry-backoff, or cron-style recurring jobs in the queue itself (the existing `schedulerTick` continues to handle "is it time to sync user X?" logic and just enqueues).

---

## 3. Architecture

### 3.1 The `jobs` table

Append to the `SCHEMA` constant in `lib/migrate.ts`:

```sql
CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,                          -- 'sync_gmail' | 'sync_slack' | 'extract_emails'
  payload JSONB NOT NULL,                      -- { userId, ...args }
  status TEXT NOT NULL DEFAULT 'pending',      -- pending | processing | completed | failed
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at TIMESTAMPTZ,
  claimed_by TEXT,                             -- "<hostname>-<random>" for debug
  claim_expires_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The single hot index used by the claim query.
CREATE INDEX IF NOT EXISTS idx_jobs_pending
  ON jobs (scheduled_at)
  WHERE status = 'pending';

-- For the per-user concurrency cap subquery and observability.
CREATE INDEX IF NOT EXISTS idx_jobs_processing_userid
  ON jobs ((payload->>'userId'))
  WHERE status = 'processing';
```

`jobs` is NOT a tenant table — it's queue infrastructure used by all users plus admin queries. Do NOT enable RLS on it. The `payload->>'userId'` filter is sufficient.

### 3.2 The claim query (atomic, fairness-aware)

```sql
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
    AND COALESCE(pua.n, 0) < $1            -- per-user concurrency cap
  ORDER BY j.scheduled_at, j.id            -- FIFO within the eligible set
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
RETURNING id, type, payload, attempts, max_attempts;
```

Three parameters:
- `$1` — per-user cap (default `2` — see §3.5)
- `$2` — batch size (default `WORKER_CONCURRENCY=3`)
- `$3` — claimer id (e.g. `web-${hostname}-${randomShort}`)

**`SKIP LOCKED` is the load-bearing primitive.** Multiple workers can run this query simultaneously and each grabs a disjoint set of jobs — no double-processing, no deadlocks. Same approach as Sidekiq, GoodJob, river-queue, and most Postgres-backed queues across all languages.

### 3.3 The drain function

The substance of the worker. Phase 2 (HTTP endpoint) and Phase 3 (worker process) both call this same function — that's how nothing gets thrown away.

`lib/queue/drain.ts`:

```typescript
import { hostname } from "os";
import { randomBytes } from "crypto";
import { getMetaDb } from "../db";
import { runners } from "./runners";

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

export async function drain(): Promise<DrainResult> {
  await reapStuckJobs();

  const db = getMetaDb();
  const { rows: claimed } = await db.query<{
    id: string;
    type: string;
    payload: { userId: string; [k: string]: unknown };
    attempts: number;
    max_attempts: number;
  }>(/* the claim query from §3.2 */, [PER_USER_CAP, CONCURRENCY, CLAIMER_ID]);

  let completed = 0, failed = 0, retried = 0;

  await Promise.all(claimed.map(async (job) => {
    try {
      const runner = runners[job.type];
      if (!runner) throw new Error(`No runner for job type ${job.type}`);
      await runner(job.payload);
      await db.query(
        `UPDATE jobs SET status = 'completed', completed_at = now() WHERE id = $1`,
        [job.id]
      );
      completed++;
    } catch (err: any) {
      const errorMsg = String(err?.message ?? err);
      console.error(`[queue] job=${job.id} type=${job.type} failed:`, errorMsg);
      if (job.attempts >= job.max_attempts) {
        await db.query(
          `UPDATE jobs SET status = 'failed', failed_at = now(), last_error = $1
           WHERE id = $2`,
          [errorMsg, job.id]
        );
        failed++;
      } else {
        const backoff = BACKOFF_SECONDS[Math.min(job.attempts - 1, BACKOFF_SECONDS.length - 1)];
        await db.query(
          `UPDATE jobs SET status = 'pending', scheduled_at = now() + ($1 * interval '1 second'),
                          last_error = $2, claimed_at = NULL, claimed_by = NULL, claim_expires_at = NULL
           WHERE id = $3`,
          [backoff, errorMsg, job.id]
        );
        retried++;
      }
    }
  }));

  return { claimed: claimed.length, completed, failed, retried };
}

async function reapStuckJobs(): Promise<void> {
  await getMetaDb().query(
    `UPDATE jobs SET status = 'pending', claimed_at = NULL, claimed_by = NULL,
                    claim_expires_at = NULL, last_error = 'reaper: claim expired'
     WHERE status = 'processing' AND claim_expires_at < now()`
  );
}
```

`runners` (separate file `lib/queue/runners.ts`) is just a `type → async fn` map:

```typescript
import { syncGmail, syncSlack } from "../sync";
import { processRawEvent } from "../pipeline";
import { getMetaDb } from "../db";

type Runner = (payload: any) => Promise<void>;

export const runners: Record<string, Runner> = {
  sync_gmail: async (p) => {
    const result = await syncGmail(p.userId);
    if (result.newMessages > 0) {
      await enqueue({ type: "extract_emails", userId: p.userId, limit: result.newMessages });
    }
  },
  sync_slack: async (p) => {
    const result = await syncSlack(p.userId);
    if (result.newMessages > 0) {
      await enqueue({ type: "extract_emails", userId: p.userId, limit: result.newMessages });
    }
  },
  extract_emails: async (p) => {
    const db = getMetaDb();
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM raw_events
       WHERE user_id = $1 AND extraction_status = 'pending'
       ORDER BY date_sent DESC NULLS LAST LIMIT $2`,
      [p.userId, p.limit]
    );
    for (const { id } of rows) {
      await processRawEvent(p.userId, id);
    }
  },
};
```

(Note: `extract_emails` runs each event sequentially per user — that's intentional, prevents one user's huge backlog from spawning 100 parallel Anthropic calls. If desired, can batch with a bounded `Promise.all` later.)

### 3.4 Trigger model — Option B (cron-driven endpoint with self-trigger)

**Three triggers, all calling the same `drain()`:**

1. **HTTP endpoint** at `app/api/queue/drain/route.ts`:
   ```typescript
   import { NextResponse } from "next/server";
   import { drain } from "@/lib/queue/drain";

   export async function POST() {
     // Optional: gate with a shared secret if exposed publicly.
     const result = await drain();
     return NextResponse.json(result);
   }
   ```

2. **Railway Cron** (or cloud equivalent) configured to `POST` to `/api/queue/drain` every 1 minute. Add to `railway.toml`:
   ```toml
   [[deploy.cronJobs]]
   schedule = "* * * * *"  # every minute
   command = "curl -X POST -fsS $RAILWAY_PUBLIC_DOMAIN/api/queue/drain || true"
   ```
   (Match this pattern to whichever cloud's cron primitive is in use.)

3. **Inline self-trigger on `enqueue()`** — fire-and-forget call to `/api/queue/drain` so user-initiated work starts immediately, not after the next cron tick:
   ```typescript
   export async function enqueue(job: JobInput): Promise<void> {
     await getMetaDb().query(
       `INSERT INTO jobs (type, payload) VALUES ($1, $2)`,
       [job.type, { userId: job.userId, ...job }]
     );
     // Fire and forget. If it fails, cron picks up the job within 1 min.
     fetch(`${process.env.NEXTAUTH_URL}/api/queue/drain`, { method: "POST" })
       .catch(() => { /* swallow — cron is the safety net */ });
   }
   ```

**Why this exact combination:**
- Cron survives container suspends and is the long-tail safety net.
- Self-trigger gives sub-second latency for user actions (clicking "sync" enqueues *and* immediately drains).
- HTTP endpoint is cloud-portable — every cloud has a way to ping a URL on a schedule.

### 3.5 Per-user fairness cap

`PER_USER_CAP = 2`. A single user can have at most 2 jobs in `processing` simultaneously across all types. The third job for that user waits until one of theirs completes — but other users' jobs are still claimable.

This prevents one user's huge initial-sync backlog from monopolizing all 3 worker slots and starving everyone else.

If you later want per-type caps (e.g. "1 sync + 2 extract per user"), it's a small modification to the CTE in §3.2 — add a `JOIN caps ON caps.type = j.type` and select the right cap. Don't do this in v1.

### 3.6 File structure (Phase 3 ready)

```
lib/queue/
  ├── enqueue.ts        ← INSERT into jobs table + self-trigger fetch
  ├── drain.ts          ← The work: claim, run, complete/fail/retry
  ├── runners.ts        ← type → handler map
  └── types.ts          ← shared Job / JobInput types
app/api/queue/drain/
  └── route.ts          ← Phase 2 HTTP trigger
worker.ts               ← Phase 3 entrypoint (NOT created in this phase, but planned)
```

The Phase 3 `worker.ts` would be ~10 lines:

```typescript
import { drain } from "./lib/queue/drain";

const POLL_MS = parseInt(process.env.WORKER_POLL_MS ?? "5000", 10);
async function loop() {
  while (true) {
    try { await drain(); } catch (e) { console.error(e); }
    await new Promise(r => setTimeout(r, POLL_MS));
  }
}
loop();
```

This is added in Phase 3 along with deploying it as a second Railway service. Nothing in `lib/queue/*` changes when that happens.

---

## 4. File-by-file change list

| File | Change |
|---|---|
| `lib/migrate.ts` | Append `jobs` table DDL + two indexes (§3.1). |
| `lib/queue/types.ts` | New. Define `Job`, `JobInput`, `JobType` types. |
| `lib/queue/enqueue.ts` | New. Replaces `lib/queue.ts`'s `enqueue` export. INSERTs into `jobs`, fires self-trigger fetch. |
| `lib/queue/drain.ts` | New. The `drain()` function (§3.3), `reapStuckJobs()`. |
| `lib/queue/runners.ts` | New. The `type → handler` map (§3.3). |
| `lib/queue.ts` | **Delete.** Its `resetStuckJobs` is now `reapStuckJobs` in `drain.ts`; its `enqueue` and `drain` move to `lib/queue/`. |
| `app/api/queue/drain/route.ts` | New. POST handler that calls `drain()`. |
| `instrumentation.ts` | Replace `resetStuckJobs` import with `reapStuckJobs` from `lib/queue/drain`. Keep the call (cleans up jobs left in `processing` on restart). |
| `lib/sync.ts` | `schedulerTick` already calls `enqueue` — just re-import from new location. No logic change. |
| `app/api/sync/...`, `app/api/extract/...` (anywhere a route handler manually triggers work) | Re-import `enqueue` from `lib/queue/enqueue`. |
| `railway.toml` | Add the cron job entry for `/api/queue/drain` (§3.4). |
| `.env.example` | Add `WORKER_CONCURRENCY=3` (default; documented as overridable). |
| `README.md` | Add a "Background jobs" subsection mentioning the cron entry and `WORKER_CONCURRENCY`. |

---

## 5. Migrations

Single addition to `lib/migrate.ts` SCHEMA: the `CREATE TABLE jobs` + two indexes from §3.1. Idempotent (`IF NOT EXISTS`). Runs against `getAdminDb()` like the rest.

No data migration needed. The current in-memory queue is empty on every restart anyway.

---

## 6. Verification

### 6.1 Tests (REQUIRED, must run in CI)

Place in `lib/queue/__tests__/queue.test.ts`. Run against a real Postgres.

```typescript
import { enqueue } from "../enqueue";
import { drain } from "../drain";
import { getMetaDb } from "../../db";

beforeEach(async () => {
  await getMetaDb().query("TRUNCATE jobs");
});

test("enqueued job is claimed and runs", async () => {
  await enqueue({ type: "sync_gmail", userId: "11111111-1111-1111-1111-111111111111" });
  const result = await drain();
  expect(result.claimed).toBeGreaterThanOrEqual(1);
  // Stub the runner in this test to avoid actually hitting Gmail.
});

test("two concurrent drains never claim the same job (SKIP LOCKED)", async () => {
  for (let i = 0; i < 10; i++) {
    await enqueue({ type: "sync_gmail", userId: `user-${i}` });
  }
  const [a, b] = await Promise.all([drain(), drain()]);
  expect(a.claimed + b.claimed).toBeLessThanOrEqual(10);
  // No job appears in both result sets — verify by IDs if you capture them.
});

test("per-user cap blocks more than 2 in flight per user", async () => {
  // Insert 5 jobs for the same user, mark 2 as already processing.
  // drain() should claim at most 0 more for this user.
});

test("failed job retries with backoff", async () => {
  // Enqueue a job whose runner throws. After drain, status should be
  // 'pending' with scheduled_at ~60s in the future and attempts=1.
});

test("max_attempts hit → status='failed'", async () => {
  // After max_attempts drains, status should be 'failed' with last_error set.
});

test("reaper unstucks jobs whose claim_expires_at passed", async () => {
  // Insert a job with status='processing', claim_expires_at in the past.
  // Run drain() → reapStuckJobs flips it back to 'pending' → it gets claimed.
});
```

These six tests are the safety net. SKIP LOCKED behavior under concurrency is the most important one — it's the whole point of using Postgres for this.

### 6.2 Manual smoke

1. Start the dev server. Sign in. Click sync from the UI.
2. `psql -c "SELECT id, type, status, attempts FROM jobs ORDER BY created_at DESC LIMIT 5;"` — see jobs being claimed → completed within seconds (because of self-trigger).
3. Wait 1 minute without doing anything. Tail logs — see cron-triggered `POST /api/queue/drain` calls.
4. Kill the dev server while a sync is mid-flight. Restart. The job should still be `pending` (or recovered by reaper if it was claimed) and complete on the next drain.
5. Spin up a second dev server on `--port 3003` (same DB). Watch logs from both — they should each claim disjoint jobs.

### 6.3 Observability queries (operator runbook)

```sql
-- Queue depth by type and status
SELECT type, status, COUNT(*) FROM jobs GROUP BY type, status;

-- Avg job latency (claim → complete) by type
SELECT type, AVG(completed_at - claimed_at) AS avg_duration
FROM jobs WHERE status = 'completed' AND completed_at > now() - interval '1 hour'
GROUP BY type;

-- Stuck jobs (claim expired but reaper hasn't run)
SELECT id, type, claimed_by, claim_expires_at FROM jobs
WHERE status = 'processing' AND claim_expires_at < now();

-- Failed jobs needing inspection
SELECT id, type, payload->>'userId' AS user_id, last_error, failed_at
FROM jobs WHERE status = 'failed' ORDER BY failed_at DESC LIMIT 50;
```

Bake these into a `/api/admin/queue-stats` JSON endpoint later if you want a live dashboard.

---

## 7. Acceptance checklist

- [ ] `lib/migrate.ts` creates `jobs` table + two indexes; runs on `getAdminDb()`.
- [ ] `lib/queue.ts` deleted; new files in `lib/queue/` exist.
- [ ] `enqueue()` writes to DB *and* fires self-trigger fetch (non-blocking, error-swallowed).
- [ ] `drain()` is the only place that runs jobs; `runners.ts` is the only place that maps types to handlers.
- [ ] Reaper runs at the start of every `drain()` call.
- [ ] `app/api/queue/drain/route.ts` POST handler exists and returns the `DrainResult`.
- [ ] `railway.toml` (or equivalent) has cron pinging `/api/queue/drain` every minute.
- [ ] `instrumentation.ts` calls `reapStuckJobs` on startup (replaces old `resetStuckJobs`).
- [ ] CI runs the six tests in §6.1; all pass.
- [ ] Manual smoke (§6.2) passes including the multi-instance test.

---

## 8. Open questions for the implementer

1. **Cron syntax in Railway**: verify the exact `railway.toml` schema for cron jobs — it changes occasionally. Falling back to a wrapper service is fine if the toml support isn't there.
2. **`NEXTAUTH_URL` in self-trigger**: in dev this is `http://localhost:3002`; in prod it's the Railway domain. The fetch should always use this. If running behind a private network, may want `INTERNAL_URL` env var instead so the loopback hits the local instance directly.
3. **Endpoint auth**: the cron and the self-trigger both hit `/api/queue/drain`. In prod, gate with a shared secret in a header (`X-Queue-Secret`) so randos on the internet can't spam it. Add to env, validate in the route handler.
4. **`extract_emails` per-event parallelism**: currently sequential. If extraction throughput becomes a bottleneck before Phase 4 (per-user keys), can change to `Promise.all` with a small concurrency limit. Don't optimize until measured.

---

## 9. Out of scope but worth knowing about

- **Phase 3** (separate worker process): adds `worker.ts` (10 lines, calls `drain()` in a loop), deploys as a second Railway service. Removes the cron and self-trigger paths. No changes to `lib/queue/*`.
- **Phase 4** (per-user LLM keys): users provide their own Anthropic + OpenAI keys; env-var fallback becomes "free trial only". Eliminates the shared rate-limit ceiling that becomes the bottleneck once Phase 2 unlocks parallelism.
- **Phase 5** (raw_json offload to object storage): independent — touches `raw_events` schema, not the queue.
