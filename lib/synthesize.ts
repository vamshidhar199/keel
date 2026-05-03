import { callClaude, SONNET } from "./anthropic";
import type { BrainSearchHit } from "./gbrain";

export interface SynthesizedAnswer {
  answer: string;
  citations: { chunk_id: number; slug: string; title: string }[];
  invalidCitations: number[];
}

const SYSTEM_PROMPT = `You answer questions strictly from a personal knowledge base.

Rules:
- Use ONLY the facts in the provided sources. If the sources don't contain the answer, say so plainly — do not invent or extrapolate.
- After every claim, cite the source as [chunk:N] where N is the chunk_id of the source. Multiple citations allowed: [chunk:3][chunk:7].
- Be specific and concise. Quote names, dates, numbers verbatim from sources.
- If the user asks "who" or "what" and the sources only contain partial info, give the partial answer plus what's missing.
- No filler ("Based on the sources provided..."). Just answer.`;

function formatSources(hits: BrainSearchHit[]): string {
  if (hits.length === 0) return "(no sources found)";
  return hits
    .map(
      (h) =>
        `[chunk:${h.chunk_id}] (${h.slug} — ${h.title})\n${h.chunk_text.trim()}`
    )
    .join("\n\n---\n\n");
}

// Parse [chunk:N] tags from the answer and verify each N is a real chunk_id from the hits.
// Returns the chunk_ids that were cited but not in the hits list (hallucinated citations).
function validateCitations(
  answer: string,
  hits: BrainSearchHit[]
): { cited: Set<number>; invalid: number[] } {
  const validIds = new Set(hits.map((h) => h.chunk_id));
  const cited = new Set<number>();
  const invalid: number[] = [];

  const re = /\[chunk:(\d+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(answer)) !== null) {
    const id = parseInt(match[1], 10);
    if (validIds.has(id)) {
      cited.add(id);
    } else if (!invalid.includes(id)) {
      invalid.push(id);
    }
  }
  return { cited, invalid };
}

export async function synthesizeAnswer(
  userId: string,
  question: string,
  hits: BrainSearchHit[],
  userName?: string | null,
  history?: { role: "user" | "assistant"; content: string }[]
): Promise<SynthesizedAnswer> {
  const today = new Date().toISOString().slice(0, 10);
  const ownerLine = userName
    ? `This knowledge base belongs to ${userName}. When the answer refers to ${userName}, use "you" / "your" instead of their name.`
    : "";

  const system = [SYSTEM_PROMPT, ownerLine].filter(Boolean).join("\n\n");

  const currentTurn = [
    `Today's date: ${today}`,
    ``,
    `Question: ${question}`,
    ``,
    `Sources:`,
    formatSources(hits),
  ].join("\n");

  const messages = [
    ...(history ?? []),
    { role: "user" as const, content: currentTurn },
  ];

  const answer = await callClaude(userId, SONNET, messages, { system, maxTokens: 1024 });

  const { cited, invalid } = validateCitations(answer, hits);
  const citations = hits
    .filter((h) => cited.has(h.chunk_id))
    .map((h) => ({ chunk_id: h.chunk_id, slug: h.slug, title: h.title }));

  return { answer, citations, invalidCitations: invalid };
}
