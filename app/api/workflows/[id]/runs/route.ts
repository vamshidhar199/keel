import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { listWorkflowRuns } from "@/lib/workflows";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const runs = await listWorkflowRuns(session.user.id, id, 20);
  return NextResponse.json({ runs });
}
