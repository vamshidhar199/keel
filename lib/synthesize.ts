import { callClaudeWithWebSearch, SONNET } from "./anthropic";
import type { BrainSearchHit } from "./gbrain";

export interface SynthesizedAnswer {
  answer: string;
  citations: { chunk_id: number; slug: string; title: string }[];
  webCitations: { id: number; title: string; url: string }[];
  invalidCitations: number[];
}

const SYSTEM_PROMPT = `You answer questions using a personal knowledge base and web search.

Personal knowledge base sources are labeled [chunk:N] — these are facts from the user's own emails and communications. Cite every personal knowledge base claim as [chunk:N].

You also have access to web search. Use it to supplement with general or public information not covered by the personal sources. When you use web information, make it clearly distinct from personal knowledge (e.g. "Publicly, [company] is known for...").

Rules:
- Prefer personal knowledge base for anything about the user's own work, relationships, or history.
- Use web search for general company info, public facts, or context the personal sources don't cover.
- Be specific and concise. No filler phrases.`;

function formatSources(hits: BrainSearchHit[]): string {
  if (hits.length === 0) return "(no personal sources found)";
  return hits
    .map((h) => `[chunk:${h.chunk_id}] (${h.slug} — ${h.title})\n${h.chunk_text.trim()}`)
    .join("\n\n---\n\n");
}

function validateChunkCitations(
  answer: string,
  hits: BrainSearchHit[]
): { cited: Set<number>; invalid: number[] } {
  const validIds = new Set(hits.map((h) => h.chunk_id));
  const cited = new Set<number>();
  const invalid: number[] = [];

  const re = /\[chunk:(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(answer)) !== null) {
    const id = parseInt(m[1], 10);
    if (validIds.has(id)) cited.add(id);
    else if (!invalid.includes(id)) invalid.push(id);
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
    `Personal Knowledge Base:`,
    formatSources(hits),
  ].join("\n");

  const messages = [
    ...(history ?? []),
    { role: "user" as const, content: currentTurn },
  ];

  const { text: answer, webCitations: rawWeb } = await callClaudeWithWebSearch(
    userId,
    SONNET,
    messages,
    { system, maxTokens: 1024 }
  );

  const { cited, invalid } = validateChunkCitations(answer, hits);

  const citations = hits
    .filter((h) => cited.has(h.chunk_id))
    .map((h) => ({ chunk_id: h.chunk_id, slug: h.slug, title: h.title }));

  const webCitations = rawWeb.map((w, i) => ({ id: i + 1, title: w.title, url: w.url }));

  return { answer, citations, webCitations, invalidCitations: invalid };
}
