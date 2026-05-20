"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";

interface Props {
  content: string;
  streaming?: boolean;
}

// Renders an assistant message as Markdown with chat-friendly styling.
// Inline `[chunk:N]` references are pre-converted to a styled superscript.
// The bottom-of-bubble citations panel still gives the full source list.
export function RenderMarkdown({ content, streaming = false }: Props) {
  const processed = content.replace(
    /\[chunk:(\d+)\]/g,
    (_, n) => `<sup data-cite="${n}">[${n}]</sup>`
  );

  return (
    <div className="space-y-1">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={{
          h1: ({ children }) => (
            <h2
              className="text-[18px] font-bold mt-5 mb-3 flex items-center gap-2.5 first:mt-0"
              style={{ color: "var(--c-fg)" }}
            >
              <span
                className="w-1 h-5 rounded-full shrink-0"
                style={{ background: "var(--c-primary)" }}
              />
              {children}
            </h2>
          ),
          h2: ({ children }) => (
            <h3
              className="text-[15px] font-semibold mt-4 mb-2 flex items-center gap-2 first:mt-0"
              style={{ color: "var(--c-fg)" }}
            >
              <span
                className="w-1 h-4 rounded-full shrink-0"
                style={{ background: "var(--c-primary)" }}
              />
              {children}
            </h3>
          ),
          h3: ({ children }) => (
            <h4
              className="text-[11px] font-bold uppercase tracking-[0.12em] mt-4 mb-2 first:mt-0"
              style={{ color: "var(--c-muted)" }}
            >
              {children}
            </h4>
          ),
          p: ({ children }) => (
            <p
              className="text-[14px] leading-[1.65] mb-2.5 last:mb-0"
              style={{ color: "var(--c-fg)" }}
            >
              {children}
            </p>
          ),
          ul: ({ children }) => <ul className="space-y-1.5 mb-3 last:mb-0">{children}</ul>,
          ol: ({ children }) => (
            <ol
              className="space-y-1.5 mb-3 ml-5 list-decimal last:mb-0"
              style={{ color: "var(--c-fg)" }}
            >
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li
              className="text-[14px] leading-[1.6] flex items-start gap-2.5"
              style={{ color: "var(--c-fg)" }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0 mt-[9px]"
                style={{ background: "var(--c-primary)", opacity: 0.65 }}
              />
              <span className="flex-1 min-w-0">{children}</span>
            </li>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold" style={{ color: "var(--c-fg)" }}>
              {children}
            </strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
          code: ({ className, children }) => {
            const isBlock = className?.startsWith("language-");
            if (isBlock) {
              return (
                <code
                  className={`block font-mono text-[12.5px] leading-[1.55] p-3 rounded-lg overflow-x-auto ${className}`}
                  style={{
                    background: "var(--c-surface-low)",
                    border: "1px solid var(--c-card-border)",
                    color: "var(--c-fg)",
                  }}
                >
                  {children}
                </code>
              );
            }
            return (
              <code
                className="font-mono text-[12.5px] px-1.5 py-0.5 rounded"
                style={{ background: "var(--c-surface-low)", color: "var(--c-fg)" }}
              >
                {children}
              </code>
            );
          },
          pre: ({ children }) => <pre className="mb-3 last:mb-0">{children}</pre>,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 transition-opacity hover:opacity-80 break-words"
              style={{ color: "var(--c-primary)" }}
            >
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote
              className="pl-4 italic mb-3 last:mb-0 text-[14px]"
              style={{
                borderLeft: "2px solid var(--c-primary)",
                color: "var(--c-muted)",
              }}
            >
              {children}
            </blockquote>
          ),
          hr: () => (
            <hr className="my-4" style={{ borderColor: "var(--c-divider)" }} />
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto mb-3 last:mb-0">
              <table className="w-full text-[13px]" style={{ color: "var(--c-fg)" }}>
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th
              className="text-left font-semibold px-3 py-2"
              style={{ borderBottom: "1px solid var(--c-divider)", color: "var(--c-muted)" }}
            >
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-3 py-2" style={{ borderBottom: "1px solid var(--c-divider)" }}>
              {children}
            </td>
          ),
          sup: ({ children, ...rest }) => (
            <sup
              className="text-[10px] font-semibold ml-0.5"
              style={{ color: "var(--c-primary)" }}
              {...rest}
            >
              {children}
            </sup>
          ),
        }}
      >
        {processed}
      </ReactMarkdown>
      {streaming && (
        <span
          className="inline-block w-[3px] h-4 ml-0.5 align-middle animate-pulse rounded-sm"
          style={{ background: "var(--c-primary)" }}
          aria-hidden
        />
      )}
    </div>
  );
}
