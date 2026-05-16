import { BentoCard, BentoEmpty } from "./bento-card";
import { ThumbsRow } from "../thumbs-row";
import { QuickViewLink } from "../quick-view-link";
import type { OpportunityItem } from "@/lib/digest";

interface Props {
  items: OpportunityItem[];
  digestId: string | null;
}

function relativeShort(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (days <= 0) return "today";
  if (days === 1) return "1d";
  return `${days}d`;
}

// Job listings and inbound opportunities. Surfaces pages tagged
// kind='job_listing' by the extractor. Kept separate from "Active threads" so
// recruiter pings don't crowd out things the user is actually working on.
export function OpportunitiesCard({ items, digestId }: Props) {
  return (
    <BentoCard
      icon="work"
      title="Opportunities"
      statVar="stat1"
      count={items.length}
    >
      {items.length === 0 ? (
        <BentoEmpty message="No new openings landed this week." />
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
                <span
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0"
                  style={{
                    color: "var(--c-stat1)",
                    background: "var(--c-stat1-icon)",
                  }}
                >
                  {relativeShort(p.updated_at)}
                </span>
                <ThumbsRow digestId={digestId} section="opportunities" itemRef={p.slug} />
              </QuickViewLink>
            </li>
          ))}
        </ul>
      )}
    </BentoCard>
  );
}
