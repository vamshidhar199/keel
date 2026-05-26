import { BentoCard, BentoEmpty } from "./bento-card";
import { ThumbsRow } from "../thumbs-row";
import type { AwaitingReplyItem } from "@/lib/digest";
import { gmailThreadUrl } from "@/lib/gmail-url";

interface Props {
  items: AwaitingReplyItem[];
  digestId: string | null;
  userEmail: string;
}

function relativeDays(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

function senderName(addr: string): string {
  // Common formats: "Sarah <sarah@x.com>", "sarah@x.com"
  const m = addr.match(/^(.+?)\s*</);
  if (m) return m[1].replace(/^["']|["']$/g, "");
  return addr.split("@")[0];
}

export function AwaitingReplyCard({ items, digestId, userEmail }: Props) {
  return (
    <BentoCard icon="reply" title="Awaiting your reply" statVar="stat2" count={items.length}>
      {items.length === 0 ? (
        <BentoEmpty message="Inbox is caught up. Nothing's been waiting on you." />
      ) : (
        <ul className="space-y-2.5">
          {items.map((it) => (
            <li key={it.thread_ref} className="group">
              <a
                href={gmailThreadUrl(userEmail, it.thread_ref) ?? "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-lg p-2 -mx-2 transition-colors hover:[background:var(--c-row-hover)]"
              >
                <div className="flex items-baseline gap-2">
                  <p
                    className="text-[13px] font-semibold truncate flex-1"
                    style={{ color: "var(--c-fg)" }}
                  >
                    {senderName(it.from_addr)}
                  </p>
                  <span className="text-[10px] shrink-0" style={{ color: "var(--c-subtle)" }}>
                    {relativeDays(it.date_sent)}
                  </span>
                  <ThumbsRow digestId={digestId} section="awaiting_reply" itemRef={it.thread_ref} />
                </div>
                <p
                  className="text-[12px] truncate mt-0.5"
                  style={{ color: "var(--c-muted)" }}
                >
                  {it.subject}
                </p>
              </a>
            </li>
          ))}
        </ul>
      )}
    </BentoCard>
  );
}
