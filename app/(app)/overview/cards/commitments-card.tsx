"use client";

import { useState } from "react";
import { BentoCard, BentoEmpty } from "./bento-card";
import { ThumbsRow } from "../thumbs-row";
import { QuickViewLink } from "../quick-view-link";
import type { OpenCommitment } from "@/lib/commitments";

interface Props {
  initial: OpenCommitment[];
  digestId: string | null;
}

export function CommitmentsCard({ initial, digestId }: Props) {
  const [items, setItems] = useState(initial);
  const [pending, setPending] = useState<Set<string>>(new Set());

  async function resolve(id: string, status: "done" | "dismissed") {
    setPending((prev) => new Set(prev).add(id));
    setItems((prev) => prev.filter((c) => c.id !== id));

    try {
      const res = await fetch(`/api/commitments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        // Roll back on failure.
        const restored = initial.find((c) => c.id === id);
        if (restored) setItems((prev) => [...prev, restored]);
      }
    } catch {
      const restored = initial.find((c) => c.id === id);
      if (restored) setItems((prev) => [...prev, restored]);
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  return (
    <BentoCard icon="task_alt" title="Today's promises" statVar="stat1" count={items.length}>
      {items.length === 0 ? (
        <BentoEmpty message="Nothing pending. When you commit to something in an email, I'll surface it here." />
      ) : (
        <ul className="space-y-2">
          {items.map((c) => (
            <li
              key={c.id}
              className={`flex items-start gap-2 group transition-opacity ${
                pending.has(c.id) ? "opacity-50" : ""
              }`}
            >
              <button
                onClick={() => resolve(c.id, "done")}
                disabled={pending.has(c.id)}
                title="Mark done"
                aria-label="Mark done"
                className="cursor-pointer mt-[2px] w-5 h-5 inline-flex items-center justify-center rounded-md transition-colors hover:[background:var(--c-stat1-icon)]"
                style={{ border: "1.5px solid var(--c-card-border)" }}
              >
                <span
                  className="material-symbols-outlined text-[14px] leading-none opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ color: "var(--c-stat1)" }}
                >
                  check
                </span>
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] leading-snug" style={{ color: "var(--c-fg)" }}>
                  {c.text}
                </p>
                {c.entity_slug && (
                  <QuickViewLink
                    slug={c.entity_slug}
                    className="text-[10px] font-mono hover:underline cursor-pointer"
                  >
                    <span style={{ color: "var(--c-subtle)" }}>{c.entity_slug}</span>
                  </QuickViewLink>
                )}
              </div>
              <ThumbsRow digestId={digestId} section="commitments" itemRef={c.id} />
              <button
                onClick={() => resolve(c.id, "dismissed")}
                disabled={pending.has(c.id)}
                title="Dismiss"
                aria-label="Dismiss"
                className="cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity p-1"
                style={{ color: "var(--c-subtle)" }}
              >
                <span className="material-symbols-outlined text-[14px] leading-none">close</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </BentoCard>
  );
}
