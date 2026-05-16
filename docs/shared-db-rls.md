# Phase 1 — Per-user DB → shared DB with Postgres RLS

> **Status:** implemented (kept for the *why*).
> **Scope:** ONLY the database architecture change. Queue, worker tier, BYO API keys, and `raw_json` offload are explicitly out of scope (Phases 2-5).
> **Audience:** Claude Sonnet (or any engineer) implementing this end-to-end.
> **Tense note:** the prose below is preserved in the original imperative/future tense as it was written for the implementer. The work is done — read it as "this is what was changed."

---

## 1. Why this change

Before Phase 1, every user got their own Postgres database (`gbrain_user_<uuid>`) provisioned at sign-in by `provisionGbrainDb()` in `lib/gbrain.ts`. This pattern caps the system at ~50-100 concurrent users on a Pro-tier Postgres before connection-pool explosion, and ~1000-5000 total users before per-DB operational overhead (pg_dump time, migration replays, monitoring opacity) becomes painful.

The fix: one shared Postgres database, with **row-level security (RLS)** enforcing per-user isolation. This is the architecture used by Supabase, Notion, Linear, and most modern multi-tenant SaaS — proven to several million users on a single Postgres before sharding becomes necessary.

There are **no existing users** to migrate. This is a clean cut.

---

## 2. Goals

When done:
1. One Postgres database (`mettrie_meta`) holds all tenant data. No more `gbrain_user_*` databases.
2. RLS policies enforce that user A can never read/write/delete user B's rows, at the database layer.
3. Application traffic runs as a non-superuser role that *cannot* `BYPASSRLS`.
4. Sign-in latency drops from ~44s (CREATE DATABASE + pgvector + migrations) to ~50ms.
5. The gbrain CLI subprocess is gone. Page writes are inline TypeScript.
6. Two CI contract tests prove cross-tenant isolation holds.
7. The change is portable — works unchanged on Railway, AWS RDS, GCP Cloud SQL, Azure Postgres, Supabase, Neon, or any vanilla Postgres 16 + pgvector.

## Non-goals (do NOT do these in this phase)

- ❌ Postgres-backed job queue (Phase 2)
- ❌ Splitting web tier from worker tier (Phase 3)
- ❌ Forcing per-user LLM API keys (Phase 4)
- ❌ Moving `raw_events.raw_json` to object storage (Phase 5)
- ❌ Encrypting `pages.compiled_truth` / `content_chunks.chunk_text` (separate follow-up; the encryption already in place for `raw_events` continues to work as-is)
- ❌ Backwards-compat shims for old `gbrain_user_*` databases (no existing users)

---

## 3. Architecture

### 3.1 Schema additions to `mettrie_meta`

Three tables move out of per-user gbrain DBs and into `mettrie_meta`. Each gains a `user_id UUID NOT NULL` column. Add to the `SCHEMA` constant in `lib/migrate.ts`:

```sql
CREATE TABLE IF NOT EXISTS pages (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  type TEXT,
  compiled_truth TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pages_pkey PRIMARY KEY (id),
  CONSTRAINT pages_user_slug_key UNIQUE (user_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_pages_user_id ON pages (user_id);

CREATE TABLE IF NOT EXISTS content_chunks (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  page_id UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL,
  chunk_text TEXT NOT NULL,
  embedding vector(1536) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT content_chunks_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_content_chunks_user_id ON content_chunks (user_id);
CREATE INDEX IF NOT EXISTS idx_content_chunks_embedding ON content_chunks
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE TABLE IF NOT EXISTS links (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  from_page_id UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  to_page_slug TEXT NOT NULL,
  CONSTRAINT links_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_links_user_id ON links (user_id);
```

(Verify exact columns by reading the existing per-user gbrain schema — gbrain's source defines `pages`/`content_chunks`/`links`. The above is the expected shape; adjust if gbrain has additional columns.)

The `pgvector` extension must be enabled once on `mettrie_meta`:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

### 3.2 RLS policies (one per tenant table)

```sql
-- pages
ALTER TABLE pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE pages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pages_isolation ON pages;
CREATE POLICY pages_isolation ON pages
  USING       (user_id = current_setting('app.user_id')::uuid)
  WITH CHECK  (user_id = current_setting('app.user_id')::uuid);

-- content_chunks
ALTER TABLE content_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_chunks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS content_chunks_isolation ON content_chunks;
CREATE POLICY content_chunks_isolation ON content_chunks
  USING       (user_id = current_setting('app.user_id')::uuid)
  WITH CHECK  (user_id = current_setting('app.user_id')::uuid);

-- links
ALTER TABLE links ENABLE ROW LEVEL SECURITY;
ALTER TABLE links FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS links_isolation ON links;
CREATE POLICY links_isolation ON links
  USING       (user_id = current_setting('app.user_id')::uuid)
  WITH CHECK  (user_id = current_setting('app.user_id')::uuid);
```

**Apply RLS to tenant-data tables only.** Do NOT apply RLS to `mettrie_meta`'s shared/auth tables (`users`, `accounts`, `sessions`, `verification_token`, `raw_events`, `user_api_keys`, `sync_cursors`, `llm_costs`). Those are filtered by application code via `WHERE user_id = $1` and don't need RLS to function. Adding RLS to them would just complicate auth flows.

> **Future:** consider extending RLS to `raw_events` and `user_api_keys` later for defense-in-depth, but it's out of scope for this phase.

### 3.3 Two database roles

```sql
-- Application role: no BYPASSRLS, used by all request traffic
CREATE ROLE mettrie_app LOGIN PASSWORD '<set in env>' NOBYPASSRLS;
GRANT CONNECT ON DATABASE mettrie_meta TO mettrie_app;
GRANT USAGE ON SCHEMA public TO mettrie_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO mettrie_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO mettrie_app;

-- Admin role: superuser, used ONLY for migrations and admin scripts
-- (In Railway / managed Postgres, the existing `mettrie` user already plays this role.)
```

The app's `DATABASE_URL` env var points at `mettrie_app`. A new `ADMIN_DATABASE_URL` env var points at the superuser. Migrations and the encryption-backfill script use `ADMIN_DATABASE_URL`; everything else uses `DATABASE_URL`.

### 3.4 The `withUser` query helper (the safety contract)

This is the single, sanctioned way to query any RLS-protected table. Add to `lib/db.ts`:

```typescript
import { Pool, PoolClient } from "pg";

let pool: Pool | undefined;
let adminPool: Pool | undefined;

export function getMetaDb(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }
  return pool;
}

export function getAdminDb(): Pool {
  if (!adminPool) {
    adminPool = new Pool({
      connectionString: process.env.ADMIN_DATABASE_URL,
      max: 5,
    });
  }
  return adminPool;
}

/**
 * Run `fn` inside a transaction with `app.user_id` set so RLS-protected
 * tables filter to this user only. This is the ONLY sanctioned way to
 * query `pages`, `content_chunks`, or `links`.
 *
 * Why a transaction: `SET LOCAL` is transaction-scoped, so the var dies
 * at COMMIT and the connection returns to the pool clean. Safe under
 * pgBouncer transaction-mode pooling (RDS Proxy, Supavisor, etc.).
 */
export async function withUser<T>(
  userId: string,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getMetaDb().connect();
  try {
    await client.query("BEGIN");
    // set_config(...) lets us pass userId as a parameter; SET LOCAL doesn't.
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
```

**Invariants** (must be enforced by code review and the lint check below):
- Every read/write of `pages`, `content_chunks`, or `links` goes through `withUser(userId, c => c.query(...))`.
- Never call `pool.query(...)` directly on those tables.
- Never call `SET app.user_id = ...` (without `LOCAL`) or `SELECT set_config('app.user_id', ..., false)` (the third arg `false` makes it session-scoped — leak).

### 3.5 Replacing the gbrain CLI write path

Before Phase 1, `lib/gbrain.ts:82` (`putPage`) shelled out to the `gbrain put` subprocess, which:
1. Parses the markdown content (frontmatter + body)
2. Splits the body into chunks
3. Calls OpenAI to embed each chunk
4. INSERTs into the per-user gbrain DB's `pages` and `content_chunks` tables

Replace it with inline TypeScript. New `putPage` in `lib/gbrain.ts`:

```typescript
import { withUser } from "./db";
import { embedText } from "./embeddings";

export async function putPage(
  userId: string,
  slug: string,
  content: string  // full markdown including frontmatter
): Promise<void> {
  const { title, type, body } = parseFrontmatter(content);
  const chunks = chunkText(body);  // see chunking note below

  // Embed all chunks first (parallel; outside the txn to keep it short).
  const embeddings = await Promise.all(chunks.map(c => embedText(userId, c)));

  await withUser(userId, async (c) => {
    const pageRes = await c.query<{ id: string }>(
      `INSERT INTO pages (user_id, slug, title, type, compiled_truth, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (user_id, slug) DO UPDATE
         SET title = EXCLUDED.title,
             type = EXCLUDED.type,
             compiled_truth = EXCLUDED.compiled_truth,
             updated_at = now()
       RETURNING id`,
      [userId, slug, title, type, content]
    );
    const pageId = pageRes.rows[0].id;

    // Replace all chunks for this page
    await c.query(`DELETE FROM content_chunks WHERE page_id = $1`, [pageId]);
    for (let i = 0; i < chunks.length; i++) {
      await c.query(
        `INSERT INTO content_chunks (user_id, page_id, chunk_index, chunk_text, embedding)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, pageId, i, chunks[i], `[${embeddings[i].join(",")}]`]
      );
    }
    // Optionally re-extract wikilinks here and rewrite `links` for this page.
  });
}
```

**Notes for the implementer:**
- `parseFrontmatter()` already exists in `lib/compose.ts` — reuse it.
- `chunkText()`: gbrain's own chunker splits by paragraph then merges to ~1000-token chunks. Match that approximately. A simple version: split on double newlines, then greedily merge to ~3000 chars per chunk. Don't over-engineer — chunking quality affects search ranking but won't break correctness.
- The pgvector literal format is `'[1,2,3,...]'` as a string, quoted as text in the SQL. Cast happens implicitly when target column is `vector`.

Read paths in `lib/gbrain.ts` (`brainSearch`, `getPage`) need the same treatment — wrap in `withUser`. They're simpler because they're already raw SQL queries — just route through `withUser` instead of `getGbrainDb(userId).query(...)`.

### 3.6 Removing the per-user DB plumbing

Delete entirely:
- `provisionGbrainDb()` in `lib/gbrain.ts`
- `getGbrainDb()` in `lib/db.ts`
- The `events.createUser` and `signIn` provisioning blocks in `auth.ts:91-99` and `auth.ts:55-81`
- The `BUN_BIN` env var and all references — no more gbrain subprocess
- The `SUPER_DATABASE_URL` env var (replaced by `ADMIN_DATABASE_URL`)

After this, `auth.ts` shrinks substantially. Sign-in becomes "create user row, set session cookie" — done.

---

## 4. File-by-file change list

| File | Change |
|---|---|
| `lib/migrate.ts` | Append the new `pages`, `content_chunks`, `links` table DDL; the `CREATE EXTENSION vector`; the RLS `ALTER + POLICY` blocks; role grants. |
| `lib/db.ts` | Add `getAdminDb()` and `withUser()`. Delete `getGbrainDb()`. |
| `lib/gbrain.ts` | Rewrite `putPage` inline (no subprocess). Rewrite `brainSearch` and `getPage` to use `withUser`. Delete `provisionGbrainDb`, the `gbrain()` subprocess wrapper, and `bunBin` plumbing. |
| `lib/compose.ts` | Update `findExistingPage` to use `withUser` (currently uses `getGbrainDb`). Reuse the same `parseFrontmatter` helper from `putPage`. |
| `lib/pipeline.ts` | `pagesCreated` count query at line 130 — wrap in `withUser`. |
| `auth.ts` | Remove `provisionGbrainDb` calls in `createUser` event (line 91) and the retry-provisioning block in `signIn` (lines 55-81). |
| `app/(app)/pages/...`, `app/(app)/graph/...`, `app/(app)/ask/...`, `app/(app)/overview/...` | Anywhere a server component reads `pages`/`content_chunks`/`links`, route through `withUser(session.user.id, ...)`. Audit with grep. |
| `app/api/...` route handlers | Same audit; any handler that touches a tenant table must use `withUser`. |
| `Dockerfile` | Remove the gbrain CLI install block (lines 16-31). Remove `BUN_BIN` env var. |
| `.env.example` | Remove `BUN_BIN`, `SUPER_DATABASE_URL`. Add `ADMIN_DATABASE_URL` with comment. |
| `.env.local` | Same. |
| `README.md` | Update Step 3 (no more gbrain CLI install), Step 7 (env var changes). |
| `setup.sh` | Drop the gbrain CLI install steps entirely. |

---

## 5. Migrations

Append to the existing `SCHEMA` const in `lib/migrate.ts`. The CREATE TABLE / CREATE EXTENSION / ALTER TABLE / CREATE POLICY blocks above are all idempotent (`IF NOT EXISTS`, `DROP POLICY IF EXISTS … CREATE POLICY`).

`runMigrations()` already runs against `getMetaDb()`. Switch it to use `getAdminDb()` instead — migrations need superuser to `CREATE EXTENSION` and to grant on tables to `mettrie_app`.

The role creation (`CREATE ROLE mettrie_app …`) cannot be run idempotently from inside a regular migration in all environments (some managed Postgres providers don't allow CREATE ROLE in a migration). Document this as a one-time manual setup step in the README:

> Before first deploy, run as superuser:
> ```sql
> CREATE ROLE mettrie_app LOGIN PASSWORD '<strong-pw>' NOBYPASSRLS;
> ```
> then set `DATABASE_URL` to the `mettrie_app` connection string and `ADMIN_DATABASE_URL` to the superuser one.

---

## 6. Verification (the safety story)

### 6.1 Two contract tests (REQUIRED, must run in CI)

Place in `lib/__tests__/rls-isolation.test.ts` (or wherever the project's test runner expects). Run against a real Postgres (the local Docker one).

```typescript
import { withUser, getAdminDb } from "../db";
import { randomUUID } from "crypto";

let userA: string, userB: string;

beforeAll(async () => {
  userA = randomUUID();
  userB = randomUUID();
  // Seed users in the users table via admin connection.
  const admin = getAdminDb();
  await admin.query(`INSERT INTO users (id, email) VALUES ($1, $2), ($3, $4)`,
    [userA, `a-${userA}@test`, userB, `b-${userB}@test`]);
});

test("user A cannot see user B's pages", async () => {
  await withUser(userA, c =>
    c.query(`INSERT INTO pages (user_id, slug, title, compiled_truth)
             VALUES ($1, 'secret-doc', 'Secret', '# secret content')`, [userA])
  );
  const { rows } = await withUser(userB, c =>
    c.query(`SELECT slug FROM pages WHERE slug = 'secret-doc'`)
  );
  expect(rows).toEqual([]);
});

test("user A cannot insert a page with user B's id", async () => {
  await expect(
    withUser(userA, c =>
      c.query(`INSERT INTO pages (user_id, slug, title, compiled_truth)
               VALUES ($1, 'evil', 'evil', 'evil')`, [userB])
    )
  ).rejects.toThrow(/row.level security|row violates/i);
});

test("query without withUser context throws (default-deny)", async () => {
  // Direct pool query has no app.user_id set → current_setting() throws.
  await expect(
    getMetaDb().query(`SELECT * FROM pages`)
  ).rejects.toThrow(/unrecognized configuration parameter|app.user_id/i);
});
```

These three assertions are the load-bearing safety net. If they pass, the design holds.

### 6.2 Lint / grep check

A simple CI grep that fails the build if any code outside `lib/db.ts` or `lib/__tests__/` writes the literal string `app.user_id`:

```bash
# fails if any non-test file outside lib/db.ts touches app.user_id
! grep -rn "app\\.user_id" --include="*.ts" --include="*.tsx" \\
    --exclude-dir=node_modules --exclude-dir=.next \\
    | grep -v "lib/db\\.ts" | grep -v "__tests__"
```

And another that catches direct queries on tenant tables:

```bash
# fails if any code uses pool.query / getMetaDb().query against tenant tables
! grep -rn "FROM pages\\|FROM content_chunks\\|FROM links\\|INTO pages\\|INTO content_chunks\\|INTO links" \\
    --include="*.ts" --exclude-dir=node_modules --exclude-dir=.next \\
    | grep -v "withUser" | grep -v "lib/migrate\\.ts" | grep -v "__tests__"
```

Add both to `package.json` scripts as `lint:rls` and run in CI before tests.

### 6.3 Manual smoke after deployment

1. Sign in with a fresh Google account → user row created, **no `gbrain_user_*` database created** (verify with `\l` in psql).
2. Sync a few Gmail messages → `raw_events` rows appear.
3. Run extraction → `pages` and `content_chunks` rows appear with the new user's `user_id`.
4. As that user, hit `/pages` and `/ask` → see the data.
5. Sign in as a *second* user, hit the same routes → see only the second user's data, never the first's.

---

## 7. Rollout plan (no live users)

Because there are no existing users:

1. Drop any leftover dev `gbrain_user_*` databases manually (one-line `DROP DATABASE` per).
2. Apply the new migration (just runs the new DDL on an empty schema).
3. Deploy.
4. Done. No data to move.

If staging has dev test users that you want to preserve: drop their tables and re-create them by signing in again. Faster than writing a one-shot migration.

---

## 8. Acceptance checklist

Implementation is complete when:

- [ ] `lib/migrate.ts` creates `pages`, `content_chunks`, `links` with RLS enabled and FORCED.
- [ ] `lib/db.ts` exports `getAdminDb` and `withUser`; no longer exports `getGbrainDb`.
- [ ] `lib/gbrain.ts` no longer spawns subprocesses; `putPage`, `brainSearch`, `getPage` are inline TS using `withUser`.
- [ ] `auth.ts` no longer calls `provisionGbrainDb`; sign-in completes in <500ms locally.
- [ ] `Dockerfile` no longer installs the gbrain CLI.
- [ ] `.env.example` lists `ADMIN_DATABASE_URL`, no `BUN_BIN` / `SUPER_DATABASE_URL`.
- [ ] CI runs `lint:rls` and the three contract tests; both must pass.
- [ ] Manual smoke (section 6.3) passes for two users.
- [ ] No `gbrain_user_*` databases exist on the deployed Postgres.

---

## 9. Open questions for the implementer

These are decisions the implementer should make (or escalate) during the work, not blockers for starting:

1. **Chunking algorithm**: match gbrain's exact behaviour, or pick a simple paragraph-based chunker? Recommendation: simple chunker is fine; chunking quality affects search ranking, not correctness.
2. **`links` table semantics**: gbrain's `links` is derived from wikilinks in the markdown. Decide whether to populate it during `putPage` (parse markdown for `[[wikilinks]]`) or leave empty for now. The graph page (`app/(app)/graph/...`) reads it, so leaving empty means the graph is empty until populated.
3. **ivfflat index `lists` parameter**: 100 is fine for low row counts. Tune to `sqrt(N)` once at scale.
4. **Test runner**: the project doesn't currently have one configured. Recommend Vitest; smallest config, works with Bun.

---

## 10. Out of scope but worth knowing about

These are the next phases discussed in the broader scaling plan. They build on top of this one but are independent:

- **Phase 2** — replace the in-memory job queue (`lib/queue.ts:22`) with a `jobs` table + `SELECT FOR UPDATE SKIP LOCKED`. Makes the system multi-instance safe.
- **Phase 3** — split web tier from worker tier (separate Railway/etc. service).
- **Phase 4** — force per-user Anthropic+OpenAI keys; remove env-var fallback. Eliminates shared rate-limit ceiling.
- **Phase 5** — move `raw_events.raw_json` to object storage (S3/R2/GCS).

Together with Phase 1, these get the system to ~thousands of users on a single Pro-tier Postgres.
