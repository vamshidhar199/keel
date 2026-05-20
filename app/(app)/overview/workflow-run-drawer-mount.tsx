"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { WorkflowRunDrawer } from "./workflow-run-drawer";

function Inner() {
  const router = useRouter();
  const params = useSearchParams();
  const runId = params.get("run");

  function close() {
    const next = new URLSearchParams(params.toString());
    next.delete("run");
    const qs = next.toString();
    router.replace(qs ? `/overview?${qs}` : "/overview", { scroll: false });
  }

  return <WorkflowRunDrawer runId={runId} onClose={close} />;
}

export function WorkflowRunDrawerMount() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}
