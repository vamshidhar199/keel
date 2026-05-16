"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface Props {
  email: string;
  name?: string | null;
}

const NAV = [
  { href: "/ask", label: "Ask", icon: "chat_bubble" },
  { href: "/overview", label: "Home", icon: "home" },
  { href: "/workflows", label: "Workflows", icon: "bolt" },
];

export function Sidebar({ email, name }: Props) {
  const pathname = usePathname();
  const initial = (name?.trim()?.[0] ?? email?.trim()?.[0] ?? "?").toUpperCase();

  return (
    <aside
      className="sidebar-glass group/sb fixed left-0 top-0 h-full flex flex-col z-40 shadow-xl overflow-hidden w-16 hover:w-64 transition-[width] duration-200 ease-out"
    >
      {/* Logo */}
      <div className="px-3 py-6 flex items-center gap-3 shrink-0">
        <Link href="/ask" className="block shrink-0" aria-label="Mettrie home">
          <span
            className="inline-flex items-center justify-center w-10 h-10 rounded-xl text-[16px] font-extrabold"
            style={{
              background: "var(--c-primary-m)",
              color: "var(--c-primary)",
              border: "1px solid var(--c-card-border)",
            }}
          >
            M
          </span>
        </Link>
        <span
          className="text-xl font-bold whitespace-nowrap opacity-0 group-hover/sb:opacity-100 transition-opacity duration-200 bg-clip-text text-transparent bg-gradient-to-r"
          style={{ backgroundImage: "var(--c-gradient)" }}
          aria-hidden
        >
          Mettrie
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 flex flex-col py-2 mt-2">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              className="flex items-center gap-4 px-5 py-3 transition-all duration-200 text-[11px] font-semibold tracking-[0.1em] uppercase border-r-2 whitespace-nowrap"
              style={
                active
                  ? {
                      background: "var(--c-nav-active)",
                      color: "var(--c-nav-at)",
                      borderRightColor: "var(--c-nav-ab)",
                    }
                  : {
                      color: "var(--c-nav-text)",
                      borderRightColor: "transparent",
                    }
              }
            >
              <span
                className="material-symbols-outlined text-xl leading-none shrink-0"
                style={active ? { fontVariationSettings: "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24" } : undefined}
              >
                {item.icon}
              </span>
              <span className="opacity-0 group-hover/sb:opacity-100 transition-opacity duration-200">
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* Bottom: Settings + user */}
      <div className="px-3 pb-5 pt-3 shrink-0 space-y-1.5" style={{ borderTop: "1px solid var(--c-divider)" }}>
        <Link
          href="/settings"
          title="Settings"
          className="flex items-center gap-4 px-2 py-2.5 transition-all rounded-lg text-[11px] font-semibold tracking-[0.1em] uppercase whitespace-nowrap"
          style={{ color: "var(--c-nav-text)" }}
        >
          <span className="material-symbols-outlined text-xl leading-none shrink-0">settings</span>
          <span className="opacity-0 group-hover/sb:opacity-100 transition-opacity duration-200">Settings</span>
        </Link>

        <div className="flex items-center gap-3 px-2 pt-2">
          <span
            className="inline-flex items-center justify-center w-9 h-9 rounded-full text-[13px] font-bold shrink-0"
            style={{
              background: "var(--c-primary-m)",
              color: "var(--c-primary)",
              border: "1px solid var(--c-card-border)",
            }}
          >
            {initial}
          </span>
          <div className="opacity-0 group-hover/sb:opacity-100 transition-opacity duration-200 min-w-0">
            <p className="text-[11px] font-semibold truncate" style={{ color: "var(--c-fg)" }}>
              {name ?? "Account"}
            </p>
            <p className="text-[10px] truncate mt-0.5" style={{ color: "var(--c-subtle)" }}>
              {email}
            </p>
          </div>
        </div>
      </div>
    </aside>
  );
}
