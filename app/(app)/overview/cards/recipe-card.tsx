import { BentoCard, BentoEmpty } from "./bento-card";
import { ThumbsRow } from "../thumbs-row";
import { QuickViewLink } from "../quick-view-link";
import type { RecipeCardData } from "@/lib/digest";

interface Props {
  card: RecipeCardData;
  digestId: string | null;
}

// User-defined card rendered from a saved recipe. Items can be threads or
// pages — we deep-link accordingly. Thumbs row sits next to each item for
// feedback-tuning future recipe runs.
export function RecipeCard({ card, digestId }: Props) {
  return (
    <BentoCard
      icon="auto_awesome"
      title={card.name}
      statVar="stat3"
      count={card.items.length}
    >
      {card.items.length === 0 ? (
        <BentoEmpty message="Nothing matched this recipe today." />
      ) : (
        <ul className="space-y-2">
          {card.items.map((it) => {
            const href =
              it.kind === "thread"
                ? `https://mail.google.com/mail/u/0/#inbox/${it.ref}`
                : it.kind === "page"
                ? `/pages/${it.ref}`
                : null;
            const inner = (
              <div className="flex items-start justify-between gap-2 rounded-lg p-2 -mx-2 transition-colors hover:[background:var(--c-row-hover)] group">
                <div className="min-w-0 flex-1">
                  <p
                    className="text-[13px] font-semibold truncate"
                    style={{ color: "var(--c-fg)" }}
                  >
                    {it.label}
                  </p>
                  {it.why && (
                    <p
                      className="text-[11px] truncate mt-0.5"
                      style={{ color: "var(--c-subtle)" }}
                    >
                      {it.why}
                    </p>
                  )}
                </div>
                <ThumbsRow
                  digestId={digestId}
                  section={`recipe:${card.recipe_id}`}
                  itemRef={it.ref}
                />
              </div>
            );
            return (
              <li key={`${card.recipe_id}-${it.ref}`}>
                {it.kind === "page" ? (
                  <QuickViewLink slug={it.ref} className="block cursor-pointer">
                    {inner}
                  </QuickViewLink>
                ) : href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block"
                  >
                    {inner}
                  </a>
                ) : (
                  inner
                )}
              </li>
            );
          })}
        </ul>
      )}
    </BentoCard>
  );
}
