import { auth } from "@/auth";
import { listPages } from "@/lib/gbrain";
import { PageHeader } from "../../components/page-header";
import { TypeBadge } from "../../components/type-badge";
import Link from "next/link";

const TYPES = ["person", "company", "project", "topic"] as const;

export default async function PagesIndex({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const session = await auth();
  const userId = session!.user!.id;

  const { type } = await searchParams;
  const pages = await listPages(userId, type ? { type } : {});

  return (
    <div>
      <PageHeader
        title="Pages"
        subtitle={`${pages.length} ${pages.length === 1 ? "page" : "pages"}${type ? ` · ${type}` : ""}`}
        actions={
          <Link
            href="/graph"
            className="text-xs px-3 py-1.5 bg-white border border-zinc-200 rounded-lg hover:bg-zinc-100 transition-colors text-zinc-700"
          >
            Graph view
          </Link>
        }
      />

      <div className="max-w-5xl mx-auto px-8 py-8 space-y-4">
        {/* Type filter */}
        <div className="flex gap-2 flex-wrap">
          <Link
            href="/pages"
            className={`text-xs px-3 py-1.5 rounded-full transition-colors ${
              !type
                ? "bg-zinc-800 text-white"
                : "bg-white border border-zinc-200 text-zinc-600 hover:bg-zinc-100"
            }`}
          >
            All
          </Link>
          {TYPES.map((t) => (
            <Link
              key={t}
              href={`/pages?type=${t}`}
              className={`text-xs px-3 py-1.5 rounded-full transition-colors ${
                type === t
                  ? "bg-zinc-800 text-white"
                  : "bg-white border border-zinc-200 text-zinc-600 hover:bg-zinc-100"
              }`}
            >
              {t}
            </Link>
          ))}
        </div>

        {/* Page list */}
        {pages.length === 0 ? (
          <div className="bg-white border border-zinc-200 rounded-lg p-8 text-center">
            <p className="text-sm text-zinc-500">
              No pages yet.{" "}
              <Link href="/sources" className="text-violet-600 hover:underline">
                Go to Sources
              </Link>{" "}
              to sync and extract.
            </p>
          </div>
        ) : (
          <ul className="bg-white border border-zinc-200 rounded-lg divide-y divide-zinc-100">
            {pages.map((p) => (
              <li key={p.slug}>
                <Link
                  href={`/pages/${p.slug}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-zinc-50 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-zinc-800 truncate">{p.title}</p>
                    <p className="text-xs text-zinc-400 font-mono mt-0.5 truncate">{p.slug}</p>
                  </div>
                  <div className="flex items-center gap-3 ml-3 shrink-0">
                    {p.link_count > 0 && (
                      <span className="text-xs text-zinc-400">
                        {p.link_count} link{p.link_count === 1 ? "" : "s"}
                      </span>
                    )}
                    <TypeBadge type={p.type} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
