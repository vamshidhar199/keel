# Roadmap — Phases 3, 4, 5

> **Status:** sketches, not implementation specs. When any of these gets prioritized, write a full design doc (same shape as `shared-db-rls.md` / `postgres-queue.md`) and only then have Sonnet implement.
> **Already shipped:** at-rest encryption, Phase 1 (shared DB + RLS), Phase 2 (Postgres-backed queue). See `deployment.md` for what to do today.

---

## Phase 3 — Separate worker process

**What:** Deploy a second Railway service that runs `worker.ts` (a ~10-line poll loop calling `drain()` from `lib/queue/drain.ts`). The web service stops needing the cron + self-trigger path.

**Why:** today, web requests and Claude/OpenAI calls share the same Node process. A long extraction can spike CPU and slow down sign-in for everyone. Separating gives real isolation between web and worker tiers, and lets each scale independently.

**What changes:**
- New `worker.ts` entrypoint at the repo root (~10 lines)
- New Railway service definition (or equivalent on whatever platform)
- Remove (or keep as fallback) the `/api/queue/drain` cron — the worker polls directly
- Nothing in `lib/queue/*` changes — that's why Phase 2 was structured this way

**Effort:** ~half a day, mostly platform config.
**Cost:** doubles deployed services. Still cheap (Railway compute is per-second).
**Trigger to build it:** users complaining sign-in is slow during heavy extraction; or `SELECT count(*) FROM jobs WHERE status='pending' AND created_at < now() - interval '5 minutes'` is consistently > 0 (cron isn't keeping up).

---

## Phase 4 — Force per-user LLM keys (drop the shared rate-limit ceiling)

**What:** `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` env vars become a "free trial" pool — each user gets ~50 extractions on the house, then must add their own keys. The settings UI to add per-user keys already exists (`app/(app)/settings/api-keys-panel.tsx`); this phase just enforces the trial cap and routes onboarding to it.

**Why:** today every user shares one Anthropic tier-1 quota (50 RPM Sonnet, 40K input tokens/min). Five users extracting concurrently = rate-limited. With per-user keys, each user's quota is their own — your shared bill stops growing with usage too.

**What changes:**
- `lib/anthropic.ts` and `lib/embeddings.ts`: track per-user "trial credits used" (probably a column on `users` or a `user_trial` table); reject calls with a clear "add your own key" error when over
- Settings page: "trial credits remaining" display + clearer CTA
- Onboarding flow: prompt for keys after N successful extractions, or up-front during sign-up
- README + deployment docs: mention the trial limit knob

**Effort:** ~1-2 days. The hard part is the UX — friction at sign-up vs. preserving the demo experience. Worth one design conversation before coding.
**Cost:** sign-up friction (users must create Anthropic + OpenAI accounts).
**Trigger to build it:** 429s from Anthropic in prod logs; or the monthly LLM bill becomes uncomfortable; or a user complains "extraction was fast yesterday, now it's hanging" (rate-limit symptom).

---

## Phase 5 — Move `raw_json` to object storage

**What:** `raw_events.raw_json` (the full Gmail API response — typically 5-50KB per message, often 10× the size of the actual `body_text`) moves from Postgres to S3 / R2 / GCS / Azure Blob. DB stores only an object key + the small extracted fields (subject, from_addr, body_text, all already encrypted).

**Why:** `raw_json` is the storage hog. Moving it out cuts Postgres size ~10×, which translates to ~10× more users on the same Postgres tier. Object storage is also ~50× cheaper per GB than Postgres at scale.

**What changes:**
- New `lib/object-storage.ts` — thin S3-compatible client (works with AWS S3, Cloudflare R2, GCS-compat, MinIO). Encrypts payloads with the same `ENCRYPTION_KEY` before upload.
- Schema migration: `raw_events.raw_json TEXT → raw_events.raw_json_key TEXT`
- `lib/sync.ts` Gmail write path: upload `msg` to object storage, store the key
- Anywhere reading `raw_json`: fetch from object storage on demand (today nothing reads it after the initial extraction; if extraction stays as the only consumer, this is mostly write-side work)
- One-shot backfill script: read existing `raw_json` rows, upload each, replace with key
- `.env.example` + deployment doc: `OBJECT_STORAGE_URL`, `OBJECT_STORAGE_BUCKET`, `OBJECT_STORAGE_KEY_ID`, `OBJECT_STORAGE_SECRET`

**Effort:** ~1-2 days. Backfill is the slowest piece (streaming uploads).
**Cost:** object storage bill (~$0.02/GB/month — usually negligible). One more service dependency to monitor.
**Trigger to build it:** Postgres storage becoming the line item that matters; or wanting to retain longer history per user; or moving to a Postgres tier change is being driven by raw_json size alone.

---

## Recommended order (what bites first)

| You see this in production... | Build this next |
|---|---|
| 429s from Anthropic / OpenAI in logs; users seeing "rate limit" errors | **Phase 4** — typically the first user-facing pain |
| Web requests slow during extraction; CPU spikes correlate with queue activity | **Phase 3** |
| Postgres storage cost is starting to hurt; you're considering a tier upgrade | **Phase 5** |

**None of these matter until usage forces them.** With encryption + Phase 1 + Phase 2 already shipped, the system handles ~50 simultaneous users / ~500 registered before any of 3/4/5 becomes urgent. Right call is probably **"ship beta, watch metrics, build whichever phase the metrics actually demand."**

---

## What's NOT on this roadmap (deliberate)

A few things you might expect to see and why they're not here:

- **Sharding the Postgres database** — only matters past several million users / billions of rows. Not a beta concern. Path when the time comes: `tenant_id`-based logical sharding (Stripe pattern), or jump to a managed sharded provider like Citus / Neon.
- **Per-user encryption keys (zero-knowledge)** — explicitly ruled out for beta when we designed encryption. Would mean we can't extract on the user's behalf without them being signed in. Different product entirely.
- **Real-time observability platform** (Datadog, Honeycomb, etc.) — for beta, the SQL queries in `deployment.md §6` are enough. Add when paging an oncall is something you actually need.
- **Encrypting `pages.compiled_truth` / `content_chunks.chunk_text`** — these are extracted content in per-user-now-shared tables, derived from already-encrypted raw events. Could encrypt for defense-in-depth but raises complexity (search would need the full chunk decrypted, RLS already isolates per user). Defer.
- **Rate limiting on the public API endpoints** — only matters if you have any. Today everything is auth-gated.

---

## Doc index (for the next person picking this up)

- `docs/deployment.md` — what to do **today** to deploy
- `docs/shared-db-rls.md` — Phase 1 design (implemented; kept for the *why*)
- `docs/postgres-queue.md` — Phase 2 design (implemented; kept for the *why*)
- `docs/roadmap.md` — this file: Phases 3-5 sketches

When Phase 3 / 4 / 5 gets prioritized, add `docs/phase-3-worker-process.md` etc., write the full implementation spec, then have Sonnet build from it.
