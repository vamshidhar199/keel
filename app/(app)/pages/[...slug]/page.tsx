import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getPage, getBacklinks } from "@/lib/gbrain";
import { PageHeader } from "../../../components/page-header";
import { TypeBadge } from "../../../components/type-badge";
import { BackButton } from "../../../components/back-button";

function renderBody(body: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const re = /\[\[([^\]]+)\]\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = re.exec(body)) !== null) {
    if (match.index > lastIndex) {
      parts.push(body.slice(lastIndex, match.index));
    }
    const slug = match[1];
    parts.push(
      <Link key={key++} href={`/pages/${slug}`} className="text-violet-600 hover:underline">
        {slug}
      </Link>
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < body.length) parts.push(body.slice(lastIndex));
  return parts;
}

export default async function PageDetail({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const session = await auth();
  const userId = session!.user!.id;

  const { slug: slugParts } = await params;
  const slug = slugParts.join("/");

  const [page, backlinks] = await Promise.all([
    getPage(userId, slug),
    getBacklinks(userId, slug),
  ]);

  if (!page) notFound();

  const evidence = Array.isArray(page.frontmatter.evidence)
    ? (page.frontmatter.evidence as Array<{ event_id?: string; source?: string; date?: string }>)
    : [];

  const otherFrontmatter = Object.entries(page.frontmatter).filter(
    ([k]) => k !== "evidence" && k !== "type" && k !== "title"
  );

  return (
    <div>
      <PageHeader
        title={page.title}
        crumbs={[{ href: "/pages", label: "Pages" }]}
        actions={
          <div className="flex items-center gap-3">
            <BackButton />
            <TypeBadge type={page.type} />
          </div>
        }
      />

      <div className="max-w-3xl mx-auto px-8 py-8 space-y-4">
        <p className="text-xs text-zinc-400 font-mono">{page.slug}</p>

        {/* Body */}
        <div className="bg-white border border-zinc-200 rounded-lg p-6">
          <div className="text-sm text-zinc-700 leading-relaxed whitespace-pre-wrap">
            {renderBody(page.body)}
          </div>
        </div>

        {/* Frontmatter attributes */}
        {otherFrontmatter.length > 0 && (
          <div className="bg-white border border-zinc-200 rounded-lg p-6">
            <p className="text-xs text-zinc-400 uppercase tracking-wide mb-3">Attributes</p>
            <dl className="space-y-2 text-sm">
              {otherFrontmatter.map(([k, v]) => (
                <div key={k} className="flex gap-3">
                  <dt className="text-zinc-500 w-1/3 shrink-0">{k}</dt>
                  <dd className="text-zinc-700 font-mono text-xs break-all">
                    {typeof v === "string" ? v : JSON.stringify(v)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {/* Backlinks */}
        {backlinks.length > 0 && (
          <div className="bg-white border border-zinc-200 rounded-lg p-6">
            <p className="text-xs text-zinc-400 uppercase tracking-wide mb-3">
              Linked from ({backlinks.length})
            </p>
            <ul className="space-y-1">
              {backlinks.map((b) => (
                <li key={b.slug} className="flex items-center gap-2 text-sm">
                  <Link href={`/pages/${b.slug}`} className="text-violet-600 hover:underline">
                    {b.title}
                  </Link>
                  <span className="text-xs text-zinc-400 font-mono">{b.slug}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Evidence */}
        {evidence.length > 0 && (
          <div className="bg-white border border-zinc-200 rounded-lg p-6">
            <p className="text-xs text-zinc-400 uppercase tracking-wide mb-3">
              Evidence ({evidence.length})
            </p>
            <ul className="space-y-1.5 text-xs">
              {evidence.map((e, i) => (
                <li key={i} className="font-mono text-zinc-500">
                  {e.source ?? "?"} · {e.date ?? "?"}{" "}
                  <span className="text-zinc-400">{e.event_id ?? ""}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
