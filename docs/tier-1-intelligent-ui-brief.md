# Tier 1 Intelligent UI — implementation brief for Sonnet

> **Status:** implemented (kept for the *why*). This was the brief handed to Sonnet to drive Tier 1; the spec it produced (`docs/tier-1-intelligent-ui.md`) and the live code in `app/(app)/ask/` are now the canonical references. See `docs/tier-1-intelligent-ui.md` for the full list of what shipped, including the streaming pipeline and markdown renderer added beyond the original brief.
>
> **Read first:** `docs/intelligent-ui-roadmap.md` (the vision) and `AGENTS.md` (this is NOT the Next.js you know — consult `node_modules/next/dist/docs/` before using App Router APIs you're unsure of).

---

## Scope of this PR

In:

- **1.1** Default landing = `/ask`
- **1.2** Dynamic opener on `/ask` (server-prefetched, cached)
- **1.3** Dynamic suggested questions on `/ask` (cached)
- **1.6** Move admin surfaces under Settings (do **not** hide `/sources` entirely)
- **1.7** Voice/copy pass

Deferred to a follow-up PR — do not start these:

- **1.4** "Recent thinking" stream — needs an extraction-time `blurb` column to avoid per-render LLM fanout. Don't inline-generate on render.
- **1.5** Auto-briefings on entity pages — reuses the cache pattern this PR establishes; cleaner as a follow-up.

The reason for deferring: 1.4 and 1.5 each open a separate question (extraction-pipeline change for 1.4, page-row cache invalidation for 1.5). Bundling them with 1.1/1.2/1.3/1.6/1.7 inflates the PR and slows review.

---

## Step 1 — write `docs/tier-1-intelligent-ui.md`, then stop

Produce a file-by-file spec covering the items below. Do not write implementation code until this spec is reviewed.

### 1.1 — Default landing = `/ask`

This is *not* one line. Three touch points:

1. The post-login redirect target. Search `auth.ts` and `app/page.tsx` for where authenticated users land after sign-in; change it from `/overview` to `/ask`.
2. `app/components/sidebar.tsx:11` — swap NAV order so `Ask` comes first.
3. `app/components/sidebar.tsx:26` — change the logo `href` from `/overview` to `/ask`.

The spec should list the exact diff for each.

### 1.2 + 1.3 — dynamic opener and suggested questions on `/ask`

**Cache table.** New migration adding `user_briefings`:

```
(user_id uuid, kind text, content jsonb, generated_at timestamptz, PRIMARY KEY (user_id, kind))
```

Enable RLS, `FORCE ROW LEVEL SECURITY`, and an isolation policy keyed on `current_setting('app.user_id')::uuid`. Match the pattern already used in `lib/migrate.ts` — do not invent a new convention.

**Cache helper.** New `lib/briefing.ts` exposing:

```
getOrGenerate(userId, kind, ttlSeconds, generator: () => Promise<JsonValue>): Promise<JsonValue>
```

- Returns cached row if `generated_at > now() - ttl`.
- Otherwise calls `generator`, upserts, returns.
- TTL = 1h for both `ask_opener` and `ask_suggestions`.

**LLM calls.** All LLM traffic goes through `callClaude(userId, HAIKU, ...)` from `lib/anthropic.ts` — never instantiate the Anthropic client directly. Be aware of the $5/day soft cap in `lib/anthropic.ts:21`; the cache exists partly to keep this predictable.

**`/ask` data flow.** `app/(app)/ask/page.tsx` is currently a `"use client"` component. Convert to a server component wrapper that:

1. Fetches `{ opener, suggestions }` via `lib/briefing.ts`.
2. Passes them as initial props to a renamed client component (e.g. `AskClient`).

**Empty state.** If the user has fewer than 5 pages, skip the LLM call and fall back to the existing static greeting + the current hardcoded `SUGGESTED` array. The opener would hallucinate otherwise.

**Prompts.** Spec out the exact system + user prompts for both calls. Opener context = last 24h of pages (titles + types, not full bodies). Suggestions context = 5 most recent pages.

### 1.6 — move admin surfaces

- Keep `/sources` reachable. Move it from the main sidebar NAV into the Settings page (or a Settings sub-nav). The brain shouldn't talk about its plumbing in public, but the user still needs a way to debug a broken sync.
- `app/(app)/overview/page.tsx`: remove the "System Status: Active" pill (lines 26–34).
- Replace the 3-card stats grid (lines 47–72) with a placeholder section commented `// TODO 1.4 — Recent thinking stream`. Do **not** delete the underlying data fetch (`getExtractionStatus`) — 1.4 will reuse it.

### 1.7 — voice/copy pass

Enumerate every string changed in the spec. Minimum set:

- `sidebar.tsx` — tagline "Enterprise Intelligence" → first-person; "Synthesize Knowledge" CTA → first-person.
- `ask/page.tsx` — h2 "Knowledge Synthesis" + subheading "Query your personal data landscape…" → first-person.
- `overview/page.tsx` — header "Overview", hero "Welcome back, X. Your personal knowledge system is ready." → first-person.

Tone: "I noticed", "I think", "Here's what I see." Avoid "I'm so excited to help!" energy — it reads fake.

---

## Step 2 — implement after spec review

Once `docs/tier-1-intelligent-ui.md` is approved, implement in this order so each commit is independently reviewable:

1. Migration + `lib/briefing.ts` + tests.
2. 1.1 (landing change) + 1.6 (admin surfaces) + 1.7 (copy).
3. 1.2 + 1.3 (server-prefetched `/ask`).

---

## Constraints

- `callClaude` is the only entrypoint to Claude. Use `HAIKU` for opener/suggestions.
- All new tables need RLS + FORCE + per-user policy. See `lib/migrate.ts` for the pattern.
- The `user_briefings` table **is** the cache. Do not introduce a new caching library or in-memory cache.
- Do not delete the `getExtractionStatus` call from `overview/page.tsx` — 1.4 reuses it.
- Do not write comments unless the WHY is non-obvious.
- Match existing code style; do not refactor adjacent code that isn't in scope.

---

## Risks called out in the roadmap, restated here

- **Stale "today" in cached opener.** TTL is 1h, but the cache key does not include a date — at 11:59pm a "today" opener could persist into tomorrow. Spec how you'll handle this (cheapest: include `YYYY-MM-DD` in the cache key, or invalidate at local midnight).
- **AI personality.** First-person yes; saccharine no.
- **Hidden admin surfaces.** Reachable from Settings, not deleted. The user must be able to find `/sources` when sync breaks.
