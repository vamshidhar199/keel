"use client";

import { useEffect, useState } from "react";

interface Prefs {
  digest_enabled: boolean;
  digest_hour_local: number;
  show_commitments: boolean;
  show_awaiting_reply: boolean;
  show_active_threads: boolean;
  show_quiet_but_important: boolean;
  show_opportunities: boolean;
  ai_memories: string;
}

const DEFAULTS: Prefs = {
  digest_enabled: true,
  digest_hour_local: 8,
  show_commitments: true,
  show_awaiting_reply: true,
  show_active_threads: true,
  show_quiet_but_important: true,
  show_opportunities: true,
  ai_memories: "",
};

interface Props {
  initialTimezone: string;
}

export function BriefPanel({ initialTimezone }: Props) {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/settings/preferences")
      .then((r) => (r.ok ? r.json() : DEFAULTS))
      .then((data) => {
        setPrefs({ ...DEFAULTS, ...data });
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  async function patch(partial: Partial<Prefs>) {
    setSaving(true);
    setPrefs((p) => ({ ...p, ...partial }));
    try {
      await fetch("/api/settings/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(partial),
      });
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) {
    return (
      <div className="glass-card rounded-xl p-5">
        <p className="text-[13px]" style={{ color: "var(--c-subtle)" }}>Loading…</p>
      </div>
    );
  }

  return (
    <div className="glass-card rounded-xl divide-y" style={{ borderColor: "var(--c-divider)" }}>
      <Toggle
        label="Daily brief on /home"
        sublabel={`Greets you each morning at ${formatHour(prefs.digest_hour_local)} (${initialTimezone})`}
        value={prefs.digest_enabled}
        disabled={saving}
        onChange={(v) => patch({ digest_enabled: v })}
      />

      <div className="px-5 py-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium" style={{ color: "var(--c-fg)" }}>Brief time</p>
          <p className="text-xs mt-0.5" style={{ color: "var(--c-subtle)" }}>
            Hour of day in your local timezone
          </p>
        </div>
        <select
          value={prefs.digest_hour_local}
          onChange={(e) => patch({ digest_hour_local: Number(e.target.value) })}
          disabled={saving || !prefs.digest_enabled}
          className="glass-card rounded-lg px-3 py-2 text-sm cursor-pointer disabled:opacity-50"
          style={{ color: "var(--c-fg)", background: "var(--c-card)" }}
        >
          {Array.from({ length: 24 }, (_, h) => (
            <option key={h} value={h}>
              {formatHour(h)}
            </option>
          ))}
        </select>
      </div>

      <MemoriesEditor
        value={prefs.ai_memories}
        disabled={saving}
        onSave={(next) => patch({ ai_memories: next })}
      />

      <Toggle
        label="Show open promises"
        sublabel="Action items I extracted from your emails"
        value={prefs.show_commitments}
        disabled={saving || !prefs.digest_enabled}
        onChange={(v) => patch({ show_commitments: v })}
      />
      <Toggle
        label="Show awaiting your reply"
        sublabel="Gmail threads where you're up"
        value={prefs.show_awaiting_reply}
        disabled={saving || !prefs.digest_enabled}
        onChange={(v) => patch({ show_awaiting_reply: v })}
      />
      <Toggle
        label="Show active threads"
        sublabel="Projects and topics that moved this week"
        value={prefs.show_active_threads}
        disabled={saving || !prefs.digest_enabled}
        onChange={(v) => patch({ show_active_threads: v })}
      />
      <Toggle
        label="Show quiet but important"
        sublabel="Relationships that haven't surfaced in a while"
        value={prefs.show_quiet_but_important}
        disabled={saving || !prefs.digest_enabled}
        onChange={(v) => patch({ show_quiet_but_important: v })}
      />
      <Toggle
        label="Show opportunities"
        sublabel="Inbound job listings and recruiter pitches"
        value={prefs.show_opportunities}
        disabled={saving || !prefs.digest_enabled}
        onChange={(v) => patch({ show_opportunities: v })}
      />
    </div>
  );
}

function formatHour(h: number): string {
  if (h === 0) return "12 AM";
  if (h < 12) return `${h} AM`;
  if (h === 12) return "12 PM";
  return `${h - 12} PM`;
}

function MemoriesEditor({
  value,
  disabled,
  onSave,
}: {
  value: string;
  disabled?: boolean;
  onSave: (next: string) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState(value);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setDraft(value);
    setDirty(false);
  }, [value]);

  function commit() {
    if (!dirty) return;
    onSave(draft);
    setDirty(false);
  }

  return (
    <div className="px-5 py-4 space-y-2.5">
      <div>
        <p className="text-sm font-medium" style={{ color: "var(--c-fg)" }}>
          AI memories
        </p>
        <p className="text-xs mt-0.5" style={{ color: "var(--c-subtle)" }}>
          Things I should always remember about how you like your brief. One per
          line.
        </p>
      </div>
      <textarea
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setDirty(true);
        }}
        onBlur={commit}
        disabled={disabled}
        rows={5}
        placeholder={`e.g. "Always show dollar amounts mentioned in emails."\n"Deprioritize Substack newsletters in awaiting-reply."`}
        className="w-full glass-card rounded-lg px-3 py-2.5 text-[13px] leading-relaxed resize-vertical disabled:opacity-50"
        style={{
          color: "var(--c-fg)",
          background: "var(--c-card)",
          borderColor: "var(--c-card-border)",
        }}
      />
      <div className="flex items-center justify-between">
        <p className="text-[10px]" style={{ color: "var(--c-subtle)" }}>
          {draft.trim().length === 0
            ? "No memories saved yet."
            : `${draft.length} / 4000 characters`}
        </p>
        {dirty && (
          <button
            type="button"
            onClick={commit}
            disabled={disabled}
            className="text-[11px] font-medium px-3 py-1 rounded-md transition-colors hover:[background:var(--c-row-hover)]"
            style={{ color: "var(--c-primary)" }}
          >
            Save memories
          </button>
        )}
      </div>
    </div>
  );
}

function Toggle({
  label,
  sublabel,
  value,
  disabled,
  onChange,
}: {
  label: string;
  sublabel: string;
  value: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      className={`px-5 py-4 flex items-center justify-between gap-4 transition-opacity ${
        disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium" style={{ color: "var(--c-fg)" }}>{label}</p>
        <p className="text-xs mt-0.5" style={{ color: "var(--c-subtle)" }}>{sublabel}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        disabled={disabled}
        onClick={() => !disabled && onChange(!value)}
        className="relative w-11 h-6 rounded-full transition-colors shrink-0 cursor-pointer disabled:cursor-not-allowed"
        style={{
          background: value ? "var(--c-primary)" : "var(--c-card-border)",
        }}
      >
        <span
          className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-all"
          style={{ left: value ? "calc(100% - 1.375rem)" : "0.125rem" }}
        />
      </button>
    </label>
  );
}
