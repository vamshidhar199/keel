"use client";

import { useEffect } from "react";

// Posts the browser's IANA timezone to the server on first mount when the
// stored timezone is still the default 'UTC'. Fire-and-forget; failures are
// silent because this is a polish convenience, not a hard requirement.
export function TimezoneSync({ currentTz }: { currentTz: string }) {
  useEffect(() => {
    if (currentTz !== "UTC") return;
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (!tz || tz === "UTC") return;
      fetch("/api/settings/timezone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tz }),
      }).catch(() => {});
    } catch {
      // Intl unavailable in some environments — no-op.
    }
  }, [currentTz]);

  return null;
}
