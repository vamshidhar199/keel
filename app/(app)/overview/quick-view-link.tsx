"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { ReactNode, MouseEvent } from "react";

interface Props {
  slug: string;
  children: ReactNode;
  className?: string;
}

// Wraps a card item so click opens the page drawer via ?slug=... — keeps the
// user on /overview. Cmd/Ctrl-click and middle-click still open /pages/[slug]
// in a new tab (native anchor behavior).
export function QuickViewLink({ slug, children, className }: Props) {
  const router = useRouter();
  const params = useSearchParams();

  function onClick(e: MouseEvent<HTMLAnchorElement>) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1) return;
    e.preventDefault();
    const next = new URLSearchParams(params.toString());
    next.set("slug", slug);
    router.replace(`/overview?${next.toString()}`, { scroll: false });
  }

  return (
    <a
      href={`/pages/${slug}`}
      onClick={onClick}
      className={className}
      data-slug={slug}
    >
      {children}
    </a>
  );
}
