# Tier 2 — proactive layer (daily brief + commitments tracker)

> **Status:** in-app shipped (commitments + bento hub on `/overview`). Email + Slack delivery deferred to PRs 3-4 below.
> **Source-of-truth references:** `app/(app)/overview/page.tsx`, `app/(app)/overview/cards/`, `lib/digest.ts`, `lib/commitments.ts`, `app/(app)/digests/page.tsx`.

---

## What shipped

The "personal brain" was reactive — it answered when asked. Tier 2 makes it proactive: it speaks first, surfaces what's pending, and acts on a daily schedule.

### Surfaces

- **`/overview`** is now the proactive home — a bento grid hub. Top to bottom: greeting strip with date + first-name greeting + LLM-written one-liner + Ask pill, then 4 cards in a 2-column grid (Today's promises / Awaiting your reply / Active threads / Quiet but important), then footer link to `/digests`.
- **`/digests`** is the past-briefs timeline. Last 30 days of saved briefs, each showing greeting + section snapshots.
- **Settings → Daily brief** lets the user toggle the brief, pick the local hour, and hide individual sections.

### Data model

| Table / Column | Purpose |
|---|---|
| `commitments` | First-class action items extracted from emails. Status: `open` / `done` / `dismissed` / `aged_out`. RLS-protected. |
| `digests` | One row per user per local date. JSONB `content` holds `{ greeting, commitments, awaiting_reply, active_threads, quiet }`. RLS-protected. Unique on `(user_id, local_date)`. |
| `user_preferences` | Per-user brief settings: `digest_enabled`, `digest_hour_local`, and 4 `show_*` toggles. No RLS (lives next to `users` / `user_api_keys`). |
| `users.timezone` | IANA zone string, defaults to `'UTC'`, browser-set on first `/overview` load via `POST /api/settings/timezone`. |
| `raw_events.thread_ref` | Gmail `threadId` cached at insert time. Powers the "Awaiting your reply" grouping. New rows only — old rows stay NULL until re-synced or backfilled. |

### Backend pipeline

1. **Extraction-time commitment capture** — `lib/pipeline.ts:99-117` takes the existing `extraction.commitments: string[]` (from `lib/extract.ts:17`, already extracted but never surfaced before) and INSERTs each into the `commitments` table. No extra LLM call; strings are already in memory. Attribution to the first extracted entity as a best-guess `entity_slug`.
2. **Daily digest generation** — `lib/digest.ts:composeDigest()` runs four pure-SQL candidate queries in parallel (commitments, awaiting-reply, active-threads, quiet), then makes one Haiku call (~$0.0005) to write the greeting. Total cost per brief: ~$0.001.
3. **Lazy + scheduled execution** — `lib/digest.ts:getOrGenerateDigest()` writes a `digests` row on demand if missing. Cron (`schedulerTick` in `lib/sync.ts`) enqueues `generate_daily_digest` jobs at the user's chosen local hour. Unique constraint on `(user_id, local_date)` makes double-fires safe.
4. **Live commitments fetch** — `/overview` queries open commitments fresh on every load (not from the cached digest), so check/dismiss actions feel real-time.

### API routes

| Route | Method | Purpose |
|---|---|---|
| `/api/commitments/[id]` | PATCH | Mark commitment `done` / `dismissed`. Optimistic UI in `commitments-card.tsx`. |
| `/api/settings/preferences` | GET/PATCH | Read/update user_preferences. |
| `/api/settings/timezone` | POST | Set `users.timezone` from `Intl.DateTimeFormat().resolvedOptions().timeZone`. |
| `/api/admin/backfill-commitments` | POST | Re-runs Haiku extraction over already-extracted `raw_events` to populate commitments for pre-PR data. Chunked via `?limit=` and `?offset=`. |

### Cards (`app/(app)/overview/cards/`)

- `bento-card.tsx` — shared chrome (icon + title + count badge + optional footer)
- `commitments-card.tsx` — **client component** with optimistic check/dismiss
- `awaiting-reply-card.tsx` — server-rendered; opens Gmail at `https://mail.google.com/mail/u/0/#inbox/{threadRef}`
- `active-threads-card.tsx` — server-rendered; links to `/pages/[slug]`
- `quiet-card.tsx` — server-rendered; links to `/pages/[slug]`

Each card hides its body when its section is empty. With nothing connected, the page reads as an intentional empty state (greeting + Ask pill + four "nothing yet" hints).

---

## Deferred (PRs 3-5)

- **PR 3 — Email delivery via Resend.** Reuses `digests.content` JSON. New env: `RESEND_API_KEY`. New runner `deliver_digest_email`. New column `digests.delivered_email_at` for idempotency.
- **PR 4 — Slack DM delivery.** Add `chat:write` to `SLACK_SCOPES` in `app/api/slack/connect/route.ts:4`; "Reconnect Slack" banner in Settings if missing. New `lib/slack.ts:postDmToSelf()`. Runner `deliver_digest_slack`. Column `digests.delivered_slack_at`.
- **PR 5 (polish) — Inline Ask input on `/overview`.** Today the Ask pill links to `/ask`. A real mini-input that streams to `/api/query` from the home page is a follow-up.
- **`raw_events.thread_ref` backfill** for pre-shipped data. New rows are written with `thread_ref` going forward; an admin route would decrypt + parse `raw_json` for old rows. Not blocking — the awaiting-reply card simply omits old rows.
- **Discrete commitment reminders** (e.g. "you said you'd follow up with X 3 days ago" as a Slack DM) — should arrive as a Tier 3 user-creatable workflow once that primitive ships.

---

## Future card ideas (for design discussion, not implementation yet)

The four v1 cards are a starting set. We deliberately picked the highest-confidence signals from data we already have. The full *personal-brain* surface needs more — specifically the categories below. Each needs a real design conversation before any implementation; this section is a parking lot, not a spec.

### Critical / urgent surfacing

- **Critical issues card.** Heuristic over incoming Gmail/Slack: messages containing urgency markers (`asap`, `urgent`, `blocker`, `broken`, `down`, `escalation`) or with multiple senders pinging the same thread. Risk of false positives — needs careful prompting.
- **Negative-sentiment spike.** `extraction.sentiment` is already stored. A card surfacing "3 messages today from people who sound frustrated" would catch fires early. Real risk of feeling judgmental — neutral framing critical.
- **Approvals waiting on you.** Messages with explicit asks ("can you approve…", "need your sign-off"). Could fold into existing "Awaiting your reply" card with a priority flag.

### Calendar-aware (requires new OAuth scope)

- **Today's meetings.** Strip across the top of `/overview` showing the day's calendar — title, time, attendees.
- **Meeting prep card.** For each upcoming meeting, surface the most recent thread(s) with the attendees + relevant pages. The killer feature: open `/overview` 5 minutes before a 1:1 and see "you last talked to Sarah about Q4 OKRs; she asked about the Acme deal — here's what changed since."
- **Post-meeting follow-up.** After a calendar event ends, surface a "log notes / open commitments from this meeting" prompt.

### Time-boxed retrospectives

- **Last week recap.** Friday afternoon (or Monday morning): "what shipped, what got decided, who you spent time with." Already mentioned in the original Tier 1 roadmap as a workflow template; could promote to a first-class card.
- **Yesterday digest.** Tighter time window — the catch-up read for someone returning from PTO or a deep-work block.
- **Monthly snapshot.** "October in review" — top 5 themes, biggest threads, people whose share-of-attention shifted.

### Decisions + status

- **Open decisions tracker.** Threads where someone asked a question / proposed an option and no decision has landed. Likely needs a small extraction-time addition (`decisions_pending: string[]` alongside the existing `commitments`).
- **Project status one-liners.** Per active project page: an LLM-written one-line "where things stand" updated weekly. Costly at scale — needs the Phase 4 per-user-keys story before broad rollout.
- **Stuck projects.** Project pages with no `updated_at` change in N days but high recent activity beforehand. (Variant of "Quiet but important" but scoped to projects.)

### Knowledge surfacing

- **Recently shared.** Documents, links, and resources shared in your inbox in the last 7 days that you haven't followed up on.
- **Themes you mentioned.** Topics that came up in your *outbound* messages but you don't have a page for yet — gaps in the brain that you're already thinking about.

### Patterns / personal

- **Response-time mirror.** "You typically reply to Sarah within 4h; the Q4 thread has been open 38h." Useful but creepy zone — needs careful framing if shipped at all.
- **Working-hours snapshot.** When you're most active each day; not for the user, but useful as context fed into LLM calls so the brief reads naturally for *that* user's rhythm.

---

## User-creatable digests (Tier 3 territory)

The user explicitly asked for **the ability to define their own digests**. This is exactly what Tier 3 in `docs/intelligent-ui-roadmap.md` already specs — the `trigger + filter + prompt + delivery` workflow primitive. Once shipped, every card idea above can be expressed as a workflow template the user can clone and tweak.

Cross-reference: `docs/intelligent-ui-roadmap.md` § **Tier 3 — user-creatable workflows**. Concrete next steps for that tier are already documented (schema sketch, killer-UX flow, template library) — what's missing is prioritization. Most likely sequence:

1. Ship Tier 2 PRs 3-4 (email + Slack delivery for the *built-in* brief).
2. Ship a basic Tier 3 with **3-5 hard-coded workflow templates** the user can pick from (e.g. "Friday weekly recap", "Recruiter inbox summary"). No NL workflow builder yet.
3. Add the natural-language workflow generator (the "killer UX" in the roadmap).
4. Each new card idea above ships as a *template* — no UI work, just a prompt + filter.

This avoids one-off card UIs for every signal. The cards on `/overview` become the *defaults*; Tier 3 lets users add their own.

---

## How to use this list

When prioritizing the next proactive-layer PR:

1. Pick a card category that maps to a clear data signal (don't invent extraction for a card no user has asked for).
2. Prototype the candidate query in SQL first — if the candidate set is empty for the test user, the card won't land.
3. Decide if it's a *built-in* card (lives on `/overview` for everyone) or a *template* (waits for Tier 3). Only ship as built-in if it's universally valuable across user types.

---

## Verification (already passed in dev)

- `bunx tsc --noEmit` clean.
- `bun run test` 13/13 (existing suite; no new tests added — could add coverage for `composeDigest` candidate queries with a seeded user).
- Migrations apply cleanly: `bun -e "import('./lib/migrate').then(m => m.runMigrations())"` shows `proactive schema ok`.
- Routes:
  - `GET /overview`, `/digests`, `/settings` → 307 redirect when unauth
  - `PATCH /api/commitments/[id]`, `GET/PATCH /api/settings/preferences`, `POST /api/settings/timezone` → 401 when unauth

End-to-end smoke (signed-in user):
1. Open `/overview` — bento hub renders with greeting + 4 cards (or empty hints if no data yet).
2. If a recent extraction surfaced a commitment, "Today's promises" card shows it; click to mark done.
3. Settings → Daily brief: change hour, toggle off a section → return to `/overview` → that card hides.
4. Manually invoke the cron tick: `curl -X POST -H "x-cron-secret: $CRON_SECRET" http://localhost:3002/api/cron/scheduler-tick`. If your local hour matches, a `generate_daily_digest` job lands; `POST /api/queue/drain` runs it; a `digests` row appears for today.
5. Open `/digests` — today's brief at the top of the timeline.

---

## Key files

| Path | Role |
|---|---|
| `lib/migrate.ts` | `SCHEMA_PROACTIVE` block; runs as Step 8 |
| `lib/commitments.ts` | `listOpenCommitments()`, `setCommitmentStatus()` |
| `lib/digest.ts` | All four candidate queries, `composeDigest`, `getOrGenerateDigest`, `localDateFor` |
| `lib/pipeline.ts:99-117` | Inline commitments INSERT after successful extraction |
| `lib/sync.ts:schedulerTick` | Enqueues `generate_daily_digest` jobs by user-local hour |
| `lib/queue/runners.ts` | `generate_daily_digest` runner |
| `lib/queue/types.ts` | `JobType` union extended |
| `app/(app)/overview/page.tsx` | Bento hub assembly |
| `app/(app)/overview/cards/*.tsx` | Bento cards |
| `app/(app)/overview/timezone-sync.tsx` | Browser-tz POST on first mount |
| `app/(app)/digests/page.tsx` | History timeline |
| `app/(app)/settings/brief-panel.tsx` | Settings UI for brief preferences |
| `app/api/commitments/[id]/route.ts` | PATCH handler |
| `app/api/settings/preferences/route.ts` | GET/PATCH for `user_preferences` |
| `app/api/settings/timezone/route.ts` | POST for `users.timezone` |
| `app/api/admin/backfill-commitments/route.ts` | Admin one-shot for pre-PR data |
