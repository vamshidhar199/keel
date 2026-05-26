"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { RenderMarkdown } from "../ask/render-markdown";

interface Source {
  ref: string;
  thread_ref: string | null;
  from_addr: string;
  subject: string;
  date_sent: string | null;
  is_from_user: boolean;
  gmail_url: string | null;
}

interface Fact {
  key: string;
  label: string;
  value: string;
  link?: string;
}

interface Payload {
  slug: string;
  title: string;
  type: string | null;
  kind: string | null;
  facts: Fact[];
  body: string;
  updated_at: string;
  sources: Source[];
}

interface Props {
  slug: string | null;
  onClose: () => void;
}

// Type-aware label used in the drawer header. Maps DB type+kind into a clear
// item name the user understands.
function itemLabel(type: string | null, kind: string | null): string {
  if (kind === "job_listing") return "Opportunity";
  switch (type) {
    case "project":
      return "Project";
    case "person":
      return "Person";
    case "company":
      return "Company";
    case "topic":
      return "Topic";
    default:
      return "Item";
  }
}

// A small color hint per item type so the drawer feels visually anchored.
function itemTone(type: string | null, kind: string | null): { fg: string; bg: string } {
  if (kind === "job_listing") return { fg: "var(--c-stat1)", bg: "var(--c-stat1-icon)" };
  if (type === "project") return { fg: "var(--c-stat3)", bg: "var(--c-stat3-icon)" };
  if (type === "person") return { fg: "var(--c-primary)", bg: "var(--c-primary-m)" };
  return { fg: "var(--c-subtle)", bg: "var(--c-row-hover)" };
}

export function PageDrawer({ slug, onClose }: Props) {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    if (!slug) {
      setData(null);
      setError(null);
      setShowRaw(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    setShowRaw(false);
    fetch(`/api/pages/${slug}`)
      .then(async (r) => {
        if (cancelled) return;
        if (r.status === 404) {
          setError("We don't have details on this item yet — it hasn't surfaced as a tracked page.");
          return;
        }
        if (!r.ok) {
          setError("Couldn't load the details.");
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
  }, [slug]);

  useEffect(() => {
    if (!slug) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [slug, onClose]);

  if (!slug) return null;

  const label = data ? itemLabel(data.type, data.kind) : "";
  const tone = data ? itemTone(data.type, data.kind) : { fg: "", bg: "" };
  const latestThreadHref = data?.sources.find((s) => s.gmail_url)?.gmail_url ?? null;
  const inboundSource = data?.sources.find((s) => !s.is_from_user) ?? null;
  const userSentSource = data?.sources.find((s) => s.is_from_user) ?? null;

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
        className="relative h-full w-full max-w-[540px] flex flex-col shadow-2xl"
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
              style={{ color: tone.fg, background: tone.bg }}
            >
              {label || (loading ? "Loading…" : "Item")}
            </p>
            <h2
              className="text-[20px] font-bold leading-tight"
              style={{ color: "var(--c-fg)" }}
            >
              {data?.title ?? (loading ? "…" : slug)}
            </h2>
            <p
              className="text-[10px] font-mono mt-1 truncate"
              style={{ color: "var(--c-subtle)" }}
            >
              {slug}
            </p>
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
              Loading details…
            </p>
          )}
          {error && (
            <div className="space-y-1.5">
              <p className="text-[13px]" style={{ color: "var(--c-muted)" }}>
                {error}
              </p>
              <p className="text-[11px]" style={{ color: "var(--c-subtle)" }}>
                {slug}
              </p>
            </div>
          )}

          {data && (
            <>
              {/* Inbound surfacing summary — who reached out / when */}
              {inboundSource && (
                <section
                  className="rounded-xl p-4 space-y-1.5"
                  style={{ background: "var(--c-row-hover)" }}
                >
                  <p
                    className="text-[10px] uppercase tracking-widest"
                    style={{ color: "var(--c-subtle)" }}
                  >
                    Surfaced from
                  </p>
                  <p className="text-[13px]" style={{ color: "var(--c-fg)" }}>
                    <strong>{inboundSource.from_addr || "Unknown sender"}</strong>
                    {inboundSource.date_sent &&
                      ` on ${new Date(inboundSource.date_sent).toLocaleDateString()}`}
                  </p>
                  <p
                    className="text-[12px] truncate"
                    style={{ color: "var(--c-muted)" }}
                  >
                    “{inboundSource.subject}”
                  </p>
                  {userSentSource ? (
                    <p
                      className="text-[11px] pt-1"
                      style={{ color: "var(--c-stat3)" }}
                    >
                      You replied
                      {userSentSource.date_sent &&
                        ` on ${new Date(userSentSource.date_sent).toLocaleDateString()}`}
                      .
                    </p>
                  ) : (
                    <p
                      className="text-[11px] pt-1"
                      style={{ color: "var(--c-subtle)" }}
                    >
                      You haven&apos;t replied to this thread yet.
                    </p>
                  )}
                </section>
              )}

              {/* Key facts panel */}
              {data.facts.length > 0 && (
                <section className="space-y-2.5">
                  <p
                    className="text-[10px] uppercase tracking-widest"
                    style={{ color: "var(--c-subtle)" }}
                  >
                    Details
                  </p>
                  <dl
                    className="rounded-xl overflow-hidden"
                    style={{ border: "1px solid var(--c-divider)" }}
                  >
                    {data.facts.map((f, i) => (
                      <div
                        key={f.key}
                        className="flex gap-3 px-4 py-2.5"
                        style={
                          i < data.facts.length - 1
                            ? { borderBottom: "1px solid var(--c-divider)" }
                            : undefined
                        }
                      >
                        <dt
                          className="text-[12px] w-32 shrink-0"
                          style={{ color: "var(--c-subtle)" }}
                        >
                          {f.label}
                        </dt>
                        <dd className="text-[13px] flex-1 min-w-0" style={{ color: "var(--c-fg)" }}>
                          {f.link ? (
                            <Link
                              href={`/overview?slug=${encodeURIComponent(f.link)}`}
                              className="hover:underline"
                              style={{ color: "var(--c-primary)" }}
                            >
                              {f.value}
                            </Link>
                          ) : (
                            <span className="break-words">{f.value}</span>
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              )}

              {/* Sources */}
              {data.sources.length > 0 && (
                <section className="space-y-2">
                  <p
                    className="text-[10px] uppercase tracking-widest"
                    style={{ color: "var(--c-subtle)" }}
                  >
                    Source threads · {data.sources.length}
                  </p>
                  <ul className="space-y-2">
                    {data.sources.map((s) => {
                      const href = s.gmail_url;
                      const inner = (
                        <div
                          className="rounded-lg p-3 transition-colors hover:[background:var(--c-row-hover)]"
                          style={{ border: "1px solid var(--c-divider)" }}
                        >
                          <div className="flex items-baseline justify-between gap-2">
                            <p
                              className="text-[12px] font-semibold truncate flex-1"
                              style={{ color: "var(--c-fg)" }}
                            >
                              {s.subject}
                            </p>
                            {s.is_from_user && (
                              <span
                                className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0"
                                style={{
                                  background: "var(--c-stat3-icon)",
                                  color: "var(--c-stat3)",
                                }}
                              >
                                you sent
                              </span>
                            )}
                          </div>
                          <p
                            className="text-[11px] truncate mt-0.5"
                            style={{ color: "var(--c-subtle)" }}
                          >
                            {s.from_addr}
                            {s.date_sent &&
                              ` · ${new Date(s.date_sent).toLocaleDateString()}`}
                          </p>
                        </div>
                      );
                      return (
                        <li key={s.ref}>
                          {href ? (
                            <a href={href} target="_blank" rel="noopener noreferrer" className="block">
                              {inner}
                            </a>
                          ) : (
                            inner
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}

              {/* Raw page body — hidden behind a toggle so the drawer stays an
                  overview rather than a wall of markdown. */}
              {data.body && data.body.trim().length > 0 && (
                <section className="space-y-2">
                  <button
                    type="button"
                    onClick={() => setShowRaw((v) => !v)}
                    className="text-[11px] uppercase tracking-widest inline-flex items-center gap-1 cursor-pointer hover:underline"
                    style={{ color: "var(--c-subtle)" }}
                  >
                    {showRaw ? "Hide notes" : "Show notes"}
                    <span className="material-symbols-outlined text-[14px] leading-none">
                      {showRaw ? "expand_less" : "expand_more"}
                    </span>
                  </button>
                  {showRaw && (
                    <article className="text-[13px] leading-relaxed">
                      <RenderMarkdown content={data.body} />
                    </article>
                  )}
                </section>
              )}
            </>
          )}
        </div>

        <footer
          className="flex items-center justify-between gap-3 px-6 py-4 shrink-0"
          style={{ borderTop: "1px solid var(--c-divider)" }}
        >
          <div className="flex gap-2">
            {latestThreadHref && (
              <a
                href={latestThreadHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[12px] font-semibold px-3 py-1.5 rounded-md transition-colors hover:[background:var(--c-row-hover)]"
                style={{ color: "var(--c-stat3)" }}
              >
                <span className="material-symbols-outlined text-[14px] leading-none">mail</span>
                Open in Gmail
              </a>
            )}
          </div>
          <Link
            href={`/pages/${slug}`}
            className="inline-flex items-center gap-1 text-[12px] font-semibold px-3 py-1.5 rounded-md transition-colors hover:[background:var(--c-row-hover)]"
            style={{ color: "var(--c-primary)" }}
          >
            Open full page
            <span className="material-symbols-outlined text-[14px] leading-none">arrow_forward</span>
          </Link>
        </footer>
      </aside>
    </div>
  );
}
