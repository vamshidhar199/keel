"use client";

import { useState } from "react";

interface Props {
  initialAnthropicKey: string | null;
  initialOpenaiKey: string | null;
}

export function ApiKeysPanel({ initialAnthropicKey, initialOpenaiKey }: Props) {
  const [anthropicKey, setAnthropicKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  async function handleSave() {
    if (!anthropicKey && !openaiKey) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/settings/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ anthropicKey, openaiKey }),
      });
      if (!res.ok) { setMsg({ text: "Failed to save", ok: false }); return; }
      setMsg({ text: "Saved", ok: true });
      setAnthropicKey("");
      setOpenaiKey("");
      setTimeout(() => setMsg(null), 3000);
    } catch {
      setMsg({ text: "Network error", ok: false });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="glass-card rounded-xl overflow-hidden">
      {[
        {
          label: "Anthropic API Key",
          placeholder: initialAnthropicKey ?? "sk-ant-...",
          value: anthropicKey,
          onChange: setAnthropicKey,
        },
        {
          label: "OpenAI API Key",
          placeholder: initialOpenaiKey ?? "sk-...",
          value: openaiKey,
          onChange: setOpenaiKey,
        },
      ].map(({ label, placeholder, value, onChange }, i, arr) => (
        <div
          key={label}
          className="px-5 py-4"
          style={{ borderBottom: i < arr.length - 1 ? "1px solid var(--c-divider)" : undefined }}
        >
          <p className="text-[10px] uppercase tracking-wider mb-2" style={{ color: "var(--c-subtle)" }}>
            {label}
          </p>
          <input
            type="password"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder ?? "Enter key to update"}
            className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none font-mono"
            style={{
              background: "var(--c-surface-low)",
              border: "1px solid var(--c-card-border)",
              color: "var(--c-fg)",
            }}
          />
          <p className="text-[10px] mt-1.5" style={{ color: "var(--c-subtle)" }}>
            {placeholder ? "Key saved — enter a new value to replace it" : "No key saved yet"}
          </p>
        </div>
      ))}

      <div className="px-5 py-4 flex items-center gap-4">
        <button
          onClick={handleSave}
          disabled={saving || (!anthropicKey && !openaiKey)}
          className="px-5 py-2 text-sm font-semibold rounded-lg transition-all hover:brightness-110 disabled:opacity-40"
          style={{ background: "var(--c-btn-bg)", border: "1px solid var(--c-btn-border)", color: "var(--c-fg)" }}
        >
          {saving ? "Saving…" : "Save Keys"}
        </button>
        {msg && (
          <span className="text-[12px]" style={{ color: msg.ok ? "var(--c-stat2)" : "#ef4444" }}>
            {msg.text}
          </span>
        )}
      </div>
    </div>
  );
}
