"use client";

import { useState } from "react";

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

  async function handleExtract(limit: number) {
    setRunning(true);
    setMsg(null);
    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit }),
      });
      if (!res.ok) {
        setMsg("Failed to start extraction");
        return;
      }
      setMsg(`Processing up to ${limit} emails…`);
      let unchanged = 0;
      while (unchanged < 3) {
        await new Promise((r) => setTimeout(r, 3000));
        const s = await fetch("/api/extract").then((r) => r.json());
        setPending(s.pending);
        setExtracted(s.extracted);
        setSkipped(s.skipped);
        setFailed(s.failed);
        setPages(s.pagesCreated);
        if (s.pending === pending) unchanged++;
        else unchanged = 0;
        if (s.pending === 0) break;
      }
      setMsg("Done");
    } catch {
      setMsg("Network error — check server logs");
    } finally {
      setRunning(false);
    }
  }

  const total = pending + extracted + skipped + failed;
  const processed = extracted + skipped;

  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-400 uppercase tracking-wide">Extraction</p>
        {pages > 0 && (
          <span className="text-xs text-violet-600 font-medium bg-violet-50 px-2 py-0.5 rounded-full">
            {pages} pages created
          </span>
        )}
      </div>

      {/* Big number */}
      <div>
        <p className="text-2xl font-semibold text-zinc-900">{pages}</p>
        <p className="text-xs text-zinc-400">knowledge pages</p>
      </div>

      {/* Progress bar */}
      {total > 0 && (
        <div>
          <div className="flex justify-between text-xs text-zinc-400 mb-1.5">
            <span>{processed} / {total} processed</span>
            <span>{Math.round((processed / total) * 100)}%</span>
          </div>
          <div className="w-full bg-zinc-100 rounded-full h-1.5">
            <div
              className="bg-violet-500 h-1.5 rounded-full transition-all duration-500"
              style={{ width: `${(processed / total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-2">
        {[
          { label: "Pending", value: pending, color: "text-zinc-700" },
          { label: "Extracted", value: extracted, color: "text-emerald-600" },
          { label: "Skipped", value: skipped, color: "text-zinc-500" },
          { label: "Failed", value: failed, color: "text-red-500" },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-zinc-50 rounded-lg p-3">
            <p className="text-xs text-zinc-400 mb-0.5">{label}</p>
            <p className={`text-lg font-semibold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={() => handleExtract(20)}
          disabled={running || pending === 0}
          className="flex-1 px-3 py-2.5 text-sm font-medium bg-zinc-900 text-white rounded-lg hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {running ? "Running…" : "Extract 20"}
        </button>
        <button
          onClick={() => handleExtract(pending)}
          disabled={running || pending === 0}
          className="flex-1 px-3 py-2.5 text-sm font-medium bg-violet-600 text-white rounded-lg hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {running ? "Running…" : `Extract all (${pending})`}
        </button>
      </div>

      {msg && <p className="text-xs text-zinc-400 text-center">{msg}</p>}
    </div>
  );
}
