import type { ReactNode } from "react";

interface Props {
  icon: string;
  title: string;
  statVar: "stat1" | "stat2" | "stat3";
  count?: number;
  children: ReactNode;
  footer?: ReactNode;
}

// Shared chrome for the proactive bento cards on /overview.
export function BentoCard({ icon, title, statVar, count, children, footer }: Props) {
  return (
    <section className="glass-card rounded-2xl p-5 flex flex-col gap-4 min-h-[200px]">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            className="material-symbols-outlined text-[18px] leading-none w-8 h-8 inline-flex items-center justify-center rounded-lg shrink-0"
            style={{
              color: `var(--c-${statVar})`,
              background: `var(--c-${statVar}-icon)`,
            }}
          >
            {icon}
          </span>
          <h3 className="text-[14px] font-semibold" style={{ color: "var(--c-fg)" }}>
            {title}
          </h3>
        </div>
        {typeof count === "number" && count > 0 && (
          <span
            className="text-[11px] font-mono px-2 py-0.5 rounded-full"
            style={{
              background: `var(--c-${statVar}-icon)`,
              color: `var(--c-${statVar})`,
            }}
          >
            {count}
          </span>
        )}
      </header>
      <div className="flex-1">{children}</div>
      {footer && (
        <div
          className="pt-3"
          style={{ borderTop: "1px solid var(--c-divider)" }}
        >
          {footer}
        </div>
      )}
    </section>
  );
}

export function BentoEmpty({ message }: { message: string }) {
  return (
    <p className="text-[13px] leading-relaxed" style={{ color: "var(--c-subtle)" }}>
      {message}
    </p>
  );
}
