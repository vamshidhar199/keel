import Link from "next/link";
import { auth } from "@/auth";
import { withUser, getMetaDb } from "@/lib/db";
import type { DigestContent } from "@/lib/digest";

interface DigestRow {
  id: string;
  local_date: string;
  content: DigestContent;
}

async function listRecentDigests(userId: string, limit = 30): Promise<DigestRow[]> {
  return withUser(userId, async (c) => {
    const { rows } = await c.query<{
      id: string;
      local_date: Date;
      content: DigestContent;
    }>(
      `SELECT id, local_date, content
       FROM digests
       ORDER BY local_date DESC
       LIMIT $1`,
      [limit]
    );
    return rows.map((r) => ({
      id: r.id,
      local_date: r.local_date.toISOString().slice(0, 10),
      content: r.content,
    }));
  });
}

export default async function DigestsPage() {
  const session = await auth();
  const userId = session!.user!.id;

  const db = getMetaDb();
  const tzRow = await db.query<{ timezone: string }>(
    `SELECT timezone FROM users WHERE id = $1`,
    [userId]
  );
  const timezone = tzRow.rows[0]?.timezone ?? "UTC";

  const digests = await listRecentDigests(userId, 30);

  function dateLabel(localDate: string): string {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: timezone,
    }).format(new Date(localDate));
  }

  return (
    <div className="min-h-screen">
      <header className="header-glass sticky top-0 h-16 flex items-center justify-between px-6 z-30">
        <div className="flex items-center gap-3">
          <Link
            href="/overview"
            className="material-symbols-outlined text-xl leading-none"
            style={{ color: "var(--c-muted)" }}
            aria-label="Back to home"
          >
            arrow_back
          </Link>
          <h1 className="text-2xl font-bold" style={{ color: "var(--c-fg)" }}>
            Past briefs
          </h1>
        </div>
      </header>

      <div className="px-8 py-10 max-w-3xl mx-auto space-y-6">
        {digests.length === 0 ? (
          <div className="glass-card rounded-2xl p-8 text-center">
            <p className="text-[14px]" style={{ color: "var(--c-muted)" }}>
              No briefs yet. They&apos;ll appear here once your daily brief starts running.
            </p>
            <Link
              href="/settings"
              className="inline-block mt-3 text-[12px] font-medium hover:underline"
              style={{ color: "var(--c-primary)" }}
            >
              Set up your brief →
            </Link>
          </div>
        ) : (
          digests.map((d) => (
            <article key={d.id} className="glass-card rounded-2xl p-6 space-y-4">
              <header className="flex items-baseline justify-between gap-4">
                <p
                  className="text-[11px] font-mono uppercase tracking-[0.18em]"
                  style={{ color: "var(--c-subtle)" }}
                >
                  {dateLabel(d.local_date)}
                </p>
                <p className="text-[10px]" style={{ color: "var(--c-subtle)" }}>
                  {d.local_date}
                </p>
              </header>

              <p className="text-[16px] leading-relaxed" style={{ color: "var(--c-fg)" }}>
                {d.content.greeting}
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[12px]">
                <DigestSection
                  label="Promises"
                  count={d.content.commitments?.length ?? 0}
                  items={(d.content.commitments ?? []).map((c) => c.text)}
                />
                <DigestSection
                  label="Awaiting reply"
                  count={d.content.awaiting_reply?.length ?? 0}
                  items={(d.content.awaiting_reply ?? []).map((a) => a.subject)}
                />
                <DigestSection
                  label="Active threads"
                  count={d.content.active_threads?.length ?? 0}
                  items={(d.content.active_threads ?? []).map((t) => t.title)}
                />
                <DigestSection
                  label="Quiet"
                  count={d.content.quiet?.length ?? 0}
                  items={(d.content.quiet ?? []).map((q) => `${q.title} · ${q.days_quiet}d`)}
                />
                <DigestSection
                  label="Opportunities"
                  count={d.content.opportunities?.length ?? 0}
                  items={(d.content.opportunities ?? []).map((o) => o.title)}
                />
                {(d.content.recipes ?? []).map((r) => (
                  <DigestSection
                    key={r.recipe_id}
                    label={r.name}
                    count={r.items.length}
                    items={r.items.map((it) => it.label)}
                  />
                ))}
              </div>
            </article>
          ))
        )}
      </div>
    </div>
  );
}

function DigestSection({
  label,
  count,
  items,
}: {
  label: string;
  count: number;
  items: string[];
}) {
  if (count === 0) return null;
  return (
    <div className="space-y-1.5">
      <p
        className="text-[10px] font-semibold uppercase tracking-wider"
        style={{ color: "var(--c-subtle)" }}
      >
        {label} · {count}
      </p>
      <ul className="space-y-1">
        {items.slice(0, 4).map((it, i) => (
          <li
            key={i}
            className="text-[12px] truncate"
            style={{ color: "var(--c-muted)" }}
          >
            • {it}
          </li>
        ))}
      </ul>
    </div>
  );
}
