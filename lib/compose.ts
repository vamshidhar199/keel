import { callClaude, SONNET } from "./anthropic";
import { getGbrainDb } from "./db";
import type { ExtractedEntity } from "./extract";

export type KnownEntity = { slug: string; title: string; type: string };

// Fetch all pages currently in the user's gbrain DB.
// Called once per email in pipeline.ts and threaded to both extract and compose steps.
export async function getKnownEntities(userId: string): Promise<KnownEntity[]> {
  const db = getGbrainDb(userId);
  try {
    const { rows } = await db.query<KnownEntity>(
      "SELECT slug, title, type FROM pages ORDER BY updated_at DESC LIMIT 500"
    );
    return rows;
  } catch {
    return [];
  } finally {
    await db.end();
  }
}

// Check if a page already exists in the user's gbrain DB.
// Tries exact slug, exact title, then fuzzy substring match.
export async function findExistingPage(
  userId: string,
  slug: string,
  entityName: string
): Promise<{ slug: string; content: string } | null> {
  const db = getGbrainDb(userId);
  try {
    // 1. Exact slug match.
    const exact = await db.query<{ slug: string; compiled_truth: string }>(
      "SELECT slug, compiled_truth FROM pages WHERE slug = $1 LIMIT 1",
      [slug]
    );
    if (exact.rows[0]) {
      return { slug: exact.rows[0].slug, content: exact.rows[0].compiled_truth ?? "" };
    }

    // 2. Exact title match (handles slug drift like people/john vs people/john-smith).
    const title = await db.query<{ slug: string; compiled_truth: string }>(
      "SELECT slug, compiled_truth FROM pages WHERE LOWER(title) = LOWER($1) LIMIT 1",
      [entityName]
    );
    if (title.rows[0]) {
      return { slug: title.rows[0].slug, content: title.rows[0].compiled_truth ?? "" };
    }

    // 3. Fuzzy: entity name contained in title, or title contained in entity name.
    //    Catches "Vamshidhar" matching "Vamshidhar Reddy" and vice versa.
    const fuzzy = await db.query<{ slug: string; compiled_truth: string }>(
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
  } finally {
    await db.end();
  }
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
  emailContext: {
    eventId: string;
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

  const userContent = [
    `Entity: ${entity.name} (type: ${entity.type}, slug: ${entity.resolvedSlug})`,
    ``,
    `Email context:`,
    `  From: ${emailContext.fromAddr}`,
    `  Date: ${emailContext.dateSent ?? "unknown"}`,
    `  Subject: ${emailContext.subject}`,
    ``,
    `Claims extracted from this email:`,
    entity.claims.map((c) => `  - ${c}`).join("\n"),
    ``,
    `Attributes: ${JSON.stringify(entity.attributes)}`,
    ``,
    `Known entities (use [[slug]] when referencing these in body prose):`,
    entityList,
    ``,
    existingContent
      ? `Existing page content (update this, don't replace):\n${existingContent}`
      : `This is a NEW page — compose from scratch.`,
  ].join("\n");

  const markdown = await callClaude(userId, SONNET, [{ role: "user", content: userContent }], {
    system: SYSTEM_PROMPT,
    maxTokens: 2048,
  });

  const withEvidence = injectEvidence(markdown, emailContext.eventId, emailContext.dateSent);

  return { slug: entity.resolvedSlug, content: withEvidence };
}

function injectEvidence(markdown: string, eventId: string, dateSent: string | null): string {
  const fmMatch = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return markdown;

  const fmBody = fmMatch[1];
  if (fmBody.includes(eventId)) return markdown;

  const evidenceEntry = JSON.stringify({ event_id: eventId, source: "gmail", date: dateSent });
  const updatedFm = fmBody.includes("evidence:")
    ? fmBody.replace(/evidence:\s*\[([^\]]*)\]/, (_, items) => {
        const trimmed = items.trim();
        return `evidence: [${trimmed ? trimmed + ", " : ""}${evidenceEntry}]`;
      })
    : fmBody + `\nevidence: [${evidenceEntry}]`;

  return markdown.replace(fmMatch[0], `---\n${updatedFm}\n---`);
}
