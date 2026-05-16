"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageDrawer } from "./page-drawer";

function DrawerMountInner() {
  const router = useRouter();
  const params = useSearchParams();
  const slug = params.get("slug");

  function close() {
    const next = new URLSearchParams(params.toString());
    next.delete("slug");
    const qs = next.toString();
    router.replace(qs ? `/overview?${qs}` : "/overview", { scroll: false });
  }

  return <PageDrawer slug={slug} onClose={close} />;
}

// Reads ?slug=... from the URL and renders the drawer when present.
// useSearchParams requires a Suspense boundary at runtime.
export function DrawerMount() {
  return (
    <Suspense fallback={null}>
      <DrawerMountInner />
    </Suspense>
  );
}
