import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { brainSearch, findEntityPages, getEntityChunks } from "@/lib/gbrain";
import { synthesizeAnswer } from "@/lib/synthesize";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const question: string = String(body.question ?? "").trim();
  if (!question) {
    return NextResponse.json({ error: "Missing 'question'" }, { status: 400 });
  }

  const limit = Math.min(Number(body.limit ?? 8), 20);
  const history: { role: "user" | "assistant"; content: string }[] =
    Array.isArray(body.history) ? body.history : [];

  try {
    // Run vector search and entity detection in parallel.
    const [vectorHits, entityPages] = await Promise.all([
      brainSearch(session.user.id, question, limit),
      findEntityPages(session.user.id, question),
    ]);

    // Fetch full chunks for any entity pages found, then merge:
    // entity chunks first (score=1.0), then vector hits (deduped by chunk_id).
    const entityHits = await getEntityChunks(
      session.user.id,
      entityPages.map((p) => p.slug)
    );
    const seenIds = new Set(entityHits.map((h) => h.chunk_id));
    const hits = [
      ...entityHits,
      ...vectorHits.filter((h) => !seenIds.has(h.chunk_id)),
    ];

    if (hits.length === 0) {
      return NextResponse.json({
        answer: "Nothing in your knowledge base matches that question yet.",
        citations: [],
        webCitations: [],
        invalidCitations: [],
        hits: [],
      });
    }

    const result = await synthesizeAnswer(session.user.id, question, hits, session.user.name, history);

    return NextResponse.json({
      ...result,
      hits: hits.map((h) => ({
        chunk_id: h.chunk_id,
        slug: h.slug,
        title: h.title,
        score: Number(h.score.toFixed(4)),
      })),
    });
  } catch (err: any) {
    console.error("[api/query] failed:", err);
    return NextResponse.json(
      { error: err?.message ?? "Query failed" },
      { status: 500 }
    );
  }
}
