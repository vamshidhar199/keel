"use client";

import { useRouter } from "next/navigation";

export function BackButton() {
  const router = useRouter();
  return (
    <button
      onClick={() => router.back()}
      className="glass-card flex items-center gap-2 text-[11px] font-semibold px-3 py-2 rounded-lg transition-colors tracking-wide"
      style={{ color: "var(--c-muted)" }}
    >
      <span className="material-symbols-outlined text-[16px] leading-none">arrow_back</span>
      Back
    </button>
  );
}
