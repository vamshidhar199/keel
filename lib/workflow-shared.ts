// Client-safe workflow primitives. Importable from "use client" components
// without dragging in lib/db.ts (and therefore pg / Node-only modules).
// lib/workflows.ts re-exports these for server-side callers.

export const LOOKBACK_HOURS_CHOICES = [12, 24, 48, 72, 168, 336, 720] as const;
export type LookbackHours = (typeof LOOKBACK_HOURS_CHOICES)[number];

export function isLookbackHours(n: unknown): n is LookbackHours {
  return typeof n === "number" && (LOOKBACK_HOURS_CHOICES as readonly number[]).includes(n);
}

export function describeLookback(hours: number): string {
  if (hours <= 24) return `the last ${hours} hours`;
  const days = Math.round(hours / 24);
  return `the last ${days} day${days === 1 ? "" : "s"}`;
}
