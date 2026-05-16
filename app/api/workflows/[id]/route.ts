import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getMetaDb } from "@/lib/db";
import {
  getWorkflow,
  updateWorkflow,
  deleteWorkflow,
  isCronPresetKey,
} from "@/lib/workflows";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const wf = await getWorkflow(session.user.id, id);
  if (!wf) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ workflow: wf });
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

  if (body.trigger_cron !== undefined && !isCronPresetKey(body.trigger_cron)) {
    return NextResponse.json(
      { error: "trigger_cron must be a valid preset key" },
      { status: 400 }
    );
  }

  const db = getMetaDb();
  const { rows } = await db.query<{ timezone: string }>(
    `SELECT timezone FROM users WHERE id = $1`,
    [session.user.id]
  );
  const timezone = rows[0]?.timezone ?? "UTC";

  const wf = await updateWorkflow(
    session.user.id,
    id,
    {
      name: typeof body.name === "string" ? body.name.trim() : undefined,
      description: typeof body.description === "string" ? body.description : undefined,
      trigger_cron: typeof body.trigger_cron === "string" ? body.trigger_cron : undefined,
      filter_nl: typeof body.filter_nl === "string" ? body.filter_nl : undefined,
      prompt_template:
        typeof body.prompt_template === "string" ? body.prompt_template.trim() : undefined,
      enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
    },
    timezone
  );
  if (!wf) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ workflow: wf });
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
  await deleteWorkflow(session.user.id, id);
  return NextResponse.json({ ok: true });
}
