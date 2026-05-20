import { callClaude, SONNET } from "./anthropic";
import { withUser } from "./db";
import type { ExtractedEntity } from "./extract";

export type KnownEntity = { slug: string; title: string; type: string };

export function parseFrontmatter(content: string): {
  title: string;
  type: string;
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { title: "", type: "", frontmatter: {}, body: content };

  const fmText = match[1];
  const body = match[2].trim();
  const frontmatter: Record<string, unknown> = {};

  for (const line of fmText.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const rawVal = line.slice(colonIdx + 1).trim();
    if (!key) continue;
    try {
      frontmatter[key] = JSON.parse(rawVal);
    } catch {
      frontmatter[key] = rawVal;
    }
  }

  return {
    title: typeof frontmatter.title === "string" ? frontmatter.title : "",
    type: typeof frontmatter.type === "string" ? frontmatter.type : "",
    frontmatter,
    body,
  };
}

// Pick only the known entities likely to be referenced by THIS event, so
// composePage doesn't ship the entire ~500-page wikilink dictionary on
// every call. Today's cost driver: a KB with 500 pages = ~10K input tokens
// of `knownEntities` list on every single compose call. After filtering,
// ~5-20 entities = ~500 tokens. No quality loss because the model only
// uses entries that actually appear in the prose anyway.
//
// Matching rules:
//   - Always a case-insensitive substring match on the full title.
//   - For type='person', also match individual name tokens (>= 3 chars) so
//     "John Smith" matches when the email just says "John". For other types
//     we only match the full title — partial matches like "Corp" or "Project"
//     are too noisy and would pull in irrelevant entries.
//   - Caps the result at 60 entries as a safety net. If somehow more match,
//     we keep the first-seen subset; the dictionary's job is help with the
//     common case, not be exhaustive.
const MAX_FILTERED_ENTITIES = 60;
export function filterRelevantEntities(
  known: KnownEntity[],
  haystack: string
): KnownEntity[] {
  if (known.length === 0) return [];
  const hay = haystack.toLowerCase();
  const out: KnownEntity[] = [];
  for (const e of known) {
    if (matchesHaystack(e, hay)) {
      out.push(e);
      if (out.length >= MAX_FILTERED_ENTITIES) break;
    }
  }
  return out;
}

function matchesHaystack(e: KnownEntity, hay: string): boolean {
  const title = e.title.toLowerCase().trim();
  if (title && hay.includes(title)) return true;
  if (e.type !== "person") return false;
  // For people, also try first/last name so first-name-only references match.
  for (const tok of title.split(/\s+/)) {
    if (tok.length >= 3 && hay.includes(tok)) return true;
  }
  return false;
}

// Cap existing page content sent to the LLM. Some pages get updated dozens
// of times and grow past 10K chars; sending the full body on every compose
// call multiplies token cost linearly with page age.
//
// Strategy: preserve the frontmatter intact (the model has to re-emit valid
// frontmatter with all attributes), then keep the FIRST 1K chars of body
// (preserves the page's stated identity / opening summary) and the LAST 2K
// chars (most recent context). Drop the middle with a marker.
//
// Tradeoff: when the body is truncated, the model will rewrite from what it
// sees — so middle history can be lost on the next composition. Acceptable
// for the small number of pages that hit this threshold; the alternative is
// runaway token cost. A future P3 "page consolidation" pass would rewrite
// long bodies into a denser form on a cadence, eliminating the tradeoff.
const TRUNCATE_THRESHOLD = 6000;
const TRUNCATE_HEAD = 1000;
const TRUNCATE_TAIL = 2000;
export function truncateExistingContent(content: string | null): string | null {
  if (!content || content.length <= TRUNCATE_THRESHOLD) return content;

  const fmMatch = content.match(/^---\n[\s\S]*?\n---\n?/);
  const fm = fmMatch ? fmMatch[0] : "";
  const body = content.slice(fm.length);

  if (body.length <= TRUNCATE_HEAD + TRUNCATE_TAIL) return content;

  const head = body.slice(0, TRUNCATE_HEAD).trimEnd();
  const tail = body.slice(-TRUNCATE_TAIL).trimStart();
  const dropped = body.length - TRUNCATE_HEAD - TRUNCATE_TAIL;
  return `${fm}${head}\n\n[... ${dropped} chars of older content omitted for context size; preserve only what's shown above and below ...]\n\n${tail}`;
}

// Fetch all pages currently in the user's knowledge base.
export async function getKnownEntities(userId: string): Promise<KnownEntity[]> {
  try {
    return await withUser(userId, async (c) => {
      const { rows } = await c.query<KnownEntity>(
        "SELECT slug, title, type FROM pages ORDER BY updated_at DESC LIMIT 500"
      );
      return rows;
    });
  } catch {
    return [];
  }
}

// Check if a page already exists. Tries exact slug, exact title, then fuzzy substring match.
export async function findExistingPage(
  userId: string,
  slug: string,
  entityName: string
): Promise<{ slug: string; content: string } | null> {
  return withUser(userId, async (c) => {
    const exact = await c.query<{ slug: string; compiled_truth: string }>(
      "SELECT slug, compiled_truth FROM pages WHERE slug = $1 LIMIT 1",
      [slug]
    );
    if (exact.rows[0]) {
      return { slug: exact.rows[0].slug, content: exact.rows[0].compiled_truth ?? "" };
    }

    const title = await c.query<{ slug: string; compiled_truth: string }>(
      "SELECT slug, compiled_truth FROM pages WHERE LOWER(title) = LOWER($1) LIMIT 1",
      [entityName]
    );
    if (title.rows[0]) {
      return { slug: title.rows[0].slug, content: title.rows[0].compiled_truth ?? "" };
    }

    const fuzzy = await c.query<{ slug: string; compiled_truth: string }>(
      `SELECT slug, compiled_truth FROM pages WHERE
       LOWER(title) LIKE '%' || LOWER($1) || '%'
       OR LOWER($1) LIKE '%' || LOWER(title) || '%'
       LIMIT 1`,
      [entityName]
    );
    if (fuzzy.rows[0]) {
      return { slug: fuzzy.rows[0].slug, content: fuzzy.rows[0].compiled_truth ?? "" };
    }

    return null;
  });
}

function serializeFrontmatter(fm: Record<string, unknown>): string {
  return Object.entries(fm)
    .map(([k, v]) => {
      if (typeof v === "string" && !v.includes(":") && !v.includes("\n")) {
        return `${k}: ${v}`;
      }
      if (typeof v === "number" || typeof v === "boolean") return `${k}: ${v}`;
      return `${k}: ${JSON.stringify(v)}`;
    })
    .join("\n");
}

const SYSTEM_PROMPT = `You are composing a gbrain knowledge-page for a business entity.

A gbrain page is a markdown file with YAML frontmatter followed by a body. Rules:
- Frontmatter: type, title, and any structured attributes (booleans, strings, arrays of slugs)
- Body: clear, specific prose about the entity — what is known, what was stated, any commitments
- If given existing content, integrate new information naturally; do not discard prior facts
- Evidence array in frontmatter should record where each claim came from
- Keep prose factual and concise; no filler phrases
- When referencing other entities in the body prose, use [[slug]] wikilink syntax (e.g. [[people/john-smith]], [[companies/acme]]). Only use [[slug]] for slugs that appear in the "Known entities" list provided. Do not invent slugs.
- Return ONLY the raw markdown content (--- frontmatter --- body). No code fences, no commentary.`;

export async function composePage(
  userId: string,
  entity: ExtractedEntity & { resolvedSlug: string },
  eventContext: {
    eventId: string;
    source: string;
    subject: string;
    fromAddr: string;
    dateSent: string | null;
  },
  existingContent: string | null,
  knownEntities: KnownEntity[] = []
): Promise<{ slug: string; content: string }> {
  const entityList =
    knownEntities.length > 0
      ? knownEntities.map((e) => `- ${e.slug} → ${e.title}`).join("\n")
      : "(none yet)";

  const cappedExisting = truncateExistingContent(existingContent);

  const userContent = [
    `Entity: ${entity.name} (type: ${entity.type}, slug: ${entity.resolvedSlug})`,
    ``,
    `Source event (${eventContext.source}):`,
    `  From: ${eventContext.fromAddr}`,
    `  Date: ${eventContext.dateSent ?? "unknown"}`,
    `  Subject: ${eventContext.subject}`,
    ``,
    `Claims extracted from this event:`,
    entity.claims.map((c) => `  - ${c}`).join("\n"),
    ``,
    `Attributes: ${JSON.stringify(entity.attributes)}`,
    ``,
    `Known entities (use [[slug]] when referencing these in body prose):`,
    entityList,
    ``,
    cappedExisting
      ? `Existing page content (update this, don't replace):\n${cappedExisting}`
      : `This is a NEW page — compose from scratch.`,
  ].join("\n");

  const markdown = await callClaude(userId, SONNET, [{ role: "user", content: userContent }], {
    system: SYSTEM_PROMPT,
    maxTokens: 2048,
  });

  const withEvidence = injectEvidence(
    markdown,
    eventContext.eventId,
    eventContext.source,
    eventContext.dateSent
  );

  return { slug: entity.resolvedSlug, content: withEvidence };
}

// Force the frontmatter's `evidence` key to a single canonical JSON array
// containing structured {event_id, source, date} entries. Whatever shape the
// LLM emitted (multi-line YAML list, missing entirely, prose) is wiped and
// replaced. This guarantees event_ids are preserved so page_sources backfills
// and engagement detection always have something to work with.
function injectEvidence(
  markdown: string,
  eventId: string,
  source: string,
  dateSent: string | null
): string {
  const fmMatch = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return markdown;

  // Parse existing evidence entries from the frontmatter, accepting both the
  // inline JSON-array form (`evidence: [...]`) and the multi-line YAML-list
  // form Sonnet sometimes emits (`evidence:\n  - foo`).
  const fmBody = fmMatch[1];
  const existing = readExistingEvidence(fmBody);

  // De-dup by event_id; append the new entry if not already present.
  const byEventId = new Map<string, EvidenceEntry>();
  for (const e of existing) {
    if (e.event_id) byEventId.set(e.event_id, e);
  }
  if (!byEventId.has(eventId)) {
    byEventId.set(eventId, { event_id: eventId, source, date: dateSent });
  }

  // Strip ALL existing `evidence:` blocks (inline or list form) before
  // re-inserting the canonical one.
  const stripped = stripEvidenceBlock(fmBody);
  const canonical =
    `evidence: ` +
    JSON.stringify([...byEventId.values()]);

  const newFmBody = stripped.trim().length > 0
    ? `${stripped.trimEnd()}\n${canonical}`
    : canonical;
  return markdown.replace(fmMatch[0], `---\n${newFmBody}\n---`);
}

interface EvidenceEntry {
  event_id?: string;
  source?: string;
  date?: string | null;
  // Legacy prose entries are preserved as a free-form note when no event_id.
  note?: string;
}

function readExistingEvidence(fmBody: string): EvidenceEntry[] {
  // Form A: inline JSON array — `evidence: [{...}, {...}]`
  const inline = fmBody.match(/evidence:\s*(\[[\s\S]*?\])/);
  if (inline) {
    try {
      const arr = JSON.parse(inline[1]);
      if (Array.isArray(arr)) {
        return arr
          .map((v): EvidenceEntry | null => {
            if (v && typeof v === "object") return v as EvidenceEntry;
            if (typeof v === "string") return { note: v };
            return null;
          })
          .filter((v): v is EvidenceEntry => v !== null);
      }
    } catch {
      // fall through to list form
    }
  }

  // Form B: YAML list — `evidence:\n  - foo\n  - bar`
  const list = fmBody.match(/evidence:\s*\n((?:\s+-\s+.*(?:\n|$))+)/);
  if (list) {
    return list[1]
      .split("\n")
      .map((line) => line.match(/^\s+-\s+(.*)$/)?.[1] ?? "")
      .filter((s) => s.length > 0)
      .map((s) => ({ note: s }));
  }

  return [];
}

function stripEvidenceBlock(fmBody: string): string {
  // Remove inline form first.
  let out = fmBody.replace(/^\s*evidence:\s*\[[\s\S]*?\]\s*$/m, "");
  // Then remove list form (key line + indented items).
  out = out.replace(/^\s*evidence:\s*\n(?:\s+-\s+.*(?:\n|$))+/m, "");
  return out;
}
