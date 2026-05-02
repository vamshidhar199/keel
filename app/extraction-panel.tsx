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
      // Poll until pending count stops dropping.
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

  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-6 shadow-sm w-full max-w-sm space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-400 uppercase tracking-wide">Knowledge Extraction</p>
        {pages > 0 && (
          <span className="text-xs text-violet-600 font-medium bg-violet-50 px-2 py-0.5 rounded-full">
            {pages} pages
          </span>
        )}
      </div>

      {/* Progress bar */}
      {total > 0 && (
        <div>
          <div className="flex justify-between text-xs text-zinc-400 mb-1">
            <span>{extracted + skipped} / {total} processed</span>
            <span>{Math.round(((extracted + skipped) / total) * 100)}%</span>
          </div>
          <div className="w-full bg-zinc-100 rounded-full h-1.5">
            <div
              className="bg-violet-500 h-1.5 rounded-full transition-all"
              style={{ width: `${((extracted + skipped) / total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-zinc-50 rounded p-2">
          <p className="text-zinc-400">Pending</p>
          <p className="font-semibold text-zinc-700">{pending}</p>
        </div>
        <div className="bg-emerald-50 rounded p-2">
          <p className="text-emerald-500">Extracted</p>
          <p className="font-semibold text-emerald-700">{extracted}</p>
        </div>
        <div className="bg-zinc-50 rounded p-2">
          <p className="text-zinc-400">Skipped</p>
          <p className="font-semibold text-zinc-500">{skipped}</p>
        </div>
        <div className="bg-red-50 rounded p-2">
          <p className="text-red-400">Failed</p>
          <p className="font-semibold text-red-600">{failed}</p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={() => handleExtract(20)}
          disabled={running || pending === 0}
          className="flex-1 px-3 py-2 text-xs bg-zinc-800 text-white rounded-lg hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {running ? "Running…" : "Extract 20"}
        </button>
        <button
          onClick={() => handleExtract(pending)}
          disabled={running || pending === 0}
          className="flex-1 px-3 py-2 text-xs bg-violet-600 text-white rounded-lg hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {running ? "Running…" : `Extract all (${pending})`}
        </button>
      </div>

      {msg && <p className="text-xs text-zinc-400 text-center">{msg}</p>}
    </div>
  );
}
