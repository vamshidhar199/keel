# Intelligent UI + Workflows Roadmap

> **Status:** product roadmap, not implementation-ready specs. Each tier needs a real design doc before Sonnet can build it.
> **Why this exists:** today Keel *feels like a dashboard, not a brain*. This doc captures the prioritized list of what to change to fix that, plus the bigger product bet on user-creatable workflows.
> **Already shipped (foundation):** at-rest encryption, Phase 1 (shared DB + RLS), Phase 2 (Postgres-backed queue), **Tier 1** (landing/opener/suggestions/admin-surface moves/copy), the **streaming `/api/query` + react-markdown** pipeline, and **Tier 2 in-app daily brief** (proactive bento hub on `/overview` + open commitments tracker). See `docs/tier-1-intelligent-ui.md` and `docs/tier-2-digests.md` for what landed.

---

## The diagnosis

The UI today reads as a SaaS admin panel:

| Symptom | Where it lives | Why it's wrong |
|---|---|---|
| Default landing is `/overview` ("Dashboard") | `app/(app)/overview/page.tsx` + `app/components/sidebar.tsx` NAV order | Frames the whole app as plumbing, not as a thinking partner |
| 3-card stats grid: "Pages Indexed: 16", "Emails Extracted: 6" | `overview/page.tsx` | Facts about the *system*, not facts about *you* |
| Static "System Status: Active" pill | `overview/page.tsx` header | Pure admin theater |
| Tagline "Enterprise Intelligence" | `sidebar.tsx` | Snowflake / Datadog language, not thinking-partner language |
| `/ask` is the second nav item, not the first | `sidebar.tsx` NAV array | The brain is buried behind the meter readings |
| Suggested questions hardcoded ("Who have I been talking to most?") | `ask/page.tsx` `SUGGESTED` const | A brain that knows you would suggest *today's* questions, not generic ones |
| The brain never speaks first | `ask/page.tsx` (only renders after user types) | A real brain has its own things to say |

**The mental model shift:** today the UI shows *what it has* (counts, status, sync state). A brain UI shows *what it thinks* (insights, briefings, what changed since you last looked). Same data, completely different framing.

---

## Tier 1 — make the existing surface feel intelligent

**Effort:** ~1 week of UI work. **No new infra.** Pure UX/UI changes against existing data.

These are the highest-ROI moves. Ship before talking to any new beta users.

| # | Status | Change | File(s) | Notes |
|---|---|---|---|---|
| 1.1 | ✅ Shipped | **Default landing = `/ask`**, not `/overview`. Either drop "Dashboard" from nav or rename to "Home". | `app/page.tsx` (root redirect + post-login `signIn` target), `sidebar.tsx` NAV order | "Home" replaced "Dashboard" in nav; logo now links to `/ask`. |
| 1.2 | ✅ Shipped | **Dynamic opener on `/ask`**. On page load, one Claude call using last 24h of pages → 2-sentence "I've been watching your inbox. Here are 2 things I noticed today." | `app/(app)/ask/page.tsx` (server prefetch), `lib/briefing.ts` (`getOrGenerate`), `user_briefings` table | Haiku + 1h cache, date-keyed. Empty-state fallback when <5 pages. |
| 1.3 | ✅ Shipped | **Dynamic suggested questions** generated from recent activity, replacing the hardcoded `SUGGESTED` array. | `ask/page.tsx`, `ask-client.tsx` | Same cache pattern as 1.2; falls back to hardcoded `SUGGESTED` if JSON parse fails. |
| 1.4 | ⏳ Deferred | **Replace stats cards on `/overview`** with a "Recent thinking" stream — last N extractions as one-sentence cards. | `overview/page.tsx` | Stats grid replaced with `// TODO 1.4` placeholder; needs an extraction-time `blurb` column to avoid per-render LLM fanout. |
| 1.5 | ⏳ Deferred | **Auto-briefings on entity pages**. Top of `/pages/[...slug]` shows a 2-sentence Claude-generated synthesis above the markdown. | `app/(app)/pages/[...slug]/page.tsx` + `lib/briefing.ts` | Cache pattern is now in place (`getOrGenerate`); just needs the page-detail integration. |
| 1.6 | ✅ Shipped (extended) | **Move admin surfaces** (`/sources`, "Pages Indexed: 16", "System Status") into Settings or hide entirely. | `sidebar.tsx`, `overview/page.tsx`, `settings/page.tsx` ("Your knowledge" section) | `/sources`, `/pages`, and `/graph` all moved under Settings; "System Status" pill removed. Sidebar nav reduced to **Ask + Home only** to keep the conversation as the primary surface. |
| 1.7 | ✅ Shipped | **Voice/copy pass**. Replace "Synthesize Knowledge" CTA, "Enterprise Intelligence" tagline, and similar with first-person language ("I noticed", "I think", "Here's what I see"). | `sidebar.tsx`, page headers | "Enterprise Intelligence" → "Your thinking partner"; "Synthesize Knowledge" → "Ask me anything"; etc. |

### Bonus shipped during Tier 1 iteration

Beyond the originally-scoped items above, the following landed while iterating on the live `/ask` page. Listed here so the roadmap reflects reality:

- **Streaming `/api/query`** — NDJSON pipeline emitting `searching` → `reading {count}` → `thinking` → `delta` → `citations` → `done`. Replaced the slow "submit, wait, render" UX. (`app/api/query/route.ts`, `lib/anthropic.ts:streamClaudeWithWebSearch`, `lib/synthesize.ts:synthesizeAnswerStream`.)
- **Status pills + streaming cursor** — first-person phase labels with a 3-dot bounce, then text streams in token-by-token with a pulsing cursor.
- **Real markdown rendering** — `react-markdown` + `remark-gfm` + `rehype-raw` with custom node overrides for headings (indigo accent marks), lists (custom dot bullets), code, blockquotes, links, GFM tables. Inline `[chunk:N]` references rendered as styled superscripts. (`app/(app)/ask/render-markdown.tsx`.)
- **Sidebar hover-to-expand** — collapsed `w-16` icon strip, expands to `w-64` on hover with labels fading in. Main content uses `ml-16` so the sidebar overlays without reflow. (`app/components/sidebar.tsx`, `app/(app)/layout.tsx`.)
- **Message styling pivot** — user questions render as a gradient pill on the right; assistant turns get a sparkle (`auto_awesome`) avatar header above a glass-card bubble. Empty state uses the same chat-bubble + 3-card grid pattern.

### Risks to watch
- Caching the dynamic opener wrong (showing yesterday's "today" → feels broken)
- Going too far on AI personality (tools that say "I'm so excited to help!" feel fake)
- Hiding admin surfaces so completely that nothing is debuggable when sync breaks

---

## Tier 2 — built-in digests

**Effort:** in-app shipped. Email + Slack delivery deferred (PRs 3-4 in `docs/tier-2-digests.md`).

Uses the Phase 2 queue. Prepares the ground for Tier 3 by proving the digest primitive on rails before letting users design their own.

| # | Status | Change | Notes |
|---|---|---|---|
| 2.1 | ✅ Shipped (now on `/overview`, not `/ask`) | **Daily in-app brief**, generated overnight via a scheduled queue job. | New runner `generate_daily_digest`. Stored in `digests` table. Lazy-fires on first `/overview` load if cron hasn't yet. UX evolved from "card on /ask" → full bento hub on `/overview`. |
| 2.2 | ⏳ Pending (PR 3) | **Daily email digest** opt-in. | Resend/Postmark integration; reuses cached `digests.content` JSON. |
| 2.3 | ⏳ Pending (PR 4) | **Daily Slack DM digest** to the user's own Slack. | Add `chat:write` to `SLACK_SCOPES` (`app/api/slack/connect/route.ts:4`); reuses existing token storage. |
| 2.4 | ✅ Shipped | **Digest history page** at `/digests`. | List view of `digests` table grouped by `local_date`. |
| 2.5 | ✅ Shipped | **Time-zone-aware scheduling.** | `users.timezone` column with browser-inferred default via `app/(app)/overview/timezone-sync.tsx`. Scheduler checks `EXTRACT(HOUR FROM (now() AT TIME ZONE u.timezone))`. |
| 2.6 | ✅ Shipped (extension) | **Open commitments tracker.** | New `commitments` table populated inline at `lib/pipeline.ts:99` from the existing `extraction.commitments` array. Surfaced as the first interactive bento card. |

### What "default digest" actually contains
For the v1 in-app digest, the prompt should produce sections like:
- **What changed** — pages updated in the last 24h
- **Who's active** — people with new mentions
- **What needs your reply** — open threads where you're the last expected speaker (heuristic from Gmail data)
- **Quiet but important** — entities that haven't moved in a while but used to be active

---

## Tier 3 — user-creatable workflows

**The real product differentiator.** This is what makes Keel *uniquely* powerful vs. another AI inbox tool. The model: **trigger + filter + prompt + delivery**, all describable in natural language.

**User explicitly asked for this** during Tier 2 review — "users ability to create his own digests should also be provided." Once shipped, the proactive-card backlog in `docs/tier-2-digests.md` ("Future card ideas") becomes a library of workflow templates rather than one-off UI work. Recommended sequence: ship Tier 2 delivery (PRs 3-4) → ship Tier 3 with 3-5 hard-coded templates → add the NL workflow generator.

**Effort:** ~4-6 weeks. **Depends on Tier 2** for delivery infrastructure.

### The primitive

```
Trigger:   every weekday at 8am   |   when an email arrives from <pattern>   |   when extraction creates a page about <entity>
Filter:    natural-language filter ("only when sender matches 'recruiter'")
Prompt:    "Summarize what's pending and what needs my reply"
Deliver:   in-app  |  email  |  Slack DM  |  webhook
```

### Schema sketch

```sql
CREATE TABLE workflows (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  trigger_type TEXT NOT NULL,        -- 'cron' | 'on_extraction' | 'on_sync'
  trigger_config JSONB NOT NULL,     -- { cron: '0 8 * * 1-5' } | { entity_type: 'person' }
  filter_query TEXT,                 -- optional natural-language filter
  prompt_template TEXT NOT NULL,
  delivery_type TEXT NOT NULL,       -- 'in_app' | 'email' | 'slack_dm' | 'webhook'
  delivery_config JSONB,             -- { url } for webhook, etc.
  enabled BOOLEAN DEFAULT true,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflows FORCE ROW LEVEL SECURITY;
CREATE POLICY workflows_isolation ON workflows
  USING (user_id = current_setting('app.user_id')::uuid)
  WITH CHECK (user_id = current_setting('app.user_id')::uuid);

CREATE TABLE workflow_runs (
  id UUID PRIMARY KEY,
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  ran_at TIMESTAMPTZ DEFAULT now(),
  status TEXT NOT NULL,              -- 'success' | 'failed' | 'no_data'
  output TEXT,                       -- the generated content
  error TEXT
);
-- + RLS isolation per Phase 1
```

### The killer UX

User types: *"every Friday afternoon, summarize what I shipped this week and what's still in flight, send to my Slack."*

System:
1. Sends to Sonnet with prompt: "convert this user request into a workflow spec (json schema attached)"
2. Returns a structured workflow with the cron, filter, prompt, delivery
3. Shows preview to the user — name, when it'll run, what it'll do, where it'll send
4. User reviews/edits/saves
5. Done. Workflow runs forever until disabled.

### Template library (must-have for v1)

5-10 starter workflows users can clone with one click. Lowers the cold-start problem and seeds intuition for what's possible:

- **Daily inbox summary** — every weekday morning, summarize new emails
- **Weekly project digest** — Friday afternoon, what shipped + what's in flight
- **New person intro** — when extraction creates a `person` page, brief me on them
- **Sunday prep** — Sunday evening, "what should I prepare for the week"
- **Recruiter inbox** — daily summary of emails from contacts tagged "recruiter"
- **Quiet relationships** — weekly "people I haven't heard from in a month"
- **Mention alerts** — when someone mentions a tag I care about, surface it

### How execution slots into Phase 2's queue

- A new cron tick `POST /api/cron/workflows-tick` (or fold into existing scheduler-tick) every minute scans `workflows WHERE next_run_at <= now() AND enabled = true`
- For each due workflow, enqueues a `run_workflow` job
- The runner: gathers context (recent pages matching filter), calls Claude with the prompt, dispatches to delivery channel, writes a `workflow_runs` row
- All under per-user fairness cap from the existing queue

### Why this is huge

Keel shifts from "a brain that lists things" to "a brain that *acts on your behalf on a schedule*." That's the Claude Cowork / Custom GPTs analogy — but tied to *your* actual data, not a generic chatbot.

---

## Tier 4 — power features (later, when traction warrants)

| # | Feature | Inspiration |
|---|---|---|
| 4.1 | **Saved questions / Skills** — give common ad-hoc queries a name, run with one tap | Claude Skills |
| 4.2 | **Memory across sessions** — brain remembers your preferences ("Vamshi prefers terse answers") | Claude memory feature |
| 4.3 | **Workflow sharing** between users | Custom GPTs marketplace |
| 4.4 | **Webhook delivery** — power users send digests to Notion, Linear, Discord, etc. | Zapier-class integrations |
| 4.5 | **Evaluations** — let users rate digest quality; the prompt self-tunes | Vellum's smart move |
| 4.6 | **Voice/audio digest** — TTS the daily digest | Granola pattern |

None of these matter until Tiers 1-3 are real. Capture here so they're not forgotten.

---

## Recommended sequence

| Week | Build | Status | Why now |
|---|---|---|---|
| **1** | All of Tier 1 (5 of 7 items) + streaming pipeline | ✅ Shipped | Zero infra, biggest perception change. Ship before talking to a single new beta user. |
| **Next** | Tier 1 leftovers (1.4 Recent thinking, 1.5 Entity briefings) | ⏳ Pending | Both blocked on small things: 1.4 wants an extraction-time `blurb` column; 1.5 just needs to be wired into the page-detail route. |
| **2-3** | Tier 2 in-app digest + opt-in email | ⏳ Pending | Proves the digest concept on rails before letting users build their own. |
| **4-7** | Tier 3 workflow primitive + template library | ⏳ Pending | The product differentiator. Build template-clone first, then natural-language workflow generation as a follow-up. |
| **Later** | Tier 4 + the Phase 4 (per-user LLM keys) from `roadmap.md` | ⏳ Pending | When you have real signal on what users actually want, and when LLM costs from workflows force the per-user-keys move. |

---

## Three product questions to think about before Tier 3

Workflows fundamentally change Keel from a *passive index* to an *active agent on your behalf*. That changes the trust contract: today the brain "knows" things; tomorrow it'll *act* (send messages, deliver digests on schedule). Things to settle before shipping:

1. **Visibility / undo.** Can users see exactly what the brain sent on their behalf yesterday? Recommendation: yes — `workflow_runs` table is the audit log; show it in the workflow detail view.
2. **Failure mode.** What happens when a workflow runs and Claude returns garbage? Recommendation: first 3 runs of every new workflow are "preview" mode — content goes to the in-app digest only, not email/Slack. User explicitly enables external delivery once they're confident in the output.
3. **Cost.** Workflows multiply LLM calls per user. With shared `ANTHROPIC_API_KEY` (today's setup), this is your bill. **Phase 4 (per-user keys) becomes much more urgent if Tier 3 ships** — should be sequenced together.

---

## Doc index update

When this gets prioritized, the docs map looks like:

```
docs/
├── deployment.md              ← what to do today (what's shipped)
├── shared-db-rls.md           ← Phase 1 (implemented)
├── postgres-queue.md          ← Phase 2 (implemented)
├── intelligent-ui-roadmap.md  ← THIS doc (vision, prioritized)
└── roadmap.md                 ← Phases 3-5 backend (vision)
```

When implementing Tier 1, write `docs/tier-1-intelligent-ui.md` (full spec, file-by-file). Same for Tier 2 and Tier 3 separately.

---

## References / inspiration

- [Vellum: Workflows / orchestration platform](https://www.vellum.ai/products/orchestration) — developer-facing workflow builder; the model translates to consumer
- [Slack: Use AI to build Slack workflows](https://slack.com/help/articles/32843655109395-Use-AI-to-build-Slack-workflows) — natural-language workflow creation
- [Zapier: AI-generated daily digest of emails in Slack](https://zapier.com/apps/gmail/integrations/slack/1225635/get-an-ai-generated-daily-digest-of-your-emails-in-slack) — the digest pattern at consumer scale
- [Claude Projects vs Custom GPTs (2026)](https://builts.ai/blog/claude-projects-vs-chatgpt-custom-gpts/) — persistent context + custom instructions per workflow
- [How I AI: Claude Cowork tutorial + Build your own Slack inbox](https://www.lennysnewsletter.com/p/this-week-on-how-i-ai-claude-cowork) — the "build your own AI inbox" framing
- [Stackviv: Custom GPTs, Gems & Claude Projects 2026 guide](https://stackviv.ai/blog/custom-gpts-gems-claude-projects) — comparison of user-creatable AI tools
