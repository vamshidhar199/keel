import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { generateWorkflowFromNL } from "@/lib/workflows";

// Turns "every Friday afternoon, summarize what shipped" into a workflow draft.
// Does NOT persist — the UI shows it to the user for review then POSTs the
// final shape to /api/workflows. Persisting only on user confirmation keeps the
// trust contract clear: the AI never silently creates schedules.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const request = typeof body.request === "string" ? body.request : "";
  if (!request.trim()) {
    return NextResponse.json(
      { error: "request is required" },
      { status: 400 }
    );
  }

  const draft = await generateWorkflowFromNL(session.user.id, request);
  if (!draft) {
    return NextResponse.json(
      { error: "Couldn't read that as a workflow. Try being more specific about cadence (e.g. 'every Friday')." },
      { status: 422 }
    );
  }
  return NextResponse.json({ draft });
}
