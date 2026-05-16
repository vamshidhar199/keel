import { BentoCard, BentoEmpty } from "./bento-card";
import { ThumbsRow } from "../thumbs-row";
import { QuickViewLink } from "../quick-view-link";
import type { QuietItem } from "@/lib/digest";

interface Props {
  items: QuietItem[];
  digestId: string | null;
}

export function QuietCard({ items, digestId }: Props) {
  return (
    <BentoCard icon="schedule" title="Quiet but important" statVar="stat2" count={items.length}>
      {items.length === 0 ? (
        <BentoEmpty message="Nothing's been quiet too long." />
      ) : (
        <ul className="space-y-2">
          {items.map((p) => (
            <li key={p.slug} className="group">
              <QuickViewLink
                slug={p.slug}
                className="flex items-center justify-between gap-3 rounded-lg p-2 -mx-2 transition-colors hover:[background:var(--c-row-hover)] cursor-pointer"
              >
                <div className="min-w-0 flex-1">
                  <p
                    className="text-[13px] font-semibold truncate"
                    style={{ color: "var(--c-fg)" }}
                  >
                    {p.title}
                  </p>
                  <p
                    className="text-[10px] font-mono truncate mt-0.5"
                    style={{ color: "var(--c-subtle)" }}
                  >
                    {p.slug}
                  </p>
                </div>
                <span className="text-[10px] shrink-0" style={{ color: "var(--c-subtle)" }}>
                  {p.days_quiet}d quiet
                </span>
                <ThumbsRow digestId={digestId} section="quiet" itemRef={p.slug} />
              </QuickViewLink>
            </li>
          ))}
        </ul>
      )}
    </BentoCard>
  );
}
