import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { enqueue } from "@/lib/queue/enqueue";

// Manual trigger — enqueues a run_workflow job so the run happens off the
// request thread. The user polls /api/workflows/[id]/runs for results.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  await enqueue({ type: "run_workflow", userId: session.user.id, workflowId: id });
  return NextResponse.json({ ok: true });
}
