import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { deleteFile } from "@/lib/files";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  await deleteFile(session.user.id, id);
  return NextResponse.json({ ok: true });
}
