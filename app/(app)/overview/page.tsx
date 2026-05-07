import Link from "next/link";
import { auth } from "@/auth";
import { hasGmailScope } from "@/lib/gmail";
import { getGmailStatus } from "@/lib/sync";
import { getExtractionStatus } from "@/lib/pipeline";
import { listPages } from "@/lib/gbrain";
import { TypeBadge } from "../../components/type-badge";

export default async function OverviewPage() {
  const session = await auth();
  const userId = session!.user!.id;

  const [gmailConnected, extractionStatus, recentPages] = await Promise.all([
    hasGmailScope(userId),
    getExtractionStatus(userId),
    listPages(userId, { limit: 6 }),
  ]);
  const gmailStatus = gmailConnected ? await getGmailStatus(userId) : null;
  const firstName = session?.user?.name?.split(" ")[0] ?? "there";

  return (
    <div className="min-h-screen">
      {/* Sticky header */}
      <header className="header-glass sticky top-0 h-16 flex items-center justify-between px-6 z-30">
        <h1 className="text-2xl font-bold" style={{ color: "var(--c-fg)" }}>Overview</h1>
        <div className="glass-card px-4 py-2 rounded-xl flex items-center gap-3">
          <div className="p-1.5 rounded-lg" style={{ background: "var(--c-stat2-icon)" }}>
            <span className="material-symbols-outlined text-[18px] leading-none" style={{ color: "var(--c-stat2)" }}>visibility</span>
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: "var(--c-subtle)" }}>System Status</p>
            <p className="text-[13px] font-bold" style={{ color: "var(--c-stat2)" }}>Active</p>
          </div>
        </div>
      </header>

      <div className="p-10 max-w-7xl mx-auto space-y-10">
        {/* Welcome hero */}
        <section>
          <h2 className="text-5xl font-bold tracking-tight" style={{ color: "var(--c-fg)" }}>
            Welcome back, {firstName}.
          </h2>
          <p className="text-lg mt-2" style={{ color: "var(--c-muted)" }}>Your personal knowledge system is ready.</p>
        </section>

        {/* Stats grid */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <StatCard
            icon="description"
            statVar="stat1"
            value={extractionStatus.pagesCreated}
            label="Pages Indexed"
            badge={extractionStatus.pagesCreated > 0 ? `${extractionStatus.pagesCreated} total` : "None yet"}
            href="/pages"
          />
          <StatCard
            icon="auto_awesome"
            statVar="stat2"
            value={extractionStatus.extracted}
            label="Emails Extracted"
            badge={`of ${extractionStatus.total}`}
            href="/sources"
          />
          <StatCard
            icon="pending_actions"
            statVar="stat3"
            value={extractionStatus.pending}
            label="Pending Analysis"
            badge={extractionStatus.pending > 0 ? "Action Needed" : "All clear"}
            href="/sources"
          />
        </section>

        {/* Ask bar */}
        <section className="relative group">
          <div
            className="absolute -inset-px rounded-2xl opacity-25 group-hover:opacity-75 transition duration-500 blur-sm"
            style={{ background: "var(--c-gradient)" }}
          />
          <Link
            href="/ask"
            className="relative glass-card rounded-2xl p-4 flex items-center shadow-2xl block"
          >
            <span className="flex-grow text-base px-2" style={{ color: "var(--c-muted)" }}>
              Ask Mettrie anything about your knowledge base…
            </span>
          </Link>
        </section>

        {/* Bento grid */}
        <div className="grid grid-cols-12 gap-6">
          {/* Recent pages */}
          <section className="col-span-12 lg:col-span-8 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-2xl font-semibold" style={{ color: "var(--c-fg)" }}>Recent Intelligence</h3>
              <Link href="/pages" className="text-[12px] font-medium hover:underline" style={{ color: "var(--c-primary)" }}>
                View all pages
              </Link>
            </div>

            {recentPages.length === 0 ? (
              <div className="glass-card rounded-xl p-8 text-center">
                <p className="text-sm" style={{ color: "var(--c-muted)" }}>
                  No pages yet.{" "}
                  <Link href="/sources" className="hover:underline" style={{ color: "var(--c-primary)" }}>
                    Connect Gmail
                  </Link>{" "}
                  to start.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {recentPages.map((p) => (
                  <Link
                    key={p.slug}
                    href={`/pages/${p.slug}`}
                    className="glass-card p-5 rounded-xl flex items-center gap-5 group block"
                  >
                    <div className="flex-grow space-y-1 min-w-0">
                      <h4 className="text-sm font-bold truncate" style={{ color: "var(--c-fg)" }}>{p.title}</h4>
                      <p className="text-xs font-mono truncate" style={{ color: "var(--c-subtle)" }}>{p.slug}</p>
                      <div className="flex gap-2 mt-2 flex-wrap">
                        <TypeBadge type={p.type} />
                        {p.link_count > 0 && (
                          <span className="text-[10px]" style={{ color: "var(--c-subtle)" }}>
                            {p.link_count} link{p.link_count === 1 ? "" : "s"}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="material-symbols-outlined opacity-0 group-hover:opacity-100 transition-opacity leading-none" style={{ color: "var(--c-muted)" }}>
                      chevron_right
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </section>

          {/* Right column */}
          <section className="col-span-12 lg:col-span-4 space-y-4">
            <h3 className="text-2xl font-semibold" style={{ color: "var(--c-fg)" }}>Knowledge Graph</h3>
            <Link
              href="/graph"
              className="glass-card rounded-2xl overflow-hidden relative group block"
              style={{ height: "200px" }}
            >
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center space-y-2">
                  <span className="material-symbols-outlined text-5xl leading-none block" style={{ color: "var(--c-primary)" }}>account_tree</span>
                  <p className="text-sm" style={{ color: "var(--c-muted)" }}>Explore Connections</p>
                </div>
              </div>
              <div className="absolute bottom-4 left-4 right-4">
                <div className="glass-panel p-3 rounded-xl">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-bold" style={{ color: "var(--c-fg)" }}>View Graph</p>
                      <p className="text-xs" style={{ color: "var(--c-subtle)" }}>How your data interconnects</p>
                    </div>
                    <span className="material-symbols-outlined text-xl leading-none" style={{ color: "var(--c-primary)" }}>open_in_full</span>
                  </div>
                </div>
              </div>
            </Link>

            <Link href="/sources" className="glass-card p-5 rounded-xl block">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-xl leading-none" style={{ color: "var(--c-stat2)" }}>email</span>
                  <div>
                    <p className="text-sm font-bold" style={{ color: "var(--c-fg)" }}>Gmail</p>
                    <p className="text-xs mt-0.5" style={{ color: "var(--c-subtle)" }}>
                      {gmailConnected
                        ? `${gmailStatus?.messageCount ?? 0} messages synced`
                        : "Not connected"}
                    </p>
                  </div>
                </div>
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ background: gmailConnected ? "var(--c-connected-text)" : "var(--c-subtle)" }}
                />
              </div>
            </Link>
          </section>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon, statVar, value, label, badge, href,
}: {
  icon: string;
  statVar: "stat1" | "stat2" | "stat3";
  value: number;
  label: string;
  badge?: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="glass-card p-8 rounded-xl space-y-4 block border-l-4"
      style={{ borderLeftColor: `var(--c-${statVar})` }}
    >
      <div className="flex justify-between items-start">
        <span
          className="material-symbols-outlined p-2 rounded-lg text-xl leading-none"
          style={{ color: `var(--c-${statVar})`, background: `var(--c-${statVar}-icon)` }}
        >
          {icon}
        </span>
        {badge && (
          <span className="text-sm font-bold" style={{ color: `var(--c-${statVar})` }}>
            {badge}
          </span>
        )}
      </div>
      <div>
        <p className="text-3xl font-semibold" style={{ color: "var(--c-fg)" }}>{value.toLocaleString()}</p>
        <p className="text-[11px] font-medium uppercase tracking-wider mt-1" style={{ color: "var(--c-subtle)" }}>{label}</p>
      </div>
    </Link>
  );
}
