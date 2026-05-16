import Link from "next/link";
import { auth } from "@/auth";
import { listWorkflows, WORKFLOW_TEMPLATES, CRON_PRESETS } from "@/lib/workflows";
import { WorkflowsClient } from "./workflows-client";

export default async function WorkflowsPage() {
  const session = await auth();
  const userId = session!.user!.id;

  const workflows = await listWorkflows(userId);

  return (
    <div className="min-h-screen">
      <header className="header-glass sticky top-0 h-16 flex items-center justify-between px-6 z-30">
        <div className="flex items-center gap-3">
          <Link
            href="/overview"
            className="material-symbols-outlined text-xl leading-none"
            style={{ color: "var(--c-muted)" }}
            aria-label="Back to home"
          >
            arrow_back
          </Link>
          <h1 className="text-2xl font-bold" style={{ color: "var(--c-fg)" }}>
            Workflows
          </h1>
        </div>
      </header>

      <div className="px-8 py-10 max-w-4xl mx-auto space-y-8">
        <section className="space-y-2">
          <p
            className="text-[11px] font-mono uppercase tracking-[0.18em]"
            style={{ color: "var(--c-subtle)" }}
          >
            Your AI on a schedule
          </p>
          <h2
            className="text-3xl md:text-4xl font-bold tracking-tight"
            style={{ color: "var(--c-fg)" }}
          >
            Build a workflow.
          </h2>
          <p
            className="text-base max-w-2xl"
            style={{ color: "var(--c-muted)" }}
          >
            A workflow is a tiny AI agent that runs on a schedule against your
            knowledge. Pick a cadence, write a filter and a prompt, and I&apos;ll
            deliver the result here every time it fires.
          </p>
        </section>

        <WorkflowsClient
          initialWorkflows={workflows}
          templates={WORKFLOW_TEMPLATES}
          cronPresets={Object.values(CRON_PRESETS)}
        />
      </div>
    </div>
  );
}
