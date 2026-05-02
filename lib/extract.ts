import { callClaude, HAIKU } from "./anthropic";

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

const SYSTEM_PROMPT = `You are a business intelligence analyst extracting structured knowledge from emails.

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
- worth_extracting = false for: newsletters, marketing, automated notifications, receipts, spam, no-reply senders, list-unsubscribe emails
- worth_extracting = true for: real human correspondence, meeting follow-ups, business discussions, commitments, decisions
- slug format: people/first-last, companies/company-name, projects/project-name, topics/topic-name (all lowercase, hyphens only)
- claims: specific facts stated about the entity in this email (not vague)
- attributes: structured data e.g. { "role": "CTO", "needs_po": true, "company": "companies/acme" }
- commitments: action items or promises, e.g. "Send proposal by Friday"
- confidence: 0–1 based on how clear and unambiguous the email content is
- If worth_extracting is false, return empty entities/commitments arrays

Return only valid JSON. No markdown fences, no commentary.`;

export async function extractEmail(
  userId: string,
  event: {
    id: string;
    subject: string;
    from_addr: string;
    date_sent: string | null;
    body_text: string;
  }
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
    { system: SYSTEM_PROMPT, maxTokens: 1024 }
  );

  const parsed = JSON.parse(raw);

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
