"use client";

import { useEffect, useState } from "react";

interface Recipe {
  id: string;
  name: string;
  nl_rule: string;
  enabled: boolean;
  sort_order: number;
}

export function RecipesPanel() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState<{ name: string; nl_rule: string }>({
    name: "",
    nl_rule: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const r = await fetch("/api/settings/recipes");
    const data = r.ok ? await r.json() : { recipes: [] };
    setRecipes(data.recipes ?? []);
    setLoaded(true);
  }

  useEffect(() => {
    refresh().catch(() => setLoaded(true));
  }, []);

  async function addRecipe(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.name.trim() || !draft.nl_rule.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/recipes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Could not create recipe");
      } else {
        setDraft({ name: "", nl_rule: "" });
        await refresh();
      }
    } finally {
      setSaving(false);
    }
  }

  async function update(id: string, partial: Partial<Recipe>) {
    setRecipes((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...partial } : r))
    );
    const res = await fetch(`/api/settings/recipes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(partial),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not update recipe");
      await refresh();
    } else {
      setError(null);
    }
  }

  async function remove(id: string) {
    setRecipes((prev) => prev.filter((r) => r.id !== id));
    await fetch(`/api/settings/recipes/${id}`, { method: "DELETE" });
  }

  if (!loaded) {
    return (
      <div className="glass-card rounded-xl p-5">
        <p className="text-[13px]" style={{ color: "var(--c-subtle)" }}>Loading…</p>
      </div>
    );
  }

  return (
    <div
      className="glass-card rounded-xl divide-y"
      style={{ borderColor: "var(--c-divider)" }}
    >
      <div className="px-5 py-4">
        <p className="text-sm font-medium" style={{ color: "var(--c-fg)" }}>
          Custom cards
        </p>
        <p className="text-xs mt-0.5" style={{ color: "var(--c-subtle)" }}>
          Natural-language rules I&apos;ll run against your recent activity every
          brief. Up to 5 enabled at a time.
        </p>
      </div>

      {recipes.length > 0 && (
        <ul className="divide-y" style={{ borderColor: "var(--c-divider)" }}>
          {recipes.map((r) => (
            <li key={r.id} className="px-5 py-4 space-y-2.5">
              <div className="flex items-center justify-between gap-3">
                <input
                  type="text"
                  value={r.name}
                  onChange={(e) =>
                    setRecipes((prev) =>
                      prev.map((p) =>
                        p.id === r.id ? { ...p, name: e.target.value } : p
                      )
                    )
                  }
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== r.name) update(r.id, { name: v });
                  }}
                  className="text-sm font-medium bg-transparent border-none outline-none flex-1 min-w-0"
                  style={{ color: "var(--c-fg)" }}
                />
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={r.enabled}
                    onClick={() => update(r.id, { enabled: !r.enabled })}
                    className="relative w-9 h-5 rounded-full transition-colors cursor-pointer"
                    style={{
                      background: r.enabled
                        ? "var(--c-primary)"
                        : "var(--c-card-border)",
                    }}
                  >
                    <span
                      className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-all"
                      style={{
                        left: r.enabled ? "calc(100% - 1.125rem)" : "0.125rem",
                      }}
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(r.id)}
                    aria-label="Delete recipe"
                    className="p-1 rounded-md cursor-pointer hover:[background:var(--c-row-hover)]"
                    style={{ color: "var(--c-subtle)" }}
                  >
                    <span className="material-symbols-outlined text-[16px] leading-none">
                      delete
                    </span>
                  </button>
                </div>
              </div>
              <textarea
                value={r.nl_rule}
                onChange={(e) =>
                  setRecipes((prev) =>
                    prev.map((p) =>
                      p.id === r.id ? { ...p, nl_rule: e.target.value } : p
                    )
                  )
                }
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== r.nl_rule) update(r.id, { nl_rule: v });
                }}
                rows={2}
                className="w-full rounded-lg px-3 py-2 text-[13px] leading-relaxed resize-vertical glass-card"
                style={{
                  color: "var(--c-muted)",
                  background: "var(--c-card)",
                }}
              />
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={addRecipe} className="px-5 py-4 space-y-2.5">
        <p className="text-[11px] uppercase tracking-wider" style={{ color: "var(--c-subtle)" }}>
          Add a recipe
        </p>
        <input
          type="text"
          value={draft.name}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          placeholder="Card name (e.g. Acme this week)"
          className="w-full rounded-lg px-3 py-2 text-sm glass-card"
          style={{ color: "var(--c-fg)", background: "var(--c-card)" }}
          maxLength={80}
        />
        <textarea
          value={draft.nl_rule}
          onChange={(e) => setDraft((d) => ({ ...d, nl_rule: e.target.value }))}
          rows={2}
          placeholder="anything mentioning Acme in the last 7 days"
          className="w-full rounded-lg px-3 py-2 text-[13px] resize-vertical glass-card"
          style={{ color: "var(--c-fg)", background: "var(--c-card)" }}
          maxLength={600}
        />
        {error && (
          <p className="text-[11px]" style={{ color: "#ef4444" }}>
            {error}
          </p>
        )}
        <div className="flex items-center justify-end">
          <button
            type="submit"
            disabled={saving || !draft.name.trim() || !draft.nl_rule.trim()}
            className="text-[12px] font-medium px-3 py-1.5 rounded-md transition-colors hover:[background:var(--c-row-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ color: "var(--c-primary)" }}
          >
            Add recipe
          </button>
        </div>
      </form>
    </div>
  );
}
