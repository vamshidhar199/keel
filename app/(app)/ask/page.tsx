import { auth } from "@/auth";
import { listPages } from "@/lib/gbrain";
import { withUser } from "@/lib/db";
import { getOrGenerate } from "@/lib/briefing";
import { callClaude, HAIKU } from "@/lib/anthropic";
import { AskClient } from "./ask-client";

const TTL = 3600;

function todayKey(prefix: string): string {
  return `${prefix}:${new Date().toISOString().slice(0, 10)}`;
}

export default async function AskPage() {
  const session = await auth();
  const userId = session!.user!.id;

  const recentPages = await listPages(userId, { limit: 5 });

  if (recentPages.length < 5) {
    return <AskClient opener={null} suggestions={null} />;
  }

  const pageList = recentPages
    .map((p) => `- ${p.title}${p.type ? ` (${p.type})` : ""}`)
    .join("\n");

  const [openerRaw, suggestionsRaw] = await Promise.all([
    getOrGenerate(userId, todayKey("ask_opener"), TTL, async () => {
      const last24h = await withUser(userId, async (client) => {
        const { rows } = await client.query<{ title: string; type: string | null }>(
          `SELECT title, type FROM pages
           WHERE user_id = $1 AND updated_at > NOW() - INTERVAL '24 hours'
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
            "You are Mettrie, a personal knowledge system. You speak in first person. You are observant and direct — never sycophantic. Brevity over completeness.",
          maxTokens: 120,
        }
      );
    }),

    getOrGenerate(userId, todayKey("ask_suggestions"), TTL, async () => {
      const raw = await callClaude(
        userId,
        HAIKU,
        [
          {
            role: "user",
            content: `The 5 most recent pages in this user's knowledge base:\n${pageList}\n\nReturn ONLY a JSON array of exactly 3 short, specific questions (8 words MAX each) the user would ask about their own data today. Each question must reference the actual content above. Start your response with [ and end with ]. No markdown, no code fences, no preamble.\n\nExample: ["What's driving the hiring surge?", "Who's most active this week?", "Summarize Project X status"]`,
          },
        ],
        {
          system:
            "You are Mettrie. Generate timely, specific questions a user would ask about their own data. Output ONLY a JSON array — no other text.",
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

  return <AskClient opener={opener} suggestions={suggestions} />;
}
