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
      <Link key={key++} href={`/pages/${slug}`} className="hover:underline" style={{ color: "var(--c-primary)" }}>
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
    <div className="min-h-screen">
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

      <div className="max-w-3xl mx-auto px-6 py-8 space-y-4">
        <p className="text-[11px] font-mono" style={{ color: "var(--c-subtle)" }}>{page.slug}</p>

        {/* Body */}
        <div className="glass-card rounded-xl p-6">
          <div className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: "var(--c-fg)" }}>
            {renderBody(page.body)}
          </div>
        </div>

        {/* Frontmatter attributes */}
        {otherFrontmatter.length > 0 && (
          <div className="glass-card rounded-xl p-6">
            <p className="text-[10px] uppercase tracking-widest mb-3" style={{ color: "var(--c-subtle)" }}>Attributes</p>
            <dl className="space-y-2 text-sm">
              {otherFrontmatter.map(([k, v]) => (
                <div key={k} className="flex gap-3">
                  <dt className="w-1/3 shrink-0 text-[12px]" style={{ color: "var(--c-muted)" }}>{k}</dt>
                  <dd className="font-mono text-[11px] break-all" style={{ color: "var(--c-fg)" }}>
                    {typeof v === "string" ? v : JSON.stringify(v)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {/* Backlinks */}
        {backlinks.length > 0 && (
          <div className="glass-card rounded-xl p-6">
            <p className="text-[10px] uppercase tracking-widest mb-3" style={{ color: "var(--c-subtle)" }}>
              Linked from ({backlinks.length})
            </p>
            <ul className="space-y-2">
              {backlinks.map((b) => (
                <li key={b.slug} className="flex items-center gap-3 text-sm">
                  <Link href={`/pages/${b.slug}`} className="hover:underline" style={{ color: "var(--c-primary)" }}>
                    {b.title}
                  </Link>
                  <span className="text-[10px] font-mono" style={{ color: "var(--c-subtle)" }}>{b.slug}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Evidence */}
        {evidence.length > 0 && (
          <div className="glass-card rounded-xl p-6">
            <p className="text-[10px] uppercase tracking-widest mb-3" style={{ color: "var(--c-subtle)" }}>
              Evidence ({evidence.length})
            </p>
            <ul className="space-y-1.5 text-[11px]">
              {evidence.map((e, i) => (
                <li key={i} className="font-mono" style={{ color: "var(--c-muted)" }}>
                  {e.source ?? "?"} · {e.date ?? "?"}{" "}
                  <span style={{ color: "var(--c-subtle)" }}>{e.event_id ?? ""}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
