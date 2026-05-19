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

export interface ExtractionResult {
  worthExtracting: boolean;
  entities: ExtractedEntity[];
  commitments: string[];
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
  "commitments": string[],
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
- commitments: action items or promises, e.g. "Send proposal by Friday"
- confidence: 0–1 based on how clear and unambiguous the email content is
- If worth_extracting is false, return empty entities/commitments arrays

Return only valid JSON. No markdown fences, no commentary.`;

// Build the system prompt as a structured array so we can cache the large
// static prefix (BASE_SYSTEM_PROMPT, ~3K tokens, identical on every call)
// separately from the dynamic known-entities suffix that changes per user.
// During a sync burst, the static block is cached after the first call and
// every subsequent call within ~5 min skips it from ITPM accounting.
function buildSystemPrompt(knownEntities: KnownEntity[]): SystemPrompt {
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
  knownEntities: KnownEntity[] = []
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
    { system: buildSystemPrompt(knownEntities), maxTokens: 1024 }
  );

  // Strip markdown code fences if the model wrapped the JSON.
  const cleaned = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
  const parsed = JSON.parse(cleaned);

  return {
    worthExtracting: Boolean(parsed.worth_extracting),
    entities: (parsed.entities ?? []).map((e: any) => ({
      name: String(e.name),
      type: e.type as EntityType,
      slug: String(e.slug),
      claims: Array.isArray(e.claims) ? e.claims.map(String) : [],
      attributes: e.attributes && typeof e.attributes === "object" ? e.attributes : {},
    })),
    commitments: Array.isArray(parsed.commitments)
      ? parsed.commitments.map(String)
      : [],
    sentiment: parsed.sentiment ?? "neutral",
    confidence: Number(parsed.confidence ?? 0.5),
  };
}
