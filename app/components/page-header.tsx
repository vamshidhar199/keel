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
    <header className="header-glass sticky top-0 h-16 flex items-center px-6 z-30">
      {crumbs && crumbs.length > 0 && (
        <nav className="flex items-center gap-1.5 text-xs mr-4" style={{ color: "var(--c-subtle)" }}>
          {crumbs.map((c, i) => (
            <span key={c.href} className="flex items-center gap-1.5">
              <Link href={c.href} className="transition-colors hover:opacity-80">
                {c.label}
              </Link>
              {i < crumbs.length - 1 && <span>/</span>}
            </span>
          ))}
          <span>/</span>
        </nav>
      )}
      <div className="flex items-center justify-between w-full gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold truncate" style={{ color: "var(--c-fg)" }}>{title}</h1>
          {subtitle && <p className="text-xs mt-0.5" style={{ color: "var(--c-subtle)" }}>{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
    </header>
  );
}
