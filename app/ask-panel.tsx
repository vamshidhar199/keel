"use client";

import { useState } from "react";

interface Citation {
  chunk_id: number;
  slug: string;
  title: string;
}

interface Hit {
  chunk_id: number;
  slug: string;
  title: string;
  score: number;
}

interface QueryResponse {
  answer: string;
  citations: Citation[];
  invalidCitations: number[];
  hits: Hit[];
}

export function AskPanel() {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QueryResponse | null>(null);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || loading) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Query failed");
      } else {
        setResult(data);
      }
    } catch {
      setError("Network error — check server logs");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-6 shadow-sm w-full max-w-sm space-y-4">
      <p className="text-xs text-zinc-400 uppercase tracking-wide">Ask your knowledge</p>

      <form onSubmit={ask} className="flex gap-2">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. who reached out about a job?"
          disabled={loading}
          className="flex-1 px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-200 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={loading || !question.trim()}
          className="px-3 py-2 text-xs bg-violet-600 text-white rounded-lg hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? "…" : "Ask"}
        </button>
      </form>

      {error && (
        <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded">{error}</p>
      )}

      {result && (
        <div className="space-y-3">
          <div className="text-sm text-zinc-700 whitespace-pre-wrap leading-relaxed">
            {result.answer}
          </div>

          {result.invalidCitations.length > 0 && (
            <p className="text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded">
              Warning: model cited {result.invalidCitations.length} chunk
              {result.invalidCitations.length > 1 ? "s" : ""} not in the source list
              ([chunk:{result.invalidCitations.join("], [chunk:")}]).
            </p>
          )}

          {result.citations.length > 0 && (
            <div className="border-t border-zinc-100 pt-3">
              <p className="text-xs text-zinc-400 uppercase tracking-wide mb-2">
                Sources
              </p>
              <ul className="space-y-1">
                {result.citations.map((c) => (
                  <li key={c.chunk_id} className="text-xs text-zinc-600">
                    <span className="text-violet-600 font-mono">
                      [chunk:{c.chunk_id}]
                    </span>{" "}
                    {c.title}{" "}
                    <span className="text-zinc-400 font-mono">{c.slug}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.hits.length > 0 && result.citations.length === 0 && (
            <p className="text-xs text-zinc-400 italic">
              {result.hits.length} pages matched but model did not cite them.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
