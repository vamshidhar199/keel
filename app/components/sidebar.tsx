"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface Props {
  email: string;
  name?: string | null;
}

const NAV = [
  { href: "/overview", label: "Overview", icon: "○" },
  { href: "/ask", label: "Ask", icon: "?" },
  { href: "/pages", label: "Pages", icon: "≡" },
  { href: "/graph", label: "Graph", icon: "✦" },
  { href: "/sources", label: "Sources", icon: "↺" },
];

export function Sidebar({ email, name }: Props) {
  const pathname = usePathname();

  return (
    <aside className="w-60 bg-zinc-800 flex flex-col h-screen sticky top-0">
      {/* Wordmark */}
      <div className="px-4 pt-5 pb-4">
        <Link href="/overview" className="block">
          <span className="text-base font-semibold tracking-tight text-white">
            mettrie
          </span>
        </Link>
      </div>

      {/* Nav */}
      <nav className="px-2 flex-1">
        <ul className="space-y-0.5">
          {NAV.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-sm transition-colors ${
                    active
                      ? "bg-white/10 text-white font-semibold"
                      : "text-white/70 hover:bg-white/10 hover:text-white font-medium"
                  }`}
                >
                  <span className="w-4 text-center text-xs">
                    {item.icon}
                  </span>
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* User */}
      <div className="border-t border-white/10 p-3">
        <Link
          href="/settings"
          className="block px-2 py-1.5 rounded-md hover:bg-white/10 transition-colors"
        >
          <p className="text-xs font-semibold text-white/80 truncate">{name ?? "Account"}</p>
          <p className="text-xs font-medium text-white/50 truncate">{email}</p>
        </Link>
      </div>
    </aside>
  );
}
