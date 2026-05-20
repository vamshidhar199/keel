import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import {
  getWorkflow,
  listWorkflowRuns,
  CRON_PRESETS,
  type CronPresetKey,
} from "@/lib/workflows";
import { WorkflowDetail } from "./workflow-detail";

export default async function WorkflowDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  const userId = session!.user!.id;
  const { id } = await params;

  const [workflow, runs] = await Promise.all([
    getWorkflow(userId, id),
    listWorkflowRuns(userId, id, 20),
  ]);
  if (!workflow) notFound();

  return (
    <div className="min-h-screen">
      <header className="header-glass sticky top-0 h-16 flex items-center justify-between px-6 z-30">
        <div className="flex items-center gap-3">
          <Link
            href="/workflows"
            className="material-symbols-outlined text-xl leading-none"
            style={{ color: "var(--c-muted)" }}
            aria-label="Back to workflows"
          >
            arrow_back
          </Link>
          <h1 className="text-2xl font-bold truncate" style={{ color: "var(--c-fg)" }}>
            {workflow.name}
          </h1>
        </div>
      </header>

      <div className="px-8 py-10 max-w-4xl mx-auto">
        <WorkflowDetail
          initialWorkflow={workflow}
          initialRuns={runs}
          cronPresets={Object.values(CRON_PRESETS)}
          cronPresetLabel={CRON_PRESETS[workflow.trigger_cron as CronPresetKey]?.label ?? workflow.trigger_cron}
        />
      </div>
    </div>
  );
}
