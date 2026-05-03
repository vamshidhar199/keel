import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { brainSearch } from "@/lib/gbrain";
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
    const hits = await brainSearch(session.user.id, question, limit);

    if (hits.length === 0) {
      return NextResponse.json({
        answer: "Nothing in your knowledge base matches that question yet.",
        citations: [],
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
