import { auth } from "@/auth";
import { withUser } from "@/lib/db";
import { getOrGenerate } from "@/lib/briefing";
import { callClaude, HAIKU } from "@/lib/anthropic";
import { listSkills } from "@/lib/skills";
import { AskClient } from "./ask-client";

const TTL = 3600;

function todayKey(prefix: string): string {
  return `${prefix}:${new Date().toISOString().slice(0, 10)}`;
}

export default async function AskPage() {
  const session = await auth();
  const userId = session!.user!.id;

  // Exclude job_listing pages from /ask grounding — those are inbound
  // opportunities the user is exploring, not work they've done. Letting them
  // through generates wrong questions like "How long did I work at OpenAI?"
  // for users who only ever *applied* there.
  //
  // We pull compiled_truth (snippetted) along with title/type so the
  // suggestion model has REAL content to ground on. Without snippets the
  // model only sees a list of names and invents speculative connections
  // ("How does X compare to Y", "Is A connected to B").
  const [recentPages, skills] = await Promise.all([
    withUser(userId, async (c) => {
      const { rows } = await c.query<{
        title: string;
        type: string | null;
        compiled_truth: string;
      }>(
        `SELECT title, type, compiled_truth
           FROM pages
          WHERE (kind IS NULL OR kind <> 'job_listing')
          ORDER BY updated_at DESC
          LIMIT 5`
      );
      return rows;
    }),
    listSkills(userId, true),
  ]);

  const pickerSkills = skills.map((s) => ({
    id: s.id,
    name: s.name,
    slug: s.slug,
    description: s.description,
  }));

  if (recentPages.length < 5) {
    return <AskClient opener={null} suggestions={null} skills={pickerSkills} />;
  }

  // Strip frontmatter, collapse whitespace, take first ~180 chars. Enough
  // for the model to know what each page is about without exploding tokens.
  function snippet(content: string): string {
    const body = content.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
    const flat = body.replace(/\s+/g, " ").trim();
    return flat.length > 180 ? flat.slice(0, 180) + "…" : flat;
  }
  const pageList = recentPages
    .map((p) => `- ${p.title}${p.type ? ` (${p.type})` : ""}: ${snippet(p.compiled_truth)}`)
    .join("\n");

  // If an LLM call fails (e.g. exhausted credits, rate limit), render the
  // page without that piece rather than crashing the whole route.
  // Promise.allSettled keeps the cache uncorrupted because getOrGenerate
  // only writes when the generator resolves.
  const settled = await Promise.allSettled([
    getOrGenerate(userId, todayKey("ask_opener"), TTL, async () => {
      const last24h = await withUser(userId, async (client) => {
        const { rows } = await client.query<{ title: string; type: string | null }>(
          `SELECT title, type FROM pages
           WHERE user_id = $1 AND updated_at > NOW() - INTERVAL '24 hours'
             AND (kind IS NULL OR kind <> 'job_listing')
           ORDER BY updated_at DESC LIMIT 20`,
          [userId]
        );
        return rows;
      });
      if (last24h.length === 0) return null;
      const context = last24h
        .map((p) => `- ${p.title}${p.type ? ` (${p.type})` : ""}`)
        .join("\n");
      return callClaude(
        userId,
        HAIKU,
        [
          {
            role: "user",
            content: `Pages updated in the last 24 hours:\n${context}\n\nWrite 1-2 short sentences (35 words MAX total) about what you notice. Start with "I noticed", "I've been watching", or similar. Name one specific topic, person, or theme — don't list everything. Don't use "great", "amazing", or "excited". No em dashes longer than the rest of the sentence.`,
          },
        ],
        {
          system:
            "You are Keel, the user's personal knowledge system. You speak in first person. You are observant and direct — never sycophantic. Brevity over completeness.",
          maxTokens: 120,
        }
      );
    }),

    getOrGenerate(userId, todayKey("ask_suggestions_v2"), TTL, async () => {
      const raw = await callClaude(
        userId,
        HAIKU,
        [
          {
            role: "user",
            content: `The 5 most recent pages in this user's knowledge base (with content snippets):
${pageList}

Generate exactly 3 short questions (8 words MAX each) the user would actually want to ask about this content.

STRICT RULES — violating any of these means the question is wrong:
- Every question must be answerable from the snippets shown above. If a fact isn't in a snippet, don't ask about it.
- NEVER ask if two entities are "connected", "linked", or "related" unless a snippet explicitly says they are.
- NEVER ask to "compare X to Y" unless both appear in the SAME snippet.
- NEVER ask about financial/market/public information that isn't in the snippets (e.g. "How does Amazon compare to IEEE financially?" is wrong because the snippets are about the USER's interactions, not public data).
- Each question must reference a specific person, project, role, decision, or claim that appears in the snippets.
- If the 5 pages don't share enough signal for 3 grounded questions, return fewer — never invent.

Return ONLY a JSON array. Start with [ and end with ]. No markdown, no code fences, no preamble.

Good examples (grounded in specific content): ["What did Harry C want to discuss?", "Status of the ServiceNow proposal?", "What's outstanding with Rahul?"]
Bad examples (speculative or generic): ["How does X compare to Y?", "Is A connected to B?", "Who's most active this week?"]`,
          },
        ],
        {
          system:
            "You are Keel. Generate questions strictly grounded in the user's actual data. Never speculate about connections between entities. Output ONLY a JSON array — no other text.",
          maxTokens: 200,
        }
      );
      const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      try {
        const parsed = JSON.parse(cleaned);
        if (Array.isArray(parsed) && parsed.every((q) => typeof q === "string")) {
          return parsed;
        }
        console.warn("[ask] suggestions parsed but not string[]:", cleaned.slice(0, 200));
        return null;
      } catch {
        console.warn("[ask] suggestions JSON parse failed; raw:", raw.slice(0, 200));
        return null;
      }
    }),
  ]);

  for (const r of settled) {
    if (r.status === "rejected") {
      console.warn("[ask] LLM call failed, rendering without it:", r.reason);
    }
  }
  const openerRaw = settled[0].status === "fulfilled" ? settled[0].value : null;
  const suggestionsRaw = settled[1].status === "fulfilled" ? settled[1].value : null;

  const icons = ["trending_up", "groups", "description"] as const;
  const statVars = ["stat2", "stat1", "stat3"] as const;

  const suggestions =
    Array.isArray(suggestionsRaw)
      ? (suggestionsRaw as string[]).slice(0, 3).map((label, i) => ({
          icon: icons[i],
          label,
          statVar: statVars[i],
        }))
      : null;

  const opener = typeof openerRaw === "string" ? openerRaw : null;

  return <AskClient opener={opener} suggestions={suggestions} skills={pickerSkills} />;
}
