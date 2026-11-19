# Design Decisions

> A running list of significant architectural choices, with the reasoning so future-us doesn't have to spelunk through commit messages.
> Status: living document. Each entry includes the *why* and a "if this turns out wrong" reversal path.
> Format inspired by ADRs (Architecture Decision Records) but kept terse.

---

## DD-1 · Single shared Postgres + RLS, not per-user databases

**Context:** Earlier prototypes (`gbrain` CLI) gave each user their own Postgres database.

**Decision:** One `mettrie_meta` database for everyone. Tenant tables (`pages`, `content_chunks`, `links`, `commitments`, `digests`, `card_recipes`, `digest_feedback`, `workflows`, `workflow_runs`, `page_sources`, `files`, `skills`) all carry a `user_id` column and have `ENABLE + FORCE ROW LEVEL SECURITY`. The `app.user_id` session var is set inside `withUser(userId, fn)` (`lib/db.ts`) for every tenant query.

**Why:**
- Per-user DBs don't scale operationally — provisioning, backups, schema migrations multiply per user.
- RLS is a database-enforced wall. Even a buggy query can't leak data across users.
- The `mettrie_app` role is `NOBYPASSRLS` so app traffic is firewalled by default.

**Tradeoffs:**
- Every tenant query MUST go through `withUser()`. Forgetting it is a class of bug; we have integration tests in `lib/__tests__/rls-isolation.test.ts` that prove every new tenant table is properly isolated.
- Admin scans across users (scheduler tick, migration scripts) need the `mettrie` superuser via `getAdminDb()`.

**Reversal:** Migrating back to per-user DBs is painful but possible — schema is portable.

**Files:** `lib/db.ts`, `docs/shared-db-rls.md`

---

## DD-2 · Postgres-backed job queue (not Redis/BullMQ/SQS)

**Context:** Originally a JS in-memory `Job[]` array.

**Decision:** A `jobs` table with `SELECT FOR UPDATE SKIP LOCKED` claiming. Cron-driven by Railway hitting `POST /api/queue/drain` every minute. Per-user concurrency cap = 2. Retry with backoff 1m/5m/15m, max 3 attempts. A reaper unstucks expired claims.

**Why:**
- One fewer external service (Redis would be a new dependency).
- All state lives in one DB — backups + schema migrations stay simple.
- Postgres skip-locked is genuinely good for low-to-medium workloads.

**Tradeoffs:**
- Won't scale past O(10k jobs/min) without sharding. We're nowhere near that.
- Cron-driven not event-driven, so latency floor is ~60s in prod. `enqueue()` mitigates by self-triggering an immediate `fetch /api/queue/drain` after every insert.

**Reversal:** Swap drain logic for BullMQ/SQS when load warrants. Job table contract stays the same.

**Files:** `lib/queue/*.ts`, `docs/postgres-queue.md`

---

## DD-3 · At-rest encryption with one shared `ENCRYPTION_KEY`

**Decision:** AES-256-GCM via `lib/crypto.ts`. Encrypts OAuth tokens (`accounts.access_token`, `accounts.refresh_token`), user API keys (`user_api_keys.{anthropic,openai}_api_key`), and raw email/Slack body content (`raw_events.{subject,from_addr,body_text,raw_json}`). One master key in `ENCRYPTION_KEY` env var.

**Why:**
- Encrypting at rest means a stolen DB backup isn't a data breach of email content.
- AES-GCM gives integrity + confidentiality in one primitive.

**Tradeoffs:**
- Losing or rotating `ENCRYPTION_KEY` orphans every encrypted row. Must be backed up like a secret of last resort.
- Filenames stored plaintext (need them for the UI list view) — minor metadata exposure.
- Encrypted values aren't searchable in SQL. We accept this — semantic search goes through pgvector embeddings, not `LIKE` on body_text.

**Reversal:** Run a backfill: read every encrypted column, decrypt, re-encrypt with a new key. Painful but bounded.

**Files:** `lib/crypto.ts`, `lib/migrate-encrypt.ts` (one-shot backfill)

---

## DD-4 · `SHARED_KEY_MODE` for LLM key handling

**Decision:** Three deployment modes for the `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` env vars:
- `off` — no shared fallback; users must BYO.
- `trial` — shared fallback active, treated as a free trial (banner + budget gauge).
- `org` — shared fallback active, silent (intended setup, no banner).

User's own key always wins when configured. Default: `trial` in dev, `off` in prod.

**Why this shape (not a binary flag):**
- A binary `SHARED_API_FALLBACK=true|false` couldn't tell apart a *trial* deploy from an *intentional org-wide* deploy. Both look identical from the DB's view; the banner copy differs significantly.
- `org` mode makes the "company-wide shared corporate key" use case clean.

**Tradeoffs:**
- Three knobs (`SHARED_KEY_MODE`, `SHARED_DAILY_USD_CAP`, `ENCRYPTION_KEY`) instead of one. Easy to misconfigure.
- `llm_costs.key_source` is tagged `'shared'` regardless of mode — the mode is purely UX framing.

**Reversal:** Drop the mode env var and re-bind to a binary if it turns out three modes is overkill.

**Files:** `lib/llm-keys.ts`, `docs/api-keys-and-billing.md`

---

## DD-5 · Item drawer instead of route navigation on `/overview`

**Decision:** Clicking a card item on `/overview` opens a side drawer (`PageDrawer` or `WorkflowRunDrawer`) via URL `?slug=` / `?run=` instead of navigating to `/pages/[slug]` or `/workflows/[id]`. Cmd-click still opens the full page in a new tab.

**Why:**
- Linear/Notion/Superhuman pattern. Less context-switching when triaging.
- Drawer state lives in URL → back/forward + sharable links work.
- Server components stay server; the drawer is a client overlay reading the URL param.

**Tradeoffs:**
- Two drawer mounts (`<DrawerMount />` + `<WorkflowRunDrawerMount />`) both read URL params. Slight duplication.
- The drawer can't deep-link to specific sections of long pages without extra anchoring.

**Files:** `app/(app)/overview/page-drawer.tsx`, `workflow-run-drawer.tsx`, `quick-view-link.tsx`, `drawer-mount.tsx`

---

## DD-6 · `kind='job_listing'` to separate opportunities from real projects

**Context:** The extractor treats every entity as one of `person | company | project | topic`. Inbound recruiter pitches and job listings were getting classified as `project`, drowning out actual project pages.

**Decision:** Extraction prompt tags only the listing entity (not the related company/people) with `attributes.kind = 'job_listing'`. New `pages.kind` column captures this. `listActiveThreads` filters `kind != 'job_listing'`. `listOpportunities` filters `kind = 'job_listing' AND type = 'project'`. `/ask` opener + suggestions exclude job listings entirely so the LLM doesn't confabulate "what projects did I lead at OpenAI" for users who only *applied* there.

**Why:**
- Adding a new `EntityType` (e.g. `opportunity`) would require updating all extraction + render paths. A soft `kind` tag is cheaper.
- Most consumers care about `type` × `kind` together — `kind` is a refinement, not a replacement.

**Tradeoffs:**
- The Haiku extraction prompt has to be careful not to leak `kind='job_listing'` onto the related company/person entity. Easy mistake — required explicit guidance and we backfilled mistakes by hand.
- More `kind` values (e.g. `personal_note`, `meeting`) will accrete over time. We'll need taxonomy hygiene.

**Files:** `lib/extract.ts`, `lib/digest.ts:listActiveThreads/listOpportunities`, `lib/migrate.ts:SCHEMA_PAGES_V2`

---

## DD-7 · Engagement signal via `page_sources` + `raw_events.is_from_user`

**Decision:** "Active threads" requires the user to have actually replied. Implemented by:
- `page_sources` table linking each page to the raw_events that produced it.
- `raw_events.is_from_user` boolean set at sync time by comparing the `From:` header to the user's email.
- `listActiveThreads` joins through `page_sources → raw_events` and requires `EXISTS` a same-thread message with `is_from_user = true`.

**Why:**
- Without this, "Active threads" was dominated by passive mentions — every inbound recruiter pitch counted as "activity."
- Tracking sent mail is also why we now sync `q: "in:inbox OR in:sent"` instead of `labelIds: ["INBOX"]`.

**Tradeoffs:**
- Backfilling legacy pages was lossy — Sonnet rewrote the `evidence:` frontmatter into prose, losing `event_id` references. We recovered some via `commitments.raw_event_id` joins.
- Sent mail entering `raw_events` also gets run through extraction, producing some "noise" pages from user-authored content. Acceptable for v1.

**Files:** `lib/migrate.ts:SCHEMA_PAGES_V2` (page_sources), `lib/sync.ts:syncGmail`, `lib/digest.ts:listActiveThreads`, `lib/backfill-engagement.ts`

---

## DD-8 · Cron presets + custom cadences for workflows (not raw cron expressions)

**Decision:** Workflows pick from 6 named presets (`daily_8am`, `weekday_8am`, etc.) OR a custom config of `{ weekdays: int[], hour: 0-23, minute: 0-59 }`. Stored as `trigger_cron` (preset key) + `trigger_custom` (JSONB). No raw `* * * * *` syntax exposed to users.

**Why:**
- Non-technical users won't reason about cron syntax. Presets cover 80% of cases.
- Custom config is structured + validates trivially; no need for a cron parser dep.

**Tradeoffs:**
- Sub-daily cadences (e.g. "every 4 hours") not expressible without a new model.
- DST handling lives in our IANA-tz math (`utcFromTzLocal`), not in a battle-tested cron library. The tests cover the obvious cases; corner cases on DST boundaries may bite eventually.

**Files:** `lib/workflows.ts:CRON_PRESETS`, `nextRunForSchedule`, `app/(app)/workflows/cadence-picker.tsx`

---

## DD-9 · NL generators for workflows + skills (Sonnet drafts, user confirms)

**Decision:** Both `/api/workflows/generate` and `/api/skills/generate` use Sonnet to turn free text ("every Friday afternoon, summarize what I shipped") into a structured draft. The draft is shown to the user for review/edit before saving. **The model never silently creates schedules or skills.**

**Why:**
- Killer UX: users describe intent, we handle the formal spec.
- Trust contract: every saved artifact is the user's explicit decision.

**Tradeoffs:**
- ~$0.01 per generation (Sonnet, ~600 tokens).
- The prompt enumerates valid cron preset keys explicitly. Adding a new preset means updating the prompt.
- `parseWorkflowDraft` / `parseSkillDraft` are robust to fenced JSON, prose-wrapped JSON, and reject unknown enum values — tested independently.

**Files:** `lib/workflows.ts:generateWorkflowFromNL`, `lib/skills.ts:generateSkillFromNL`

---

## DD-10 · Bento layout edit mode via CSS `order` + drag-drop (no library)

**Decision:** Users can reorder + resize bento cards on `/overview`. Stored as `user_preferences.bento_layout` JSONB. Drag-drop uses native HTML5 `draggable`. Sizing is binary (`normal` vs `wide`). Reordering applies via CSS `order` — cards don't re-mount.

**Why:**
- Native DnD avoids a dependency (react-dnd, dnd-kit) for what's essentially a small UI.
- Two sizes (1-col or 2-col span) covers 90% of use without a complex grid model.
- CSS `order` means we don't re-render the bento cards when reordering.

**Tradeoffs:**
- HTML5 DnD doesn't have built-in keyboard support — accessibility is weak.
- We learned the hard way that the drop handler must read the dragged key from `dataTransfer` (not React state) to avoid a closure race. Initially used state → no saves fired.
- Recipe cards are also reorderable but have no `hideFlag` — they only disappear by deleting the recipe in Settings.

**Files:** `app/(app)/overview/bento-board.tsx`

---

## DD-11 · `instrumentation.ts` runs migrations + scheduler tick on boot

**Decision:** Next.js `instrumentation.ts` hook runs `runMigrations()` + `reapStuckJobs()` + `schedulerTick()` once on every server boot.

**Why:**
- Self-healing on deploys: schema diffs apply automatically, missed schedule windows during downtime catch up immediately.

**Tradeoffs:**
- Boot is slower (migrations + scheduler scan). Acceptable for a server-rendered Next app.
- The boot-time `schedulerTick()` historically caused a `unrecognized configuration parameter "app.user_id"` unhandledRejection because it scanned RLS-protected `digests` on the `mettrie_app` role. Fixed by moving the scan to the admin pool (`getAdminDb()`). Lesson: any cross-tenant admin scan goes through admin, not app, pool.

**Files:** `instrumentation.ts`, `lib/sync.ts:schedulerTick`

---

## DD-12 · `getAdminDb()` for cross-tenant scans; `withUser()` for everything else

**Decision:** Two Postgres pools:
- `getMetaDb()` → connects as `mettrie_app` (NOBYPASSRLS). Used for all per-user queries via `withUser()`. Sets `app.user_id` inside a transaction so RLS policies pass.
- `getAdminDb()` → connects as `mettrie` (superuser). Used for migrations, the scheduler tick, and any admin-style scan across all users.

**Why:**
- Defense in depth: app traffic never has elevated privileges. Even if a code path forgets to call `withUser`, the query fails default-deny.
- Cross-user admin scans are a real need (schedulers, cleanup) — bypassing RLS via the admin pool is cleaner than building a per-table admin function.

**Tradeoffs:**
- Two DB connection strings to manage. Worth it.
- Local dev needs both roles created (per `setup.sh`).

**Files:** `lib/db.ts`

---

## DD-13 · Auto memory / per-user prompt customization (AI Memories + Recipes + Skills + Thumbs)

**Decision:** Four mechanisms by which users shape the LLM's behavior, all sharing one shape: **persistent text the user wrote → injected into the system prompt**.

- **AI Memories** (`user_preferences.ai_memories`) — global preferences applied to greetings + cards.
- **Recipes** (`card_recipes`) — NL rules that produce extra brief cards.
- **Skills** (`skills`) — invoked manually in `/ask` chat to shape one turn.
- **Thumbs feedback** (`digest_feedback`) — 30d downvote summary becomes an implicit "avoid these patterns" note in the memories block.

**Why:**
- All four leverage the same primitive (text → prompt) so we don't need separate fine-tuning, separate prompt-engineering surfaces, or vector stores per preference.
- Lets users teach Personal Agent incrementally instead of getting a one-shot model.

**Tradeoffs:**
- Costs more tokens per call (memories block is prepended to every greeting + recipe execution).
- Conflicting memories ("always show dollar amounts" + "be brief") aren't reconciled — the LLM resolves them, with mixed success.

**Files:** `lib/digest.ts:buildMemoriesBlock`, `lib/skills.ts`, `lib/workflows.ts:runRecipe`

---

## DD-14 · Job-listing chunks should NOT be inferred as employment

**Context:** Synthesis pulled "Senior Software Engineer at Acme" chunks and produced "you used to work at Acme" claims.

**Decision:** Synthesis system prompt now has explicit guidance: *"NEVER claim the user works/worked at a company solely because that company appears in their knowledge base. Look for explicit signals (employment dates, payslips, internal communications). If the only matches are job-application chunks, say so directly."*

**Why:**
- The model can't always tell job-listing context from employment context. We tell it explicitly.

**Tradeoffs:**
- Verbose system prompt. We accept the token cost for the safety property.

**Files:** `lib/synthesize.ts:SYSTEM_PROMPT`

---

## DD-15 · Drag key in `dataTransfer`, not React state (subtle DnD bug we hit)

**Context:** First-cut bento DnD: drop handler called `reorder(draggingKey, target)` where `draggingKey` came from React state set in `onDragStart`. State updates are async; sometimes the closure that fires on `onDrop` captured a stale `draggingKey === null`, and no reorder happened. Result: drags felt visual but never persisted.

**Decision:** Use the browser's `dataTransfer` API to ship the dragged key directly: `e.dataTransfer.setData('application/x-bento-key', key)` on start, `e.dataTransfer.getData(...)` on drop. No React-state race.

**Lesson:** For any drag event handler relying on state set in `onDragStart`, prefer `dataTransfer` for the payload.

**Files:** `app/(app)/overview/bento-board.tsx`

---

## DD-16 · PATCH endpoints COALESCE each nullable param against its default

**Context:** First-ever PATCH of `user_preferences` for a user with no existing row → INSERT path → boolean columns marked `NOT NULL DEFAULT true` rejected the explicit `NULL` we passed → 500.

**Decision:** Every PATCH endpoint that does `INSERT … ON CONFLICT … UPDATE` wraps each nullable parameter in `COALESCE($n, <column_default>)` in the VALUES clause. Postgres DEFAULTs apply only when a column is omitted, not when an explicit NULL is passed; we make our PATCHes resilient to partial bodies.

**Lesson:** Partial-PATCH + first-time INSERT is a sharp edge in Postgres. Always check INSERT vs UPDATE behavior separately.

**Files:** `app/api/settings/preferences/route.ts`

---

## DD-17 · Single long-running feature branch, deploys via merge to `main`

**Decision:** All in-progress feature work lives on ONE `feat/*` branch. The user merges to `main` deliberately — `main` triggers Railway deploy. No per-feature branches.

**Why:**
- One review surface. No coordination overhead across many PRs.
- Pre-launch this codebase has one person reviewing; multiple branches multiply context-switch cost.

**Tradeoffs:**
- The single PR will be enormous by the time it merges. We mitigate by writing structured commit messages so the diff reads as a sequence of features.

**Files:** N/A (workflow choice)

---

## DD-18 · After-merge migrations are explicit, not auto-applied on first request

**Context:** `runMigrations()` is idempotent (`CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`). On a greenfield boot, `instrumentation.ts` calls it automatically. But on an existing prod DB receiving a new code deploy, the server may serve requests on new code paths *before* any boot-step has run.

**Decision:** After merging a schema-changing branch into `main`, run `bun -e "import('./lib/migrate').then(m => m.runMigrations())"` explicitly against the connected prod DB.

**Why:**
- Safer than hoping the boot path catches up before traffic hits new columns.

**Files:** `lib/migrate.ts`

---

## How to add a new entry

When you make a non-trivial design decision (anything someone in 6 months might look back at and ask "why did we do *that*?"):

1. Add a section here with: **Context**, **Decision**, **Why**, **Tradeoffs**, optional **Reversal**, **Files**.
2. Keep it ~10-30 lines. Link out to specific code locations.
3. Don't update older entries — append. The order shows the history of decisions and how the system evolved.
4. Cross-link from the relevant feature doc (e.g. `tier-3-workflows.md` links here for DD-8 and DD-9).
