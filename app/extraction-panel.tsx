"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  pending: number;
  extracted: number;
  skipped: number;
  failed: number;
  pagesCreated: number;
}

export function ExtractionPanel({
  pending: initialPending,
  extracted: initialExtracted,
  skipped: initialSkipped,
  failed: initialFailed,
  pagesCreated: initialPages,
}: Props) {
  const [pending, setPending] = useState(initialPending);
  const [extracted, setExtracted] = useState(initialExtracted);
  const [skipped, setSkipped] = useState(initialSkipped);
  const [failed, setFailed] = useState(initialFailed);
  const [pages, setPages] = useState(initialPages);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Auto-poll while there's pending work, even when the user didn't click
  // "Extract" themselves — covers the case where a background sync queued
  // events and the user just landed on this page wondering why things look
  // slow. Stops polling once pending hits 0 or the tab is hidden.
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  useEffect(() => {
    if (pending === 0) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled || document.hidden) return;
      try {
        const r = await fetch("/api/extract");
        if (!r.ok) return;
        const s = await r.json();
        setPending(s.pending);
        setExtracted(s.extracted);
        setSkipped(s.skipped);
        setFailed(s.failed);
        setPages(s.pagesCreated);
      } catch {}
    };
    const interval = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [pending]);

  async function handleExtract(limit: number) {
    setRunning(true);
    setMsg(null);
    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit }),
      });
      if (!res.ok) { setMsg("Failed to start extraction"); return; }
      setMsg(`Processing up to ${limit} emails…`);
      let unchanged = 0;
      while (unchanged < 3) {
        await new Promise((r) => setTimeout(r, 3000));
        const s = await fetch("/api/extract").then((r) => r.json());
        setPending(s.pending); setExtracted(s.extracted);
        setSkipped(s.skipped); setFailed(s.failed); setPages(s.pagesCreated);
        if (s.pending === pending) unchanged++; else unchanged = 0;
        if (s.pending === 0) break;
      }
      setMsg("Done");
    } catch { setMsg("Network error — check server logs"); }
    finally { setRunning(false); }
  }

  const total = pending + extracted + skipped + failed;
  const processed = extracted + skipped;
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0;

  // First-sync hint: visible only when a large pending backlog exists and
  // nothing has been processed yet. Sets the expectation that this initial
  // pass takes longer than steady-state syncs without surfacing any API /
  // billing detail to the user.
  const isFirstSync = pending >= 30 && processed === 0 && failed === 0;

  const STATS = [
    { label: "Pending",   value: pending,   dotVar: "--c-muted" },
    { label: "Extracted", value: extracted, dotVar: "--c-stat2" },
    { label: "Skipped",   value: skipped,   dotVar: "--c-stat3" },
    { label: "Failed",    value: failed,    dotVar: "--c-stat1" },
  ];

  return (
    <div className="glass-card rounded-xl p-6">
      {/* Header row */}
      <div className="flex justify-between items-end mb-5">
        <div>
          <h3 className="text-2xl font-semibold" style={{ color: "var(--c-fg)" }}>Extraction Analytics</h3>
          <p className="text-sm mt-1" style={{ color: "var(--c-subtle)" }}>Real-time status of your knowledge synthesis pipeline.</p>
        </div>
        <div className="text-right">
          <span className="text-5xl font-bold" style={{ color: "var(--c-primary)" }}>{pct}%</span>
          <p className="text-[10px] font-semibold uppercase tracking-widest mt-1" style={{ color: "var(--c-subtle)" }}>Complete</p>
        </div>
      </div>

      {/* First-sync hint */}
      {isFirstSync && (
        <div
          className="rounded-lg px-4 py-3 mb-5 text-[12px] leading-relaxed"
          style={{
            background: "var(--c-primary-m)",
            border: "1px solid var(--c-card-border)",
            color: "var(--c-fg)",
          }}
        >
          We&rsquo;re processing your recent emails for the first time. This
          usually takes a few minutes — you can leave this page and come back.
        </div>
      )}

      {/* Progress bar */}
      <div className="h-3 w-full rounded-full overflow-hidden mb-6 relative" style={{ background: "var(--c-surface-low)" }}>
        <div
          className="absolute inset-0 rounded-full transition-all duration-500"
          style={{
            width: `${pct}%`,
            background: "var(--c-gradient)",
          }}
        />
      </div>

      {/* Stat cells */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        {STATS.map(({ label, value, dotVar }) => (
          <div
            key={label}
            className="rounded-lg p-4"
            style={{ background: "var(--c-surface-low)", border: "1px solid var(--c-surface-low-b)" }}
          >
            <p className="text-[10px] font-medium uppercase tracking-wider mb-2" style={{ color: "var(--c-subtle)" }}>{label}</p>
            <div className="flex items-center gap-2">
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: `var(${dotVar})` }}
              />
              <span className="text-2xl font-semibold" style={{ color: "var(--c-fg)" }}>{value.toLocaleString()}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={() => handleExtract(20)}
          disabled={running || pending === 0}
          className="px-5 py-2.5 text-sm font-semibold rounded-xl transition-all hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: "var(--c-btn-bg)", border: "1px solid var(--c-btn-border)", color: "var(--c-fg)" }}
        >
          {running ? "Running…" : "Extract 20"}
        </button>
        <button
          onClick={() => handleExtract(pending)}
          disabled={running || pending === 0}
          className="vibrant-gradient px-5 py-2.5 text-sm font-semibold text-white rounded-xl transition-all hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {running ? "Running…" : `Extract all (${pending})`}
        </button>
        {pages > 0 && (
          <span
            className="text-[11px] font-medium px-3 py-1.5 rounded-full ml-2"
            style={{ background: "var(--c-primary-m)", color: "var(--c-primary)", border: "1px solid var(--c-card-border)" }}
          >
            {pages} pages created
          </span>
        )}
        {msg && <p className="text-[11px] ml-2" style={{ color: "var(--c-subtle)" }}>{msg}</p>}
      </div>
    </div>
  );
}
