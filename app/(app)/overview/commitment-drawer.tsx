"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { CommitmentDrawerPayload } from "@/app/api/commitments/[id]/route";

interface Props {
  commitmentId: string | null;
  onClose: () => void;
}

function relativeAge(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "now";
  const days = Math.floor(ms / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export function CommitmentDrawer({ commitmentId, onClose }: Props) {
  const router = useRouter();
  const [data, setData] = useState<CommitmentDrawerPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState<"done" | "dismissed" | null>(null);

  useEffect(() => {
    if (!commitmentId) {
      setData(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    fetch(`/api/commitments/${commitmentId}`)
      .then(async (r) => {
        if (cancelled) return;
        if (r.status === 404) {
          setError("This promise is gone — it may have been deleted.");
          return;
        }
        if (!r.ok) {
          setError("Couldn't load the promise.");
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
  }, [commitmentId]);

  useEffect(() => {
    if (!commitmentId) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [commitmentId, onClose]);

  if (!commitmentId) return null;

  async function resolve(status: "done" | "dismissed") {
    if (!data) return;
    setResolving(status);
    try {
      const res = await fetch(`/api/commitments/${data.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        // Trigger a refresh of server data so the card reflects the change,
        // then close the drawer.
        router.refresh();
        onClose();
        return;
      }
    } catch {
      // fall through to reset
    }
    setResolving(null);
  }

  const gmailHref = data?.source_email?.gmail_url ?? null;

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
              className="inline-flex items-center text-[10px] font-mono uppercase tracking-wider mb-2 px-1.5 py-0.5 rounded"
              style={{ color: "var(--c-stat1)", background: "var(--c-stat1-icon)" }}
            >
              Promise
            </p>
            <h2
              className="text-[18px] font-semibold leading-snug"
              style={{ color: "var(--c-fg)" }}
            >
              {data?.text ?? (loading ? "…" : "Loading promise…")}
            </h2>
            {data && (
              <p
                className="text-[11px] mt-1.5"
                style={{ color: "var(--c-subtle)" }}
              >
                Surfaced {relativeAge(data.created_at)}
                {data.status !== "open" && ` · ${data.status}`}
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
              Loading…
            </p>
          )}
          {error && (
            <p className="text-[13px]" style={{ color: "var(--c-muted)" }}>
              {error}
            </p>
          )}

          {data && (
            <>
              {data.source_email ? (
                <section className="space-y-2">
                  <p
                    className="text-[10px] uppercase tracking-widest"
                    style={{ color: "var(--c-subtle)" }}
                  >
                    Surfaced from
                  </p>
                  <div
                    className="rounded-xl p-4 space-y-2"
                    style={{ background: "var(--c-row-hover)" }}
                  >
                    <p
                      className="text-[13px] font-semibold"
                      style={{ color: "var(--c-fg)" }}
                    >
                      {data.source_email.subject || "(no subject)"}
                    </p>
                    <p
                      className="text-[11px]"
                      style={{ color: "var(--c-muted)" }}
                    >
                      <strong>{data.source_email.from_addr || "Unknown sender"}</strong>
                      {data.source_email.date_sent &&
                        ` · ${new Date(data.source_email.date_sent).toLocaleDateString()}`}
                    </p>
                    {data.source_email.snippet && (
                      <p
                        className="text-[12px] leading-relaxed italic"
                        style={{ color: "var(--c-fg)" }}
                      >
                        "{data.source_email.snippet}"
                      </p>
                    )}
                  </div>
                </section>
              ) : (
                <p className="text-[12px]" style={{ color: "var(--c-subtle)" }}>
                  No source email on file for this promise.
                </p>
              )}

              {data.entitySlugs.length > 0 && (
                <section className="space-y-2">
                  <p
                    className="text-[10px] uppercase tracking-widest"
                    style={{ color: "var(--c-subtle)" }}
                  >
                    People & projects · {data.entitySlugs.length}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {data.entitySlugs.map((slug) => (
                      <Link
                        key={slug}
                        href={`/overview?slug=${encodeURIComponent(slug)}`}
                        className="text-[11px] font-mono px-2 py-1 rounded-md transition-colors hover:[background:var(--c-row-hover)]"
                        style={{
                          color: "var(--c-fg)",
                          border: "1px solid var(--c-divider)",
                        }}
                      >
                        {slug}
                      </Link>
                    ))}
                  </div>
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
            {gmailHref && (
              <a
                href={gmailHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[12px] font-semibold px-3 py-1.5 rounded-md transition-colors hover:[background:var(--c-row-hover)]"
                style={{
                  color: "var(--c-primary)",
                  border: "1px solid var(--c-divider)",
                }}
              >
                <span className="material-symbols-outlined text-[14px] leading-none">
                  open_in_new
                </span>
                Open in Gmail
              </a>
            )}
          </div>
          {data?.status === "open" && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => resolve("dismissed")}
                disabled={resolving !== null}
                className="text-[12px] px-3 py-1.5 rounded-md transition-colors hover:[background:var(--c-row-hover)] cursor-pointer disabled:opacity-50"
                style={{ color: "var(--c-subtle)" }}
              >
                Dismiss
              </button>
              <button
                type="button"
                onClick={() => resolve("done")}
                disabled={resolving !== null}
                className="text-[12px] font-semibold px-3 py-1.5 rounded-md transition-colors cursor-pointer disabled:opacity-50"
                style={{
                  color: "var(--c-stat1)",
                  background: "var(--c-stat1-icon)",
                }}
              >
                {resolving === "done" ? "Marking…" : "Mark done"}
              </button>
            </div>
          )}
        </footer>
      </aside>
    </div>
  );
}
