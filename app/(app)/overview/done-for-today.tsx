import type { DigestMeta } from "@/lib/digest";

interface Props {
  meta?: DigestMeta;
}

// Anti-engagement closure: marks the bottom of the brief with an explicit
// "you're done" message. Expand for "what shaped today's brief" context
// (memories applied, away-gap, recent downvotes feeding into the prompt).
export function DoneForToday({ meta }: Props) {
  return (
    <section className="pt-2">
      <details className="group">
        <summary
          className="cursor-pointer list-none flex items-center justify-between gap-3 rounded-2xl px-5 py-4 glass-card transition-colors hover:[background:var(--c-row-hover)]"
        >
          <div className="flex items-center gap-3">
            <span
              className="material-symbols-outlined text-[18px] leading-none"
              style={{ color: "var(--c-primary)" }}
            >
              check_circle
            </span>
            <p className="text-[14px] font-semibold" style={{ color: "var(--c-fg)" }}>
              That&apos;s it for today — go live your life.
            </p>
          </div>
          <span
            className="material-symbols-outlined text-[18px] leading-none transition-transform group-open:rotate-180"
            style={{ color: "var(--c-subtle)" }}
          >
            expand_more
          </span>
        </summary>
        <div className="px-5 py-4 mt-2 glass-card rounded-2xl space-y-2.5">
          <p
            className="text-[10px] uppercase tracking-wider"
            style={{ color: "var(--c-subtle)" }}
          >
            What shaped today&apos;s brief
          </p>
          <ul className="space-y-1.5 text-[13px]" style={{ color: "var(--c-muted)" }}>
            <li className="flex items-baseline gap-2">
              <span className="material-symbols-outlined text-[14px] leading-none" style={{ color: "var(--c-subtle)" }}>
                psychology
              </span>
              {meta?.memories_applied
                ? "AI memories from your settings are guiding tone and ranking."
                : "No AI memories set. Add some in settings to personalize this."}
            </li>
            <li className="flex items-baseline gap-2">
              <span className="material-symbols-outlined text-[14px] leading-none" style={{ color: "var(--c-subtle)" }}>
                schedule
              </span>
              {meta && meta.gap_hours > 30
                ? `Recap covers your away-gap (~${Math.floor(meta.gap_hours / 24)}d).`
                : "Standard 24h window."}
            </li>
            <li className="flex items-baseline gap-2">
              <span className="material-symbols-outlined text-[14px] leading-none" style={{ color: "var(--c-subtle)" }}>
                thumb_down
              </span>
              {meta && meta.downvotes_30d > 0
                ? `Avoiding patterns from ${meta.downvotes_30d} item${meta.downvotes_30d === 1 ? "" : "s"} you thumbs-downed in the last 30 days.`
                : "No negative feedback collected yet."}
            </li>
          </ul>
        </div>
      </details>
    </section>
  );
}
