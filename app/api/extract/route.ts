import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { enqueue } from "@/lib/queue";
import { getExtractionStatus } from "@/lib/pipeline";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const status = await getExtractionStatus(session.user.id);
  return NextResponse.json(status);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const limit = Math.min(Number(body.limit ?? 20), 500);

  enqueue({ type: "extract_emails", userId: session.user.id, limit });

  return NextResponse.json({ queued: true, limit });
}
