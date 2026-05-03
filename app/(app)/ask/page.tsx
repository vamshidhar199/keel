"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

interface Citation {
  chunk_id: number;
  slug: string;
  title: string;
}

interface UserMessage {
  role: "user";
  content: string;
}

interface AssistantMessage {
  role: "assistant";
  content: string;
  citations: Citation[];
  invalidCitations: number[];
}

type Message = UserMessage | AssistantMessage;

// Renders bold (**text**) and [chunk:N] → superscript citation numbers
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
      parts.push(<strong key={key++} className="font-semibold text-zinc-900">{match[1]}</strong>);
    } else if (match[2] !== undefined) {
      const idx = chunkToIndex.get(parseInt(match[2], 10));
      if (idx !== undefined) {
        parts.push(
          <sup key={key++} className="text-[10px] text-violet-500 font-medium ml-0.5">[{idx}]</sup>
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
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  function buildHistory() {
    return messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
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
        setMessages((prev) => prev.slice(0, -1)); // remove optimistic user message
      } else {
        const assistantMsg: AssistantMessage = {
          role: "assistant",
          content: data.answer,
          citations: data.citations ?? [],
          invalidCitations: data.invalidCitations ?? [],
        };
        setMessages((prev) => [...prev, assistantMsg]);
      }
    } catch {
      setError("Network error — check server logs");
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  function newChat() {
    setMessages([]);
    setError(null);
    setInput("");
    inputRef.current?.focus();
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Header */}
      <div className="border-b border-zinc-200 bg-white px-8 py-4 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900">Ask</h1>
        </div>
        {messages.length > 0 && (
          <button
            onClick={newChat}
            className="text-xs text-zinc-500 hover:text-zinc-800 border border-zinc-200 px-3 py-1.5 rounded-lg transition-colors"
          >
            New chat
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 && !loading ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-zinc-400">Ask anything about your knowledge base</p>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto px-8 py-6 space-y-6">
            {messages.map((msg, i) =>
              msg.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <div className="bg-zinc-100 text-zinc-800 text-sm rounded-2xl rounded-tr-sm px-4 py-2.5 max-w-[80%]">
                    {msg.content}
                  </div>
                </div>
              ) : (
                <AssistantBubble key={i} message={msg} />
              )
            )}

            {loading && (
              <div className="flex gap-1.5 items-center px-1">
                <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce [animation-delay:300ms]" />
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="px-8 py-2 shrink-0">
          <p className="max-w-3xl mx-auto text-xs text-red-600 bg-red-50 border border-red-100 px-4 py-2 rounded-lg">
            {error}
          </p>
        </div>
      )}

      {/* Input */}
      <div className="border-t border-zinc-200 bg-white px-8 py-4 shrink-0">
        <form onSubmit={send} className="max-w-3xl mx-auto flex gap-3">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={messages.length > 0 ? "Ask a follow-up…" : "Ask anything about your knowledge…"}
            disabled={loading}
            autoFocus
            className="flex-1 px-4 py-2.5 text-sm text-zinc-900 border border-zinc-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-300 disabled:opacity-50 placeholder:text-zinc-400"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="px-4 py-2.5 text-sm bg-violet-600 text-white rounded-lg hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}

function AssistantBubble({ message }: { message: AssistantMessage }) {
  const { content, citations, invalidCitations } = message;

  return (
    <div className="space-y-3">
      {/* Answer */}
      <div className="text-sm text-zinc-800 leading-relaxed whitespace-pre-wrap">
        {renderAnswer(content, citations)}
      </div>

      {/* Invalid citation warning */}
      {invalidCitations.length > 0 && (
        <p className="text-xs text-amber-600 bg-amber-50 border border-amber-100 px-3 py-2 rounded-lg">
          Warning: {invalidCitations.length} citation{invalidCitations.length > 1 ? "s" : ""} could not be verified.
        </p>
      )}

      {/* Sources */}
      {citations.length > 0 && (
        <div className="border border-zinc-100 rounded-lg px-4 py-3 bg-zinc-50 space-y-1.5">
          <p className="text-xs text-zinc-400 uppercase tracking-wide mb-2">Sources</p>
          {citations.map((c, i) => (
            <div key={c.chunk_id} className="flex items-baseline gap-2">
              <span className="text-xs text-violet-500 font-medium shrink-0 w-6">[{i + 1}]</span>
              <Link
                href={`/pages/${c.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-zinc-700 hover:text-violet-600 transition-colors"
              >
                {c.title}
              </Link>
              <span className="text-xs text-zinc-400 font-mono truncate">{c.slug}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
