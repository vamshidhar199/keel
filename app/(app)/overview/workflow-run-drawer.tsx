"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { RenderMarkdown } from "../ask/render-markdown";

interface Source {
  ref: string;
  kind: "thread" | "page" | "commitment" | "other";
  label: string;
}

interface Payload {
  run_id: string;
  workflow_id: string;
  workflow_name: string;
  status: "success" | "failed" | "no_data";
  ran_at: string;
  output_text: string | null;
  error: string | null;
  source_refs: Source[];
}

interface Props {
  runId: string | null;
  onClose: () => void;
}

export function WorkflowRunDrawer({ runId, onClose }: Props) {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) {
      setData(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    fetch(`/api/workflow-runs/${runId}`)
      .then(async (r) => {
        if (cancelled) return;
        if (r.status === 404) {
          setError("That workflow run is gone — it may have been deleted with its workflow.");
          return;
        }
        if (!r.ok) {
          setError("Couldn't load the run.");
          return;
        }
        setData(await r.json());
      })
      .catch(() => {
        if (!cancelled) setError("Network error.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [runId]);

  useEffect(() => {
    if (!runId) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [runId, onClose]);

  if (!runId) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="absolute inset-0"
        style={{ background: "rgba(15,15,20,0.45)", backdropFilter: "blur(2px)" }}
      />
      <aside
        onClick={(e) => e.stopPropagation()}
        className="relative h-full w-full max-w-[600px] flex flex-col shadow-2xl"
        style={{
          background: "var(--c-bg)",
          borderLeft: "1px solid var(--c-card-border)",
        }}
      >
        <header
          className="flex items-start justify-between gap-3 px-6 py-5 shrink-0"
          style={{ borderBottom: "1px solid var(--c-divider)" }}
        >
          <div className="min-w-0 flex-1">
            <p
              className="inline-flex items-center text-[10px] font-mono uppercase tracking-wider mb-1.5 px-1.5 py-0.5 rounded"
              style={{
                color: "var(--c-stat3)",
                background: "var(--c-stat3-icon)",
              }}
            >
              Workflow run
            </p>
            <h2
              className="text-[20px] font-bold leading-tight"
              style={{ color: "var(--c-fg)" }}
            >
              {data?.workflow_name ?? (loading ? "…" : "Run")}
            </h2>
            {data?.ran_at && (
              <p
                className="text-[11px] mt-1"
                style={{ color: "var(--c-subtle)" }}
              >
                Ran {new Date(data.ran_at).toLocaleString()}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="material-symbols-outlined text-[20px] leading-none p-1 rounded-md cursor-pointer hover:[background:var(--c-row-hover)]"
            style={{ color: "var(--c-subtle)" }}
          >
            close
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {loading && (
            <p className="text-[13px]" style={{ color: "var(--c-subtle)" }}>
              Loading run…
            </p>
          )}
          {error && (
            <p className="text-[13px]" style={{ color: "var(--c-muted)" }}>
              {error}
            </p>
          )}

          {data && (
            <>
              {data.status === "failed" && data.error && (
                <section
                  className="rounded-xl p-4"
                  style={{
                    background: "rgba(239,68,68,0.08)",
                    border: "1px solid rgba(239,68,68,0.25)",
                  }}
                >
                  <p
                    className="text-[10px] uppercase tracking-widest mb-1"
                    style={{ color: "#ef4444" }}
                  >
                    Run failed
                  </p>
                  <p className="text-[13px]" style={{ color: "var(--c-fg)" }}>
                    {data.error}
                  </p>
                </section>
              )}

              {data.status === "no_data" && (
                <section
                  className="rounded-xl p-4"
                  style={{ background: "var(--c-row-hover)" }}
                >
                  <p
                    className="text-[10px] uppercase tracking-widest mb-1"
                    style={{ color: "var(--c-subtle)" }}
                  >
                    No data
                  </p>
                  <p className="text-[13px]" style={{ color: "var(--c-muted)" }}>
                    Nothing matched the workflow&apos;s filter on this run. The
                    next scheduled fire will try again.
                  </p>
                </section>
              )}

              {data.output_text && (
                <article className="text-[14px] leading-relaxed">
                  <RenderMarkdown content={data.output_text} />
                </article>
              )}

              {data.source_refs.length > 0 && (
                <section className="space-y-2">
                  <p
                    className="text-[10px] uppercase tracking-widest"
                    style={{ color: "var(--c-subtle)" }}
                  >
                    Source items · {data.source_refs.length}
                  </p>
                  <ul className="space-y-2">
                    {data.source_refs.map((s) => {
                      const href =
                        s.kind === "thread"
                          ? `https://mail.google.com/mail/u/0/#inbox/${s.ref}`
                          : s.kind === "page"
                          ? `/pages/${s.ref}`
                          : null;
                      const inner = (
                        <div
                          className="rounded-lg p-2.5 transition-colors hover:[background:var(--c-row-hover)]"
                          style={{ border: "1px solid var(--c-divider)" }}
                        >
                          <p
                            className="text-[12px] font-semibold truncate"
                            style={{ color: "var(--c-fg)" }}
                          >
                            {s.label}
                          </p>
                          <p
                            className="text-[10px] font-mono mt-0.5"
                            style={{ color: "var(--c-subtle)" }}
                          >
                            {s.kind} · {s.ref}
                          </p>
                        </div>
                      );
                      return (
                        <li key={s.ref}>
                          {href ? (
                            href.startsWith("/") ? (
                              <Link href={href} className="block">
                                {inner}
                              </Link>
                            ) : (
                              <a
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block"
                              >
                                {inner}
                              </a>
                            )
                          ) : (
                            inner
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>

        <footer
          className="flex items-center justify-end gap-3 px-6 py-4 shrink-0"
          style={{ borderTop: "1px solid var(--c-divider)" }}
        >
          {data && (
            <Link
              href={`/workflows/${data.workflow_id}`}
              className="inline-flex items-center gap-1 text-[12px] font-semibold px-3 py-1.5 rounded-md transition-colors hover:[background:var(--c-row-hover)]"
              style={{ color: "var(--c-primary)" }}
            >
              Open workflow
              <span className="material-symbols-outlined text-[14px] leading-none">
                arrow_forward
              </span>
            </Link>
          )}
        </footer>
      </aside>
    </div>
  );
}
