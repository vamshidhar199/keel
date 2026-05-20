import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { brainSearch, findEntityPages, getEntityChunks } from "@/lib/gbrain";
import { synthesizeAnswerStream } from "@/lib/synthesize";
import { getSkill, getSkillBySlug } from "@/lib/skills";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const userId = session.user.id;
  const userName = session.user.name;

  const body = await req.json().catch(() => ({}));
  const question: string = String(body.question ?? "").trim();
  if (!question) {
    return jsonResponse({ error: "Missing 'question'" }, 400);
  }

  const limit = Math.min(Number(body.limit ?? 8), 20);
  const history: { role: "user" | "assistant"; content: string }[] =
    Array.isArray(body.history) ? body.history : [];

  // Optional skill: looked up by id first, falling back to slug for /command
  // invocations. Disabled skills are silently ignored.
  let skillInstructions: string | null = null;
  let skillName: string | null = null;
  if (typeof body.skillId === "string" && body.skillId.length > 0) {
    const s = await getSkill(userId, body.skillId);
    if (s && s.enabled) {
      skillInstructions = s.instructions;
      skillName = s.name;
    }
  } else if (typeof body.skillSlug === "string" && body.skillSlug.length > 0) {
    const s = await getSkillBySlug(userId, body.skillSlug);
    if (s && s.enabled) {
      skillInstructions = s.instructions;
      skillName = s.name;
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      function send(obj: unknown) {
        controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));
      }

      try {
        if (skillName) {
          send({ skill: { name: skillName } });
        }
        send({ phase: "searching" });

        const [vectorHits, entityPages] = await Promise.all([
          brainSearch(userId, question, limit),
          findEntityPages(userId, question),
        ]);
        const entityHits = await getEntityChunks(
          userId,
          entityPages.map((p) => p.slug)
        );
        const seenIds = new Set(entityHits.map((h) => h.chunk_id));
        const hits = [
          ...entityHits,
          ...vectorHits.filter((h) => !seenIds.has(h.chunk_id)),
        ];

        send({ phase: "reading", count: hits.length });

        if (hits.length === 0) {
          send({ delta: "Nothing in your knowledge base matches that question yet." });
          send({ citations: [], webCitations: [], invalidCitations: [] });
          send({ done: true });
          controller.close();
          return;
        }

        send({ phase: "thinking" });

        const result = await synthesizeAnswerStream(
          userId,
          question,
          hits,
          userName,
          history,
          (delta) => send({ delta }),
          skillInstructions
        );

        send({
          citations: result.citations,
          webCitations: result.webCitations,
          invalidCitations: result.invalidCitations,
        });
        send({ done: true });
      } catch (err: unknown) {
        const msg =
          err && typeof err === "object" && "message" in err
            ? String((err as { message: unknown }).message)
            : String(err);
        // Don't log the user's question or hit content; only the error message.
        console.error("[api/query] failed:", msg.slice(0, 200));
        send({ error: msg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
