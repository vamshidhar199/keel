import Link from "next/link";
import { BentoCard, BentoEmpty } from "./bento-card";
import { ThumbsRow } from "../thumbs-row";
import type { RecentRunSummary } from "@/lib/workflows";

interface Props {
  items: RecentRunSummary[];
  digestId: string | null;
}

function relativeShort(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 1000 / 60);
  if (mins < 60) return mins <= 1 ? "just now" : `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1d ago" : `${days}d ago`;
}

// Recent successful workflow runs from the last 2 days. Clicking a row opens
// the workflow detail page where the full output + run history lives.
export function WorkflowRunsCard({ items, digestId }: Props) {
  return (
    <BentoCard
      icon="bolt"
      title="From your workflows"
      statVar="stat3"
      count={items.length}
    >
      {items.length === 0 ? (
        <BentoEmpty message="No workflow runs in the last 48 hours. They'll appear here once your scheduled workflows fire." />
      ) : (
        <ul className="space-y-2.5">
          {items.map((r) => (
            <li key={r.run_id} className="group">
              <Link
                href={`/workflows/${r.workflow_id}`}
                className="block rounded-lg p-2 -mx-2 transition-colors hover:[background:var(--c-row-hover)]"
              >
                <div className="flex items-baseline gap-2">
                  <p
                    className="text-[13px] font-semibold truncate flex-1"
                    style={{ color: "var(--c-fg)" }}
                  >
                    {r.workflow_name}
                  </p>
                  <span
                    className="text-[10px] shrink-0"
                    style={{ color: "var(--c-subtle)" }}
                  >
                    {relativeShort(r.ran_at)}
                  </span>
                  <ThumbsRow
                    digestId={digestId}
                    section="workflow_runs"
                    itemRef={r.run_id}
                  />
                </div>
                {r.preview && (
                  <p
                    className="text-[12px] line-clamp-2 mt-0.5"
                    style={{ color: "var(--c-muted)" }}
                  >
                    {r.preview}
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </BentoCard>
  );
}
