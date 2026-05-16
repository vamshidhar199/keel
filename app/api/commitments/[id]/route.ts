import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { setCommitmentStatus } from "@/lib/commitments";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const status = body.status;
  if (status !== "done" && status !== "dismissed") {
    return NextResponse.json(
      { error: "status must be 'done' or 'dismissed'" },
      { status: 400 }
    );
  }

  try {
    await setCommitmentStatus(session.user.id, id, status);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Update failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
