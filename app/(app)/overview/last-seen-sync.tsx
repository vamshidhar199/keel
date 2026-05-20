"use client";

import { useEffect } from "react";

// Heartbeat: POSTs to /api/users/last-seen on mount so composeDigest can compute
// the user's away-gap for the adaptive recap window. Fire-and-forget.
export function LastSeenSync() {
  useEffect(() => {
    fetch("/api/users/last-seen", { method: "POST" }).catch(() => {});
  }, []);
  return null;
}
