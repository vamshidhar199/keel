import Link from "next/link";
import { auth } from "@/auth";
import { getMetaDb } from "@/lib/db";
import { listOpenCommitments } from "@/lib/commitments";
import { getOrGenerateDigest, localDateFor } from "@/lib/digest";
import { CommitmentsCard } from "./cards/commitments-card";
import { AwaitingReplyCard } from "./cards/awaiting-reply-card";
import { ActiveThreadsCard } from "./cards/active-threads-card";
import { QuietCard } from "./cards/quiet-card";
import { OpportunitiesCard } from "./cards/opportunities-card";
import { RecipeCard } from "./cards/recipe-card";
import { TimezoneSync } from "./timezone-sync";
import { LastSeenSync } from "./last-seen-sync";
import { DoneForToday } from "./done-for-today";
import { DrawerMount } from "./drawer-mount";

interface Prefs {
  digest_enabled: boolean;
  show_commitments: boolean;
  show_awaiting_reply: boolean;
  show_active_threads: boolean;
  show_quiet_but_important: boolean;
  show_opportunities: boolean;
}

const DEFAULT_PREFS: Prefs = {
  digest_enabled: true,
  show_commitments: true,
  show_awaiting_reply: true,
  show_active_threads: true,
  show_quiet_but_important: true,
  show_opportunities: true,
};

async function getUserContext(userId: string) {
  const db = getMetaDb();
  const [u, p] = await Promise.all([
    db.query<{ email: string; timezone: string }>(
      `SELECT email, timezone FROM users WHERE id = $1`,
      [userId]
    ),
    db.query<Prefs>(
      `SELECT digest_enabled, show_commitments, show_awaiting_reply,
              show_active_threads, show_quiet_but_important, show_opportunities
       FROM user_preferences WHERE user_id = $1`,
      [userId]
    ),
  ]);
  return {
    email: u.rows[0]?.email ?? "",
    timezone: u.rows[0]?.timezone ?? "UTC",
    prefs: p.rows[0] ?? DEFAULT_PREFS,
  };
}

export default async function OverviewPage() {
  const session = await auth();
  const userId = session!.user!.id;
  const firstName = session?.user?.name?.split(" ")[0] ?? "there";

  const { email, timezone, prefs } = await getUserContext(userId);
  const localDate = localDateFor(timezone);

  const digestRow = prefs.digest_enabled
    ? await getOrGenerateDigest(userId, email, localDate).catch((err) => {
        console.error(
          "[overview] digest failed:",
          String((err as Error)?.message ?? err).slice(0, 200)
        );
        return null;
      })
    : null;

  const digest = digestRow?.content ?? null;
  const digestId = digestRow?.id ?? null;

  // Commitments are fetched fresh (not from the cached digest) because the user
  // marks them done/dismiss throughout the day.
  const liveCommitments = await listOpenCommitments(userId, 5);

  const awaitingReply = digest?.awaiting_reply ?? [];
  const activeThreads = digest?.active_threads ?? [];
  const quiet = digest?.quiet ?? [];
  const opportunities = digest?.opportunities ?? [];
  const recipes = digest?.recipes ?? [];
  const meta = digest?.meta;

  const dateLabel = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: timezone,
  }).format(new Date());

  const greeting =
    digest?.greeting ??
    "Quiet morning — ask me anything when you're ready.";

  return (
    <div className="min-h-screen">
      <TimezoneSync currentTz={timezone} />
      <LastSeenSync />
      <DrawerMount />

      {/* Sticky header */}
      <header className="header-glass sticky top-0 h-16 flex items-center px-6 z-30">
        <h1 className="text-2xl font-bold" style={{ color: "var(--c-fg)" }}>Home</h1>
      </header>

      <div className="px-8 py-10 max-w-6xl mx-auto space-y-10">
        {/* Hero */}
        <section className="space-y-4">
          <p
            className="text-[11px] font-mono uppercase tracking-[0.18em]"
            style={{ color: "var(--c-subtle)" }}
          >
            {dateLabel}
          </p>
          <h2
            className="text-4xl md:text-5xl font-bold tracking-tight"
            style={{ color: "var(--c-fg)" }}
          >
            Good morning, {firstName}.
          </h2>
          <p
            className="text-base md:text-lg max-w-2xl"
            style={{ color: "var(--c-muted)" }}
          >
            {greeting}
          </p>

          {/* Ask pill */}
          <div className="pt-2">
            <Link
              href="/ask"
              className="group glass-card rounded-2xl px-5 py-3.5 flex items-center justify-between gap-3 max-w-2xl shadow-md hover:shadow-lg transition-all"
            >
              <span
                className="material-symbols-outlined text-[18px] leading-none shrink-0"
                style={{ color: "var(--c-primary)" }}
              >
                auto_awesome
              </span>
              <span className="flex-1 text-[14px]" style={{ color: "var(--c-muted)" }}>
                Ask me anything…
              </span>
              <span
                className="material-symbols-outlined text-[18px] leading-none shrink-0 opacity-50 group-hover:opacity-100 transition-opacity"
                style={{ color: "var(--c-fg)" }}
              >
                arrow_forward
              </span>
            </Link>
          </div>
        </section>

        {/* Bento grid */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {prefs.show_commitments && (
            <CommitmentsCard initial={liveCommitments} digestId={digestId} />
          )}
          {prefs.show_awaiting_reply && (
            <AwaitingReplyCard items={awaitingReply} digestId={digestId} />
          )}
          {prefs.show_active_threads && (
            <ActiveThreadsCard items={activeThreads} digestId={digestId} />
          )}
          {prefs.show_quiet_but_important && (
            <QuietCard items={quiet} digestId={digestId} />
          )}
          {prefs.show_opportunities && (
            <OpportunitiesCard items={opportunities} digestId={digestId} />
          )}
          {recipes.map((r) => (
            <RecipeCard key={r.recipe_id} card={r} digestId={digestId} />
          ))}
        </section>

        <DoneForToday meta={meta} />

        {/* Footer */}
        <footer className="flex items-center justify-between pt-4">
          <Link
            href="/digests"
            className="text-[12px] font-medium hover:underline inline-flex items-center gap-1"
            style={{ color: "var(--c-muted)" }}
          >
            Past briefs
            <span className="material-symbols-outlined text-[14px] leading-none">arrow_forward</span>
          </Link>
          <Link
            href="/settings"
            className="text-[11px] hover:underline"
            style={{ color: "var(--c-subtle)" }}
          >
            Customize your brief
          </Link>
        </footer>
      </div>
    </div>
  );
}
