import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSkill, updateSkill, deleteSkill } from "@/lib/skills";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const skill = await getSkill(session.user.id, id);
  if (!skill) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ skill });
}

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
  const skill = await updateSkill(session.user.id, id, {
    name: typeof body.name === "string" ? body.name : undefined,
    description: typeof body.description === "string" ? body.description : undefined,
    instructions: typeof body.instructions === "string" ? body.instructions : undefined,
    enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
  });
  if (!skill) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ skill });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  await deleteSkill(session.user.id, id);
  return NextResponse.json({ ok: true });
}
