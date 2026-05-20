"use client";

import type { CronPreset, WorkflowCustomTrigger } from "@/lib/workflows";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface Props {
  presets: CronPreset[];
  cron: string;                                  // either a preset key or "custom"
  custom: WorkflowCustomTrigger | null;
  onChange: (next: { cron: string; custom: WorkflowCustomTrigger | null }) => void;
}

const DEFAULT_CUSTOM: WorkflowCustomTrigger = {
  weekdays: [1, 2, 3, 4, 5],
  hour: 9,
  minute: 0,
};

// Renders a cadence dropdown (presets + "Custom…") and, when "Custom" is
// selected, day-of-week checkboxes + an hour/minute time picker.
export function CadencePicker({ presets, cron, custom, onChange }: Props) {
  const isCustom = cron === "custom";
  // Coerce a missing/invalid custom into the default — keeps the UI usable
  // when the user switches into custom mode for the first time.
  const c = isCustom && custom ? custom : DEFAULT_CUSTOM;

  function selectPreset(value: string) {
    if (value === "custom") {
      onChange({ cron: "custom", custom: c });
    } else {
      onChange({ cron: value, custom: null });
    }
  }

  function toggleWeekday(d: number) {
    const set = new Set(c.weekdays);
    if (set.has(d)) set.delete(d);
    else set.add(d);
    onChange({
      cron: "custom",
      custom: { ...c, weekdays: [...set].sort((a, b) => a - b) },
    });
  }

  function setHour(h: number) {
    onChange({ cron: "custom", custom: { ...c, hour: clampInt(h, 0, 23) } });
  }
  function setMinute(m: number) {
    onChange({ cron: "custom", custom: { ...c, minute: clampInt(m, 0, 59) } });
  }
  function setAmPm(pm: boolean) {
    let h = c.hour % 12;
    if (pm) h += 12;
    onChange({ cron: "custom", custom: { ...c, hour: h } });
  }

  const display12 = c.hour === 0 ? 12 : c.hour > 12 ? c.hour - 12 : c.hour;
  const pm = c.hour >= 12;

  return (
    <div className="space-y-3">
      <select
        value={cron}
        onChange={(e) => selectPreset(e.target.value)}
        className="w-full rounded-lg px-3 py-2 text-sm glass-card cursor-pointer"
        style={{ color: "var(--c-fg)", background: "var(--c-card)" }}
      >
        {presets.map((p) => (
          <option key={p.key} value={p.key}>
            {p.label}
          </option>
        ))}
        <option value="custom">Custom…</option>
      </select>

      {isCustom && (
        <div
          className="rounded-lg p-3 space-y-3"
          style={{ background: "var(--c-card)", border: "1px solid var(--c-divider)" }}
        >
          {/* Days of week */}
          <div>
            <p
              className="text-[10px] uppercase tracking-wider mb-2"
              style={{ color: "var(--c-subtle)" }}
            >
              Days
            </p>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAY_LABELS.map((label, i) => {
                const active = c.weekdays.includes(i);
                return (
                  <button
                    type="button"
                    key={label}
                    onClick={() => toggleWeekday(i)}
                    className="text-[11px] font-medium px-2.5 py-1 rounded-md transition-colors cursor-pointer"
                    style={{
                      background: active ? "var(--c-primary)" : "transparent",
                      color: active ? "white" : "var(--c-muted)",
                      border: `1px solid ${active ? "var(--c-primary)" : "var(--c-card-border)"}`,
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            {c.weekdays.length === 0 && (
              <p className="text-[10px] mt-1.5" style={{ color: "#ef4444" }}>
                Pick at least one day.
              </p>
            )}
          </div>

          {/* Time */}
          <div>
            <p
              className="text-[10px] uppercase tracking-wider mb-2"
              style={{ color: "var(--c-subtle)" }}
            >
              Time
            </p>
            <div className="flex items-center gap-2">
              <select
                value={display12}
                onChange={(e) => {
                  const next12 = Number(e.target.value);
                  // Recompute 24h hour preserving AM/PM.
                  const base24 = next12 === 12 ? 0 : next12;
                  setHour(pm ? base24 + 12 : base24);
                }}
                className="rounded-md px-2 py-1 text-sm glass-card cursor-pointer"
                style={{ color: "var(--c-fg)", background: "var(--c-bg)" }}
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
              <span style={{ color: "var(--c-subtle)" }}>:</span>
              <select
                value={Math.floor(c.minute / 5) * 5}
                onChange={(e) => setMinute(Number(e.target.value))}
                className="rounded-md px-2 py-1 text-sm glass-card cursor-pointer"
                style={{ color: "var(--c-fg)", background: "var(--c-bg)" }}
              >
                {Array.from({ length: 12 }, (_, i) => i * 5).map((m) => (
                  <option key={m} value={m}>
                    {String(m).padStart(2, "0")}
                  </option>
                ))}
              </select>
              <div
                className="ml-1 inline-flex rounded-md overflow-hidden"
                style={{ border: "1px solid var(--c-card-border)" }}
              >
                <button
                  type="button"
                  onClick={() => setAmPm(false)}
                  className="text-[11px] font-medium px-2 py-1 cursor-pointer"
                  style={{
                    background: !pm ? "var(--c-primary)" : "transparent",
                    color: !pm ? "white" : "var(--c-muted)",
                  }}
                >
                  AM
                </button>
                <button
                  type="button"
                  onClick={() => setAmPm(true)}
                  className="text-[11px] font-medium px-2 py-1 cursor-pointer"
                  style={{
                    background: pm ? "var(--c-primary)" : "transparent",
                    color: pm ? "white" : "var(--c-muted)",
                  }}
                >
                  PM
                </button>
              </div>
            </div>
          </div>

          {c.weekdays.length > 0 && (
            <p className="text-[11px]" style={{ color: "var(--c-subtle)" }}>
              {summarize(c)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function clampInt(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}

function summarize(c: WorkflowCustomTrigger): string {
  const dayPart =
    c.weekdays.length === 7
      ? "Every day"
      : c.weekdays.length === 0
      ? "(no day selected)"
      : c.weekdays.length === 5 &&
        c.weekdays.every((d) => d >= 1 && d <= 5)
      ? "Weekdays"
      : c.weekdays.length === 2 &&
        c.weekdays.every((d) => d === 0 || d === 6)
      ? "Weekends"
      : c.weekdays.map((d) => WEEKDAY_LABELS[d]).join(", ");
  const h12 = c.hour === 0 ? 12 : c.hour > 12 ? c.hour - 12 : c.hour;
  const pm = c.hour >= 12;
  return `${dayPart} at ${h12}:${String(c.minute).padStart(2, "0")} ${pm ? "PM" : "AM"}`;
}
