import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { generateSkillFromNL } from "@/lib/skills";

// NL drafter — converts "I want a skill that does X" into a reviewable draft.
// Does not persist; the UI shows the draft for review and then POSTs to
// /api/skills to save.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const request = typeof body.request === "string" ? body.request : "";
  if (!request.trim()) {
    return NextResponse.json({ error: "request is required" }, { status: 400 });
  }
  const draft = await generateSkillFromNL(session.user.id, request);
  if (!draft) {
    return NextResponse.json(
      { error: "Couldn't draft a skill from that. Try being more concrete about how I should behave." },
      { status: 422 }
    );
  }
  return NextResponse.json({ draft });
}
