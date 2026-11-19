# Deployment guide

> **Audience:** anyone deploying Keel to a real environment (Railway, AWS, GCP, Azure, self-hosted). For local dev see `README.md`.
> **Reflects:** the state of the codebase after at-rest encryption, Phase 1 (shared DB + RLS), and Phase 2 (Postgres-backed queue). Phases 3-5 are documented in their respective design docs but not yet implemented.

> ⚠️ **If you're deploying to Railway, read §0 before anything else.** The Railway Postgres plugin's default `DATABASE_URL` is the `postgres` *superuser*. Wiring it straight into the app service bypasses RLS and silently leaks every user's data to every other user. §0 walks the safe path. Background: §1–§9.

---

## 0. Railway quickstart (do this BEFORE first deploy or right after, if you skipped it)

The Railway Postgres plugin ships one user — `postgres`, a superuser with `BYPASSRLS=t`. Every tenant query in this codebase (`pages`, `commitments`, `digests`, etc.) has **no `WHERE user_id = …`** — it relies on Postgres RLS for isolation. RLS is silently skipped for superusers and `BYPASSRLS` roles even with `FORCE ROW LEVEL SECURITY`. So pointing the app at the default `postgres` user = full cross-tenant leak. You won't see an error; queries just return everyone's rows.

The fix is to add a second, non-superuser role (`mettrie_app`) and route the app through that, keeping the `postgres` role exclusively for migrations.

### 0.1 Create the `mettrie_app` role

In Railway, open the **Postgres service → Data tab → Query**, then run **each statement separately** (Railway's Query tool auto-appends `LIMIT` and chokes on multi-statement DDL or any statement containing the word `SELECT`):

```sql
CREATE ROLE mettrie_app LOGIN PASSWORD '<paste-strong-pw>' NOSUPERUSER NOBYPASSRLS;
```

```sql
GRANT CONNECT ON DATABASE railway TO mettrie_app;
```

```sql
GRANT USAGE ON SCHEMA public TO mettrie_app;
```

```sql
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO mettrie_app;
```

```sql
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO mettrie_app;
```

```sql
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO mettrie_app;
```

```sql
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON SEQUENCES TO mettrie_app;
```

> **Why `GRANT ALL PRIVILEGES` instead of `GRANT SELECT, INSERT, UPDATE, DELETE`?** Railway's Query tool sees the word `SELECT` inside the GRANT clause and auto-appends `LIMIT`, breaking the statement. `ALL PRIVILEGES` avoids the keyword. The extra rights (`TRUNCATE, REFERENCES, TRIGGER`) don't bypass RLS and are harmless. Alternative: run the whole block via `psql "$DATABASE_PUBLIC_URL"` from your laptop — no auto-LIMIT bug there.

> **Password generation:** use `openssl rand -hex 24`. Hex-only avoids URL-encoding pain in `DATABASE_URL` (no `@ : / # ? & %` to escape). Save the password to a password manager *before* pasting into Railway — you'll need it again in step 0.3 and it's only shown once.

### 0.2 Verify the role

```sql
SELECT rolname, rolsuper, rolbypassrls, rolcanlogin
FROM pg_roles WHERE rolname = 'mettrie_app';
```

Required: `rolsuper = f`, `rolbypassrls = f`, `rolcanlogin = t`. If either of the first two is `t`, **stop** — re-run `ALTER ROLE mettrie_app NOSUPERUSER NOBYPASSRLS;` and re-verify. The leak isn't fixed until both are `f`.

### 0.3 Wire the app service to the right variables

On the **app service** (the Next.js one) → **Variables**:

| Variable | Value | Notes |
|---|---|---|
| `DATABASE_URL` | `postgresql://mettrie_app:<pw>@<host>:5432/railway` | The new non-superuser. **All request traffic uses this.** Same host/port/db as the Postgres service's auto-generated `DATABASE_URL`; only the user/password differ. |
| `ADMIN_DATABASE_URL` | `postgresql://postgres:<pw>@<host>:5432/railway` | The original superuser string (what Railway gave you by default). Used **only** by `runMigrations()` at boot to `ENABLE ROW LEVEL SECURITY`, `CREATE EXTENSION vector`, etc. The `mettrie_app` role can't do those — deliberately. |

Both vars must exist and point at different roles. If `ADMIN_DATABASE_URL` is unset, `lib/migrate.ts:476` falls back to `DATABASE_URL` (= `mettrie_app`), migrations fail with permission errors, RLS policies don't get refreshed on schema changes.

If Railway shows `DATABASE_URL` as a reference like `${{Postgres.DATABASE_URL}}`, **overwrite with a literal string**. The reference will keep pointing at the superuser.

### 0.4 Redeploy and verify in logs

Saving env vars on Railway sometimes auto-deploys, sometimes not. Force one: **app service → Deployments → ⋯ → Redeploy**. Watch the deploy logs for:

```
[migrate] core schema ok
[migrate] pgvector extension ok
[migrate] tenant tables ok
[migrate] RLS policies ok
[migrate] mettrie_app grants ok
```

If you see `password authentication failed for user "mettrie_app"` → the password in `DATABASE_URL` is wrong (URL-encoding issue, or you copied the wrong one). If you see `permission denied … pages` → `mettrie_app` is missing grants; re-run §0.1's GRANT block. If you see `must be superuser … CREATE EXTENSION` → `ADMIN_DATABASE_URL` is missing or also pointing at `mettrie_app`.

### 0.5 Two-browser cross-tenant test (non-negotiable)

1. Sign in as user A in a normal window → visit `/pages`, `/overview`. Note what you see.
2. Sign in as user B in an incognito window (different Google account) → visit `/pages`, `/overview`. **Must see only B's data, never A's.**

If B sees any of A's rows: `DATABASE_URL` is still pointing at a superuser, or `mettrie_app` somehow has `BYPASSRLS=t`. Re-run §0.2's check. Don't accept users until this passes.

### 0.6 Rotate any password that touched chat, screenshots, or notes

Any password that appears in a Railway screenshot, a Slack message, a chat with an assistant, or an unencrypted notes file is **compromised** — assume it's leaked. Rotate by re-running step 0.1's `CREATE ROLE` as an `ALTER ROLE … PASSWORD …`, generate a fresh hex password, and update `DATABASE_URL` / `ADMIN_DATABASE_URL` on the app service.

```sql
ALTER ROLE mettrie_app WITH PASSWORD '<new-strong-pw>';
-- and/or, if the postgres superuser password is also compromised:
ALTER ROLE postgres WITH PASSWORD '<new-strong-pw>';
```

After rotating `postgres`, you must also update any other Railway service that references it (the Postgres plugin's own internal variable, plus your app's `ADMIN_DATABASE_URL`).

---

## 1. What you need

| Component | Purpose | Notes |
|---|---|---|
| **Postgres 16+** with `pgvector` extension | The only data store. All tenant data, auth, queue. | Vanilla Postgres works on any cloud. See §8 for cloud-specific minimum versions. |
| **A way to run a Node/bun server** | Hosts Next.js | Railway, Fly, Render, Cloud Run, ECS, EC2, anything that runs containers or `bun server.js`. |
| **A scheduled HTTP pinger** | Triggers the queue drain + scheduler | Railway Cron, EventBridge, Cloud Scheduler, Azure Logic Apps. Two cron jobs required: `POST /api/queue/drain` every 1 min (queue worker), `POST /api/cron/scheduler-tick` every 5 min (Gmail/Slack sync scheduler). |
| **HTTPS termination** | Auth.js v5 + Slack require it in prod | Provided by Railway/Cloud Run/etc. by default; on EC2/EKS bring your own (ALB, Cloudflare). |
| **Outbound internet** | Calls Anthropic, OpenAI, Gmail, Slack APIs | No special peering needed. |

---

## 2. Required environment variables

| Var | Required | Generated how | Notes |
|---|---|---|---|
| `DATABASE_URL` | ✅ | `postgresql://mettrie_app:<pw>@<host>:5432/<db>` | App-traffic role — must be `NOBYPASSRLS`. Used by all request handlers. |
| `ADMIN_DATABASE_URL` | ✅ | `postgresql://<superuser>:<pw>@<host>:5432/<db>` | Superuser role — runs migrations, backfills, admin scripts. **Must NOT be used for request traffic.** |
| `AUTH_SECRET` | ✅ | `openssl rand -base64 32` | Auth.js session signing key. |
| `AUTH_TRUST_HOST` | ✅ | `true` | Auth.js v5 requires this behind any proxy or HTTPS terminator; without it sign-in returns "UntrustedHost" 500. |
| `ENCRYPTION_KEY` | ✅ | `openssl rand -base64 32` | AES-256-GCM master key for OAuth tokens, user API keys, raw Gmail/Slack content. **If lost, all encrypted rows become unrecoverable.** Store in a password manager. Never reuse the dev key. |
| `NEXTAUTH_URL` | ✅ | `https://<your-domain>` | Drives OAuth callback URLs for Google + Slack. Must match what's configured in those providers. |
| `GOOGLE_CLIENT_ID` | ✅ | from Google Cloud Console | Same Client ID can be used across environments only if its authorized redirect URIs include each environment's `${NEXTAUTH_URL}/api/auth/callback/google`. |
| `GOOGLE_CLIENT_SECRET` | ✅ | from Google Cloud Console | |
| `SLACK_CLIENT_ID` | ✅ | from api.slack.com/apps | |
| `SLACK_CLIENT_SECRET` | ✅ | from api.slack.com/apps | |
| `ANTHROPIC_API_KEY` | ✅ | from console.anthropic.com | Default key used when a user hasn't supplied their own. Until Phase 4, this is the rate-limit ceiling shared across all users. |
| `OPENAI_API_KEY` | ✅ | from platform.openai.com | Same — until Phase 4 this is shared across users. Used inline by `lib/embeddings.ts` for chunk embeddings; no subprocess involved. |
| `WORKER_CONCURRENCY` | optional | integer, default `3` | How many jobs the queue drains in parallel per call. Raise on bigger instances; lower if Anthropic/OpenAI rate limits start tripping. |
| `QUEUE_SECRET` | recommended in prod | `openssl rand -base64 24` | Shared secret for `POST /api/queue/drain`. If set, both the cron and the in-process self-trigger send `X-Queue-Secret: <value>`; the route returns 401 without it. **Set this in any environment exposed to the public internet** — without it, anyone can drain your queue. |
| `INTERNAL_URL` | optional | service-internal URL (e.g. `http://${RAILWAY_PRIVATE_DOMAIN}`) | Used by `enqueue()` self-trigger to hit `/api/queue/drain` without going through the public load balancer. Falls back to `NEXTAUTH_URL` if unset (works fine, just adds ~50ms per self-trigger). |

**Do not set these (deprecated, removed in Phase 1):**
- ~~`SUPER_DATABASE_URL`~~ → renamed to `ADMIN_DATABASE_URL`
- ~~`BUN_BIN`~~ → no more gbrain subprocess
- ~~`GBRAIN_DATABASE_URL`~~ → no more per-user databases

---

## 3. One-time setup (per environment)

Do these once when bringing up a new staging or prod environment. None of them are idempotent on the second run — that's why they're separate from migrations.

### 3.1 Provision Postgres

1. Create a Postgres 16+ instance with the `pgvector` extension available.
2. Create the application database:
   ```sql
   CREATE DATABASE mettrie_meta;
   ```
3. Connect to `mettrie_meta` as the superuser and enable pgvector:
   ```sql
   \c mettrie_meta
   CREATE EXTENSION IF NOT EXISTS vector;
   ```

### 3.2 Create the application role

Run as the Postgres superuser:

```sql
CREATE ROLE mettrie_app LOGIN PASSWORD '<generate a strong password>' NOBYPASSRLS;
GRANT CONNECT ON DATABASE mettrie_meta TO mettrie_app;
\c mettrie_meta
GRANT USAGE ON SCHEMA public TO mettrie_app;
-- The migrations grant SELECT/INSERT/UPDATE/DELETE on tables; that step
-- depends on this role existing first.
```

`NOBYPASSRLS` is the load-bearing flag. Without it, `mettrie_app` would silently bypass row-level security and you'd have a multi-tenant data leak.

`DATABASE_URL` for the app uses `mettrie_app:<password>@host/mettrie_meta`.
`ADMIN_DATABASE_URL` uses the superuser credentials.

### 3.3 Configure OAuth providers

**Google Cloud Console → APIs & Services → Credentials → your OAuth Client:**
- Authorized redirect URI: `${NEXTAUTH_URL}/api/auth/callback/google`
- Add the deploying user's Google email as a test user (until OAuth consent goes to "Production" mode).

**Slack App → OAuth & Permissions:**
- Redirect URL: `${NEXTAUTH_URL}/api/slack/callback`
- For multi-workspace public distribution: complete the Manage Distribution checklist (HTTPS required).

### 3.4 Set environment variables

Set every var from §2 in your platform's secrets store. **Do not commit them to git.** Generate fresh `AUTH_SECRET` and `ENCRYPTION_KEY` per environment — never copy from local dev.

### 3.5 Configure the cron

Two cron jobs required:

1. **Queue drain** — `POST ${NEXTAUTH_URL}/api/queue/drain` every **1 minute**. Drains pending jobs even when the container is otherwise idle (Railway and similar suspend idle containers). Send `X-Queue-Secret: $QUEUE_SECRET` in the header. Safe to call with nothing to do (cheap no-op).

2. **Sync scheduler** — `POST ${NEXTAUTH_URL}/api/cron/scheduler-tick` every **5 minutes**. Looks at `sync_cursors`, enqueues `sync_gmail` / `sync_slack` jobs for any user whose interval has elapsed.

Both are idempotent. If the cron platform supports retries on failure, enable them — the route returning a 5xx will be retried on the next tick anyway.

Cloud-specific cron config: see §8.

---

## 4. Deploy procedure

The actual deploy is just "ship the container and start it." Migrations run automatically on startup via `instrumentation.ts`.

### 4.1 First deploy

1. Confirm §3 is done.
2. Push the container / trigger the deploy.
3. On startup the app:
   - Loads `ENCRYPTION_KEY`, `DATABASE_URL`, `ADMIN_DATABASE_URL` (boot fails fast if any are missing or malformed).
   - Runs `runMigrations()` against `ADMIN_DATABASE_URL`: creates `users`, `accounts`, `raw_events`, `pages`, `content_chunks`, `links`, etc. Enables the `vector` extension. Applies RLS policies. Grants on tables to `mettrie_app`.
   - Resets any `processing` raw_events back to `pending` (recovery from a previous crash).
4. Watch logs for `[migrate] mettrie_meta schema up to date` — that's the success signal.

### 4.2 Subsequent deploys

Same. The migrations are idempotent (`CREATE TABLE IF NOT EXISTS`, `DROP POLICY IF EXISTS … CREATE POLICY`). New columns / tables added in a future PR get applied automatically.

### 4.3 If you have existing user data on a previous deployment

Two cases:
- **Existing data is already encrypted under the same `ENCRYPTION_KEY`:** no action.
- **Migrating from an old per-user gbrain DB schema:** there's no automated migration script. Either re-extract from `raw_events` (set `extraction_status = 'pending'` for the affected users and let the pipeline rerun) or write a one-shot migration. For small data, re-extraction is faster.

**Backfill encryption** if data was inserted before encryption was enabled:
```bash
bun run lib/migrate-encrypt.ts
```
Idempotent (skips rows already prefixed with `enc:v1:`).

---

## 5. Post-deploy verification

Run through these every deploy. They take ~2 minutes total.

### 5.1 Schema + extension

```bash
psql "$ADMIN_DATABASE_URL" -c "\dx" | grep vector
# expect: vector | <version> | public | vector data type and ivfflat access methods

psql "$ADMIN_DATABASE_URL" -c "
  SELECT tablename, rowsecurity, forcerowsecurity
  FROM pg_tables WHERE schemaname='public'
  AND tablename IN ('pages','content_chunks','links');"
# expect: all three rows show rowsecurity=t, forcerowsecurity=t
```

### 5.2 App role doesn't bypass RLS

```bash
psql "$ADMIN_DATABASE_URL" -c "
  SELECT rolname, rolsuper, rolbypassrls
  FROM pg_roles WHERE rolname IN ('mettrie_app');"
# expect: rolsuper=f, rolbypassrls=f
```

If `rolbypassrls=t`, **stop and fix** — multi-tenant isolation is broken. Run:
```sql
ALTER ROLE mettrie_app NOBYPASSRLS;
```

### 5.3 Sign-in flow

1. Open the deployed URL in a fresh browser profile.
2. Sign in with Google → should land on `/overview` in <2 seconds (no per-user DB to provision since Phase 1).
3. Hit `/sources`, click "Sync Gmail" → check logs show `[queue] sync_gmail user=<uuid> new=<count>`.
4. Click "Extract all" → check logs show `[queue] event=<id> status=extracted pages=<count>` (a count, not slugs — slugs in logs are a content leak).
5. Hit `/pages` → see your knowledge.

### 5.4 Cross-tenant isolation

Sign in as a second user (different Google account). Hit `/pages`, `/ask`, `/graph` — should see ONLY the second user's data, never the first user's. If you see the first user's data, **stop the deploy and rotate everything** — RLS is broken.

### 5.5 Encryption check

```bash
psql "$ADMIN_DATABASE_URL" -c "
  SELECT
    count(*) AS total,
    count(*) FILTER (WHERE access_token LIKE 'enc:v1:%') AS encrypted
  FROM accounts;"
# expect: total = encrypted (or 0 if no users yet)

psql "$ADMIN_DATABASE_URL" -c "
  SELECT
    count(*) AS total,
    count(*) FILTER (WHERE body_text LIKE 'enc:v1:%' OR body_text IS NULL OR body_text = '') AS encrypted_or_empty
  FROM raw_events;"
# expect: total = encrypted_or_empty
```

If counts don't match, run `bun run lib/migrate-encrypt.ts` against this environment.

### 5.6 Logs don't leak user content

Tail logs while triggering an extraction. Confirm:
- ✅ Job IDs (UUIDs), counts, status strings appear
- ✅ Truncated `err.message` (≤200 chars) for failures
- ❌ Page slugs (e.g. `companies/jobright`)
- ❌ Email subjects, bodies, sender addresses
- ❌ User questions from `/ask`

If any of the ❌ items appear, grep the codebase for the offending `console.*` and replace `, err)` with `, String(err?.message ?? err).slice(0, 200))`.

---

## 6. Operator runbook (psql one-liners)

Useful when something looks off.

```sql
-- How many users? How many pages each?
SELECT u.email, COUNT(p.id) AS pages
FROM users u LEFT JOIN pages p ON p.user_id = u.id
GROUP BY u.email ORDER BY pages DESC;

-- Extraction backlog
SELECT extraction_status, COUNT(*) FROM raw_events GROUP BY extraction_status;

-- Per-user storage (rough)
SELECT u.email,
       pg_size_pretty(SUM(pg_column_size(re.*))) AS raw_events_size,
       pg_size_pretty(SUM(pg_column_size(p.*))) AS pages_size
FROM users u
LEFT JOIN raw_events re ON re.user_id = u.id
LEFT JOIN pages p ON p.user_id = u.id
GROUP BY u.email;

-- Daily LLM spend by user
SELECT user_id, model, SUM(cost_usd) AS spent_24h
FROM llm_costs WHERE called_at >= now() - interval '24 hours'
GROUP BY user_id, model ORDER BY spent_24h DESC;

-- Connection count (am I close to max_connections?)
SELECT count(*), state FROM pg_stat_activity WHERE datname = 'mettrie_meta'
GROUP BY state;

-- Queue depth by type and status
SELECT type, status, COUNT(*) FROM jobs GROUP BY type, status ORDER BY type, status;

-- Stuck jobs (claim expired, reaper hasn't run yet — usually self-resolves on next drain)
SELECT id, type, claimed_by, claim_expires_at, attempts FROM jobs
WHERE status = 'processing' AND claim_expires_at < now();

-- Failed jobs needing inspection
SELECT id, type, payload->>'userId' AS user_id, last_error, failed_at
FROM jobs WHERE status = 'failed' ORDER BY failed_at DESC LIMIT 50;

-- Avg job latency (claim → complete) by type, last hour
SELECT type, COUNT(*) AS completed, AVG(completed_at - claimed_at) AS avg_duration
FROM jobs WHERE status = 'completed' AND completed_at > now() - interval '1 hour'
GROUP BY type;

-- Per-user job throughput (last 24h)
SELECT payload->>'userId' AS user_id, type, COUNT(*) AS completed_24h
FROM jobs WHERE status = 'completed' AND completed_at > now() - interval '24 hours'
GROUP BY payload->>'userId', type ORDER BY completed_24h DESC;
```

---

## 7. Common failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Boot crashes with `ENCRYPTION_KEY env var is required` | Env var unset or wrong length | Generate with `openssl rand -base64 32`, set in platform secrets |
| Sign-in returns "UntrustedHost" 500 | `AUTH_TRUST_HOST` not set | Set `AUTH_TRUST_HOST=true` in env |
| Sign-in works but `/overview` shows nothing for a returning user | They had data in old `gbrain_user_*` DBs (pre-Phase 1) | Re-extract from `raw_events`: `UPDATE raw_events SET extraction_status='pending' WHERE user_id=$1 AND extraction_status='extracted';` then trigger extraction |
| Every query on `pages` returns 0 rows even with data present | `mettrie_app` has `BYPASSRLS=false` (good) but `app.user_id` isn't getting set | Verify code path uses `withUser(...)`, not `getMetaDb().query(...)` for tenant tables |
| `error: row violates row-level security policy` on INSERT | Caller is trying to insert with a `user_id` different from `app.user_id` | Either pass the right user_id, or this is a bug — caller has the wrong session |
| `error: unrecognized configuration parameter "app.user_id"` on SELECT | Code is querying tenant tables outside `withUser` | Wrap the query in `withUser(userId, c => c.query(...))` |
| `error: function set_config(unknown, unknown, unknown) does not exist` | Postgres < 9.4 | Upgrade. Postgres 16+ is the supported floor. |
| pgvector queries error with `type "vector" does not exist` | Extension not enabled on the right database | `CREATE EXTENSION vector;` while connected to `mettrie_meta` |
| ivfflat index build skipped on first deploy | Empty `content_chunks` table — ivfflat needs sample rows | Harmless; index is auto-created on subsequent migration runs once data exists |
| Anthropic returns 400 "no low surrogate in string" | Email body contains unpaired UTF-16 surrogate (mangled emoji) | Sanitize `bodyText` in `lib/extract.ts` before the Claude call: `bodyText.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])\|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "")` |
| Duplicate sign-ins create duplicate `accounts` rows | NextAuth pg-adapter behavior; not a Phase 1 regression | The `signIn` callback in `auth.ts` UPDATEs the row instead of inserting; verify it's still being called |
| Jobs stuck in `pending` forever; nothing extracts | Cron not configured, hitting wrong URL, or wrong/missing `QUEUE_SECRET` | Check `SELECT count(*) FROM jobs WHERE status='pending'` is rising; `curl -X POST -H "X-Queue-Secret: $QUEUE_SECRET" $NEXTAUTH_URL/api/queue/drain` should return `{"claimed":N,...}`. If 401, header missing/wrong. If 200 but `claimed=0` and pending count is non-zero, check `scheduled_at` — jobs may be waiting on backoff. |
| `POST /api/queue/drain` returns 401 Unauthorized | `QUEUE_SECRET` set in env but the caller isn't sending matching header | Either pass `X-Queue-Secret: $QUEUE_SECRET` or unset the env var (only safe behind a private network) |
| Many jobs in `processing` with `claim_expires_at` in the past | Worker crashed mid-job; reaper hasn't run yet | Self-resolves on next drain (reaper is the first thing each drain does, resets to `pending`). If persistently stuck, run a manual drain: `curl -X POST -H "X-Queue-Secret: $QUEUE_SECRET" .../api/queue/drain` |
| Same job claimed twice (logs show two workers running it) | `mettrie_app` role missing required SELECT/UPDATE on `jobs`, OR pgBouncer in `statement` pooling mode (breaks `SELECT FOR UPDATE`) | Verify role grants on `jobs` table. Verify pgBouncer is `transaction` or `session` mode, not `statement`. |
| Queue depth grows faster than it drains | `WORKER_CONCURRENCY` too low for sustained load, OR Anthropic/OpenAI rate-limiting causing retries | Raise `WORKER_CONCURRENCY` (watch DB connections). Check `SELECT type, COUNT(*) FROM jobs WHERE status='failed' GROUP BY type` — if extract_emails is failing with 429s, you're rate-limited (Phase 4 fixes by per-user keys). |
| `[queue] sync_gmail user=… new=N` then no extract job appears | The runner enqueued an `extract_emails` job but the self-trigger fetch failed (NEXTAUTH_URL wrong or unreachable from the worker's network) | The cron will pick it up within 1 min anyway. To fix latency, set `INTERNAL_URL` to a service-internal hostname that resolves from the worker. |

---

## 8. Cloud-specific notes

### Railway

- ⚠️ **Two-role setup is mandatory** — see §0 above. The default `DATABASE_URL` Railway provides is the `postgres` superuser; using it for the app silently breaks RLS. Create `mettrie_app` (§0.1) and wire it through `DATABASE_URL`; keep `postgres` exclusively in `ADMIN_DATABASE_URL`.
- ⚠️ **Railway Query tab auto-appends `LIMIT`** to anything containing the word `SELECT`. Run DDL one statement at a time, use `GRANT ALL PRIVILEGES` instead of `GRANT SELECT, …`, or shell into `psql "$DATABASE_PUBLIC_URL"` from your laptop.
- ⚠️ **Passwords in screenshots/chat are leaked.** Generate with `openssl rand -hex 24` (no URL-special chars). If you must screenshot the Variables tab, blur the value before sharing. Rotate immediately if exposed (§0.6).
- Default Postgres plugin is direct (no pgBouncer). pgvector available on `pgvector/pgvector:pg16` template.
- Cron: `railway.toml` (both required):
  ```toml
  [[deploy.cronJobs]]
  schedule = "* * * * *"
  command = "curl -X POST -fsS -H \"X-Queue-Secret: $QUEUE_SECRET\" $RAILWAY_PUBLIC_DOMAIN/api/queue/drain || true"

  [[deploy.cronJobs]]
  schedule = "*/5 * * * *"
  command = "curl -X POST -fsS $RAILWAY_PUBLIC_DOMAIN/api/cron/scheduler-tick || true"
  ```
- Set `AUTH_TRUST_HOST=true`. Set `NEXTAUTH_URL` to the Railway public URL.
- Set `INTERNAL_URL=http://$RAILWAY_PRIVATE_DOMAIN` to avoid the public proxy roundtrip on `enqueue()` self-triggers.

### AWS (Fargate / ECS / EKS / EC2 + RDS)

- RDS for PostgreSQL: minimum **15.2** for pgvector. Enable in parameter group: `shared_preload_libraries = vector`.
- For large workloads add **RDS Proxy** in front (transaction-mode pooling — our `withUser` works under it).
- Cron: EventBridge Scheduler → Lambda or HTTP target hitting your ALB.
- Secrets in AWS Secrets Manager; reference via task-definition `secrets:` block.

### GCP (Cloud Run + Cloud SQL)

- Cloud SQL for PostgreSQL: minimum **14.6** for pgvector. Enable: in Flags, `cloudsql.enable_pgvector = on`.
- Cloud Run: use the Cloud SQL Auth Proxy sidecar OR connect via private VPC. Either way, `DATABASE_URL` is `postgresql://mettrie_app:<pw>@/mettrie_meta?host=/cloudsql/<instance>` (Unix socket).
- Cron: Cloud Scheduler → HTTP target.
- Cloud Run scales to zero by default — turn it OFF for the service hosting `/api/cron/...`, or accept that the scheduler endpoint may take a few seconds to wake (cron retries on 5xx so this is usually fine).

### Azure (App Service / Container Apps + Azure Database for PostgreSQL Flexible Server)

- Azure Database for PostgreSQL Flexible Server has pgvector available; enable via **server parameters → `azure.extensions = vector`**.
- Built-in PgBouncer in transaction mode — toggle on with `pgbouncer.enabled = on`. Our `withUser` is safe under it.
- Cron: Azure Logic Apps with a recurrence trigger → HTTP action.

### Self-hosted (Docker Compose, Kubernetes)

- Use the `pgvector/pgvector:pg16` image directly.
- Run a sidecar / cronjob container that does `curl -X POST <internal-url>/api/cron/scheduler-tick` on schedule.
- Bring your own HTTPS terminator (nginx, Traefik, Caddy).

---

## 9. Security checklist

Before serving real users:

- [ ] `mettrie_app` role exists with `NOBYPASSRLS` (verify with §5.2 query)
- [ ] `DATABASE_URL` uses `mettrie_app`, not the superuser
- [ ] `ADMIN_DATABASE_URL` is set ONLY for the Next.js process (or wherever migrations run); not handed to anything else
- [ ] All three RLS contract tests pass in CI (`bun test`)
- [ ] `bun run lint:rls` passes in CI
- [ ] `ENCRYPTION_KEY` is unique per environment (never reused from dev/staging)
- [ ] `ENCRYPTION_KEY` is stored in a password manager AND in the platform secrets store
- [ ] `AUTH_SECRET` is unique per environment
- [ ] No `console.log`/`console.error` in the codebase emits raw `err` objects (run §5.6 audit)
- [ ] Encryption backfill has run (or N/A — no pre-existing data)
- [ ] OAuth client IDs/secrets restricted to the right `NEXTAUTH_URL`
- [ ] `AUTH_TRUST_HOST=true` set
- [ ] HTTPS enforced; HTTP redirects to HTTPS
- [ ] `QUEUE_SECRET` set in env; `/api/queue/drain` returns 401 without the matching `X-Queue-Secret` header (verify with `curl` from outside)
- [ ] All 6 queue contract tests pass (`bun test`)

---

## 10. What's planned but not deployed yet

These exist as design docs and will become deploy steps when implemented:

- **Phase 3 — Separate worker process**: deploy `worker.ts` as a second service that polls the `jobs` table directly (replacing the cron + self-trigger pair). No new env vars, just an additional service definition. Buys real isolation between web and worker tiers.
- **Phase 4 — Per-user LLM keys forced**: the env-var fallback for `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` becomes "free trial only" (e.g. first N pages). Each user must supply their own keys past the trial. Eliminates the shared-rate-limit ceiling that becomes the bottleneck once Phase 2 unlocks parallelism.
- **Phase 5 — `raw_json` to object storage**: adds `S3_BUCKET` / `OBJECT_STORAGE_URL` env vars; raw Gmail payloads move out of Postgres. Cuts DB storage ~10×.

When each ships, add its env vars to §2 and its cron/role/service steps to §3.

---

## 11. Backups

- **Use the cloud's native Postgres backup** (RDS automated backups, Cloud SQL automated backups, Azure backup, Railway snapshots). Daily is fine for beta; raise to hourly when you have real users.
- **Do NOT back up `ENCRYPTION_KEY` to the same place as the database backup.** If both leak, encryption is moot. Key in a password manager, DB in cloud backups — different blast radius.
- **Restore drill once before launch:** restore a backup into a scratch instance, set `ENCRYPTION_KEY` and `ADMIN_DATABASE_URL` pointing at it, run `bun run dev`, sign in, verify pages load. If decrypt fails, the backup-key pair is wrong — fix before you need it for real.
- **`ADMIN_DATABASE_URL` is destruction-capable.** Treat it like an AWS root account: only the deploy process has it, never given to humans for ad-hoc psql sessions.
