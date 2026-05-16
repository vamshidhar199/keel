import { getMetaDb, withUser } from "./db";
import { decrypt } from "./crypto";
import { callClaude, HAIKU } from "./anthropic";
import { listOpenCommitments, type OpenCommitment } from "./commitments";

export interface AwaitingReplyItem {
  thread_ref: string;
  from_addr: string;
  subject: string;
  date_sent: string;
}

export interface ActiveThreadItem {
  slug: string;
  title: string;
  type: string | null;
  updated_at: string;
}

export interface QuietItem {
  slug: string;
  title: string;
  type: string | null;
  days_quiet: number;
}

export interface RecipeCardItem {
  ref: string;        // page slug | thread_ref | commitment id (caller decides)
  kind: "page" | "thread" | "commitment" | "other";
  label: string;      // headline displayed
  why: string;        // one-line rationale from the LLM
}

export interface RecipeCardData {
  recipe_id: string;
  name: string;
  items: RecipeCardItem[];
}

export interface DigestMeta {
  gap_hours: number;
  memories_applied: boolean;
  downvotes_30d: number;
}

export interface DigestContent {
  greeting: string;
  generated_at: string;
  commitments: OpenCommitment[];
  awaiting_reply: AwaitingReplyItem[];
  active_threads: ActiveThreadItem[];
  quiet: QuietItem[];
  opportunities: OpportunityItem[];
  recipes: RecipeCardData[];
  meta: DigestMeta;
}

// ── User context (read once per compose) ─────────────────────────────────────

export interface UserContext {
  email: string;
  timezone: string;
  ai_memories: string;
  last_seen_at: Date | null;
}

export async function loadUserContext(userId: string): Promise<UserContext> {
  const db = getMetaDb();
  const [u, p] = await Promise.all([
    db.query<{ email: string | null; timezone: string | null; last_seen_at: Date | null }>(
      `SELECT email, timezone, last_seen_at FROM users WHERE id = $1`,
      [userId]
    ),
    db.query<{ ai_memories: string }>(
      `SELECT ai_memories FROM user_preferences WHERE user_id = $1`,
      [userId]
    ),
  ]);
  return {
    email: u.rows[0]?.email ?? "",
    timezone: u.rows[0]?.timezone ?? "UTC",
    ai_memories: p.rows[0]?.ai_memories ?? "",
    last_seen_at: u.rows[0]?.last_seen_at ?? null,
  };
}

// ── Gap computation (F4 — adaptive time window) ──────────────────────────────

export function gapHoursFor(lastSeenAt: Date | null): number {
  if (!lastSeenAt) return 0;
  const ms = Date.now() - new Date(lastSeenAt).getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60)));
}

// Adaptive window: 14d baseline for awaiting-reply, widen when gap > 30h.
// Caps at 30d so prompts stay bounded.
function awaitingWindowDays(gapHours: number): number {
  if (gapHours <= 30) return 14;
  return Math.min(30, Math.ceil(gapHours / 12));
}

// Active threads baseline 7d, widen up to 14d when gap warrants.
function activeWindowDays(gapHours: number): number {
  if (gapHours <= 30) return 7;
  return Math.min(14, Math.ceil(gapHours / 24) + 1);
}

// ── Per-section candidate queries ────────────────────────────────────────────

export async function listAwaitingReply(
  userId: string,
  userEmail: string,
  limit = 5,
  windowDays = 14
): Promise<AwaitingReplyItem[]> {
  const db = getMetaDb();
  const { rows } = await db.query<{
    thread_ref: string;
    from_addr: string;
    subject: string;
    date_sent: Date;
  }>(
    `SELECT DISTINCT ON (thread_ref)
        thread_ref, from_addr, subject, date_sent
     FROM raw_events
     WHERE user_id = $1 AND source = 'gmail'
       AND thread_ref IS NOT NULL
       AND date_sent > now() - ($2 || ' days')::interval
     ORDER BY thread_ref, date_sent DESC
     LIMIT 50`,
    [userId, windowDays]
  );

  const normalizedEmail = userEmail.toLowerCase();
  const decrypted = rows.map((r) => {
    const fromRaw = decrypt(r.from_addr) ?? "";
    const subjRaw = decrypt(r.subject) ?? "(no subject)";
    return {
      thread_ref: r.thread_ref,
      from_addr: fromRaw,
      subject: subjRaw,
      date_sent: r.date_sent.toISOString(),
    };
  });

  return decrypted
    .filter((r) => !r.from_addr.toLowerCase().includes(normalizedEmail))
    .slice(0, limit);
}

export async function listActiveThreads(
  userId: string,
  limit = 5,
  windowDays = 7
): Promise<ActiveThreadItem[]> {
  // "Active" means: type project/topic, recently touched, NOT a job listing, AND
  // the user has actually replied in at least one source thread. The engagement
  // check joins page_sources → raw_events → another raw_events row in the same
  // thread with is_from_user = true.
  return withUser(userId, async (c) => {
    const { rows } = await c.query<{
      slug: string;
      title: string;
      type: string | null;
      updated_at: Date;
    }>(
      `SELECT p.slug, p.title, p.type, p.updated_at
         FROM pages p
        WHERE p.type IN ('project', 'topic')
          AND p.updated_at > now() - ($1 || ' days')::interval
          AND (p.kind IS NULL OR p.kind <> 'job_listing')
          AND EXISTS (
            SELECT 1
              FROM page_sources ps
              JOIN raw_events src ON src.id = ps.raw_event_id
              JOIN raw_events mine ON mine.user_id = ps.user_id
                                   AND mine.thread_ref = src.thread_ref
                                   AND mine.thread_ref IS NOT NULL
                                   AND mine.is_from_user = true
             WHERE ps.page_id = p.id
          )
        ORDER BY p.updated_at DESC
        LIMIT $2`,
      [windowDays, limit]
    );
    return rows.map((r) => ({
      slug: r.slug,
      title: r.title,
      type: r.type,
      updated_at: r.updated_at.toISOString(),
    }));
  });
}

export interface OpportunityItem {
  slug: string;
  title: string;
  updated_at: string;
}

// Surface job-listing pages on their own card. Mirrors the active-threads age
// window but does NOT require engagement — opportunities by definition are
// inbound and haven't been replied to yet. Restricted to type='project' so
// companies and people that the extractor may have mis-tagged don't pollute.
export async function listOpportunities(
  userId: string,
  limit = 5,
  windowDays = 14
): Promise<OpportunityItem[]> {
  return withUser(userId, async (c) => {
    const { rows } = await c.query<{
      slug: string;
      title: string;
      updated_at: Date;
    }>(
      `SELECT slug, title, updated_at
         FROM pages
        WHERE kind = 'job_listing'
          AND type = 'project'
          AND updated_at > now() - ($1 || ' days')::interval
        ORDER BY updated_at DESC
        LIMIT $2`,
      [windowDays, limit]
    );
    return rows.map((r) => ({
      slug: r.slug,
      title: r.title,
      updated_at: r.updated_at.toISOString(),
    }));
  });
}

export async function listQuiet(
  userId: string,
  limit = 3
): Promise<QuietItem[]> {
  return withUser(userId, async (c) => {
    const { rows } = await c.query<{
      slug: string;
      title: string;
      type: string | null;
      updated_at: Date;
    }>(
      `SELECT slug, title, type, updated_at
       FROM pages
       WHERE type IN ('person', 'project')
         AND updated_at < now() - INTERVAL '14 days'
         AND updated_at > created_at + INTERVAL '7 days'
       ORDER BY updated_at DESC
       LIMIT $1`,
      [limit]
    );
    const now = Date.now();
    return rows.map((r) => ({
      slug: r.slug,
      title: r.title,
      type: r.type,
      days_quiet: Math.floor((now - r.updated_at.getTime()) / (1000 * 60 * 60 * 24)),
    }));
  });
}

// ── Feedback summarization (F2) ──────────────────────────────────────────────

export interface DownvoteSummary {
  total: number;
  bySection: Array<{ section: string; count: number }>;
}

export async function summarizeRecentDownvotes(
  userId: string
): Promise<DownvoteSummary> {
  return withUser(userId, async (c) => {
    const { rows } = await c.query<{ section: string; count: string }>(
      `SELECT section, COUNT(*)::text AS count
         FROM digest_feedback
        WHERE signal = -1
          AND created_at > now() - INTERVAL '30 days'
        GROUP BY section
        ORDER BY count DESC`
    );
    const bySection = rows.map((r) => ({ section: r.section, count: Number(r.count) }));
    const total = bySection.reduce((acc, r) => acc + r.count, 0);
    return { total, bySection };
  });
}

// ── Memories block (F1) ──────────────────────────────────────────────────────

export function buildMemoriesBlock(
  memories: string,
  downvotes: DownvoteSummary,
  gapHours: number
): string {
  const trimmedMemories = memories.trim();
  const parts: string[] = [];

  if (trimmedMemories.length > 0) {
    parts.push(
      `<user_memories>\n${trimmedMemories}\n</user_memories>`
    );
  }

  if (downvotes.total > 0) {
    const breakdown = downvotes.bySection
      .map((r) => `- ${r.section}: ${r.count}`)
      .join("\n");
    parts.push(
      `<feedback_signals>\nUser has thumbs-downed ${downvotes.total} items in the last 30 days:\n${breakdown}\nAvoid resurfacing the same kinds of items.\n</feedback_signals>`
    );
  }

  if (gapHours > 30) {
    const days = Math.floor(gapHours / 24);
    parts.push(
      `<presence>\nUser was last seen ${days >= 1 ? `${days} day${days === 1 ? "" : "s"}` : `${gapHours} hours`} ago. Acknowledge the gap naturally; do not pretend it's just another morning.\n</presence>`
    );
  }

  return parts.join("\n\n");
}

// ── Greeting (one tiny Haiku call) ───────────────────────────────────────────

async function generateGreeting(
  userId: string,
  counts: { commitments: number; awaiting: number; active: number; quiet: number; recipes: number; opportunities: number },
  memoriesBlock: string
): Promise<string> {
  const total =
    counts.commitments +
    counts.awaiting +
    counts.active +
    counts.quiet +
    counts.recipes +
    counts.opportunities;
  if (total === 0) {
    return "Quiet morning — ask me anything when you're ready.";
  }

  const summary = [
    counts.commitments > 0 ? `${counts.commitments} open promises` : null,
    counts.awaiting > 0 ? `${counts.awaiting} awaiting your reply` : null,
    counts.active > 0 ? `${counts.active} active threads this week` : null,
    counts.quiet > 0 ? `${counts.quiet} relationships gone quiet` : null,
    counts.opportunities > 0 ? `${counts.opportunities} new opportunities` : null,
    counts.recipes > 0 ? `${counts.recipes} custom cards` : null,
  ]
    .filter(Boolean)
    .join(", ");

  const system =
    "You are Mettrie, a personal knowledge assistant. Observant, direct, never sycophantic." +
    (memoriesBlock ? `\n\n${memoriesBlock}` : "");

  try {
    const text = await callClaude(
      userId,
      HAIKU,
      [
        {
          role: "user",
          content: `Today's snapshot: ${summary}.\n\nWrite ONE opening sentence for a daily brief — under 18 words. Reference the most prominent thing only; do not list numbers. Do not start with "Good morning", "Hello", or any greeting. No emojis. Honor the user_memories and presence context if provided.`,
        },
      ],
      { system, maxTokens: 80 }
    );
    return text.trim().replace(/^["']|["']$/g, "");
  } catch (err) {
    console.error(
      "[digest] greeting failed:",
      String((err as Error)?.message ?? err).slice(0, 200)
    );
    return "Here's where things stand today.";
  }
}

// ── Card recipes (F3) ────────────────────────────────────────────────────────

export interface CardRecipeRow {
  id: string;
  name: string;
  nl_rule: string;
}

export async function listEnabledRecipes(userId: string): Promise<CardRecipeRow[]> {
  return withUser(userId, async (c) => {
    const { rows } = await c.query<CardRecipeRow>(
      `SELECT id, name, nl_rule
         FROM card_recipes
        WHERE enabled = true
        ORDER BY sort_order ASC, created_at ASC
        LIMIT 5`
    );
    return rows;
  });
}

interface RecipeCandidate {
  ref: string;
  kind: RecipeCardItem["kind"];
  summary: string;
}

// Pull at most ~40 candidate items (recent emails + recently-touched pages) for
// the recipe LLM to filter against. Keeps token budget bounded.
async function recipeCandidates(userId: string): Promise<RecipeCandidate[]> {
  const db = getMetaDb();
  const [emails, pages] = await Promise.all([
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
          AND date_sent > now() - INTERVAL '7 days'
        ORDER BY date_sent DESC
        LIMIT 30`,
      [userId]
    ),
    withUser(userId, (c) =>
      c.query<{ slug: string; title: string; updated_at: Date }>(
        `SELECT slug, title, updated_at
           FROM pages
          WHERE updated_at > now() - INTERVAL '7 days'
          ORDER BY updated_at DESC
          LIMIT 15`
      )
    ),
  ]);

  const out: RecipeCandidate[] = [];

  for (const e of emails.rows) {
    if (!e.thread_ref) continue;
    const from = decrypt(e.from_addr ?? null) ?? "";
    const subj = decrypt(e.subject ?? null) ?? "(no subject)";
    const body = decrypt(e.body_text ?? null) ?? "";
    const snippet = body.slice(0, 240).replace(/\s+/g, " ").trim();
    out.push({
      ref: e.thread_ref,
      kind: "thread",
      summary: `from=${from.slice(0, 80)} subject="${subj.slice(0, 100)}" snippet="${snippet}"`,
    });
  }

  for (const p of pages.rows) {
    out.push({
      ref: p.slug,
      kind: "page",
      summary: `page title="${p.title}" slug=${p.slug}`,
    });
  }

  return out;
}

interface LlmRecipeResult {
  ref: string;
  label: string;
  why: string;
}

export async function runRecipe(
  userId: string,
  recipe: CardRecipeRow,
  memoriesBlock: string
): Promise<RecipeCardData> {
  const candidates = await recipeCandidates(userId);
  if (candidates.length === 0) {
    return { recipe_id: recipe.id, name: recipe.name, items: [] };
  }

  const candidateBlock = candidates
    .map((c, i) => `${i}. ref=${c.ref} kind=${c.kind} ${c.summary}`)
    .join("\n");

  const system =
    "You are Mettrie's recipe filter. Pick at most 5 candidates that match the user's natural-language rule. Return STRICT JSON: an array of {ref, label, why}. label = a short headline (<=80 chars). why = one short clause (<=80 chars) explaining the match. If nothing matches, return [].";

  const user = `${memoriesBlock ? memoriesBlock + "\n\n" : ""}<rule name="${recipe.name}">
${recipe.nl_rule}
</rule>

<candidates>
${candidateBlock}
</candidates>

Return ONLY the JSON array, no prose, no markdown fence.`;

  let text: string;
  try {
    text = await callClaude(
      userId,
      HAIKU,
      [{ role: "user", content: user }],
      { system, maxTokens: 700 }
    );
  } catch (err) {
    console.error(
      "[digest] recipe call failed:",
      String((err as Error)?.message ?? err).slice(0, 200)
    );
    return { recipe_id: recipe.id, name: recipe.name, items: [] };
  }

  const parsed = safeParseJsonArray(text);
  if (!parsed) {
    return { recipe_id: recipe.id, name: recipe.name, items: [] };
  }

  const byRef = new Map(candidates.map((c) => [c.ref, c]));
  const items: RecipeCardItem[] = [];
  for (const p of parsed.slice(0, 5)) {
    const cand = byRef.get(p.ref);
    if (!cand) continue;
    items.push({
      ref: p.ref,
      kind: cand.kind,
      label: typeof p.label === "string" ? p.label.slice(0, 200) : cand.summary.slice(0, 80),
      why: typeof p.why === "string" ? p.why.slice(0, 200) : "",
    });
  }

  return { recipe_id: recipe.id, name: recipe.name, items };
}

function safeParseJsonArray(text: string): LlmRecipeResult[] | null {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    const v = JSON.parse(cleaned);
    if (Array.isArray(v)) return v as LlmRecipeResult[];
    return null;
  } catch {
    // Try to locate the first '[' .. last ']' substring.
    const i = cleaned.indexOf("[");
    const j = cleaned.lastIndexOf("]");
    if (i >= 0 && j > i) {
      try {
        const v = JSON.parse(cleaned.slice(i, j + 1));
        if (Array.isArray(v)) return v as LlmRecipeResult[];
      } catch {}
    }
    return null;
  }
}

// ── Compose + read/write ─────────────────────────────────────────────────────

export async function composeDigest(
  userId: string,
  userEmail: string
): Promise<DigestContent> {
  const ctx = await loadUserContext(userId);
  const email = userEmail || ctx.email;
  const gapHours = gapHoursFor(ctx.last_seen_at);
  const awaitDays = awaitingWindowDays(gapHours);
  const activeDays = activeWindowDays(gapHours);

  const [commitments, awaiting_reply, active_threads, quiet, opportunities, downvotes, recipeRows] =
    await Promise.all([
      listOpenCommitments(userId, 5),
      listAwaitingReply(userId, email, 5, awaitDays),
      listActiveThreads(userId, 5, activeDays),
      listQuiet(userId, 3),
      listOpportunities(userId, 5),
      summarizeRecentDownvotes(userId),
      listEnabledRecipes(userId),
    ]);

  const memoriesBlock = buildMemoriesBlock(ctx.ai_memories, downvotes, gapHours);

  const recipes = await Promise.all(
    recipeRows.map((r) => runRecipe(userId, r, memoriesBlock))
  );

  const greeting = await generateGreeting(
    userId,
    {
      commitments: commitments.length,
      awaiting: awaiting_reply.length,
      active: active_threads.length,
      quiet: quiet.length,
      recipes: recipes.reduce((acc, r) => acc + r.items.length, 0),
      opportunities: opportunities.length,
    },
    memoriesBlock
  );

  return {
    greeting,
    generated_at: new Date().toISOString(),
    commitments,
    awaiting_reply,
    active_threads,
    quiet,
    opportunities,
    recipes,
    meta: {
      gap_hours: gapHours,
      memories_applied: ctx.ai_memories.trim().length > 0,
      downvotes_30d: downvotes.total,
    },
  };
}

export async function readDigest(
  userId: string,
  localDate: string
): Promise<{ id: string; content: DigestContent } | null> {
  return withUser(userId, async (c) => {
    const { rows } = await c.query<{ id: string; content: DigestContent }>(
      `SELECT id, content FROM digests WHERE local_date = $1 LIMIT 1`,
      [localDate]
    );
    return rows[0] ?? null;
  });
}

export async function writeDigest(
  userId: string,
  localDate: string,
  content: DigestContent
): Promise<string> {
  return withUser(userId, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO digests (user_id, local_date, content)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, local_date) DO UPDATE
         SET content = EXCLUDED.content, generated_at = now()
       RETURNING id`,
      [userId, localDate, JSON.stringify(content)]
    );
    return rows[0].id;
  });
}

export interface DigestWithId {
  id: string;
  content: DigestContent;
}

// Lazy-fires the digest if no row exists for today. Used by /overview's server
// fetch so a user opening the page before cron fires still gets a brief.
export async function getOrGenerateDigest(
  userId: string,
  userEmail: string,
  localDate: string
): Promise<DigestWithId> {
  const existing = await readDigest(userId, localDate);
  if (existing) return existing;

  const fresh = await composeDigest(userId, userEmail);
  const id = await writeDigest(userId, localDate, fresh);
  return { id, content: fresh };
}

// Resolve the user's local "today" date in YYYY-MM-DD format.
export function localDateFor(timezone: string | null | undefined): string {
  const tz = timezone && timezone.length > 0 ? timezone : "UTC";
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
}
