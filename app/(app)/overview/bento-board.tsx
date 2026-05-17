"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

export type CardSize = "normal" | "wide";

export interface BentoCardDef {
  key: string;
  defaultSize?: CardSize;
  node: ReactNode;
  hideFlag?: keyof ShowFlags;
}

export interface ShowFlags {
  show_commitments?: boolean;
  show_awaiting_reply?: boolean;
  show_active_threads?: boolean;
  show_quiet_but_important?: boolean;
  show_opportunities?: boolean;
  show_workflow_runs?: boolean;
}

export interface LayoutEntry {
  key: string;
  size: CardSize;
}

interface Props {
  cards: BentoCardDef[];
  initialLayout: LayoutEntry[];
  initialShowFlags: ShowFlags;
}

const SAVE_DEBOUNCE_MS = 150;
const DRAG_DATA_KEY = "application/x-bento-key";

type SaveState = "idle" | "saving" | "saved" | "error";

export function BentoBoard({ cards, initialLayout, initialShowFlags }: Props) {
  const [editing, setEditing] = useState(false);
  const [layout, setLayout] = useState<LayoutEntry[]>(() =>
    resolveLayout(initialLayout, cards)
  );
  const [showFlags, setShowFlags] = useState<ShowFlags>(initialShowFlags);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  const layoutRef = useRef(layout);
  const flagsRef = useRef(showFlags);
  layoutRef.current = layout;
  flagsRef.current = showFlags;

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushSave = useCallback(async () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    setSaveState("saving");
    try {
      const res = await fetch("/api/settings/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bento_layout: layoutRef.current,
          ...flagsRef.current,
        }),
      });
      if (!res.ok) {
        console.error(`[bento] save failed: ${res.status}`);
        setSaveState("error");
        return;
      }
      setSaveState("saved");
      setTimeout(() => setSaveState((s) => (s === "saved" ? "idle" : s)), 1500);
    } catch (err) {
      console.error(
        "[bento] save error:",
        String((err as Error)?.message ?? err).slice(0, 200)
      );
      setSaveState("error");
    }
  }, []);

  const queueSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
  }, [flushSave]);

  // Best-effort save on page-hide. keepalive lets the request finish even if
  // the page is unloading.
  useEffect(() => {
    function onPageHide() {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      try {
        fetch("/api/settings/preferences", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bento_layout: layoutRef.current,
            ...flagsRef.current,
          }),
          keepalive: true,
        }).catch(() => {});
      } catch {}
    }
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, []);

  function setSize(key: string, size: CardSize) {
    setLayout((prev) => prev.map((e) => (e.key === key ? { ...e, size } : e)));
    queueSave();
  }

  function setHidden(key: string, hide: boolean) {
    const def = cards.find((c) => c.key === key);
    if (!def?.hideFlag) return;
    setShowFlags((prev) => ({ ...prev, [def.hideFlag!]: !hide }));
    queueSave();
  }

  function reorder(fromKey: string, toKey: string) {
    if (fromKey === toKey) return;
    setLayout((prev) => {
      const fromIdx = prev.findIndex((e) => e.key === fromKey);
      const toIdx = prev.findIndex((e) => e.key === toKey);
      if (fromIdx < 0 || toIdx < 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
    queueSave();
  }

  async function doneEditing() {
    setEditing(false);
    // Explicit flush so any change made within the debounce window lands
    // before the user navigates away.
    await flushSave();
  }

  const cardByKey = new Map(cards.map((c) => [c.key, c]));
  const visible = layout
    .map((entry) => ({ entry, def: cardByKey.get(entry.key) }))
    .filter((row): row is { entry: LayoutEntry; def: BentoCardDef } => Boolean(row.def))
    .filter(({ def }) => {
      if (!def.hideFlag) return true;
      const flagValue = showFlags[def.hideFlag];
      return flagValue !== false;
    });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-3">
        {editing && <SaveIndicator state={saveState} />}
        <button
          type="button"
          onClick={() => {
            if (editing) void doneEditing();
            else setEditing(true);
          }}
          className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-md transition-colors cursor-pointer"
          style={{
            background: editing ? "var(--c-primary)" : "transparent",
            color: editing ? "white" : "var(--c-muted)",
            border: `1px solid ${editing ? "var(--c-primary)" : "var(--c-card-border)"}`,
          }}
        >
          <span className="material-symbols-outlined text-[14px] leading-none">
            {editing ? "check" : "edit"}
          </span>
          {editing ? "Done editing" : "Edit layout"}
        </button>
      </div>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {visible.map(({ entry, def }) => (
          <BentoSlot
            key={entry.key}
            entry={entry}
            def={def}
            editing={editing}
            onDropFrom={(fromKey) => reorder(fromKey, entry.key)}
            onResize={(size) => setSize(entry.key, size)}
            onHide={() => setHidden(entry.key, true)}
          />
        ))}
      </section>

      {editing && hiddenCount(cards, showFlags) > 0 && (
        <HiddenCardsRestoreBar
          cards={cards}
          showFlags={showFlags}
          onRestore={(key) => {
            const def = cards.find((c) => c.key === key);
            if (def?.hideFlag) {
              setShowFlags((prev) => ({ ...prev, [def.hideFlag!]: true }));
              queueSave();
            }
          }}
        />
      )}
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "idle") return null;
  const map = {
    saving: { label: "Saving…", color: "var(--c-subtle)" },
    saved: { label: "Saved", color: "var(--c-stat3)" },
    error: { label: "Save failed", color: "#ef4444" },
  } as const;
  const c = map[state];
  return (
    <span className="text-[11px]" style={{ color: c.color }}>
      {c.label}
    </span>
  );
}

function hiddenCount(cards: BentoCardDef[], flags: ShowFlags): number {
  let n = 0;
  for (const c of cards) {
    if (c.hideFlag && flags[c.hideFlag] === false) n++;
  }
  return n;
}

interface SlotProps {
  entry: LayoutEntry;
  def: BentoCardDef;
  editing: boolean;
  // Called when another card was dropped onto this one. The dragged card's
  // key comes from dataTransfer — no React-state race.
  onDropFrom: (fromKey: string) => void;
  onResize: (size: CardSize) => void;
  onHide: () => void;
}

function BentoSlot({ entry, def, editing, onDropFrom, onResize, onHide }: SlotProps) {
  const [over, setOver] = useState(false);
  const [dragging, setDragging] = useState(false);
  const spanClass = entry.size === "wide" ? "lg:col-span-2" : "";

  return (
    <div
      className={`relative ${spanClass} ${editing ? "select-none" : ""}`}
      style={{
        opacity: dragging ? 0.4 : 1,
        outline: editing
          ? `1.5px dashed ${over ? "var(--c-primary)" : "var(--c-card-border)"}`
          : undefined,
        outlineOffset: editing ? "6px" : undefined,
        borderRadius: "16px",
        transition: "opacity 120ms",
      }}
      draggable={editing}
      onDragStart={(e) => {
        if (!editing) return;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData(DRAG_DATA_KEY, entry.key);
        // Plain-text fallback for browsers that drop custom MIME types.
        e.dataTransfer.setData("text/plain", entry.key);
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
      onDragOver={(e) => {
        if (!editing) return;
        // Only highlight when this is a bento drag (not a random file drag).
        const types = Array.from(e.dataTransfer.types);
        if (!types.includes(DRAG_DATA_KEY) && !types.includes("text/plain")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (!over) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!editing) return;
        e.preventDefault();
        setOver(false);
        const fromKey =
          e.dataTransfer.getData(DRAG_DATA_KEY) ||
          e.dataTransfer.getData("text/plain");
        if (fromKey) onDropFrom(fromKey);
      }}
    >
      {editing && (
        <div
          className="absolute -top-3 left-3 z-30 flex items-center gap-1 px-2 py-1 rounded-full shadow-md"
          style={{
            background: "var(--c-bg)",
            border: "1px solid var(--c-card-border)",
          }}
        >
          <span
            className="material-symbols-outlined text-[14px] leading-none cursor-grab"
            style={{ color: "var(--c-muted)" }}
            title="Drag to reorder"
          >
            drag_indicator
          </span>
          <button
            type="button"
            onClick={() => onResize(entry.size === "normal" ? "wide" : "normal")}
            className="text-[10px] font-semibold px-2 py-0.5 rounded-full cursor-pointer hover:[background:var(--c-row-hover)]"
            style={{
              color: "var(--c-primary)",
              background: "var(--c-primary-m)",
            }}
            title="Toggle size"
          >
            {entry.size === "normal" ? "→ Wide" : "→ Normal"}
          </button>
          {def.hideFlag && (
            <button
              type="button"
              onClick={onHide}
              aria-label="Hide card"
              className="p-0.5 rounded-md cursor-pointer hover:[background:var(--c-row-hover)]"
              style={{ color: "var(--c-subtle)" }}
              title="Hide card"
            >
              <span className="material-symbols-outlined text-[14px] leading-none">
                visibility_off
              </span>
            </button>
          )}
        </div>
      )}
      <div style={{ pointerEvents: editing ? "none" : "auto" }}>{def.node}</div>
    </div>
  );
}

function HiddenCardsRestoreBar({
  cards,
  showFlags,
  onRestore,
}: {
  cards: BentoCardDef[];
  showFlags: ShowFlags;
  onRestore: (key: string) => void;
}) {
  const hidden = cards.filter((c) => c.hideFlag && showFlags[c.hideFlag] === false);
  if (hidden.length === 0) return null;
  return (
    <div
      className="glass-card rounded-xl p-3 flex items-center gap-3 flex-wrap"
      style={{ border: "1px dashed var(--c-card-border)" }}
    >
      <p
        className="text-[11px] uppercase tracking-wider"
        style={{ color: "var(--c-subtle)" }}
      >
        Hidden cards:
      </p>
      {hidden.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={() => onRestore(c.key)}
          className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-full cursor-pointer hover:[background:var(--c-row-hover)]"
          style={{
            color: "var(--c-muted)",
            border: "1px solid var(--c-card-border)",
          }}
        >
          <span className="material-symbols-outlined text-[12px] leading-none">
            visibility
          </span>
          {prettyKey(c.key)}
        </button>
      ))}
    </div>
  );
}

function prettyKey(key: string): string {
  return key
    .replace(/^recipe:/, "Recipe · ")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Reconcile the saved layout with the cards the server actually rendered.
// - Drops entries whose card no longer exists (e.g. a deleted recipe).
// - Appends any new card not in the saved layout (default size 'normal').
// - Preserves order from the saved layout where possible.
export function resolveLayout(
  saved: LayoutEntry[],
  cards: BentoCardDef[]
): LayoutEntry[] {
  const known = new Set(cards.map((c) => c.key));
  const seen = new Set<string>();
  const out: LayoutEntry[] = [];

  for (const entry of saved) {
    if (!known.has(entry.key) || seen.has(entry.key)) continue;
    seen.add(entry.key);
    out.push({
      key: entry.key,
      size: entry.size === "wide" ? "wide" : "normal",
    });
  }
  for (const def of cards) {
    if (seen.has(def.key)) continue;
    out.push({ key: def.key, size: def.defaultSize ?? "normal" });
  }
  return out;
}
