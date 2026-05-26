"use client";

import { useState, type MouseEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BentoCard, BentoEmpty } from "./bento-card";
import { ThumbsRow } from "../thumbs-row";
import type { OpenCommitment } from "@/lib/commitments";

interface Props {
  initial: OpenCommitment[];
  digestId: string | null;
}

export function CommitmentsCard({ initial, digestId }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [items, setItems] = useState(initial);
  const [pending, setPending] = useState<Set<string>>(new Set());

  function openDrawer(commitmentId: string) {
    const next = new URLSearchParams(params.toString());
    next.set("commitment", commitmentId);
    router.replace(`/overview?${next.toString()}`, { scroll: false });
  }

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

  // Buttons nested inside the clickable row must stop propagation so clicking
  // them doesn't ALSO trigger openDrawer for the row.
  function stop(handler: () => void) {
    return (e: MouseEvent) => {
      e.stopPropagation();
      handler();
    };
  }

  return (
    <BentoCard icon="task_alt" title="Open promises" statVar="stat1" count={items.length}>
      {items.length === 0 ? (
        <BentoEmpty message="Nothing pending. When you commit to something in an email, I'll surface it here." />
      ) : (
        <ul className="space-y-2">
          {items.map((c) => (
            <li
              key={c.id}
              onClick={() => openDrawer(c.id)}
              className={`flex items-start gap-2 group rounded-md -mx-2 px-2 py-1.5 transition-colors cursor-pointer hover:[background:var(--c-row-hover)] ${
                pending.has(c.id) ? "opacity-50 pointer-events-none" : ""
              }`}
            >
              <button
                onClick={stop(() => resolve(c.id, "done"))}
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
                {c.entitySlugs.length > 0 && (
                  <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-0.5">
                    {c.entitySlugs.map((slug) => (
                      <span
                        key={slug}
                        className="text-[10px] font-mono"
                        style={{ color: "var(--c-subtle)" }}
                      >
                        {slug}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div onClick={(e) => e.stopPropagation()}>
                <ThumbsRow digestId={digestId} section="commitments" itemRef={c.id} />
              </div>
              <button
                onClick={stop(() => resolve(c.id, "dismissed"))}
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
