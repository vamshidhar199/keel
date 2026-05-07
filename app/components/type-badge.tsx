export const TYPE_DOTS: Record<string, string> = {
  person:  "var(--c-badge-person-text)",
  company: "var(--c-badge-company-text)",
  project: "var(--c-badge-project-text)",
  topic:   "var(--c-badge-topic-text)",
};

export function TypeBadge({ type }: { type: string }) {
  const key = ["person", "company", "project", "topic"].includes(type) ? type : null;
  const bg     = key ? `var(--c-badge-${key}-bg)`   : "var(--c-surface-low)";
  const color  = key ? `var(--c-badge-${key}-text)`  : "var(--c-muted)";
  const border = key ? `1px solid var(--c-badge-${key}-b)` : "1px solid var(--c-card-border)";
  return (
    <span
      className="text-[11px] px-2.5 py-0.5 rounded-full font-medium"
      style={{ background: bg, color, border }}
    >
      {type}
    </span>
  );
}
