import { getAdminDb, getMetaDb, withUser } from "./db";
import { decrypt } from "./crypto";
import { callClaude, HAIKU, SONNET } from "./anthropic";
import { loadUserContext, buildMemoriesBlock, summarizeRecentDownvotes } from "./digest";

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

// Compute the next firing time of a preset in the user's timezone, strictly
// after `after`. Works by stepping forward day-by-day (max 7 iterations) and
// resolving the IANA-tz hour via Intl.DateTimeFormat.
export function nextRunAtFromPreset(
  presetKey: CronPresetKey,
  timezone: string,
  after: Date = new Date()
): Date {
  const preset = CRON_PRESETS[presetKey];
  const tz = timezone && timezone.length > 0 ? timezone : "UTC";

  for (let dayOffset = 0; dayOffset < 8; dayOffset++) {
    // Compute the candidate day (relative to `after`).
    const candidate = new Date(after.getTime() + dayOffset * 24 * 60 * 60 * 1000);

    // Determine candidate's local weekday + render YYYY-MM-DD in that tz.
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

    if (preset.weekdays.length > 0 && !preset.weekdays.includes(dow)) continue;

    // Build the local-time wall-clock string and convert to UTC.
    // Trick: localTimestamp interpreted in `tz` => figure out the UTC instant.
    const localTimestamp = `${y}-${m}-${d}T${String(preset.hour).padStart(2, "0")}:00:00`;
    const fired = utcFromTzLocal(localTimestamp, tz);
    if (fired.getTime() > after.getTime()) return fired;
  }

  // Fallback (should not hit) — fire in 1 hour.
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
  trigger_cron: CronPresetKey;
  filter_nl: string;
  prompt_template: string;
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
  filter_nl: string;
  prompt_template: string;
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
    trigger_cron: r.trigger_cron as CronPresetKey,
    filter_nl: r.filter_nl,
    prompt_template: r.prompt_template,
    delivery_type: r.delivery_type as "in_app",
    enabled: r.enabled,
    last_run_at: r.last_run_at?.toISOString() ?? null,
    next_run_at: r.next_run_at.toISOString(),
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

export async function listWorkflows(userId: string): Promise<Workflow[]> {
  return withUser(userId, async (c) => {
    const { rows } = await c.query<WorkflowRow>(
      `SELECT id, user_id, name, description, trigger_cron, filter_nl,
              prompt_template, delivery_type, enabled, last_run_at, next_run_at,
              created_at, updated_at
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
      `SELECT id, user_id, name, description, trigger_cron, filter_nl,
              prompt_template, delivery_type, enabled, last_run_at, next_run_at,
              created_at, updated_at
         FROM workflows WHERE id = $1 LIMIT 1`,
      [id]
    );
    return rows[0] ? toWorkflow(rows[0]) : null;
  });
}

export interface CreateWorkflowInput {
  name: string;
  description?: string;
  trigger_cron: CronPresetKey;
  filter_nl?: string;
  prompt_template: string;
}

export async function createWorkflow(
  userId: string,
  input: CreateWorkflowInput,
  timezone: string
): Promise<Workflow> {
  const nextRun = nextRunAtFromPreset(input.trigger_cron, timezone);
  return withUser(userId, async (c) => {
    const { rows } = await c.query<WorkflowRow>(
      `INSERT INTO workflows
         (user_id, name, description, trigger_cron, filter_nl, prompt_template,
          delivery_type, enabled, next_run_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'in_app', true, $7)
       RETURNING id, user_id, name, description, trigger_cron, filter_nl,
                 prompt_template, delivery_type, enabled, last_run_at, next_run_at,
                 created_at, updated_at`,
      [
        userId,
        input.name.slice(0, 120),
        (input.description ?? "").slice(0, 400),
        input.trigger_cron,
        (input.filter_nl ?? "").slice(0, 600),
        input.prompt_template.slice(0, 2000),
        nextRun,
      ]
    );
    return toWorkflow(rows[0]);
  });
}

export interface UpdateWorkflowInput {
  name?: string;
  description?: string;
  trigger_cron?: CronPresetKey;
  filter_nl?: string;
  prompt_template?: string;
  enabled?: boolean;
}

export async function updateWorkflow(
  userId: string,
  id: string,
  input: UpdateWorkflowInput,
  timezone: string
): Promise<Workflow | null> {
  const next =
    input.trigger_cron !== undefined
      ? nextRunAtFromPreset(input.trigger_cron, timezone)
      : null;
  return withUser(userId, async (c) => {
    const { rows } = await c.query<WorkflowRow>(
      `UPDATE workflows SET
         name            = COALESCE($1, name),
         description     = COALESCE($2, description),
         trigger_cron    = COALESCE($3, trigger_cron),
         filter_nl       = COALESCE($4, filter_nl),
         prompt_template = COALESCE($5, prompt_template),
         enabled         = COALESCE($6, enabled),
         next_run_at     = COALESCE($7, next_run_at),
         updated_at      = now()
       WHERE id = $8
       RETURNING id, user_id, name, description, trigger_cron, filter_nl,
                 prompt_template, delivery_type, enabled, last_run_at, next_run_at,
                 created_at, updated_at`,
      [
        input.name?.slice(0, 120) ?? null,
        input.description?.slice(0, 400) ?? null,
        input.trigger_cron ?? null,
        input.filter_nl?.slice(0, 600) ?? null,
        input.prompt_template?.slice(0, 2000) ?? null,
        typeof input.enabled === "boolean" ? input.enabled : null,
        next,
        id,
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
      preview: (r.output_text ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
    }));
  });
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
async function workflowCandidates(userId: string): Promise<RunCandidate[]> {
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
          AND date_sent > now() - INTERVAL '14 days'
        ORDER BY date_sent DESC
        LIMIT 25`,
      [userId]
    ),
    withUser(userId, (c) =>
      c.query<{ slug: string; title: string; type: string | null; updated_at: Date; compiled_truth: string }>(
        `SELECT slug, title, type, updated_at, compiled_truth
           FROM pages
          WHERE updated_at > now() - INTERVAL '14 days'
          ORDER BY updated_at DESC
          LIMIT 10`
      )
    ),
    withUser(userId, (c) =>
      c.query<{ id: string; text: string; entity_slug: string | null; created_at: Date }>(
        `SELECT id, text, entity_slug, created_at
           FROM commitments
          WHERE status = 'open'
          ORDER BY created_at DESC
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
    out.push({
      ref: c.id,
      kind: "commitment",
      label: c.text.slice(0, 100),
      details: `commitment text="${c.text.slice(0, 200)}" slug=${c.entity_slug ?? "?"}`,
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

  const candidates = await workflowCandidates(userId);
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

      const synthUser = `<context>
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
    const nextRun = nextRunAtFromPreset(
      wf.trigger_cron,
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
  },
  {
    key: "weekly_recap",
    name: "Weekly recap",
    description: "Every Friday afternoon, recap the week.",
    trigger_cron: "friday_4pm",
    filter_nl: "anything that shifted on a project or person this week — decisions, blockers, status changes",
    prompt_template:
      "Write a 3-section Friday recap: (1) What shipped or got decided, (2) What's still in flight, (3) What might slip into next week. Be specific. Quote one direct phrase or excerpt per item where it would help the user remember.",
  },
  {
    key: "sunday_prep",
    name: "Sunday prep",
    description: "Sunday evening: what to know going into the week.",
    trigger_cron: "sunday_6pm",
    filter_nl: "open commitments + anyone who's waiting on my reply + any threads with action items pending",
    prompt_template:
      "Write a Sunday-evening 'prep me for the week' note. Lead with the 3 most important things on the user's plate. Then list anyone who's waiting on them. Tone: warm, direct, no hand-wringing.",
  },
  {
    key: "quiet_relationships",
    name: "Quiet relationships",
    description: "Mondays: people I haven't talked to recently.",
    trigger_cron: "monday_8am",
    filter_nl: "people pages where the underlying threads have gone quiet but used to be active",
    prompt_template:
      "List up to 5 people the user used to talk to but hasn't recently. For each, write one line: their name + the last subject/thread + how long ago. End with one suggestion of who to reach out to first and why.",
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

  return {
    name,
    description,
    trigger_cron: triggerCron,
    filter_nl: filterNl,
    prompt_template: promptTemplate,
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

const NL_GENERATOR_SYSTEM = `You convert natural-language workflow requests into a Mettrie workflow spec.

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
  "prompt_template": string     // 2-5 sentences telling the AI what to write each run
}

Guidance:
- The prompt_template is a SYSTEM prompt that the AI follows when the workflow fires. Write it in second person ("Write a 3-paragraph recap...").
- The filter_nl narrows the candidates BEFORE the prompt runs. Use it for things like "only emails about Acme" or "people I haven't talked to in 2 weeks." Leave empty for general digests.
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
