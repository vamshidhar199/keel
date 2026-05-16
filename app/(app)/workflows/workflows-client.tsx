"use client";

import Link from "next/link";
import { useState } from "react";
import type { Workflow, WorkflowTemplate, CronPreset } from "@/lib/workflows";

interface Props {
  initialWorkflows: Workflow[];
  templates: WorkflowTemplate[];
  cronPresets: CronPreset[];
}

interface DraftSpec {
  name: string;
  description: string;
  trigger_cron: string;
  filter_nl: string;
  prompt_template: string;
}

const EMPTY_DRAFT: DraftSpec = {
  name: "",
  description: "",
  trigger_cron: "weekday_8am",
  filter_nl: "",
  prompt_template: "",
};

export function WorkflowsClient({
  initialWorkflows,
  templates,
  cronPresets,
}: Props) {
  const [workflows, setWorkflows] = useState<Workflow[]>(initialWorkflows);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  // The lower "Add workflow" panel auto-expands when the user has none yet.
  const [showMoreWays, setShowMoreWays] = useState(initialWorkflows.length === 0);

  // NL drafter state lives at top level so a successful draft can scroll the
  // manual form into view pre-filled.
  const [nlRequest, setNlRequest] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [draft, setDraft] = useState<DraftSpec>({
    ...EMPTY_DRAFT,
    trigger_cron: cronPresets[0]?.key ?? "daily_8am",
  });
  const [draftMsg, setDraftMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function refresh() {
    const r = await fetch("/api/workflows");
    const data = r.ok ? await r.json() : { workflows: [] };
    setWorkflows(data.workflows ?? []);
  }

  async function toggle(id: string, enabled: boolean) {
    setWorkflows((prev) => prev.map((w) => (w.id === id ? { ...w, enabled } : w)));
    await fetch(`/api/workflows/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
  }

  async function remove(id: string) {
    setWorkflows((prev) => prev.filter((w) => w.id !== id));
    await fetch(`/api/workflows/${id}`, { method: "DELETE" });
  }

  async function runNow(id: string) {
    setBusyIds((s) => new Set(s).add(id));
    try {
      await fetch(`/api/workflows/${id}/run`, { method: "POST" });
    } finally {
      setTimeout(() => {
        setBusyIds((s) => {
          const next = new Set(s);
          next.delete(id);
          return next;
        });
      }, 1500);
    }
  }

  async function generateFromNL() {
    if (!nlRequest.trim()) return;
    setDrafting(true);
    setDraftMsg(null);
    setError(null);
    try {
      const res = await fetch("/api/workflows/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request: nlRequest.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setDraftMsg(body.error ?? "Couldn't draft a workflow from that.");
        return;
      }
      const { draft: d } = await res.json();
      setDraft({
        name: d.name,
        description: d.description ?? "",
        trigger_cron: d.trigger_cron,
        filter_nl: d.filter_nl ?? "",
        prompt_template: d.prompt_template,
      });
      setDraftMsg("Draft below. Review and create.");
      setShowMoreWays(true);
    } finally {
      setDrafting(false);
    }
  }

  function pickTemplate(tpl: WorkflowTemplate) {
    setDraft({
      name: tpl.name,
      description: tpl.description,
      trigger_cron: tpl.trigger_cron,
      filter_nl: tpl.filter_nl,
      prompt_template: tpl.prompt_template,
    });
    setShowMoreWays(true);
  }

  async function submitDraft(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Could not create workflow");
        return;
      }
      setDraft({
        ...EMPTY_DRAFT,
        trigger_cron: cronPresets[0]?.key ?? "daily_8am",
      });
      setNlRequest("");
      setDraftMsg(null);
      await refresh();
      // After creation, collapse the lower panel unless the user is still empty.
      setShowMoreWays(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* NL drafter — always visible, the differentiator front-and-center */}
      <section className="glass-card rounded-2xl p-6 space-y-3">
        <div className="flex items-center gap-2">
          <span
            className="material-symbols-outlined text-[18px] leading-none"
            style={{ color: "var(--c-primary)" }}
          >
            auto_awesome
          </span>
          <p
            className="text-[11px] uppercase tracking-widest font-semibold"
            style={{ color: "var(--c-primary)" }}
          >
            Describe it in plain English
          </p>
        </div>
        <p className="text-[13px]" style={{ color: "var(--c-muted)" }}>
          Tell me what you want and I&apos;ll draft a workflow you can review and
          save.
        </p>
        <textarea
          value={nlRequest}
          onChange={(e) => setNlRequest(e.target.value)}
          rows={2}
          maxLength={600}
          placeholder={`e.g. "Every Friday afternoon, summarize what I shipped this week and what's still in flight."`}
          className="w-full rounded-lg px-3 py-2 text-[14px] resize-vertical glass-card"
          style={{ color: "var(--c-fg)", background: "var(--c-card)" }}
        />
        <div className="flex items-center justify-between gap-3">
          {draftMsg && (
            <p
              className="text-[11px]"
              style={{
                color: draftMsg.startsWith("Draft")
                  ? "var(--c-primary)"
                  : "#ef4444",
              }}
            >
              {draftMsg}
            </p>
          )}
          <button
            type="button"
            onClick={generateFromNL}
            disabled={drafting || !nlRequest.trim()}
            className="ml-auto inline-flex items-center gap-1.5 text-[13px] font-semibold px-4 py-2 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: "var(--c-primary)", color: "white" }}
          >
            <span className="material-symbols-outlined text-[16px] leading-none">
              auto_awesome
            </span>
            {drafting ? "Drafting…" : "Draft workflow"}
          </button>
        </div>
      </section>

      {/* Workflows list */}
      {workflows.length === 0 ? (
        <div
          className="rounded-2xl p-6 text-center space-y-1.5"
          style={{
            border: "1px dashed var(--c-card-border)",
            background: "transparent",
          }}
        >
          <p className="text-[14px]" style={{ color: "var(--c-muted)" }}>
            No workflows yet.
          </p>
          <p className="text-[12px]" style={{ color: "var(--c-subtle)" }}>
            Use the drafter above, pick a template, or start manually below.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {workflows.map((w) => {
            const nextRun = new Date(w.next_run_at);
            const presetLabel =
              cronPresets.find((p) => p.key === w.trigger_cron)?.label ??
              w.trigger_cron;
            return (
              <div
                key={w.id}
                className="glass-card rounded-2xl p-5 flex flex-col md:flex-row md:items-center gap-4"
              >
                <div className="flex-1 min-w-0">
                  <Link
                    href={`/workflows/${w.id}`}
                    className="block hover:underline"
                  >
                    <p
                      className="text-[15px] font-semibold truncate"
                      style={{ color: "var(--c-fg)" }}
                    >
                      {w.name}
                    </p>
                  </Link>
                  <p className="text-[12px] mt-0.5" style={{ color: "var(--c-subtle)" }}>
                    {presetLabel} · next {nextRun.toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => runNow(w.id)}
                    disabled={busyIds.has(w.id)}
                    className="text-[12px] font-medium px-3 py-1.5 rounded-md transition-colors hover:[background:var(--c-row-hover)] disabled:opacity-50"
                    style={{ color: "var(--c-primary)" }}
                  >
                    {busyIds.has(w.id) ? "Queued…" : "Run now"}
                  </button>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={w.enabled}
                    onClick={() => toggle(w.id, !w.enabled)}
                    className="relative w-9 h-5 rounded-full transition-colors cursor-pointer"
                    style={{
                      background: w.enabled ? "var(--c-primary)" : "var(--c-card-border)",
                    }}
                  >
                    <span
                      className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-all"
                      style={{
                        left: w.enabled ? "calc(100% - 1.125rem)" : "0.125rem",
                      }}
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(`Delete workflow "${w.name}"?`)) remove(w.id);
                    }}
                    aria-label="Delete workflow"
                    className="p-1 rounded-md cursor-pointer hover:[background:var(--c-row-hover)]"
                    style={{ color: "var(--c-subtle)" }}
                  >
                    <span className="material-symbols-outlined text-[16px] leading-none">
                      delete
                    </span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Other ways to add — auto-open when no workflows */}
      <section>
        <button
          type="button"
          onClick={() => setShowMoreWays((v) => !v)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-medium glass-card hover:[background:var(--c-row-hover)]"
          style={{ color: "var(--c-fg)" }}
        >
          <span className="material-symbols-outlined text-[16px] leading-none">
            {showMoreWays ? "expand_less" : "expand_more"}
          </span>
          {showMoreWays ? "Hide other ways to add" : "Other ways to add"}
        </button>

        {showMoreWays && (
          <div className="mt-4 glass-card rounded-2xl p-6 space-y-5">
            <div>
              <p
                className="text-[11px] uppercase tracking-widest mb-2.5"
                style={{ color: "var(--c-subtle)" }}
              >
                Start from a template
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {templates.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => pickTemplate(t)}
                    className="text-left rounded-xl p-3 border transition-colors hover:[background:var(--c-row-hover)]"
                    style={{ borderColor: "var(--c-divider)" }}
                  >
                    <p className="text-[13px] font-semibold" style={{ color: "var(--c-fg)" }}>
                      {t.name}
                    </p>
                    <p className="text-[11px] mt-0.5" style={{ color: "var(--c-subtle)" }}>
                      {t.description}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            <form onSubmit={submitDraft} className="space-y-3 pt-2">
              <p
                className="text-[11px] uppercase tracking-widest"
                style={{ color: "var(--c-subtle)" }}
              >
                Review & save
              </p>
              <input
                type="text"
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="Name (e.g. Friday recap)"
                maxLength={120}
                className="w-full rounded-lg px-3 py-2 text-sm glass-card"
                style={{ color: "var(--c-fg)", background: "var(--c-card)" }}
              />
              <select
                value={draft.trigger_cron}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, trigger_cron: e.target.value }))
                }
                className="w-full rounded-lg px-3 py-2 text-sm glass-card cursor-pointer"
                style={{ color: "var(--c-fg)", background: "var(--c-card)" }}
              >
                {cronPresets.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
              <textarea
                value={draft.filter_nl}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, filter_nl: e.target.value }))
                }
                rows={2}
                placeholder="Filter rule — what should I look at? (optional)"
                maxLength={600}
                className="w-full rounded-lg px-3 py-2 text-[13px] resize-vertical glass-card"
                style={{ color: "var(--c-fg)", background: "var(--c-card)" }}
              />
              <textarea
                value={draft.prompt_template}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, prompt_template: e.target.value }))
                }
                rows={5}
                placeholder="Prompt — what should I write each time it runs?"
                maxLength={2000}
                className="w-full rounded-lg px-3 py-2 text-[13px] resize-vertical glass-card"
                style={{ color: "var(--c-fg)", background: "var(--c-card)" }}
              />
              {error && (
                <p className="text-[11px]" style={{ color: "#ef4444" }}>
                  {error}
                </p>
              )}
              <div className="flex items-center justify-end">
                <button
                  type="submit"
                  disabled={saving || !draft.name.trim() || !draft.prompt_template.trim()}
                  className="text-[13px] font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ background: "var(--c-primary)", color: "white" }}
                >
                  Create workflow
                </button>
              </div>
            </form>
          </div>
        )}
      </section>
    </div>
  );
}
