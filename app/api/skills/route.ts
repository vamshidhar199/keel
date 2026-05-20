import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { listSkills, createSkill } from "@/lib/skills";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const onlyEnabled = req.nextUrl.searchParams.get("enabled") === "true";
  const skills = await listSkills(session.user.id, onlyEnabled);
  return NextResponse.json({ skills });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  if (typeof body.name !== "string" || typeof body.instructions !== "string") {
    return NextResponse.json(
      { error: "name and instructions are required" },
      { status: 400 }
    );
  }
  try {
    const skill = await createSkill(session.user.id, {
      name: body.name,
      slug: typeof body.slug === "string" ? body.slug : undefined,
      description: typeof body.description === "string" ? body.description : undefined,
      instructions: body.instructions,
    });
    return NextResponse.json({ skill });
  } catch (err) {
    const msg = String((err as Error)?.message ?? err).slice(0, 200);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
