"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface Props {
  email: string;
  name?: string | null;
}

const NAV = [
  { href: "/overview", label: "Dashboard", icon: "dashboard" },
  { href: "/ask", label: "Ask", icon: "chat_bubble" },
  { href: "/pages", label: "Pages", icon: "folder_copy" },
  { href: "/graph", label: "Graph", icon: "account_tree" },
  { href: "/sources", label: "Sources", icon: "hub" },
];

export function Sidebar({ email, name }: Props) {
  const pathname = usePathname();

  return (
    <aside className="sidebar-glass fixed left-0 top-0 h-full flex flex-col z-40 w-64 shadow-xl">
      {/* Logo */}
      <div className="px-6 py-8 pb-6">
        <Link href="/overview" className="block">
          <span
            className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r"
            style={{ backgroundImage: "var(--c-gradient)" }}
          >
            Mettrie
          </span>
        </Link>
        <p className="text-[10px] font-medium tracking-[0.15em] uppercase mt-1" style={{ color: "var(--c-subtle)" }}>
          Enterprise Intelligence
        </p>
      </div>

      {/* Nav */}
      <nav className="flex-1 flex flex-col py-2">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-4 px-6 py-3 transition-all duration-300 text-[11px] font-semibold tracking-[0.1em] uppercase border-r-2"
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
                className="material-symbols-outlined text-xl leading-none"
                style={active ? { fontVariationSettings: "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24" } : undefined}
              >
                {item.icon}
              </span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Bottom CTA + user */}
      <div className="p-6 pb-8 space-y-4">
        <Link
          href="/ask"
          className="vibrant-gradient w-full py-3 px-4 rounded-xl text-[11px] font-bold text-white shadow-lg flex items-center justify-center gap-2 hover:brightness-110 transition-all tracking-wide"
        >
          <span className="material-symbols-outlined text-[18px] leading-none">bolt</span>
          Synthesize Knowledge
        </Link>

        <div className="space-y-1 pt-3" style={{ borderTop: "1px solid var(--c-divider)" }}>
          <Link
            href="/settings"
            className="flex items-center gap-4 px-2 py-2.5 transition-all duration-300 rounded-lg text-[11px] font-semibold tracking-[0.1em] uppercase"
            style={{ color: "var(--c-nav-text)" }}
          >
            <span className="material-symbols-outlined text-xl leading-none">settings</span>
            Settings
          </Link>

          <div className="px-2 pt-2">
            <p className="text-[11px] font-semibold truncate" style={{ color: "var(--c-fg)" }}>{name ?? "Account"}</p>
            <p className="text-[10px] truncate mt-0.5" style={{ color: "var(--c-subtle)" }}>{email}</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
