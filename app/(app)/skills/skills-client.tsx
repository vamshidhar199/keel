"use client";

import { useState } from "react";
import type { Skill } from "@/lib/skills";

interface Props {
  initialSkills: Skill[];
}

interface DraftSpec {
  name: string;
  slug: string;
  description: string;
  instructions: string;
}

const EMPTY_DRAFT: DraftSpec = {
  name: "",
  slug: "",
  description: "",
  instructions: "",
};

export function SkillsClient({ initialSkills }: Props) {
  const [skills, setSkills] = useState<Skill[]>(initialSkills);
  const [showMore, setShowMore] = useState(initialSkills.length === 0);

  const [nlRequest, setNlRequest] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [draftMsg, setDraftMsg] = useState<string | null>(null);

  const [draft, setDraft] = useState<DraftSpec>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const r = await fetch("/api/skills");
    const data = r.ok ? await r.json() : { skills: [] };
    setSkills(data.skills ?? []);
  }

  async function toggle(id: string, enabled: boolean) {
    setSkills((prev) => prev.map((s) => (s.id === id ? { ...s, enabled } : s)));
    await fetch(`/api/skills/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
  }

  async function remove(id: string) {
    setSkills((prev) => prev.filter((s) => s.id !== id));
    await fetch(`/api/skills/${id}`, { method: "DELETE" });
  }

  async function draftFromNL() {
    if (!nlRequest.trim()) return;
    setDrafting(true);
    setDraftMsg(null);
    setError(null);
    try {
      const res = await fetch("/api/skills/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request: nlRequest.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setDraftMsg(body.error ?? "Couldn't draft a skill from that.");
        return;
      }
      const { draft: d } = await res.json();
      setDraft({
        name: d.name,
        slug: d.slug ?? "",
        description: d.description ?? "",
        instructions: d.instructions,
      });
      setDraftMsg("Draft below. Review and save.");
      setShowMore(true);
    } finally {
      setDrafting(false);
    }
  }

  async function submitDraft(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Could not create skill");
        return;
      }
      setDraft(EMPTY_DRAFT);
      setNlRequest("");
      setDraftMsg(null);
      await refresh();
      setShowMore(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* NL drafter hero */}
      <section className="glass-card rounded-2xl p-6 space-y-3">
        <div className="flex items-center gap-2">
          <span
            className="material-symbols-outlined text-[18px] leading-none"
            style={{ color: "var(--c-primary)" }}
          >
            auto_fix_high
          </span>
          <p
            className="text-[11px] uppercase tracking-widest font-semibold"
            style={{ color: "var(--c-primary)" }}
          >
            Describe how you want me to behave
          </p>
        </div>
        <p className="text-[13px]" style={{ color: "var(--c-muted)" }}>
          Tell me what you want and I&apos;ll draft a Skill you can review and save.
        </p>
        <textarea
          value={nlRequest}
          onChange={(e) => setNlRequest(e.target.value)}
          rows={2}
          maxLength={600}
          placeholder={`e.g. "When I ask about people, always show how long it's been since we last talked."`}
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
            onClick={draftFromNL}
            disabled={drafting || !nlRequest.trim()}
            className="ml-auto inline-flex items-center gap-1.5 text-[13px] font-semibold px-4 py-2 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: "var(--c-primary)", color: "white" }}
          >
            <span className="material-symbols-outlined text-[16px] leading-none">
              auto_awesome
            </span>
            {drafting ? "Drafting…" : "Draft skill"}
          </button>
        </div>
      </section>

      {/* Skills list */}
      {skills.length === 0 ? (
        <div
          className="rounded-2xl p-6 text-center space-y-1.5"
          style={{ border: "1px dashed var(--c-card-border)" }}
        >
          <p className="text-[14px]" style={{ color: "var(--c-muted)" }}>
            No skills yet.
          </p>
          <p className="text-[12px]" style={{ color: "var(--c-subtle)" }}>
            Use the drafter above, or write one manually below.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {skills.map((s) => (
            <div
              key={s.id}
              className="glass-card rounded-2xl p-5 space-y-2"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold truncate" style={{ color: "var(--c-fg)" }}>
                    {s.name}
                  </p>
                  <p className="text-[11px] font-mono mt-0.5" style={{ color: "var(--c-subtle)" }}>
                    /{s.slug}
                  </p>
                  {s.description && (
                    <p className="text-[12px] mt-1" style={{ color: "var(--c-muted)" }}>
                      {s.description}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={s.enabled}
                    onClick={() => toggle(s.id, !s.enabled)}
                    className="relative w-9 h-5 rounded-full transition-colors cursor-pointer"
                    style={{
                      background: s.enabled ? "var(--c-primary)" : "var(--c-card-border)",
                    }}
                  >
                    <span
                      className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-all"
                      style={{ left: s.enabled ? "calc(100% - 1.125rem)" : "0.125rem" }}
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(`Delete skill "${s.name}"?`)) remove(s.id);
                    }}
                    aria-label="Delete skill"
                    className="p-1 rounded-md cursor-pointer hover:[background:var(--c-row-hover)]"
                    style={{ color: "var(--c-subtle)" }}
                  >
                    <span className="material-symbols-outlined text-[16px] leading-none">
                      delete
                    </span>
                  </button>
                </div>
              </div>
              <details>
                <summary
                  className="text-[11px] cursor-pointer hover:underline"
                  style={{ color: "var(--c-subtle)" }}
                >
                  Show instructions
                </summary>
                <pre
                  className="text-[12px] whitespace-pre-wrap font-sans rounded-lg p-3 mt-2"
                  style={{
                    color: "var(--c-fg)",
                    background: "var(--c-card)",
                    border: "1px solid var(--c-divider)",
                  }}
                >
                  {s.instructions}
                </pre>
              </details>
            </div>
          ))}
        </div>
      )}

      {/* Manual editor */}
      <section>
        <button
          type="button"
          onClick={() => setShowMore((v) => !v)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-medium glass-card hover:[background:var(--c-row-hover)]"
          style={{ color: "var(--c-fg)" }}
        >
          <span className="material-symbols-outlined text-[16px] leading-none">
            {showMore ? "expand_less" : "expand_more"}
          </span>
          {showMore ? "Hide manual editor" : "Write one manually"}
        </button>

        {showMore && (
          <form onSubmit={submitDraft} className="mt-4 glass-card rounded-2xl p-6 space-y-3">
            <p className="text-[11px] uppercase tracking-widest" style={{ color: "var(--c-subtle)" }}>
              Review & save
            </p>
            <input
              type="text"
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="Name (e.g. Three-bullet brief)"
              maxLength={80}
              className="w-full rounded-lg px-3 py-2 text-sm glass-card"
              style={{ color: "var(--c-fg)", background: "var(--c-card)" }}
            />
            <input
              type="text"
              value={draft.slug}
              onChange={(e) => setDraft((d) => ({ ...d, slug: e.target.value }))}
              placeholder="Slug (auto-generated from name if left blank)"
              maxLength={40}
              className="w-full rounded-lg px-3 py-2 text-[13px] font-mono glass-card"
              style={{ color: "var(--c-fg)", background: "var(--c-card)" }}
            />
            <input
              type="text"
              value={draft.description}
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
              placeholder="One-line description (shown in the picker)"
              maxLength={200}
              className="w-full rounded-lg px-3 py-2 text-[13px] glass-card"
              style={{ color: "var(--c-fg)", background: "var(--c-card)" }}
            />
            <textarea
              value={draft.instructions}
              onChange={(e) => setDraft((d) => ({ ...d, instructions: e.target.value }))}
              rows={6}
              maxLength={4000}
              placeholder="Instructions for the AI (in second person — 'Always reply in three bullets', 'Quote dollar amounts', etc.)"
              className="w-full rounded-lg px-3 py-2 text-[13px] resize-vertical glass-card"
              style={{ color: "var(--c-fg)", background: "var(--c-card)" }}
            />
            {error && <p className="text-[11px]" style={{ color: "#ef4444" }}>{error}</p>}
            <div className="flex items-center justify-end">
              <button
                type="submit"
                disabled={saving || !draft.name.trim() || !draft.instructions.trim()}
                className="text-[13px] font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: "var(--c-primary)", color: "white" }}
              >
                Create skill
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
