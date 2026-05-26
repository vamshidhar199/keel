"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CommitmentDrawer } from "./commitment-drawer";

function CommitmentDrawerMountInner() {
  const router = useRouter();
  const params = useSearchParams();
  const commitmentId = params.get("commitment");

  function close() {
    const next = new URLSearchParams(params.toString());
    next.delete("commitment");
    const qs = next.toString();
    router.replace(qs ? `/overview?${qs}` : "/overview", { scroll: false });
  }

  return <CommitmentDrawer commitmentId={commitmentId} onClose={close} />;
}

// Reads ?commitment=<id> from the URL and renders the promise drawer when
// present. Mirrors DrawerMount (?slug=) so the two can coexist — clicking a
// person chip inside the promise drawer pushes a slug onto the URL and the
// page drawer pops on top.
export function CommitmentDrawerMount() {
  return (
    <Suspense fallback={null}>
      <CommitmentDrawerMountInner />
    </Suspense>
  );
}
