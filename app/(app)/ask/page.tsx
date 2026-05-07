"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

interface Citation {
  chunk_id: number;
  slug: string;
  title: string;
}

interface WebCit {
  id: number;
  title: string;
  url: string;
}

interface UserMessage {
  role: "user";
  content: string;
}

interface AssistantMessage {
  role: "assistant";
  content: string;
  citations: Citation[];
  webCitations: WebCit[];
  invalidCitations: number[];
}

type Message = UserMessage | AssistantMessage;

const SUGGESTED = [
  { icon: "trending_up", label: "What's been top of mind lately?", statVar: "stat2" },
  { icon: "groups", label: "Who have I been talking to most?", statVar: "stat1" },
  { icon: "description", label: "Summarize my recent projects", statVar: "stat3" },
];

function renderAnswer(text: string, citations: Citation[]): React.ReactNode {
  const chunkToIndex = new Map(citations.map((c, i) => [c.chunk_id, i + 1]));
  return text.split("\n").map((line, lineIdx, arr) => (
    <span key={lineIdx}>
      {renderLine(line, chunkToIndex)}
      {lineIdx < arr.length - 1 && "\n"}
    </span>
  ));
}

function renderLine(text: string, chunkToIndex: Map<number, number>): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\[chunk:(\d+)\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    if (match[1] !== undefined) {
      parts.push(
        <strong key={key++} className="font-semibold" style={{ color: "var(--c-fg)" }}>{match[1]}</strong>
      );
    } else if (match[2] !== undefined) {
      const idx = chunkToIndex.get(parseInt(match[2], 10));
      if (idx !== undefined) {
        parts.push(
          <sup key={key++} className="text-[10px] font-medium ml-0.5" style={{ color: "var(--c-primary)" }}>[{idx}]</sup>
        );
      }
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

export default function AskPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  function buildHistory() {
    return messages.map((m) => ({ role: m.role, content: m.content }));
  }

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    const q = input.trim();
    if (!q || loading) return;

    const userMsg: UserMessage = { role: "user", content: q };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, history: buildHistory() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Query failed");
        setMessages((prev) => prev.slice(0, -1));
      } else {
        const assistantMsg: AssistantMessage = {
          role: "assistant",
          content: data.answer,
          citations: data.citations ?? [],
          webCitations: data.webCitations ?? [],
          invalidCitations: data.invalidCitations ?? [],
        };
        setMessages((prev) => [...prev, assistantMsg]);
      }
    } catch {
      setError("Network error — check server logs");
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setLoading(false);
      textareaRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function newChat() {
    setMessages([]);
    setError(null);
    setInput("");
    textareaRef.current?.focus();
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Header */}
      <header className="header-glass h-16 shrink-0 flex items-center justify-between px-6 z-30">
        <span className="text-2xl font-bold" style={{ color: "var(--c-fg)" }}>Ask</span>
        {messages.length > 0 && (
          <button
            onClick={newChat}
            className="glass-card text-[11px] font-semibold px-4 py-2 rounded-lg transition-colors tracking-wide"
            style={{ color: "var(--c-muted)" }}
          >
            New chat
          </button>
        )}
      </header>

      {/* Messages or empty state */}
      <div className="flex-1 overflow-y-auto relative">
        {messages.length === 0 && !loading ? (
          <div className="flex items-center justify-center h-full px-6 pb-24">
            <div className="text-center max-w-2xl relative z-10">
              <div
                className="mb-6 inline-flex p-5 rounded-full"
                style={{
                  background: "var(--c-primary-m)",
                  border: "1px solid var(--c-card-border)",
                }}
              >
                <span className="material-symbols-outlined text-[48px] leading-none" style={{ color: "var(--c-primary)" }}>psychology</span>
              </div>
              <h2
                className="text-5xl font-bold mb-4"
                style={{ color: "var(--c-fg)" }}
              >
                Knowledge Synthesis
              </h2>
              <p className="text-lg mb-8" style={{ color: "var(--c-muted)" }}>
                Query your personal data landscape. Get answers with traceable sources.
              </p>
              <div className="flex flex-wrap justify-center gap-3">
                {SUGGESTED.map((s) => (
                  <button
                    key={s.label}
                    onClick={() => { setInput(s.label); textareaRef.current?.focus(); }}
                    className="glass-panel px-5 py-3 rounded-full transition-all flex items-center gap-2 text-[12px] font-medium"
                    style={{ color: "var(--c-muted)" }}
                  >
                    <span className="material-symbols-outlined text-[16px] leading-none" style={{ color: `var(--c-${s.statVar})` }}>
                      {s.icon}
                    </span>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto px-6 py-6 space-y-6 relative z-10">
            {messages.map((msg, i) =>
              msg.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <div
                    className="text-sm rounded-2xl rounded-tr-sm px-4 py-3 max-w-[80%]"
                    style={{
                      background: "var(--c-primary-m)",
                      color: "var(--c-fg)",
                      border: "1px solid var(--c-card-border)",
                    }}
                  >
                    {msg.content}
                  </div>
                </div>
              ) : (
                <AssistantBubble key={i} message={msg} />
              )
            )}

            {loading && (
              <div className="flex gap-1.5 items-center px-1 py-2">
                <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: "var(--c-primary)", animationDelay: "0ms" }} />
                <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: "var(--c-primary)", animationDelay: "150ms" }} />
                <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: "var(--c-primary)", animationDelay: "300ms" }} />
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="px-6 py-2 shrink-0">
          <p
            className="max-w-3xl mx-auto text-xs px-4 py-2 rounded-lg"
            style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)" }}
          >
            {error}
          </p>
        </div>
      )}

      {/* Input bar */}
      <div className="shrink-0 w-full max-w-3xl mx-auto px-6 pb-6">
        <form
          onSubmit={send}
          className="glass-panel rounded-2xl flex items-end gap-3 p-3 shadow-2xl"
          style={{ outline: loading ? "2px solid var(--c-card-border)" : "none" }}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={messages.length > 0 ? "Ask a follow-up…" : "Type your query… (e.g., Who have I been talking to most?)"}
            disabled={loading}
            rows={1}
            autoFocus
            className="flex-1 bg-transparent border-none focus:ring-0 text-sm py-2 px-2 resize-none outline-none"
            style={{ color: "var(--c-fg)", minHeight: "36px", maxHeight: "120px" }}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="vibrant-gradient p-3 rounded-xl text-white shadow-lg hover:scale-105 transition-transform disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 shrink-0"
          >
            <span
              className="material-symbols-outlined text-[18px] leading-none"
              style={{ fontVariationSettings: "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24" }}
            >
              send
            </span>
          </button>
        </form>
        <p className="text-center text-[10px] mt-2 tracking-wide" style={{ color: "var(--c-subtle)" }}>
          Mettrie may provide inaccurate results. Verify important information.
        </p>
      </div>
    </div>
  );
}

function AssistantBubble({ message }: { message: AssistantMessage }) {
  const { content, citations, webCitations, invalidCitations } = message;
  return (
    <div className="space-y-3">
      <div className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: "var(--c-fg)" }}>
        {renderAnswer(content, citations)}
      </div>

      {invalidCitations.length > 0 && (
        <p
          className="text-xs px-3 py-2 rounded-lg"
          style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)" }}
        >
          Warning: {invalidCitations.length} citation{invalidCitations.length > 1 ? "s" : ""} could not be verified.
        </p>
      )}

      {citations.length > 0 && (
        <div className="glass-panel rounded-xl px-4 py-3 space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--c-subtle)" }}>Knowledge base</p>
          {citations.map((c, i) => (
            <div key={c.chunk_id} className="flex items-baseline gap-2">
              <span className="text-[10px] font-medium shrink-0 w-6" style={{ color: "var(--c-primary)" }}>[{i + 1}]</span>
              <Link
                href={`/pages/${c.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm transition-colors hover:opacity-80"
                style={{ color: "var(--c-muted)" }}
              >
                {c.title}
              </Link>
              <span className="text-[10px] font-mono truncate" style={{ color: "var(--c-subtle)" }}>{c.slug}</span>
            </div>
          ))}
        </div>
      )}

      {webCitations.length > 0 && (
        <div className="glass-panel rounded-xl px-4 py-3 space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--c-subtle)" }}>Web sources</p>
          {webCitations.map((w) => (
            <div key={w.id} className="flex items-baseline gap-2">
              <span className="text-[10px] font-medium shrink-0 w-6" style={{ color: "var(--c-stat2)" }}>[{w.id}]</span>
              <a
                href={w.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm transition-colors hover:opacity-80 truncate"
                style={{ color: "var(--c-muted)" }}
              >
                {w.title || w.url}
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
