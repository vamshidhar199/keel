import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getMetaDb } from "@/lib/db";
import {
  getWorkflow,
  updateWorkflow,
  deleteWorkflow,
  isCronPresetKey,
  isValidCustomTrigger,
  isLookbackHours,
  type WorkflowCustomTrigger,
  type LookbackHours,
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

  if (body.trigger_cron !== undefined) {
    if (
      body.trigger_cron !== "custom" &&
      !isCronPresetKey(body.trigger_cron)
    ) {
      return NextResponse.json(
        { error: "trigger_cron must be a valid preset key or 'custom'" },
        { status: 400 }
      );
    }
    if (body.trigger_cron === "custom" && !isValidCustomTrigger(body.trigger_custom)) {
      return NextResponse.json(
        {
          error:
            "When setting trigger_cron='custom', trigger_custom must be { weekdays: int[] (0-6), hour: 0-23, minute: 0-59 }",
        },
        { status: 400 }
      );
    }
  }

  // trigger_custom can also be sent without changing the preset (e.g. tweaking
  // the day-of-week while keeping it custom).
  let triggerCustomInput: WorkflowCustomTrigger | null | undefined = undefined;
  if (body.trigger_custom !== undefined) {
    if (body.trigger_custom === null) {
      triggerCustomInput = null;
    } else if (isValidCustomTrigger(body.trigger_custom)) {
      triggerCustomInput = body.trigger_custom;
    } else {
      return NextResponse.json(
        {
          error:
            "trigger_custom must be { weekdays: int[] (0-6), hour: 0-23, minute: 0-59 } or null",
        },
        { status: 400 }
      );
    }
  }

  let lookbackHoursInput: LookbackHours | undefined;
  if (body.lookback_hours !== undefined) {
    if (!isLookbackHours(body.lookback_hours)) {
      return NextResponse.json(
        { error: "lookback_hours must be one of: 12, 24, 48, 72, 168, 336, 720" },
        { status: 400 }
      );
    }
    lookbackHoursInput = body.lookback_hours;
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
      trigger_custom: triggerCustomInput,
      filter_nl: typeof body.filter_nl === "string" ? body.filter_nl : undefined,
      prompt_template:
        typeof body.prompt_template === "string" ? body.prompt_template.trim() : undefined,
      lookback_hours: lookbackHoursInput,
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
