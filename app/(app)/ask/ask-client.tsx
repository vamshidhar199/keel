"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { RenderMarkdown } from "./render-markdown";
import { SkillPicker, SlashAutocomplete, type PickerSkill } from "./skill-picker";

const ACTIVE_SKILL_KEY = "mettrie:active-skill-id";

interface Citation {
  chunk_id: string;
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

type StreamPhase = "searching" | "reading" | "thinking" | "streaming" | null;

interface StreamingState {
  content: string;
  phase: StreamPhase;
  count?: number;
}

const SUGGESTED = [
  { icon: "trending_up", label: "What's been top of mind lately?", statVar: "stat2" },
  { icon: "groups", label: "Who have I been talking to most?", statVar: "stat1" },
  { icon: "description", label: "Summarize my recent projects", statVar: "stat3" },
];

interface AskClientProps {
  opener: string | null;
  suggestions: Array<{ icon: string; label: string; statVar: string }> | null;
  skills: PickerSkill[];
}

export function AskClient({ opener, suggestions, skills }: AskClientProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [dateStr, setDateStr] = useState("");
  const [streaming, setStreaming] = useState<StreamingState | null>(null);
  const [activeSkillId, setActiveSkillId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Persist active skill across reloads.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(ACTIVE_SKILL_KEY);
    if (stored && skills.some((s) => s.id === stored)) {
      setActiveSkillId(stored);
    } else if (stored) {
      window.localStorage.removeItem(ACTIVE_SKILL_KEY);
    }
  }, [skills]);

  function updateActiveSkill(id: string | null) {
    setActiveSkillId(id);
    if (typeof window === "undefined") return;
    if (id) window.localStorage.setItem(ACTIVE_SKILL_KEY, id);
    else window.localStorage.removeItem(ACTIVE_SKILL_KEY);
  }

  const activeSuggestions = suggestions ?? SUGGESTED;
  const openerText =
    opener ??
    "I'm still getting to know you. Once your sources have some activity, I'll have things worth saying. Until then — ask me anything.";

  useEffect(() => {
    setMounted(true);
    setDateStr(
      new Date()
        .toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })
        .toUpperCase()
    );
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

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
    setStreaming({ content: "", phase: "searching" });

    let answer = "";
    let citations: Citation[] = [];
    let webCitations: WebCit[] = [];
    let invalidCitations: number[] = [];

    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: q,
          history: buildHistory(),
          skillId: activeSkillId,
        }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `Query failed (${res.status})`);
        setMessages((prev) => prev.slice(0, -1));
        setStreaming(null);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let event: Record<string, unknown>;
          try {
            event = JSON.parse(trimmed);
          } catch {
            continue;
          }

          if (typeof event.error === "string") {
            setError(event.error);
            continue;
          }
          if (typeof event.phase === "string") {
            const phase = event.phase as StreamPhase;
            const count = typeof event.count === "number" ? event.count : undefined;
            setStreaming((prev) => (prev ? { ...prev, phase, count } : prev));
            continue;
          }
          if (typeof event.delta === "string") {
            const delta = event.delta;
            answer += delta;
            const snapshot = answer;
            setStreaming((prev) =>
              prev ? { ...prev, content: snapshot, phase: "streaming" } : prev
            );
            continue;
          }
          if (Array.isArray(event.citations)) {
            citations = event.citations as Citation[];
            webCitations = (event.webCitations as WebCit[]) ?? [];
            invalidCitations = (event.invalidCitations as number[]) ?? [];
            continue;
          }
          if (event.done === true) {
            const finalMsg: AssistantMessage = {
              role: "assistant",
              content: answer,
              citations,
              webCitations,
              invalidCitations,
            };
            setMessages((prev) => [...prev, finalMsg]);
            setStreaming(null);
          }
        }
      }
    } catch {
      setError("Network error — check server logs");
      setMessages((prev) => prev.slice(0, -1));
      setStreaming(null);
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
    setStreaming(null);
    textareaRef.current?.focus();
  }

  const inConversation = messages.length > 0 || streaming !== null;

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Header */}
      <header className="header-glass h-16 shrink-0 flex items-center justify-between px-6 z-30">
        <span className="text-2xl font-bold" style={{ color: "var(--c-fg)" }}>Ask</span>
        {inConversation && (
          <button
            onClick={newChat}
            className="glass-card text-[11px] font-semibold px-4 py-2 rounded-lg transition-colors tracking-wide cursor-pointer hover:[border-color:var(--c-card-hover-border)]"
            style={{ color: "var(--c-muted)" }}
          >
            New chat
          </button>
        )}
      </header>

      {/* Messages or empty state */}
      <div className="flex-1 overflow-y-auto relative">
        {!inConversation ? (
          <div className="flex items-start justify-center min-h-full px-6 pt-16 pb-24">
            <div className="w-full max-w-3xl relative z-10">
              {/* Assistant message header */}
              <div
                className={`ask-resolve ${mounted ? "is-mounted" : ""} flex items-center gap-2.5 mb-3 px-1`}
              >
                <AvatarMark />
                <span className="text-[13px] font-semibold" style={{ color: "var(--c-fg)" }}>
                  Mettrie
                </span>
                <span className="text-[11px]" style={{ color: "var(--c-subtle)" }}>
                  {dateStr ? `· ${dateStr}` : "· today"}
                </span>
              </div>

              {/* Opener as assistant message bubble */}
              <div
                className={`ask-resolve ${mounted ? "is-mounted" : ""} glass-card rounded-2xl rounded-tl-md px-6 py-5 mb-12`}
                style={{ transitionDelay: "60ms" }}
              >
                <p className="text-[15px] leading-[1.65]" style={{ color: "var(--c-fg)" }}>
                  {openerText}
                </p>
              </div>

              {/* Suggestions section */}
              <div
                className={`ask-resolve ${mounted ? "is-mounted" : ""}`}
                style={{ transitionDelay: "180ms" }}
              >
                <p
                  className="text-[11px] uppercase tracking-[0.14em] font-semibold mb-3 px-1"
                  style={{ color: "var(--c-subtle)" }}
                >
                  Try asking
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {activeSuggestions.map((s) => (
                    <button
                      key={s.label}
                      onClick={() => { setInput(s.label); textareaRef.current?.focus(); }}
                      className="group glass-card rounded-xl px-4 py-4 text-left transition-all cursor-pointer hover:-translate-y-0.5 hover:shadow-md flex flex-col gap-3 min-h-[112px]"
                    >
                      <span
                        className="material-symbols-outlined text-[18px] leading-none w-8 h-8 inline-flex items-center justify-center rounded-lg shrink-0"
                        style={{
                          color: `var(--c-${s.statVar})`,
                          background: `var(--c-${s.statVar}-icon)`,
                        }}
                      >
                        {s.icon}
                      </span>
                      <p className="text-[13px] leading-snug font-medium" style={{ color: "var(--c-fg)" }}>
                        {s.label}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto px-6 py-8 space-y-8 relative z-10">
            {messages.map((msg, i) =>
              msg.role === "user" ? (
                <UserPill key={i} content={msg.content} />
              ) : (
                <AssistantTurn key={i} message={msg} />
              )
            )}

            {streaming && <StreamingTurn streaming={streaming} />}

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
      <div className="shrink-0 w-full max-w-3xl mx-auto px-6 pb-6 relative z-10">
        {/* Skill picker pill row */}
        {skills.length > 0 && (
          <div className="relative flex items-center gap-2 mb-2">
            <SkillPicker
              skills={skills}
              activeSkillId={activeSkillId}
              onChange={updateActiveSkill}
            />
            <SlashAutocomplete
              skills={skills}
              input={input}
              setInput={setInput}
              onPick={(s) => updateActiveSkill(s.id)}
            />
          </div>
        )}
        <form
          onSubmit={send}
          className="glass-card rounded-2xl flex items-end gap-2 p-2.5 shadow-lg transition-all focus-within:[border-color:var(--c-card-hover-border)]"
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={inConversation ? "Ask a follow-up…" : "Reply to Mettrie…"}
            disabled={loading}
            rows={1}
            autoFocus
            className="flex-1 bg-transparent border-none focus:ring-0 text-[15px] py-2 px-3 resize-none outline-none placeholder:opacity-50"
            style={{ color: "var(--c-fg)", minHeight: "40px", maxHeight: "160px", lineHeight: 1.5 }}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="vibrant-gradient p-2.5 rounded-xl text-white shadow-md hover:scale-105 transition-transform disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:scale-100 shrink-0 cursor-pointer self-end"
            aria-label="Send"
          >
            <span
              className="material-symbols-outlined text-[18px] leading-none"
              style={{ fontVariationSettings: "'FILL' 1, 'wght' 500, 'GRAD' 0, 'opsz' 24" }}
            >
              arrow_upward
            </span>
          </button>
        </form>
        <p className="text-center text-[11px] mt-2.5 tracking-wide" style={{ color: "var(--c-subtle)" }}>
          Mettrie may be wrong. Verify before acting on anything that matters.
        </p>
      </div>
    </div>
  );
}

function AvatarMark() {
  return (
    <span
      className="inline-flex items-center justify-center w-8 h-8 rounded-full shrink-0"
      style={{ background: "var(--c-primary-m)", border: "1px solid var(--c-card-border)" }}
    >
      <span
        className="material-symbols-outlined text-[16px] leading-none"
        style={{
          color: "var(--c-primary)",
          fontVariationSettings: "'FILL' 1, 'wght' 500, 'GRAD' 0, 'opsz' 24",
        }}
      >
        auto_awesome
      </span>
    </span>
  );
}

function UserPill({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div
        className="vibrant-gradient text-white text-[13px] font-medium rounded-full px-4 py-2.5 max-w-[75%] shadow-md whitespace-pre-wrap break-words"
        style={{ lineHeight: 1.45 }}
      >
        {content}
      </div>
    </div>
  );
}

const PHASE_LABELS: Record<Exclude<StreamPhase, null | "streaming">, string> = {
  searching: "Searching your inbox…",
  reading: "Reading what I found…",
  thinking: "Thinking it through…",
};

function StatusPill({ phase, count }: { phase: StreamPhase; count?: number }) {
  if (!phase || phase === "streaming") return null;
  let label = PHASE_LABELS[phase];
  if (phase === "reading" && typeof count === "number" && count > 0) {
    label = `Reading ${count} source${count === 1 ? "" : "s"}…`;
  }
  return (
    <div
      className="inline-flex items-center gap-2.5 glass-panel rounded-full px-4 py-2.5"
    >
      <span className="flex gap-1">
        <span
          className="w-1.5 h-1.5 rounded-full animate-bounce"
          style={{ background: "var(--c-primary)", animationDelay: "0ms" }}
        />
        <span
          className="w-1.5 h-1.5 rounded-full animate-bounce"
          style={{ background: "var(--c-primary)", animationDelay: "150ms" }}
        />
        <span
          className="w-1.5 h-1.5 rounded-full animate-bounce"
          style={{ background: "var(--c-primary)", animationDelay: "300ms" }}
        />
      </span>
      <span className="text-[13px]" style={{ color: "var(--c-muted)" }}>
        {label}
      </span>
    </div>
  );
}

function StreamingTurn({ streaming }: { streaming: StreamingState }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2.5 px-1">
        <AvatarMark />
        <span className="text-[13px] font-semibold" style={{ color: "var(--c-fg)" }}>
          Mettrie
        </span>
      </div>
      {streaming.content ? (
        <div className="glass-card rounded-2xl rounded-tl-md px-5 py-4">
          <RenderMarkdown content={streaming.content} streaming />
        </div>
      ) : (
        <StatusPill phase={streaming.phase} count={streaming.count} />
      )}
    </div>
  );
}

function AssistantTurn({ message }: { message: AssistantMessage }) {
  const { content, citations, webCitations, invalidCitations } = message;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2.5 px-1">
        <AvatarMark />
        <span className="text-[13px] font-semibold" style={{ color: "var(--c-fg)" }}>
          Mettrie
        </span>
      </div>

      <div className="glass-card rounded-2xl rounded-tl-md px-5 py-4">
        <RenderMarkdown content={content} />
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
          <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--c-subtle)" }}>
            Knowledge base
          </p>
          {citations.map((c, i) => (
            <div key={c.chunk_id} className="flex items-baseline gap-2">
              <span className="text-[10px] font-medium shrink-0 w-6" style={{ color: "var(--c-primary)" }}>
                [{i + 1}]
              </span>
              <Link
                href={`/pages/${c.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm transition-colors hover:opacity-80"
                style={{ color: "var(--c-muted)" }}
              >
                {c.title}
              </Link>
              <span className="text-[10px] font-mono truncate" style={{ color: "var(--c-subtle)" }}>
                {c.slug}
              </span>
            </div>
          ))}
        </div>
      )}

      {webCitations.length > 0 && (
        <div className="glass-panel rounded-xl px-4 py-3 space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--c-subtle)" }}>
            Web sources
          </p>
          {webCitations.map((w) => (
            <div key={w.id} className="flex items-baseline gap-2">
              <span className="text-[10px] font-medium shrink-0 w-6" style={{ color: "var(--c-stat2)" }}>
                [{w.id}]
              </span>
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
