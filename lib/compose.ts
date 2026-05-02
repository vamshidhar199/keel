import { callClaude, SONNET } from "./anthropic";
import { getGbrainDb } from "./db";
import type { ExtractedEntity } from "./extract";

// Check if a page already exists in the user's gbrain DB.
export async function findExistingPage(
  userId: string,
  slug: string,
  entityName: string
): Promise<{ slug: string; content: string } | null> {
  const db = getGbrainDb(userId);
  try {
    // Exact slug match first.
    const exact = await db.query<{ slug: string; compiled_truth: string }>(
      "SELECT slug, compiled_truth FROM pages WHERE slug = $1 LIMIT 1",
      [slug]
    );
    if (exact.rows[0]) {
      return { slug: exact.rows[0].slug, content: exact.rows[0].compiled_truth ?? "" };
    }

    // Title match (handles slug drift like people/john vs people/john-smith).
    const title = await db.query<{ slug: string; compiled_truth: string }>(
      "SELECT slug, compiled_truth FROM pages WHERE LOWER(title) = LOWER($1) LIMIT 1",
      [entityName]
    );
    if (title.rows[0]) {
      return { slug: title.rows[0].slug, content: title.rows[0].compiled_truth ?? "" };
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
  existingContent: string | null
): Promise<{ slug: string; content: string }> {
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
    existingContent
      ? `Existing page content (update this, don't replace):\n${existingContent}`
      : `This is a NEW page — compose from scratch.`,
  ].join("\n");

  const markdown = await callClaude(userId, SONNET, [{ role: "user", content: userContent }], {
    system: SYSTEM_PROMPT,
    maxTokens: 2048,
  });

  // Ensure evidence block in frontmatter includes the source event.
  // We post-process the returned markdown to inject the event reference
  // into the frontmatter if Sonnet didn't include it.
  const withEvidence = injectEvidence(markdown, emailContext.eventId, emailContext.dateSent);

  return { slug: entity.resolvedSlug, content: withEvidence };
}

function injectEvidence(markdown: string, eventId: string, dateSent: string | null): string {
  const fmMatch = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return markdown;

  const fmBody = fmMatch[1];
  if (fmBody.includes(eventId)) return markdown; // already referenced

  const evidenceEntry = JSON.stringify({ event_id: eventId, source: "gmail", date: dateSent });
  const updatedFm = fmBody.includes("evidence:")
    ? fmBody.replace(/evidence:\s*\[([^\]]*)\]/, (_, items) => {
        const trimmed = items.trim();
        return `evidence: [${trimmed ? trimmed + ", " : ""}${evidenceEntry}]`;
      })
    : fmBody + `\nevidence: [${evidenceEntry}]`;

  return markdown.replace(fmMatch[0], `---\n${updatedFm}\n---`);
}
