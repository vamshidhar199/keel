import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getMetaDb } from "@/lib/db";
import {
  listWorkflows,
  createWorkflow,
  isCronPresetKey,
  isValidCustomTrigger,
  isLookbackHours,
  WORKFLOW_TEMPLATES,
  type WorkflowCustomTrigger,
  type LookbackHours,
} from "@/lib/workflows";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rows = await listWorkflows(session.user.id);
  return NextResponse.json({ workflows: rows, templates: WORKFLOW_TEMPLATES });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));

  // Optionally start from a template — overlay the user's overrides on top.
  let base: {
    name: string;
    description?: string;
    trigger_cron?: string;
    trigger_custom?: WorkflowCustomTrigger | null;
    filter_nl?: string;
    prompt_template?: string;
    lookback_hours?: number;
  } = body;
  if (typeof body.template === "string") {
    const tpl = WORKFLOW_TEMPLATES.find((t) => t.key === body.template);
    if (tpl) {
      base = {
        name: body.name ?? tpl.name,
        description: body.description ?? tpl.description,
        trigger_cron: body.trigger_cron ?? tpl.trigger_cron,
        trigger_custom: body.trigger_custom ?? null,
        filter_nl: body.filter_nl ?? tpl.filter_nl,
        prompt_template: body.prompt_template ?? tpl.prompt_template,
        lookback_hours: body.lookback_hours ?? tpl.lookback_hours,
      };
    }
  }

  const name = typeof base.name === "string" ? base.name.trim() : "";
  const promptTemplate =
    typeof base.prompt_template === "string" ? base.prompt_template.trim() : "";
  const triggerCron = typeof base.trigger_cron === "string" ? base.trigger_cron : "";

  if (!name || !promptTemplate || !triggerCron) {
    return NextResponse.json(
      { error: "name, prompt_template, and trigger_cron are required" },
      { status: 400 }
    );
  }

  let triggerCustom: WorkflowCustomTrigger | null = null;
  if (triggerCron === "custom") {
    if (!isValidCustomTrigger(base.trigger_custom)) {
      return NextResponse.json(
        {
          error:
            "Custom trigger requires trigger_custom: { weekdays: int[] (0-6, unique), hour: 0-23, minute: 0-59 }",
        },
        { status: 400 }
      );
    }
    triggerCustom = base.trigger_custom;
  } else if (!isCronPresetKey(triggerCron)) {
    return NextResponse.json(
      { error: "trigger_cron must be a valid preset key or 'custom'" },
      { status: 400 }
    );
  }

  let lookbackHours: LookbackHours | undefined;
  if (base.lookback_hours !== undefined) {
    if (!isLookbackHours(base.lookback_hours)) {
      return NextResponse.json(
        { error: "lookback_hours must be one of: 12, 24, 48, 72, 168, 336, 720" },
        { status: 400 }
      );
    }
    lookbackHours = base.lookback_hours;
  }

  const db = getMetaDb();
  const { rows } = await db.query<{ timezone: string }>(
    `SELECT timezone FROM users WHERE id = $1`,
    [session.user.id]
  );
  const timezone = rows[0]?.timezone ?? "UTC";

  try {
    const wf = await createWorkflow(
      session.user.id,
      {
        name,
        description: base.description,
        trigger_cron: triggerCron as "custom" | (typeof triggerCron & string),
        trigger_custom: triggerCustom,
        filter_nl: base.filter_nl,
        prompt_template: promptTemplate,
        lookback_hours: lookbackHours,
      },
      timezone
    );
    return NextResponse.json({ workflow: wf });
  } catch (err) {
    console.error(
      "[workflows] create failed:",
      String((err as Error)?.message ?? err).slice(0, 200)
    );
    return NextResponse.json({ error: "create failed" }, { status: 500 });
  }
}
