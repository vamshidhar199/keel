import { getAdminDb, getMetaDb, withUser } from "./db";
import { decrypt } from "./crypto";
import { callClaude, HAIKU, SONNET } from "./anthropic";
import { loadUserContext, buildMemoriesBlock, summarizeRecentDownvotes } from "./digest";
import {
  LOOKBACK_HOURS_CHOICES,
  describeLookback,
  isLookbackHours,
  type LookbackHours,
} from "./workflow-shared";

// Re-export for callers that have always imported these from "@/lib/workflows".
// Client components should import directly from "@/lib/workflow-shared" instead
// — pulling them through this module drags in pg / Node-only deps.
export { LOOKBACK_HOURS_CHOICES, describeLookback, isLookbackHours };
export type { LookbackHours };

// ── Cron presets ─────────────────────────────────────────────────────────────
//
// v1 deliberately ships a curated set of cadences rather than free-form cron.
// Each preset key maps to a `nextRunAtFromPreset()` formula that computes the
// next firing in the user's local timezone (so "weekday_8am" means 8 AM where
// the user lives, not 8 AM UTC).

export type CronPresetKey =
  | "daily_8am"
  | "weekday_8am"
  | "weekday_6pm"
  | "monday_8am"
  | "friday_4pm"
  | "sunday_6pm";

export interface CronPreset {
  key: CronPresetKey;
  label: string;
  hour: number;          // 0-23, in user's local timezone
  weekdays: number[];    // 0=Sun, 6=Sat. Empty = every day.
}

export const CRON_PRESETS: Readonly<Record<CronPresetKey, CronPreset>> = {
  daily_8am:    { key: "daily_8am",    label: "Every day at 8 AM",       hour: 8,  weekdays: [] },
  weekday_8am:  { key: "weekday_8am",  label: "Weekdays at 8 AM",        hour: 8,  weekdays: [1, 2, 3, 4, 5] },
  weekday_6pm:  { key: "weekday_6pm",  label: "Weekdays at 6 PM",        hour: 18, weekdays: [1, 2, 3, 4, 5] },
  monday_8am:   { key: "monday_8am",   label: "Mondays at 8 AM",         hour: 8,  weekdays: [1] },
  friday_4pm:   { key: "friday_4pm",   label: "Fridays at 4 PM",         hour: 16, weekdays: [5] },
  sunday_6pm:   { key: "sunday_6pm",   label: "Sundays at 6 PM",         hour: 18, weekdays: [0] },
} as const;

export function isCronPresetKey(s: string): s is CronPresetKey {
  return Object.prototype.hasOwnProperty.call(CRON_PRESETS, s);
}

// Custom cadence — when the user picks "Custom…" instead of a preset.
export interface WorkflowCustomTrigger {
  weekdays: number[];  // 0=Sun..6=Sat, empty = every day
  hour: number;        // 0-23, local time
  minute: number;      // 0-59
}

export function isValidCustomTrigger(v: unknown): v is WorkflowCustomTrigger {
  if (!v || typeof v !== "object") return false;
  const o = v as Partial<WorkflowCustomTrigger>;
  if (!Array.isArray(o.weekdays)) return false;
  if (!o.weekdays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) return false;
  if (new Set(o.weekdays).size !== o.weekdays.length) return false; // no dupes
  if (!Number.isInteger(o.hour) || o.hour! < 0 || o.hour! > 23) return false;
  if (!Number.isInteger(o.minute) || o.minute! < 0 || o.minute! > 59) return false;
  return true;
}

// Core scheduling math: find the next instant in `tz` matching a weekday
// filter and hour:minute, strictly after `after`. Shared by both preset and
// custom paths.
function nextRunForSchedule(
  weekdays: number[],
  hour: number,
  minute: number,
  timezone: string,
  after: Date = new Date()
): Date {
  const tz = timezone && timezone.length > 0 ? timezone : "UTC";
  const wanted = weekdays.length > 0 ? new Set(weekdays) : null;

  for (let dayOffset = 0; dayOffset < 8; dayOffset++) {
    const candidate = new Date(after.getTime() + dayOffset * 24 * 60 * 60 * 1000);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(candidate);
    const weekdayShort = parts.find((p) => p.type === "weekday")?.value ?? "";
    const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekdayShort);
    const y = parts.find((p) => p.type === "year")?.value;
    const m = parts.find((p) => p.type === "month")?.value;
    const d = parts.find((p) => p.type === "day")?.value;

    if (wanted && !wanted.has(dow)) continue;

    const localTimestamp =
      `${y}-${m}-${d}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
    const fired = utcFromTzLocal(localTimestamp, tz);
    if (fired.getTime() > after.getTime()) return fired;
  }
  return new Date(after.getTime() + 60 * 60 * 1000);
}

// Preset path — preserved for compatibility with existing callers.
export function nextRunAtFromPreset(
  presetKey: CronPresetKey,
  timezone: string,
  after: Date = new Date()
): Date {
  const preset = CRON_PRESETS[presetKey];
  return nextRunForSchedule(preset.weekdays, preset.hour, 0, timezone, after);
}

// Unified dispatcher: handles both preset and custom triggers. Pass either a
// preset key + null custom, or 'custom' + a valid WorkflowCustomTrigger.
export function nextRunAtFor(
  triggerCron: string,
  triggerCustom: WorkflowCustomTrigger | null,
  timezone: string,
  after: Date = new Date()
): Date {
  if (triggerCron === "custom" && triggerCustom && isValidCustomTrigger(triggerCustom)) {
    return nextRunForSchedule(
      triggerCustom.weekdays,
      triggerCustom.hour,
      triggerCustom.minute,
      timezone,
      after
    );
  }
  if (isCronPresetKey(triggerCron)) {
    return nextRunAtFromPreset(triggerCron, timezone, after);
  }
  // Unknown trigger — fall back to firing in 1 hour so we don't loop forever.
  return new Date(after.getTime() + 60 * 60 * 1000);
}

// Resolve a local wall-clock string (no offset) inside a given IANA timezone
// back to a UTC Date. We do this by sampling the offset at the candidate point
// and adjusting; one iteration is enough for non-pathological zones.
function utcFromTzLocal(local: string, tz: string): Date {
  const guess = new Date(`${local}Z`); // pretend it's UTC, then we'll correct.
  const offsetMin = tzOffsetMinutes(guess, tz);
  const adjusted = new Date(guess.getTime() - offsetMin * 60_000);
  // One refine pass to handle DST boundaries.
  const offsetMin2 = tzOffsetMinutes(adjusted, tz);
  if (offsetMin2 !== offsetMin) {
    return new Date(guess.getTime() - offsetMin2 * 60_000);
  }
  return adjusted;
}

function tzOffsetMinutes(at: Date, tz: string): number {
  // Format `at` in `tz` and compare to UTC parts to derive the offset.
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  let h = get("hour");
  if (h === 24) h = 0;
  const localMs = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    h,
    get("minute"),
    get("second")
  );
  return (localMs - at.getTime()) / 60_000;
}

// ── Workflow CRUD ────────────────────────────────────────────────────────────

export interface Workflow {
  id: string;
  user_id: string;
  name: string;
  description: string;
  trigger_cron: CronPresetKey | "custom";
  trigger_custom: WorkflowCustomTrigger | null;
  filter_nl: string;
  prompt_template: string;
  lookback_hours: number;
  delivery_type: "in_app";
  enabled: boolean;
  last_run_at: string | null;
  next_run_at: string;
  created_at: string;
  updated_at: string;
}

interface WorkflowRow {
  id: string;
  user_id: string;
  name: string;
  description: string;
  trigger_cron: string;
  trigger_custom: WorkflowCustomTrigger | null;
  filter_nl: string;
  prompt_template: string;
  lookback_hours: number;
  delivery_type: string;
  enabled: boolean;
  last_run_at: Date | null;
  next_run_at: Date;
  created_at: Date;
  updated_at: Date;
}

function toWorkflow(r: WorkflowRow): Workflow {
  return {
    id: r.id,
    user_id: r.user_id,
    name: r.name,
    description: r.description,
    trigger_cron: r.trigger_cron as CronPresetKey | "custom",
    trigger_custom: r.trigger_custom,
    filter_nl: r.filter_nl,
    prompt_template: r.prompt_template,
    lookback_hours: r.lookback_hours,
    delivery_type: r.delivery_type as "in_app",
    enabled: r.enabled,
    last_run_at: r.last_run_at?.toISOString() ?? null,
    next_run_at: r.next_run_at.toISOString(),
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

const WORKFLOW_COLUMNS = `id, user_id, name, description, trigger_cron, trigger_custom,
              filter_nl, prompt_template, lookback_hours, delivery_type, enabled,
              last_run_at, next_run_at, created_at, updated_at`;

export async function listWorkflows(userId: string): Promise<Workflow[]> {
  return withUser(userId, async (c) => {
    const { rows } = await c.query<WorkflowRow>(
      `SELECT ${WORKFLOW_COLUMNS}
         FROM workflows
        ORDER BY created_at DESC`
    );
    return rows.map(toWorkflow);
  });
}

export async function getWorkflow(
  userId: string,
  id: string
): Promise<Workflow | null> {
  return withUser(userId, async (c) => {
    const { rows } = await c.query<WorkflowRow>(
      `SELECT ${WORKFLOW_COLUMNS}
         FROM workflows WHERE id = $1 LIMIT 1`,
      [id]
    );
    return rows[0] ? toWorkflow(rows[0]) : null;
  });
}

export interface CreateWorkflowInput {
  name: string;
  description?: string;
  trigger_cron: CronPresetKey | "custom";
  trigger_custom?: WorkflowCustomTrigger | null;
  filter_nl?: string;
  prompt_template: string;
  lookback_hours?: LookbackHours;
}

export async function createWorkflow(
  userId: string,
  input: CreateWorkflowInput,
  timezone: string
): Promise<Workflow> {
  const customJson =
    input.trigger_cron === "custom" && input.trigger_custom
      ? JSON.stringify(input.trigger_custom)
      : null;
  const nextRun = nextRunAtFor(
    input.trigger_cron,
    input.trigger_custom ?? null,
    timezone
  );
  return withUser(userId, async (c) => {
    const { rows } = await c.query<WorkflowRow>(
      `INSERT INTO workflows
         (user_id, name, description, trigger_cron, trigger_custom,
          filter_nl, prompt_template, lookback_hours, delivery_type, enabled, next_run_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, 'in_app', true, $9)
       RETURNING ${WORKFLOW_COLUMNS}`,
      [
        userId,
        input.name.slice(0, 120),
        (input.description ?? "").slice(0, 400),
        input.trigger_cron,
        customJson,
        (input.filter_nl ?? "").slice(0, 600),
        input.prompt_template.slice(0, 2000),
        input.lookback_hours ?? 24,
        nextRun,
      ]
    );
    return toWorkflow(rows[0]);
  });
}

export interface UpdateWorkflowInput {
  name?: string;
  description?: string;
  trigger_cron?: CronPresetKey | "custom";
  trigger_custom?: WorkflowCustomTrigger | null;
  filter_nl?: string;
  prompt_template?: string;
  lookback_hours?: LookbackHours;
  enabled?: boolean;
}

export async function updateWorkflow(
  userId: string,
  id: string,
  input: UpdateWorkflowInput,
  timezone: string
): Promise<Workflow | null> {
  // Recompute next_run_at when the trigger changes. We need the BEFORE-state
  // of the row to know what trigger to combine with; easiest to read first.
  let next: Date | null = null;
  if (input.trigger_cron !== undefined || input.trigger_custom !== undefined) {
    const existing = await getWorkflow(userId, id);
    if (existing) {
      const effectiveCron = input.trigger_cron ?? existing.trigger_cron;
      const effectiveCustom =
        input.trigger_custom !== undefined ? input.trigger_custom : existing.trigger_custom;
      next = nextRunAtFor(effectiveCron, effectiveCustom, timezone);
    }
  }
  const customJsonForUpdate =
    input.trigger_custom !== undefined
      ? input.trigger_custom === null
        ? null
        : JSON.stringify(input.trigger_custom)
      : undefined;
  return withUser(userId, async (c) => {
    // We need separate handling for "set to null" vs "leave unchanged" on
    // trigger_custom. The COALESCE approach can't distinguish them, so we
    // pass a sentinel string and rebuild the JSONB column explicitly.
    const { rows } = await c.query<WorkflowRow>(
      `UPDATE workflows SET
         name            = COALESCE($1, name),
         description     = COALESCE($2, description),
         trigger_cron    = COALESCE($3, trigger_cron),
         trigger_custom  = CASE
             WHEN $9::text = '__leave__' THEN trigger_custom
             WHEN $9::text = '__null__'  THEN NULL
             ELSE $9::jsonb
           END,
         filter_nl       = COALESCE($4, filter_nl),
         prompt_template = COALESCE($5, prompt_template),
         lookback_hours  = COALESCE($10, lookback_hours),
         enabled         = COALESCE($6, enabled),
         next_run_at     = COALESCE($7, next_run_at),
         updated_at      = now()
       WHERE id = $8
       RETURNING ${WORKFLOW_COLUMNS}`,
      [
        input.name?.slice(0, 120) ?? null,
        input.description?.slice(0, 400) ?? null,
        input.trigger_cron ?? null,
        input.filter_nl?.slice(0, 600) ?? null,
        input.prompt_template?.slice(0, 2000) ?? null,
        typeof input.enabled === "boolean" ? input.enabled : null,
        next,
        id,
        customJsonForUpdate === undefined
          ? "__leave__"
          : customJsonForUpdate === null
          ? "__null__"
          : customJsonForUpdate,
        input.lookback_hours ?? null,
      ]
    );
    return rows[0] ? toWorkflow(rows[0]) : null;
  });
}

export async function deleteWorkflow(userId: string, id: string): Promise<void> {
  await withUser(userId, async (c) => {
    await c.query(`DELETE FROM workflows WHERE id = $1`, [id]);
  });
}

// ── Workflow runs ────────────────────────────────────────────────────────────

export interface WorkflowRun {
  id: string;
  workflow_id: string;
  ran_at: string;
  status: "success" | "failed" | "no_data";
  output_text: string | null;
  error: string | null;
  source_refs: WorkflowSourceRef[];
}

export interface WorkflowSourceRef {
  ref: string;
  kind: "thread" | "page" | "commitment";
  label: string;
}

interface WorkflowRunRow {
  id: string;
  workflow_id: string;
  ran_at: Date;
  status: string;
  output_text: string | null;
  error: string | null;
  source_refs: WorkflowSourceRef[];
}

export interface RecentRunSummary {
  run_id: string;
  workflow_id: string;
  workflow_name: string;
  ran_at: string;
  preview: string;     // first ~160 chars of output_text
}

// Surface workflow runs on /overview. Filters to successful runs in the last
// `windowDays` days. JOINs workflows so we can render the workflow name
// without a second round-trip.
export async function listRecentWorkflowRuns(
  userId: string,
  windowDays = 2,
  limit = 3
): Promise<RecentRunSummary[]> {
  return withUser(userId, async (c) => {
    const { rows } = await c.query<{
      run_id: string;
      workflow_id: string;
      workflow_name: string;
      ran_at: Date;
      output_text: string | null;
    }>(
      `SELECT wr.id AS run_id, wr.workflow_id, w.name AS workflow_name,
              wr.ran_at, wr.output_text
         FROM workflow_runs wr
         JOIN workflows w ON w.id = wr.workflow_id
        WHERE wr.status = 'success'
          AND wr.ran_at > now() - ($1 || ' days')::interval
        ORDER BY wr.ran_at DESC
        LIMIT $2`,
      [windowDays, limit]
    );
    return rows.map((r) => ({
      run_id: r.run_id,
      workflow_id: r.workflow_id,
      workflow_name: r.workflow_name,
      ran_at: r.ran_at.toISOString(),
      preview: stripMarkdown(r.output_text ?? "").slice(0, 200),
    }));
  });
}

// Strip the most common markdown syntax (headings, emphasis, lists, code,
// links, citation tags) so card previews show clean prose instead of raw `#`s
// and `**`s. Not a full markdown parser; just gets the preview readable.
export function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[chunk:\d+\]/g, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s{0,3}[-*+]\s+/gm, "")
    .replace(/^\s{0,3}\d+\.\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "$1")
    .replace(/(?<!_)_([^_]+)_(?!_)/g, "$1")
    .replace(/^\s*[-*_]{3,}\s*$/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function listWorkflowRuns(
  userId: string,
  workflowId: string,
  limit = 20
): Promise<WorkflowRun[]> {
  return withUser(userId, async (c) => {
    const { rows } = await c.query<WorkflowRunRow>(
      `SELECT id, workflow_id, ran_at, status, output_text, error, source_refs
         FROM workflow_runs
        WHERE workflow_id = $1
        ORDER BY ran_at DESC
        LIMIT $2`,
      [workflowId, limit]
    );
    return rows.map((r) => ({
      id: r.id,
      workflow_id: r.workflow_id,
      ran_at: r.ran_at.toISOString(),
      status: r.status as WorkflowRun["status"],
      output_text: r.output_text,
      error: r.error,
      source_refs: r.source_refs ?? [],
    }));
  });
}

// ── Candidates for filter/synth ──────────────────────────────────────────────

interface RunCandidate {
  ref: string;
  kind: "thread" | "page" | "commitment";
  label: string;        // short headline
  details: string;      // longer context fed to the LLM
  date_sent?: string;   // ISO if known
}

// Pull ~40 items the workflow filter can consider: recent Gmail (decrypted),
// recently-touched pages, and open commitments. Bounded to keep tokens sane.
//
// `lookbackHours` scopes the email + page candidates to a workflow-specific
// window so a "daily" workflow (24h) doesn't see weeks-old mail just because
// the inbox was quiet. Commitments are intentionally NOT windowed — an open
// commitment from last month is still actionable today.
async function workflowCandidates(
  userId: string,
  lookbackHours: number
): Promise<RunCandidate[]> {
  const hours = Math.max(1, Math.min(lookbackHours, 24 * 90)); // clamp to [1h, 90d]
  const db = getMetaDb();
  const [emails, pages, commitments] = await Promise.all([
    db.query<{
      thread_ref: string | null;
      from_addr: string | null;
      subject: string | null;
      body_text: string | null;
      date_sent: Date | null;
    }>(
      `SELECT thread_ref, from_addr, subject, body_text, date_sent
         FROM raw_events
        WHERE user_id = $1 AND source = 'gmail'
          AND date_sent > now() - ($2 || ' hours')::interval
        ORDER BY date_sent DESC
        LIMIT 25`,
      [userId, hours]
    ),
    withUser(userId, (c) =>
      c.query<{ slug: string; title: string; type: string | null; updated_at: Date; compiled_truth: string }>(
        `SELECT slug, title, type, updated_at, compiled_truth
           FROM pages
          WHERE updated_at > now() - ($1 || ' hours')::interval
          ORDER BY updated_at DESC
          LIMIT 10`,
        [hours]
      )
    ),
    withUser(userId, (c) =>
      c.query<{ id: string; text: string; entity_slugs: string[] | null; created_at: Date }>(
        `SELECT c.id, c.text, c.created_at,
                COALESCE(
                  array_agg(ce.entity_slug ORDER BY ce.entity_slug)
                    FILTER (WHERE ce.entity_slug IS NOT NULL),
                  ARRAY[]::text[]
                ) AS entity_slugs
           FROM commitments c
           LEFT JOIN commitment_entities ce ON ce.commitment_id = c.id
          WHERE c.status = 'open'
          GROUP BY c.id
          ORDER BY c.created_at DESC
          LIMIT 10`
      )
    ),
  ]);

  const out: RunCandidate[] = [];

  for (const e of emails.rows) {
    if (!e.thread_ref) continue;
    const from = decrypt(e.from_addr ?? null) ?? "";
    const subj = decrypt(e.subject ?? null) ?? "(no subject)";
    const body = decrypt(e.body_text ?? null) ?? "";
    const snippet = body.slice(0, 320).replace(/\s+/g, " ").trim();
    out.push({
      ref: e.thread_ref,
      kind: "thread",
      label: `${from.slice(0, 60)} — ${subj.slice(0, 80)}`,
      details: `from=${from.slice(0, 100)} subject="${subj.slice(0, 140)}" snippet="${snippet}"`,
      date_sent: e.date_sent?.toISOString(),
    });
  }
  for (const p of pages.rows) {
    out.push({
      ref: p.slug,
      kind: "page",
      label: `${p.title} (page)`,
      details: `page title="${p.title}" slug=${p.slug} type=${p.type ?? "?"} compiled="${p.compiled_truth.slice(0, 320).replace(/\s+/g, " ").trim()}"`,
    });
  }
  for (const c of commitments.rows) {
    const slugs = (c.entity_slugs ?? []).join(",") || "?";
    out.push({
      ref: c.id,
      kind: "commitment",
      label: c.text.slice(0, 100),
      details: `commitment text="${c.text.slice(0, 200)}" slugs=${slugs}`,
    });
  }

  return out;
}

// ── Runner ───────────────────────────────────────────────────────────────────

interface FilterResult {
  ref: string;
  why: string;
}

function safeParseJsonArray<T>(text: string): T[] | null {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    const v = JSON.parse(cleaned);
    return Array.isArray(v) ? (v as T[]) : null;
  } catch {
    const i = cleaned.indexOf("[");
    const j = cleaned.lastIndexOf("]");
    if (i >= 0 && j > i) {
      try {
        const v = JSON.parse(cleaned.slice(i, j + 1));
        return Array.isArray(v) ? (v as T[]) : null;
      } catch {}
    }
    return null;
  }
}

export interface WorkflowRunResult {
  status: "success" | "failed" | "no_data";
  output_text: string | null;
  error: string | null;
  source_refs: WorkflowSourceRef[];
}

// Execute a workflow end-to-end: gather candidates, filter via Haiku, then
// synthesize the output via Haiku with the user's prompt template. Writes a
// row into workflow_runs and updates workflows.last_run_at + next_run_at.
export async function runWorkflow(
  userId: string,
  workflowId: string
): Promise<WorkflowRunResult> {
  const wf = await getWorkflow(userId, workflowId);
  if (!wf) {
    return { status: "failed", output_text: null, error: "workflow not found", source_refs: [] };
  }

  const ctx = await loadUserContext(userId);
  const downvotes = await summarizeRecentDownvotes(userId);
  const memoriesBlock = buildMemoriesBlock(ctx.ai_memories, downvotes, 0);

  const candidates = await workflowCandidates(userId, wf.lookback_hours);
  const result: WorkflowRunResult = await (async () => {
    try {
      if (candidates.length === 0) {
        return { status: "no_data" as const, output_text: null, error: null, source_refs: [] };
      }

      // Step 1 — filter (only when the user provided a filter_nl rule).
      let kept: RunCandidate[] = candidates;
      if (wf.filter_nl.trim().length > 0) {
        const filterSystem =
          "You are a strict filter. Return ONLY a JSON array of {ref, why}. Pick at most 15 candidates that match the rule. If nothing matches, return [].";
        const filterUser = `${memoriesBlock ? memoriesBlock + "\n\n" : ""}<rule>${wf.filter_nl}</rule>

<candidates>
${candidates.map((c, i) => `${i}. ref=${c.ref} kind=${c.kind} ${c.details}`).join("\n")}
</candidates>

Return ONLY the JSON array.`;
        const filterText = await callClaude(
          userId,
          HAIKU,
          [{ role: "user", content: filterUser }],
          { system: filterSystem, maxTokens: 900 }
        );
        const parsed = safeParseJsonArray<FilterResult>(filterText);
        if (parsed) {
          const byRef = new Map(candidates.map((c) => [c.ref, c]));
          kept = parsed
            .map((p) => byRef.get(p.ref))
            .filter((c): c is RunCandidate => Boolean(c));
        }
      }

      if (kept.length === 0) {
        return { status: "no_data" as const, output_text: null, error: null, source_refs: [] };
      }

      // Step 2 — synthesize. The user's prompt_template is the system prompt.
      const synthSystem =
        wf.prompt_template +
        (memoriesBlock ? `\n\n${memoriesBlock}` : "") +
        "\n\nWrite a concise response in Markdown. Cite items with [ref] tags inline (e.g. [thread-abc] or [page-slug]) so the user can trace them.";

      // Anchor the model with the current date and the workflow's lookback
      // window so it can self-filter stale items. Without this, a "daily"
      // workflow that runs after a quiet night would still surface anything
      // the candidate query returned, regardless of age.
      const today = new Date().toISOString().slice(0, 10);
      const windowDesc = describeLookback(wf.lookback_hours);

      const synthUser = `Today's date: ${today}
Lookback window: ${windowDesc} (items older than this are stale and should not be treated as "new" or "overnight" unless the user's instructions explicitly ask for older history).

<context>
${kept.map((c) => `[${c.ref}] ${c.kind}: ${c.details}`).join("\n\n")}
</context>

Now respond per the system instructions, citing items by ref.`;

      const out = await callClaude(
        userId,
        HAIKU,
        [{ role: "user", content: synthUser }],
        { system: synthSystem, maxTokens: 1400 }
      );

      const source_refs: WorkflowSourceRef[] = kept.slice(0, 25).map((c) => ({
        ref: c.ref,
        kind: c.kind,
        label: c.label,
      }));

      return { status: "success" as const, output_text: out.trim(), error: null, source_refs };
    } catch (err) {
      return {
        status: "failed" as const,
        output_text: null,
        error: String((err as Error)?.message ?? err).slice(0, 400),
        source_refs: [],
      };
    }
  })();

  await withUser(userId, async (c) => {
    await c.query(
      `INSERT INTO workflow_runs (workflow_id, user_id, status, output_text, error, source_refs)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        workflowId,
        userId,
        result.status,
        result.output_text,
        result.error,
        JSON.stringify(result.source_refs),
      ]
    );
    const nextRun = nextRunAtFor(
      wf.trigger_cron,
      wf.trigger_custom,
      ctx.timezone,
      new Date()
    );
    await c.query(
      `UPDATE workflows
          SET last_run_at = now(), next_run_at = $1, updated_at = now()
        WHERE id = $2`,
      [nextRun, workflowId]
    );
  });

  return result;
}

// ── Templates ────────────────────────────────────────────────────────────────

export interface WorkflowTemplate {
  key: string;
  name: string;
  description: string;
  trigger_cron: CronPresetKey;
  filter_nl: string;
  prompt_template: string;
  lookback_hours: LookbackHours;
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    key: "daily_inbox",
    name: "Daily inbox summary",
    description: "Every morning, summarize what's new in your inbox.",
    trigger_cron: "weekday_8am",
    filter_nl: "all gmail threads from the last 24 hours that need my attention",
    prompt_template:
      "Summarize the user's overnight email in 2-3 paragraphs. Lead with what needs a reply today; then mention notable but non-urgent items. Be specific about senders and subjects. Skip newsletters and automated notifications.",
    lookback_hours: 24,
  },
  {
    key: "weekly_recap",
    name: "Weekly recap",
    description: "Every Friday afternoon, recap the week.",
    trigger_cron: "friday_4pm",
    filter_nl: "anything that shifted on a project or person this week — decisions, blockers, status changes",
    prompt_template:
      "Write a 3-section Friday recap: (1) What shipped or got decided, (2) What's still in flight, (3) What might slip into next week. Be specific. Quote one direct phrase or excerpt per item where it would help the user remember.",
    lookback_hours: 168,
  },
  {
    key: "sunday_prep",
    name: "Sunday prep",
    description: "Sunday evening: what to know going into the week.",
    trigger_cron: "sunday_6pm",
    filter_nl: "open commitments + anyone who's waiting on my reply + any threads with action items pending",
    prompt_template:
      "Write a Sunday-evening 'prep me for the week' note. Lead with the 3 most important things on the user's plate. Then list anyone who's waiting on them. Tone: warm, direct, no hand-wringing.",
    lookback_hours: 168,
  },
  {
    key: "quiet_relationships",
    name: "Quiet relationships",
    description: "Mondays: people I haven't talked to recently.",
    trigger_cron: "monday_8am",
    filter_nl: "people pages where the underlying threads have gone quiet but used to be active",
    prompt_template:
      "List up to 5 people the user used to talk to but hasn't recently. For each, write one line: their name + the last subject/thread + how long ago. End with one suggestion of who to reach out to first and why.",
    lookback_hours: 720,
  },
];

// ── Scheduler helper ─────────────────────────────────────────────────────────

// ── Natural-language workflow generator ──────────────────────────────────────

export interface WorkflowDraft {
  name: string;
  description: string;
  trigger_cron: CronPresetKey;
  filter_nl: string;
  prompt_template: string;
  lookback_hours: LookbackHours;
}

// Pick a sane default lookback when the model didn't (or returned an invalid
// value). Roughly: daily/weekday cadences → 24h, weekly → 168h, monthly-ish
// trigger (only sunday_6pm fits) → 168h. Override per-template in WORKFLOW_TEMPLATES.
function defaultLookbackForCron(cron: CronPresetKey): LookbackHours {
  switch (cron) {
    case "daily_8am":
    case "weekday_8am":
    case "weekday_6pm":
      return 24;
    case "monday_8am":
    case "friday_4pm":
    case "sunday_6pm":
      return 168;
  }
}

// Parse a JSON object out of arbitrary LLM text, then validate it against the
// WorkflowDraft shape. Returns null when the response can't be coerced.
export function parseWorkflowDraft(text: string): WorkflowDraft | null {
  const obj = extractFirstJsonObject(text);
  if (!obj) return null;

  const name = typeof obj.name === "string" ? obj.name.trim().slice(0, 80) : "";
  const description =
    typeof obj.description === "string" ? obj.description.trim().slice(0, 200) : "";
  const triggerCron =
    typeof obj.trigger_cron === "string" && isCronPresetKey(obj.trigger_cron)
      ? (obj.trigger_cron as CronPresetKey)
      : null;
  const filterNl =
    typeof obj.filter_nl === "string" ? obj.filter_nl.trim().slice(0, 600) : "";
  const promptTemplate =
    typeof obj.prompt_template === "string"
      ? obj.prompt_template.trim().slice(0, 2000)
      : "";

  if (!name || !triggerCron || !promptTemplate) return null;

  const lookbackHours = isLookbackHours(obj.lookback_hours)
    ? obj.lookback_hours
    : defaultLookbackForCron(triggerCron);

  return {
    name,
    description,
    trigger_cron: triggerCron,
    filter_nl: filterNl,
    prompt_template: promptTemplate,
    lookback_hours: lookbackHours,
  };
}

function extractFirstJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    const v = JSON.parse(cleaned);
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    const i = cleaned.indexOf("{");
    const j = cleaned.lastIndexOf("}");
    if (i >= 0 && j > i) {
      try {
        const v = JSON.parse(cleaned.slice(i, j + 1));
        return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
      } catch {}
    }
    return null;
  }
}

const NL_GENERATOR_SYSTEM = `You convert natural-language workflow requests into a Personal Agent workflow spec.

Available cadences (use these EXACT keys):
- "daily_8am": Every day at 8 AM
- "weekday_8am": Weekdays at 8 AM
- "weekday_6pm": Weekdays at 6 PM
- "monday_8am": Mondays at 8 AM
- "friday_4pm": Fridays at 4 PM
- "sunday_6pm": Sundays at 6 PM

Pick the cadence closest to the user's request. Default to "weekday_8am" if unclear.

Return STRICT JSON ONLY (no prose, no markdown fences) with this shape:
{
  "name": string,               // 3-6 words, descriptive
  "description": string,        // <= 160 chars, one sentence
  "trigger_cron": string,       // one of the keys above
  "filter_nl": string,          // 1-2 sentences describing what data to look at; empty string if no filter
  "prompt_template": string,    // 2-5 sentences telling the AI what to write each run
  "lookback_hours": number      // one of: 12, 24, 48, 72, 168, 336, 720
}

Guidance:
- The prompt_template is a SYSTEM prompt that the AI follows when the workflow fires. Write it in second person ("Write a 3-paragraph recap...").
- The filter_nl narrows the candidates BEFORE the prompt runs. Use it for things like "only emails about Acme" or "people I haven't talked to in 2 weeks." Leave empty for general digests.
- lookback_hours sets how far back the runner pulls emails + pages. Match it to the cadence and the prompt: daily / "overnight" → 24, every-2-days → 48, weekly recap → 168, monthly digest → 720. If the prompt says "this week," use 168 regardless of trigger.
- Never invent cadences. If the user says "every Tuesday" or "monthly," pick the closest preset and note the approximation in the description.`;

// Generates a draft workflow from a free-text user request. Does NOT persist.
// The caller (UI) shows the draft to the user for review + edits, then submits
// to POST /api/workflows to actually create it.
export async function generateWorkflowFromNL(
  userId: string,
  request: string
): Promise<WorkflowDraft | null> {
  const trimmed = request.trim().slice(0, 600);
  if (!trimmed) return null;

  let text: string;
  try {
    text = await callClaude(
      userId,
      SONNET,
      [{ role: "user", content: trimmed }],
      { system: NL_GENERATOR_SYSTEM, maxTokens: 600 }
    );
  } catch (err) {
    console.error(
      "[workflows] generate failed:",
      String((err as Error)?.message ?? err).slice(0, 200)
    );
    return null;
  }

  return parseWorkflowDraft(text);
}

// Returns workflows that are due to fire now. Runs as the admin role so it
// can see across all users (workflows is RLS-protected; the scheduler is an
// admin-style scan, not a per-tenant query). The per-row user_id is preserved
// for the runner, which still uses `withUser` for everything tenant-scoped.
export async function listDueWorkflows(now: Date = new Date()): Promise<
  Array<{ id: string; user_id: string }>
> {
  const admin = getAdminDb();
  const { rows } = await admin.query<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM workflows
      WHERE enabled = true AND next_run_at <= $1
      ORDER BY next_run_at ASC
      LIMIT 50`,
    [now]
  );
  return rows;
}
