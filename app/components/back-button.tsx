"use client";

import { useRouter } from "next/navigation";

export function BackButton() {
  const router = useRouter();
  return (
    <button
      onClick={() => router.back()}
      className="flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800 transition-colors"
    >
      ← Back
    </button>
  );
}
