"use client";

import { useEffect, useRef, useState } from "react";

export interface PickerSkill {
  id: string;
  name: string;
  slug: string;
  description: string;
}

interface Props {
  skills: PickerSkill[];
  activeSkillId: string | null;
  onChange: (id: string | null) => void;
}

// Match a skill against a query against name/slug/description. Case-insensitive
// substring match; empty query matches all.
function matchSkill(s: PickerSkill, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    s.name.toLowerCase().includes(q) ||
    s.slug.toLowerCase().includes(q) ||
    s.description.toLowerCase().includes(q)
  );
}

// Pill dropdown above the chat input. Shows the active skill as a badge,
// click-to-open menu with a search input + keyboard nav for scaling past
// ~10 skills. Slash autocomplete is the other invocation path — handled by
// <SlashAutocomplete /> below.
export function SkillPicker({ skills, activeSkillId, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const active = skills.find((s) => s.id === activeSkillId) ?? null;
  const filtered = skills.filter((s) => matchSkill(s, query));

  // Auto-focus search + reset state when opening.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setHighlighted(0);
    const t = setTimeout(() => searchRef.current?.focus(), 10);
    return () => clearTimeout(t);
  }, [open]);

  // Reset highlight when the filter list changes (so arrow keys don't point
  // past the end).
  useEffect(() => {
    setHighlighted(0);
  }, [query]);

  // Outside-click closes.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  if (skills.length === 0) return null;

  function pick(id: string | null) {
    onChange(id);
    setOpen(false);
  }

  function onSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = filtered[highlighted];
      if (target) pick(target.id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div ref={wrapRef} className="relative inline-flex items-center gap-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors cursor-pointer hover:[background:var(--c-row-hover)]"
        style={{
          background: active ? "var(--c-primary-m)" : "var(--c-card)",
          color: active ? "var(--c-primary)" : "var(--c-muted)",
          border: `1px solid ${active ? "var(--c-primary-m)" : "var(--c-card-border)"}`,
        }}
      >
        <span className="material-symbols-outlined text-[14px] leading-none">
          auto_fix_high
        </span>
        {active ? active.name : "Skills"}
        <span className="material-symbols-outlined text-[14px] leading-none opacity-60">
          {open ? "expand_less" : "expand_more"}
        </span>
      </button>

      {active && (
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label="Clear active skill"
          className="text-[10px] opacity-60 hover:opacity-100"
          style={{ color: "var(--c-subtle)" }}
        >
          clear
        </button>
      )}

      {open && (
        <div
          className="absolute bottom-full left-0 mb-2 w-72 rounded-xl shadow-xl glass-card overflow-hidden z-50"
          style={{ border: "1px solid var(--c-card-border)" }}
        >
          {/* Search */}
          <div className="px-2 py-2" style={{ borderBottom: "1px solid var(--c-divider)" }}>
            <div
              className="flex items-center gap-2 rounded-lg px-2 py-1.5"
              style={{ background: "var(--c-card)", border: "1px solid var(--c-divider)" }}
            >
              <span
                className="material-symbols-outlined text-[14px] leading-none"
                style={{ color: "var(--c-subtle)" }}
              >
                search
              </span>
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onSearchKey}
                placeholder={`Search ${skills.length} skill${skills.length === 1 ? "" : "s"}…`}
                className="flex-1 bg-transparent outline-none text-[12px]"
                style={{ color: "var(--c-fg)" }}
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="Clear search"
                  className="material-symbols-outlined text-[14px] leading-none opacity-60 hover:opacity-100"
                  style={{ color: "var(--c-subtle)" }}
                >
                  close
                </button>
              )}
            </div>
          </div>

          {/* None option — always present, ignores filter */}
          <button
            type="button"
            onClick={() => pick(null)}
            className="w-full text-left px-3 py-2 text-[12px] hover:[background:var(--c-row-hover)]"
            style={{
              color: !active ? "var(--c-primary)" : "var(--c-muted)",
              borderBottom: "1px solid var(--c-divider)",
            }}
          >
            None
          </button>

          {/* Filtered list */}
          {filtered.length === 0 ? (
            <p
              className="px-3 py-4 text-[12px] text-center"
              style={{ color: "var(--c-subtle)" }}
            >
              No skill matches &ldquo;{query}&rdquo;.
            </p>
          ) : (
            <ul className="max-h-72 overflow-y-auto">
              {filtered.map((s, i) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onMouseEnter={() => setHighlighted(i)}
                    onClick={() => pick(s.id)}
                    className="w-full text-left px-3 py-2 hover:[background:var(--c-row-hover)]"
                    style={
                      i === highlighted || s.id === activeSkillId
                        ? { background: "var(--c-row-hover)" }
                        : undefined
                    }
                  >
                    <p className="text-[13px] font-semibold" style={{ color: "var(--c-fg)" }}>
                      {s.name}
                    </p>
                    <p
                      className="text-[10px] font-mono mt-0.5"
                      style={{ color: "var(--c-subtle)" }}
                    >
                      /{s.slug}
                    </p>
                    {s.description && (
                      <p
                        className="text-[11px] mt-1 truncate"
                        style={{ color: "var(--c-muted)" }}
                      >
                        {s.description}
                      </p>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// Slash-command autocomplete shown inline above the textarea while the user
// is mid-typing. Matches `/<prefix>` against skill slugs. Picking a skill
// invokes `onPick(skill)` and removes the slash command from the input.
interface SlashProps {
  skills: PickerSkill[];
  input: string;
  setInput: (v: string) => void;
  onPick: (skill: PickerSkill) => void;
}

export function SlashAutocomplete({ skills, input, setInput, onPick }: SlashProps) {
  // Detect a `/<word>` token at the very start of the input (simplest UX).
  const slashMatch = input.match(/^\/([a-z0-9-]*)$/i);
  const prefix = slashMatch ? slashMatch[1].toLowerCase() : null;
  const [highlighted, setHighlighted] = useState(0);

  const matches = prefix !== null
    ? skills.filter((s) => s.slug.toLowerCase().startsWith(prefix)).slice(0, 8)
    : [];

  useEffect(() => {
    setHighlighted(0);
  }, [input]);

  useEffect(() => {
    if (matches.length === 0) return;
    function onKey(e: KeyboardEvent) {
      if (matches.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlighted((h) => Math.min(h + 1, matches.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlighted((h) => Math.max(0, h - 1));
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        onPick(matches[highlighted]);
        setInput("");
      } else if (e.key === "Escape") {
        e.preventDefault();
        setInput("");
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [matches, highlighted, onPick, setInput]);

  if (matches.length === 0) return null;

  return (
    <div
      className="absolute bottom-full left-0 mb-2 w-72 rounded-xl shadow-xl glass-card overflow-hidden z-50"
      style={{ border: "1px solid var(--c-card-border)" }}
    >
      <ul className="max-h-72 overflow-y-auto">
        {matches.map((s, i) => (
          <li key={s.id}>
            <button
              type="button"
              onMouseEnter={() => setHighlighted(i)}
              onClick={() => {
                onPick(s);
                setInput("");
              }}
              className="w-full text-left px-3 py-2"
              style={
                i === highlighted
                  ? { background: "var(--c-row-hover)" }
                  : undefined
              }
            >
              <div className="flex items-baseline justify-between gap-2">
                <p
                  className="text-[13px] font-semibold truncate"
                  style={{ color: "var(--c-fg)" }}
                >
                  {s.name}
                </p>
                <p
                  className="text-[10px] font-mono shrink-0"
                  style={{ color: "var(--c-subtle)" }}
                >
                  /{s.slug}
                </p>
              </div>
              {s.description && (
                <p
                  className="text-[11px] mt-0.5 truncate"
                  style={{ color: "var(--c-muted)" }}
                >
                  {s.description}
                </p>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
