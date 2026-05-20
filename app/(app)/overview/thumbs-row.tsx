"use client";

import { useState } from "react";

interface Props {
  digestId: string | null;
  section: string;
  itemRef: string;
}

// Tiny up/down feedback affordance shown next to brief items. Optimistic toggle:
// clicking the same signal twice clears it; clicking the opposite signal flips.
// Hidden by default, revealed on hover of the parent (parent uses `group`).
export function ThumbsRow({ digestId, section, itemRef }: Props) {
  const [signal, setSignal] = useState<1 | -1 | 0>(0);
  const [busy, setBusy] = useState(false);

  if (!digestId) return null;

  async function send(next: 1 | -1) {
    if (busy) return;
    const previous = signal;
    const target = previous === next ? 0 : next;
    setBusy(true);
    setSignal(target);
    try {
      await fetch("/api/digests/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ digestId, section, itemRef, signal: target }),
      });
    } catch {
      setSignal(previous);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inline-flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          send(1);
        }}
        aria-label="More like this"
        title="More like this"
        disabled={busy}
        className="cursor-pointer p-1 rounded-md hover:[background:var(--c-row-hover)]"
        style={{ color: signal === 1 ? "var(--c-primary)" : "var(--c-subtle)" }}
      >
        <span className="material-symbols-outlined text-[14px] leading-none">thumb_up</span>
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          send(-1);
        }}
        aria-label="Less like this"
        title="Less like this"
        disabled={busy}
        className="cursor-pointer p-1 rounded-md hover:[background:var(--c-row-hover)]"
        style={{ color: signal === -1 ? "#ef4444" : "var(--c-subtle)" }}
      >
        <span className="material-symbols-outlined text-[14px] leading-none">thumb_down</span>
      </button>
    </div>
  );
}
