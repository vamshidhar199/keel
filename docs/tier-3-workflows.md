# Tier 3 — User-Creatable Workflows

> Status: shipped. Lives on `feat/customizable-brief-and-workflows`.
> See also: [`design-decisions.md`](./design-decisions.md) DD-8 (cron presets) + DD-9 (NL generator).

---

## What a workflow is

A scheduled AI agent the user defines. It has:
- **Trigger** — when it fires (preset cron OR custom day-of-week + time)
- **Filter** — natural-language rule narrowing what data to look at (optional)
- **Prompt** — natural-language instructions for what the AI should write
- **Output** — markdown response saved to `workflow_runs`, surfaced on `/overview` and `/workflows/[id]`

Mental model: every workflow is a tiny scheduled function. Filter narrows the inputs, prompt shapes the output, schedule decides when.

---

## Data model

```sql
CREATE TABLE workflows (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  trigger_cron TEXT NOT NULL,          -- preset key OR 'custom'
  trigger_custom JSONB,                -- {weekdays, hour, minute} when 'custom'
  filter_nl TEXT NOT NULL DEFAULT '',
  prompt_template TEXT NOT NULL,
  delivery_type TEXT NOT NULL DEFAULT 'in_app',
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);
ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflows FORCE ROW LEVEL SECURITY;

CREATE TABLE workflow_runs (
  id UUID PRIMARY KEY,
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  ran_at TIMESTAMPTZ,
  status TEXT NOT NULL,                 -- 'success' | 'failed' | 'no_data'
  output_text TEXT,
  error TEXT,
  source_refs JSONB NOT NULL DEFAULT '[]'
);
ALTER TABLE workflow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_runs FORCE ROW LEVEL SECURITY;
```

Both tables are RLS-protected. All queries go through `withUser(userId, …)` except `listDueWorkflows()` which runs on the admin pool (cross-user scan, see DD-12).

---

## Cron presets

Six curated cadences (`CRON_PRESETS` in `lib/workflows.ts`):

| Key | Label |
|---|---|
| `daily_8am` | Every day at 8 AM |
| `weekday_8am` | Weekdays at 8 AM |
| `weekday_6pm` | Weekdays at 6 PM |
| `monday_8am` | Mondays at 8 AM |
| `friday_4pm` | Fridays at 4 PM |
| `sunday_6pm` | Sundays at 6 PM |

When the user picks one, `trigger_cron = '<key>'` and `trigger_custom = NULL`.

## Custom cadences

When the user picks "Custom…" in the cadence dropdown:
- `trigger_cron = 'custom'`
- `trigger_custom = { weekdays: int[], hour: 0-23, minute: 0-59 }`

`weekdays` is a sorted array of 0=Sun..6=Sat. Empty = every day.

UI lives in `app/(app)/workflows/cadence-picker.tsx` (shared by the creator panel + the detail editor). Day chips toggle multi-select; 12-hour time picker with AM/PM; live summary text like "Mon, Wed, Fri at 3:30 PM".

## Scheduling math

One shared core: `nextRunForSchedule(weekdays, hour, minute, timezone, after)` in `lib/workflows.ts`. Handles:
- IANA-tz local-time interpretation
- DST transitions (one-iteration offset refinement; covers the common cases)
- Day-by-day scan (max 7 iterations) finding the next matching slot

Both `nextRunAtFromPreset` (preset path) and `nextRunAtFor` (unified dispatcher) call into it.

---

## NL workflow generator

`/api/workflows/generate` POST takes `{ request: string }`, returns `{ draft: WorkflowDraft }`.

Server-side flow (`lib/workflows.ts:generateWorkflowFromNL`):
1. Send the request to **Sonnet** with a strict system prompt that lists the 6 valid cron preset keys.
2. Parse the response with `parseWorkflowDraft()` — tolerates fenced JSON, prose-wrapped JSON; rejects unknown enum values.
3. Returns `{ name, description, trigger_cron, filter_nl, prompt_template }` for the UI to display.

**Trust contract:** the model never persists. The user reviews + saves through the regular `POST /api/workflows` path.

UI: hero card on `/workflows` with a textarea + "Draft workflow" button. The drafted spec auto-fills the manual editor below for review.

## Templates

4 hardcoded starters (`WORKFLOW_TEMPLATES` in `lib/workflows.ts`):
- Daily inbox summary (weekday_8am)
- Weekly recap (friday_4pm)
- Sunday prep (sunday_6pm)
- Quiet relationships (monday_8am)

Picking a template in the creator panel pre-fills the form. No template-vs-custom distinction in the DB — every saved workflow is just a workflow.

---

## Run flow

`runWorkflow(userId, workflowId)` is the runner core. Two-phase:

1. **Filter (optional, ~1 Haiku call).** Pulls 40 candidate items: last 7d of Gmail (decrypted) + last 14d of recently-updated pages + open commitments. Sends them with the workflow's `filter_nl` rule to Haiku. Asks for up to 15 matching refs.

2. **Synthesize (1 Haiku call).** Takes the filtered candidates as context. The workflow's `prompt_template` becomes the system prompt. AI Memories + recent downvotes are also injected.

Output: markdown string + array of `source_refs: [{ ref, kind, label }]`. Both saved to `workflow_runs`.

Then: `UPDATE workflows SET last_run_at = now(), next_run_at = nextRunAtFor(...)`.

## Scheduler

`lib/sync.ts:schedulerTick()` runs on the admin pool and scans `SELECT id, user_id FROM workflows WHERE enabled = true AND next_run_at <= now()`. For each due workflow, calls `enqueue({ type: 'run_workflow', userId, workflowId })`.

`run_workflow` job is processed by `lib/queue/runners.ts`, which calls `runWorkflow(userId, workflowId)`.

Boot path: `instrumentation.ts` calls `schedulerTick()` once on startup. Prod cron (Railway) hits `/api/cron/scheduler-tick` every minute.

**Local dev gotcha:** there's no cron locally. Either reboot the dev server after a workflow's scheduled time to catch up, OR click "Run now" on the detail page to fire manually.

---

## Run now

`POST /api/workflows/[id]/run` enqueues a `run_workflow` job. `enqueue()` self-triggers `/api/queue/drain` immediately, so locally a "Run now" click fires within ~3 seconds.

The workflow detail page (`/workflows/[id]`) polls `/api/workflows/[id]/runs` for a few seconds after a Run-now to surface the new run in the history without a manual refresh.

---

## Surfacing on `/overview`

`listRecentWorkflowRuns(userId, 2, 3)` pulls successful runs from the last 48h. Renders as the **"From your workflows"** bento card. Clicking a row opens the `WorkflowRunDrawer` via `?run=<run_id>` URL state.

The drawer:
- Workflow name + ran_at
- Status pill (success / failed / no_data)
- Output rendered via `<RenderMarkdown />` (same component `/ask` uses)
- Source refs list with Gmail / `/pages/[slug]` deep-links
- Footer "Open workflow →" → `/workflows/[id]` for full history

Card preview uses `stripMarkdown()` to flatten the snippet to clean prose (no raw `**` or `#`).

---

## API surface

| Endpoint | Purpose |
|---|---|
| `GET /api/workflows` | List user's workflows + templates |
| `POST /api/workflows` | Create (accepts `template:` field to clone) |
| `GET /api/workflows/[id]` | Single workflow |
| `PATCH /api/workflows/[id]` | Update (toggles `enabled`, edits fields). Reads existing row to combine `trigger_cron` + `trigger_custom` correctly when recomputing `next_run_at`. |
| `DELETE /api/workflows/[id]` | Cascades to `workflow_runs` |
| `POST /api/workflows/[id]/run` | Enqueue an immediate run |
| `GET /api/workflows/[id]/runs` | Last 20 runs for the detail page |
| `POST /api/workflows/generate` | NL drafter (non-persistent) |
| `GET /api/workflow-runs/[id]` | Single run for the drawer |

---

## Tests

`lib/__tests__/workflows.test.ts` covers:
- Cron preset math (next-fire on a Friday after a Friday, DST-aware)
- Custom trigger validation (`isValidCustomTrigger`)
- Custom next-fire math (specific day + time, hour rollover)
- Preset/custom dispatcher equivalence (`nextRunAtFor` matches `nextRunAtFromPreset`)
- CRUD lifecycle
- `listDueWorkflows` filtering (skips disabled, future-scheduled)
- `workflow_runs` JSONB `source_refs` round-trip
- Template validity (every template has a valid preset key)
- NL parser fallback (clean JSON, fenced, prose-wrapped, garbage)

RLS isolation tests in `lib/__tests__/rls-isolation.test.ts` cover cross-user access on `workflows` + `workflow_runs`.

---

## Deferred / out of scope

- **Delivery channels** — email (Resend) + Slack DM. Schema-ready (`delivery_type` field) but only `'in_app'` is implemented.
- **Sub-daily cadences** — "every 4 hours" not expressible without a new model.
- **Dependent / chained workflows** — workflow A's output feeding workflow B.
- **Workflow templates from the user community** — marketplace pattern, far out.

---

## Files

| Path | Role |
|---|---|
| `lib/workflows.ts` | All CRUD, scheduling math, runner, NL generator, parser |
| `lib/queue/runners.ts:run_workflow` | Queue runner for the scheduled fire |
| `lib/sync.ts:schedulerTick` | Cross-user scan of due workflows |
| `app/(app)/workflows/page.tsx` | List + creator UI |
| `app/(app)/workflows/workflows-client.tsx` | Client orchestrator (NL hero, templates picker, manual editor) |
| `app/(app)/workflows/cadence-picker.tsx` | Shared cadence dropdown + custom UI |
| `app/(app)/workflows/[id]/page.tsx` | Detail page server |
| `app/(app)/workflows/[id]/workflow-detail.tsx` | Detail editor + run history client |
| `app/(app)/overview/cards/workflow-runs-card.tsx` | The /overview surfacing card |
| `app/(app)/overview/workflow-run-drawer.tsx` | The run-detail drawer |
| `app/(app)/overview/workflow-run-drawer-mount.tsx` | Reads `?run=<id>` URL param |
| `app/api/workflows/route.ts` + `[id]/route.ts` + `[id]/run/route.ts` + `[id]/runs/route.ts` + `generate/route.ts` | API |
| `app/api/workflow-runs/[id]/route.ts` | Single run fetch for drawer |
