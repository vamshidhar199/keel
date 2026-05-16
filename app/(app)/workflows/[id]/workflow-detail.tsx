"use client";

import { useEffect, useState } from "react";
import type { Workflow, WorkflowRun, CronPreset } from "@/lib/workflows";

interface Props {
  initialWorkflow: Workflow;
  initialRuns: WorkflowRun[];
  cronPresets: CronPreset[];
  cronPresetLabel: string;
}

export function WorkflowDetail({
  initialWorkflow,
  initialRuns,
  cronPresets,
  cronPresetLabel,
}: Props) {
  const [workflow, setWorkflow] = useState<Workflow>(initialWorkflow);
  const [runs, setRuns] = useState<WorkflowRun[]>(initialRuns);
  const [draft, setDraft] = useState({
    name: workflow.name,
    trigger_cron: workflow.trigger_cron,
    filter_nl: workflow.filter_nl,
    prompt_template: workflow.prompt_template,
  });
  const [dirty, setDirty] = useState(false);
  const [running, setRunning] = useState(false);

  async function refreshRuns() {
    const r = await fetch(`/api/workflows/${workflow.id}/runs`);
    const data = r.ok ? await r.json() : { runs: [] };
    setRuns(data.runs ?? []);
  }

  async function refreshWorkflow() {
    const r = await fetch(`/api/workflows/${workflow.id}`);
    if (r.ok) {
      const data = await r.json();
      setWorkflow(data.workflow);
    }
  }

  async function save() {
    if (!dirty) return;
    const res = await fetch(`/api/workflows/${workflow.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    if (res.ok) {
      const data = await res.json();
      setWorkflow(data.workflow);
      setDirty(false);
    }
  }

  async function runNow() {
    setRunning(true);
    try {
      await fetch(`/api/workflows/${workflow.id}/run`, { method: "POST" });
      // Poll runs a few times to capture the result without manual refresh.
      for (let i = 0; i < 8; i++) {
        await new Promise((r) => setTimeout(r, 2500));
        await refreshRuns();
        const r = runs[0];
        if (r && new Date(r.ran_at).getTime() > Date.now() - 60_000) break;
      }
      await refreshWorkflow();
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => {
    setDraft({
      name: workflow.name,
      trigger_cron: workflow.trigger_cron,
      filter_nl: workflow.filter_nl,
      prompt_template: workflow.prompt_template,
    });
    setDirty(false);
  }, [workflow]);

  return (
    <div className="space-y-8">
      {/* Metadata */}
      <section className="glass-card rounded-2xl p-5 space-y-3">
        <div className="grid grid-cols-2 gap-3 text-[12px]">
          <Stat label="Cadence" value={cronPresetLabel} />
          <Stat
            label="Status"
            value={workflow.enabled ? "Enabled" : "Paused"}
            tone={workflow.enabled ? "ok" : "muted"}
          />
          <Stat
            label="Last run"
            value={
              workflow.last_run_at
                ? new Date(workflow.last_run_at).toLocaleString()
                : "Never"
            }
          />
          <Stat
            label="Next run"
            value={new Date(workflow.next_run_at).toLocaleString()}
          />
        </div>
        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={runNow}
            disabled={running}
            className="text-[12px] font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
            style={{ background: "var(--c-primary)", color: "white" }}
          >
            {running ? "Running…" : "Run now"}
          </button>
        </div>
      </section>

      {/* Editor */}
      <section className="glass-card rounded-2xl p-5 space-y-4">
        <p
          className="text-[11px] uppercase tracking-wider"
          style={{ color: "var(--c-subtle)" }}
        >
          Edit
        </p>
        <input
          type="text"
          value={draft.name}
          onChange={(e) => {
            setDraft((d) => ({ ...d, name: e.target.value }));
            setDirty(true);
          }}
          className="w-full rounded-lg px-3 py-2 text-sm glass-card"
          style={{ color: "var(--c-fg)", background: "var(--c-card)" }}
        />
        <select
          value={draft.trigger_cron}
          onChange={(e) => {
            setDraft((d) => ({ ...d, trigger_cron: e.target.value as Workflow["trigger_cron"] }));
            setDirty(true);
          }}
          className="w-full rounded-lg px-3 py-2 text-sm glass-card cursor-pointer"
          style={{ color: "var(--c-fg)", background: "var(--c-card)" }}
        >
          {cronPresets.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
        <div>
          <p className="text-[11px] mb-1.5" style={{ color: "var(--c-subtle)" }}>
            Filter (optional)
          </p>
          <textarea
            value={draft.filter_nl}
            onChange={(e) => {
              setDraft((d) => ({ ...d, filter_nl: e.target.value }));
              setDirty(true);
            }}
            rows={2}
            className="w-full rounded-lg px-3 py-2 text-[13px] resize-vertical glass-card"
            style={{ color: "var(--c-fg)", background: "var(--c-card)" }}
          />
        </div>
        <div>
          <p className="text-[11px] mb-1.5" style={{ color: "var(--c-subtle)" }}>
            Prompt
          </p>
          <textarea
            value={draft.prompt_template}
            onChange={(e) => {
              setDraft((d) => ({ ...d, prompt_template: e.target.value }));
              setDirty(true);
            }}
            rows={6}
            className="w-full rounded-lg px-3 py-2 text-[13px] resize-vertical glass-card"
            style={{ color: "var(--c-fg)", background: "var(--c-card)" }}
          />
        </div>
        {dirty && (
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setDraft({
                  name: workflow.name,
                  trigger_cron: workflow.trigger_cron,
                  filter_nl: workflow.filter_nl,
                  prompt_template: workflow.prompt_template,
                });
                setDirty(false);
              }}
              className="text-[12px] px-3 py-1.5 rounded-md hover:[background:var(--c-row-hover)]"
              style={{ color: "var(--c-subtle)" }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              className="text-[12px] font-semibold px-3 py-1.5 rounded-md"
              style={{ background: "var(--c-primary)", color: "white" }}
            >
              Save changes
            </button>
          </div>
        )}
      </section>

      {/* Run history */}
      <section className="space-y-3">
        <p
          className="text-[10px] uppercase tracking-widest"
          style={{ color: "var(--c-subtle)" }}
        >
          Run history
        </p>
        {runs.length === 0 ? (
          <div className="glass-card rounded-2xl p-6 text-center">
            <p className="text-[13px]" style={{ color: "var(--c-muted)" }}>
              No runs yet. Hit &ldquo;Run now&rdquo; to try it.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {runs.map((r) => (
              <li key={r.id} className="glass-card rounded-2xl p-5 space-y-2.5">
                <header className="flex items-baseline justify-between gap-3">
                  <p
                    className="text-[11px] font-mono"
                    style={{ color: "var(--c-subtle)" }}
                  >
                    {new Date(r.ran_at).toLocaleString()}
                  </p>
                  <RunStatus status={r.status} />
                </header>
                {r.error && (
                  <p className="text-[12px]" style={{ color: "#ef4444" }}>
                    {r.error}
                  </p>
                )}
                {r.output_text && (
                  <pre
                    className="whitespace-pre-wrap text-[13px] leading-relaxed font-sans"
                    style={{ color: "var(--c-fg)" }}
                  >
                    {r.output_text}
                  </pre>
                )}
                {r.source_refs.length > 0 && (
                  <details className="pt-1">
                    <summary
                      className="cursor-pointer text-[11px] hover:underline"
                      style={{ color: "var(--c-subtle)" }}
                    >
                      {r.source_refs.length} source{r.source_refs.length === 1 ? "" : "s"}
                    </summary>
                    <ul className="mt-2 space-y-1">
                      {r.source_refs.map((s) => (
                        <li
                          key={s.ref}
                          className="text-[11px] truncate"
                          style={{ color: "var(--c-muted)" }}
                        >
                          • [{s.kind}] {s.label}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "ok" | "muted";
}) {
  return (
    <div>
      <p
        className="text-[10px] uppercase tracking-wider"
        style={{ color: "var(--c-subtle)" }}
      >
        {label}
      </p>
      <p
        className="text-[13px] font-medium mt-0.5 truncate"
        style={{
          color: tone === "ok" ? "var(--c-primary)" : "var(--c-fg)",
        }}
      >
        {value}
      </p>
    </div>
  );
}

function RunStatus({ status }: { status: WorkflowRun["status"] }) {
  const map = {
    success: { bg: "rgba(34,197,94,0.15)", fg: "#22c55e", label: "ok" },
    no_data: { bg: "rgba(148,163,184,0.15)", fg: "#94a3b8", label: "no data" },
    failed: { bg: "rgba(239,68,68,0.15)", fg: "#ef4444", label: "failed" },
  } as const;
  const c = map[status];
  return (
    <span
      className="text-[10px] font-mono px-2 py-0.5 rounded-full"
      style={{ background: c.bg, color: c.fg }}
    >
      {c.label}
    </span>
  );
}
