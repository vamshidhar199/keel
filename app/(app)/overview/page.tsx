import Link from "next/link";
import { auth } from "@/auth";
import { hasGmailScope } from "@/lib/gmail";
import { getGmailStatus } from "@/lib/sync";
import { getExtractionStatus } from "@/lib/pipeline";
import { listPages } from "@/lib/gbrain";
import { PageHeader } from "../../components/page-header";
import { TypeBadge } from "../../components/type-badge";

export default async function OverviewPage() {
  const session = await auth();
  const userId = session!.user!.id;

  const [gmailConnected, extractionStatus, recentPages] = await Promise.all([
    hasGmailScope(userId),
    getExtractionStatus(userId),
    listPages(userId, { limit: 8 }),
  ]);
  const gmailStatus = gmailConnected
    ? await getGmailStatus(userId)
    : null;

  const firstName = session?.user?.name?.split(" ")[0] ?? "there";

  return (
    <div>
      <PageHeader title={`Welcome back, ${firstName}`} subtitle="Your knowledge at a glance" />

      <div className="max-w-5xl mx-auto px-8 py-8 space-y-8">
        {/* Quick stats */}
        <div className="grid grid-cols-3 gap-4">
          <Stat
            label="Pages"
            value={extractionStatus.pagesCreated}
            href="/pages"
          />
          <Stat
            label="Extracted"
            value={extractionStatus.extracted}
            sublabel={`of ${extractionStatus.total} emails`}
            href="/sources"
          />
          <Stat
            label="Pending"
            value={extractionStatus.pending}
            sublabel="emails to process"
            href="/sources"
            highlight={extractionStatus.pending > 0}
          />
        </div>

        {/* Ask shortcut */}
        <div className="bg-white border border-zinc-200 rounded-lg p-6">
          <p className="text-xs text-zinc-400 uppercase tracking-wide mb-3">Ask</p>
          <Link
            href="/ask"
            className="block text-sm text-zinc-400 border border-zinc-200 rounded-md px-3 py-2.5 hover:border-zinc-300 hover:text-zinc-600 transition-colors"
          >
            Ask anything about your knowledge…
          </Link>
        </div>

        {/* Recent pages */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-zinc-400 uppercase tracking-wide">Recent pages</p>
            <Link
              href="/pages"
              className="text-xs text-zinc-500 hover:text-zinc-700 transition-colors"
            >
              View all →
            </Link>
          </div>

          {recentPages.length === 0 ? (
            <div className="bg-white border border-zinc-200 rounded-lg p-8 text-center">
              <p className="text-sm text-zinc-500">
                No pages yet.{" "}
                <Link href="/sources" className="text-violet-600 hover:underline">
                  Connect Gmail
                </Link>{" "}
                to start.
              </p>
            </div>
          ) : (
            <ul className="bg-white border border-zinc-200 rounded-lg divide-y divide-zinc-100">
              {recentPages.map((p) => (
                <li key={p.slug}>
                  <Link
                    href={`/pages/${p.slug}`}
                    className="flex items-center justify-between px-4 py-2.5 hover:bg-zinc-50 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-zinc-800 truncate">{p.title}</p>
                      <p className="text-xs text-zinc-400 font-mono mt-0.5 truncate">{p.slug}</p>
                    </div>
                    <TypeBadge type={p.type} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Source status */}
        <section>
          <p className="text-xs text-zinc-400 uppercase tracking-wide mb-3">Sources</p>
          <Link
            href="/sources"
            className="block bg-white border border-zinc-200 rounded-lg p-4 hover:border-zinc-300 transition-colors"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-zinc-800">Gmail</p>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {gmailConnected
                    ? `${gmailStatus?.messageCount ?? 0} messages synced`
                    : "Not connected"}
                </p>
              </div>
              <span
                className={`w-2 h-2 rounded-full ${
                  gmailConnected ? "bg-emerald-500" : "bg-zinc-300"
                }`}
              />
            </div>
          </Link>
        </section>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sublabel,
  href,
  highlight,
}: {
  label: string;
  value: number;
  sublabel?: string;
  href: string;
  highlight?: boolean;
}) {
  return (
    <Link
      href={href}
      className="bg-white border border-zinc-200 rounded-lg p-5 hover:border-zinc-300 transition-colors block"
    >
      <p className="text-xs text-zinc-400 uppercase tracking-wide">{label}</p>
      <p
        className={`text-2xl font-semibold mt-1 ${
          highlight ? "text-violet-600" : "text-zinc-900"
        }`}
      >
        {value}
      </p>
      {sublabel && <p className="text-xs text-zinc-400 mt-0.5">{sublabel}</p>}
    </Link>
  );
}
