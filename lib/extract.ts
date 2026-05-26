import { callClaude, HAIKU, type SystemPrompt } from "./anthropic";
import type { KnownEntity } from "./compose";

export type EntityType = "person" | "company" | "project" | "topic";

export interface ExtractedEntity {
  name: string;
  type: EntityType;
  slug: string;
  claims: string[];
  attributes: Record<string, unknown>;
}

export interface OpenCommitmentContext {
  id: string;
  text: string;
  entitySlugs: string[];
}

export type CommitmentAction =
  | { action: "create"; text: string; entitySlugs: string[] }
  | { action: "update"; existingId: string; text: string; entitySlugs: string[] };

export interface ExtractionResult {
  worthExtracting: boolean;
  entities: ExtractedEntity[];
  commitmentActions: CommitmentAction[];
  resolvedCommitmentIds: string[];
  sentiment: "positive" | "neutral" | "negative";
  confidence: number;
}

const BASE_SYSTEM_PROMPT = `You are a business intelligence analyst extracting structured knowledge from emails.

Return a JSON object with this exact schema:
{
  "worth_extracting": boolean,
  "entities": [
    {
      "name": string,
      "type": "person" | "company" | "project" | "topic",
      "slug": string,
      "claims": string[],
      "attributes": {}
    }
  ],
  "commitment_actions": [
    {
      "action": "create" | "update",
      "existing_id": string | null,
      "text": string,
      "entity_slugs": string[]
    }
  ],
  "resolved_commitment_ids": string[],
  "sentiment": "positive" | "neutral" | "negative",
  "confidence": number
}

Rules:
- worth_extracting = false for: promotional/marketing emails, sale announcements, generic newsletters, automated receipts/order confirmations, spam
- worth_extracting = true for: job opportunities, business proposals, meeting requests, personal correspondence, commitments, decisions, professional updates about specific people/companies/roles
- Judge by CONTENT INTENT not sender address — a no-reply sender can still contain valuable signal (e.g. a job opportunity, a business update)
- slug format: people/first-last, companies/company-name, projects/project-name, topics/topic-name (all lowercase, hyphens only)
- CRITICAL: If an entity matches one listed in "Known entities" below, use EXACTLY that slug — do not invent a new one
- claims: specific facts stated about the entity in this email (not vague)
- attributes: structured data e.g. { "role": "CTO", "needs_po": true, "company": "companies/acme" }
- IMPORTANT: For inbound job opportunities (recruiter pitches, job listings, open-roles emails), classify the role/listing itself as type="project" AND set attributes.kind = "job_listing". Examples of entities that GET this tag: "Senior Software Engineer at Acme", "Forward Deployed Engineer", "Platform Developer - AI Builder". Entities that MUST NOT get kind="job_listing": the company posting the role (companies/acme), the recruiter (people/jane-doe), the hiring manager. The kind tag describes the listing only — never apply it to a related person or company entity, even if they appear in the same email. Genuine projects the user is working on do not get kind="job_listing".

commitment_actions — handle action items / promises mentioned in this email:
- For each commitment in this email, decide ONE action:
  - action="update" with existing_id set: this commitment is a rephrasing, refinement, or follow-up of an existing open commitment listed under "Open commitments" below. Set text to the best current phrasing (clearer/more specific wins). Do NOT pick "update" just because the topic is similar — only when it's clearly the same promise.
  - action="create" with existing_id=null: genuinely new commitment not represented in the open list.
- entity_slugs: ALL relevant entity slugs from the entities array above (typically the people, companies, and projects involved). Multiple slugs are normal and desired. Empty array only if no entity applies.
- Be CONSERVATIVE about creating new commitments. If in doubt between create/update, prefer update.
- Phrase commitments concisely as the action itself, e.g. "Gabriel to review resume and follow up on Tech Lead Manager role at Mosaic". Do not start with "Commitment:" or filler.

resolved_commitment_ids — list ids from "Open commitments" below that THIS email closes out:
- The email shows the promise was fulfilled (e.g. the resume feedback was actually sent, the intro was made, the proposal was delivered).
- Or the promise is now moot (the role was filled, the deal fell through, the meeting happened).
- Only include ids that are clearly resolved — when uncertain, leave them out.

- confidence: 0–1 based on how clear and unambiguous the email content is
- If worth_extracting is false, return empty entities/commitment_actions/resolved_commitment_ids arrays

Return only valid JSON. No markdown fences, no commentary.`;

// Build the system prompt as a structured array so we can cache the large
// static prefix (BASE_SYSTEM_PROMPT, ~3K tokens, identical on every call)
// separately from the dynamic known-entities + open-commitments suffix that
// changes per user (and per event, for the commitments block). During a sync
// burst, the static block is cached after the first call and every subsequent
// call within ~5 min skips it from ITPM accounting.
function buildSystemPrompt(
  knownEntities: KnownEntity[],
  openCommitments: OpenCommitmentContext[]
): SystemPrompt {
  const blocks: SystemPrompt = [
    {
      type: "text",
      text: BASE_SYSTEM_PROMPT,
      cache_control: { type: "ephemeral" },
    },
  ];
  if (knownEntities.length > 0) {
    const list = knownEntities
      .map((e) => `  - ${e.slug} → ${e.title} (${e.type})`)
      .join("\n");
    blocks.push({
      type: "text",
      text: `\n\nKnown entities — use these slugs exactly if an entity matches:\n${list}`,
    });
  }
  if (openCommitments.length > 0) {
    const list = openCommitments
      .map((c) => {
        const slugs = c.entitySlugs.length > 0 ? c.entitySlugs.join(", ") : "—";
        return `  - id=${c.id} [${slugs}] "${c.text.replace(/"/g, '\\"').slice(0, 240)}"`;
      })
      .join("\n");
    blocks.push({
      type: "text",
      text: `\n\nOpen commitments — currently tracked promises. If this email rephrases / refines one, use action="update" with its id. If it fulfills one, list the id under resolved_commitment_ids:\n${list}`,
    });
  }
  return blocks;
}

export async function extractEmail(
  userId: string,
  event: {
    id: string;
    subject: string;
    from_addr: string;
    date_sent: string | null;
    body_text: string;
  },
  knownEntities: KnownEntity[] = [],
  openCommitments: OpenCommitmentContext[] = []
): Promise<ExtractionResult> {
  const emailContent = [
    `From: ${event.from_addr}`,
    `Date: ${event.date_sent ?? "unknown"}`,
    `Subject: ${event.subject}`,
    ``,
    event.body_text.slice(0, 3000), // cap at 3000 chars to keep tokens low
  ].join("\n");

  const raw = await callClaude(
    userId,
    HAIKU,
    [{ role: "user", content: emailContent }],
    { system: buildSystemPrompt(knownEntities, openCommitments), maxTokens: 1024 }
  );

  // Haiku occasionally wraps the JSON in markdown fences, prepends a preamble
  // ("Here's the JSON:"), or appends commentary. Slicing from the first `{` to
  // the last `}` recovers a parseable object from any of those without an
  // extra LLM call. Diagnostic logging on parse failure: previously the raw
  // model output was lost, making it impossible to learn from misses.
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    console.warn(`[extract] event=${event.id} no JSON object in response: ${raw.slice(0, 200)}`);
    throw new Error("no JSON object in Haiku response");
  }
  let parsed: any;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch (err) {
    console.warn(`[extract] event=${event.id} JSON parse failed: ${raw.slice(0, 200)}`);
    throw err;
  }

  // Set of valid existing-commitment ids so we can defensively drop any id the
  // LLM hallucinates back at us.
  const openIds = new Set(openCommitments.map((c) => c.id));

  const commitmentActions: CommitmentAction[] = [];
  for (const a of parsed.commitment_actions ?? []) {
    const text = typeof a?.text === "string" ? a.text.trim() : "";
    if (!text) continue;
    const entitySlugs: string[] = Array.isArray(a?.entity_slugs)
      ? Array.from(new Set<string>(a.entity_slugs.map((s: unknown) => String(s)).filter(Boolean)))
      : [];
    if (a?.action === "update" && typeof a?.existing_id === "string" && openIds.has(a.existing_id)) {
      commitmentActions.push({ action: "update", existingId: a.existing_id, text, entitySlugs });
    } else {
      commitmentActions.push({ action: "create", text, entitySlugs });
    }
  }

  const resolvedCommitmentIds: string[] = Array.isArray(parsed.resolved_commitment_ids)
    ? Array.from(
        new Set<string>(parsed.resolved_commitment_ids.map((s: unknown) => String(s)))
      ).filter((id) => openIds.has(id))
    : [];

  return {
    worthExtracting: Boolean(parsed.worth_extracting),
    entities: (parsed.entities ?? []).map((e: any) => ({
      name: String(e.name),
      type: e.type as EntityType,
      slug: String(e.slug),
      claims: Array.isArray(e.claims) ? e.claims.map(String) : [],
      attributes: e.attributes && typeof e.attributes === "object" ? e.attributes : {},
    })),
    commitmentActions,
    resolvedCommitmentIds,
    sentiment: parsed.sentiment ?? "neutral",
    confidence: Number(parsed.confidence ?? 0.5),
  };
}
