import { auth } from "@/auth";
import { listPages } from "@/lib/gbrain";
import Link from "next/link";

const TYPES = ["person", "company", "project", "topic"] as const;

const ENTITY_ICON: Record<string, { icon: string; colorVar: string; fromVar: string; toVar: string }> = {
  person:  { icon: "person",         colorVar: "--c-entity-person-icon",  fromVar: "--c-entity-person-from",  toVar: "--c-entity-person-to"  },
  company: { icon: "corporate_fare", colorVar: "--c-entity-company-icon", fromVar: "--c-entity-company-from", toVar: "--c-entity-company-to" },
  project: { icon: "description",    colorVar: "--c-entity-project-icon", fromVar: "--c-entity-project-from", toVar: "--c-entity-project-to" },
  topic:   { icon: "lightbulb",      colorVar: "--c-entity-topic-icon",   fromVar: "--c-entity-topic-from",   toVar: "--c-entity-topic-to"   },
};

export default async function PagesIndex({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; kind?: string }>;
}) {
  const session = await auth();
  const userId = session!.user!.id;

  const { type, kind } = await searchParams;
  const pages = await listPages(userId, {
    type: type || undefined,
    kind: kind || undefined,
  });

  function buildQuery(next: { type?: string; kind?: string }): string {
    const params = new URLSearchParams();
    if (next.type) params.set("type", next.type);
    if (next.kind) params.set("kind", next.kind);
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="header-glass sticky top-0 h-16 flex items-center justify-between px-6 z-30">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold" style={{ color: "var(--c-fg)" }}>Pages</h1>
          <div className="h-5 w-px" style={{ background: "var(--c-divider)" }} />
          <div className="flex items-center gap-2 text-sm" style={{ color: "var(--c-subtle)" }}>
            <span className="material-symbols-outlined text-[18px] leading-none">inventory_2</span>
            <span>{pages.length} items</span>
          </div>
        </div>
        <Link
          href="/graph"
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-[11px] font-semibold transition-all"
          style={{ color: "var(--c-muted)", border: "1px solid var(--c-card-border)" }}
        >
          <span className="material-symbols-outlined text-[16px] leading-none">account_tree</span>
          Graph view
        </Link>
      </header>

      <div className="px-6 py-8 space-y-4">
        {/* Type filter row */}
        <div
          className="flex items-center gap-1 p-1 rounded-xl w-fit"
          style={{ background: "var(--c-filter-bg)", border: "1px solid var(--c-filter-border)" }}
        >
          <Link
            href={buildQuery({ kind })}
            className="px-4 py-2 rounded-lg text-[11px] font-semibold transition-all"
            style={
              !type
                ? { background: "var(--c-filter-act)", color: "var(--c-primary-on)" }
                : { color: "var(--c-muted)" }
            }
          >
            All types
          </Link>
          {TYPES.map((t) => (
            <Link
              key={t}
              href={buildQuery({ type: t, kind })}
              className="px-4 py-2 rounded-lg text-[11px] font-semibold transition-all capitalize"
              style={
                type === t
                  ? { background: "var(--c-filter-act)", color: "var(--c-primary-on)" }
                  : { color: "var(--c-muted)" }
              }
            >
              {t}
            </Link>
          ))}
        </div>

        {/* Kind filter row */}
        <div
          className="flex items-center gap-1 p-1 rounded-xl w-fit"
          style={{ background: "var(--c-filter-bg)", border: "1px solid var(--c-filter-border)" }}
        >
          <Link
            href={buildQuery({ type })}
            className="px-4 py-2 rounded-lg text-[11px] font-semibold transition-all"
            style={
              !kind
                ? { background: "var(--c-filter-act)", color: "var(--c-primary-on)" }
                : { color: "var(--c-muted)" }
            }
          >
            All
          </Link>
          <Link
            href={buildQuery({ type, kind: "job_listing" })}
            className="px-4 py-2 rounded-lg text-[11px] font-semibold transition-all"
            style={
              kind === "job_listing"
                ? { background: "var(--c-filter-act)", color: "var(--c-primary-on)" }
                : { color: "var(--c-muted)" }
            }
          >
            Job listings
          </Link>
        </div>

        {/* Table */}
        {pages.length === 0 ? (
          <div className="glass-card rounded-xl p-8 text-center">
            <p className="text-sm" style={{ color: "var(--c-muted)" }}>
              No pages yet.{" "}
              <Link href="/sources" className="hover:underline" style={{ color: "var(--c-primary)" }}>
                Go to Sources
              </Link>{" "}
              to sync and extract.
            </p>
          </div>
        ) : (
          <div className="glass-panel rounded-xl overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--c-divider)", background: "rgba(127,127,127,0.04)" }}>
                  <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--c-subtle)" }}>Title</th>
                  <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--c-subtle)" }}>Path</th>
                  <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--c-subtle)" }}>Links</th>
                  <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--c-subtle)" }}>Type</th>
                  <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--c-subtle)" }}>Tag</th>
                  <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-widest text-right" style={{ color: "var(--c-subtle)" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pages.map((p) => {
                  const meta = ENTITY_ICON[p.type] ?? ENTITY_ICON.topic;
                  const badgeType = ["person", "company", "project", "topic"].includes(p.type) ? p.type : null;
                  return (
                    <tr
                      key={p.slug}
                      className="group cursor-pointer transition-colors"
                      style={{ borderBottom: "1px solid var(--c-divider)" }}
                    >
                      <td className="px-6 py-4">
                        <Link href={`/pages/${p.slug}`} className="flex items-center gap-4 hover:no-underline">
                          <div
                            className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                            style={{
                              background: `linear-gradient(135deg, var(${meta.fromVar}) 0%, var(${meta.toVar}) 100%)`,
                              border: "1px solid var(--c-card-border)",
                            }}
                          >
                            <span className="material-symbols-outlined text-[18px] leading-none" style={{ color: `var(${meta.colorVar})` }}>
                              {meta.icon}
                            </span>
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold truncate max-w-[280px]" style={{ color: "var(--c-fg)" }}>
                              {p.title}
                            </p>
                            <p className="text-[10px] mt-0.5" style={{ color: "var(--c-subtle)" }}>page</p>
                          </div>
                        </Link>
                      </td>
                      <td className="px-6 py-4">
                        <Link href={`/pages/${p.slug}`} className="text-[11px] font-mono truncate max-w-[200px] block" style={{ color: "var(--c-subtle)" }}>
                          /{p.slug}
                        </Link>
                      </td>
                      <td className="px-6 py-4">
                        <Link href={`/pages/${p.slug}`} className="text-sm" style={{ color: "var(--c-muted)" }}>
                          {p.link_count > 0 ? `${p.link_count} link${p.link_count === 1 ? "" : "s"}` : "—"}
                        </Link>
                      </td>
                      <td className="px-6 py-4">
                        <Link href={`/pages/${p.slug}`}>
                          <span
                            className="text-[11px] font-medium px-3 py-1 rounded-full"
                            style={{
                              background: badgeType ? `var(--c-badge-${badgeType}-bg)` : "var(--c-surface-low)",
                              color: badgeType ? `var(--c-badge-${badgeType}-text)` : "var(--c-muted)",
                              border: badgeType ? `1px solid var(--c-badge-${badgeType}-b)` : "1px solid var(--c-card-border)",
                            }}
                          >
                            {p.type ?? "—"}
                          </span>
                        </Link>
                      </td>
                      <td className="px-6 py-4">
                        {p.kind === "job_listing" ? (
                          <span
                            className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full"
                            style={{
                              background: "var(--c-stat1-icon)",
                              color: "var(--c-stat1)",
                            }}
                          >
                            opportunity
                          </span>
                        ) : (
                          <span className="text-[11px]" style={{ color: "var(--c-subtle)" }}>—</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Link href={`/pages/${p.slug}`} className="p-1 transition-colors inline-block" style={{ color: "var(--c-subtle)" }}>
                          <span className="material-symbols-outlined text-[20px] leading-none">chevron_right</span>
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
