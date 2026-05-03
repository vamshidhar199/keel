import Link from "next/link";

interface Crumb {
  href: string;
  label: string;
}

interface Props {
  title: string;
  subtitle?: string;
  crumbs?: Crumb[];
  actions?: React.ReactNode;
}

export function PageHeader({ title, subtitle, crumbs, actions }: Props) {
  return (
    <div className="border-b border-zinc-200 bg-white">
      <div className="max-w-5xl mx-auto px-8 py-5">
        {crumbs && crumbs.length > 0 && (
          <nav className="flex items-center gap-1.5 text-xs text-zinc-400 mb-2">
            {crumbs.map((c, i) => (
              <span key={c.href} className="flex items-center gap-1.5">
                <Link href={c.href} className="hover:text-zinc-700 transition-colors">
                  {c.label}
                </Link>
                {i < crumbs.length - 1 && <span>/</span>}
              </span>
            ))}
          </nav>
        )}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-zinc-900 truncate">
              {title}
            </h1>
            {subtitle && (
              <p className="text-sm text-zinc-500 mt-0.5">{subtitle}</p>
            )}
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </div>
      </div>
    </div>
  );
}
