"use client";

import { useState } from "react";

interface Props {
  connected: boolean;
  lastSyncedAt: string | null;
  messageCount: number;
}

export function GmailPanel({ connected, lastSyncedAt, messageCount }: Props) {
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [count, setCount] = useState(messageCount);
  const [lastSync, setLastSync] = useState(lastSyncedAt);

  async function handleSync() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch("/api/gmail/sync", { method: "POST" });
      if (!res.ok) {
        const body = await res.json();
        setSyncMsg(`Error: ${body.error}`);
        return;
      }
      // Poll status after a short delay to pick up the result.
      await new Promise((r) => setTimeout(r, 2500));
      const statusRes = await fetch("/api/gmail/status");
      if (statusRes.ok) {
        const status = await statusRes.json();
        setCount(status.messageCount ?? count);
        setLastSync(status.lastSyncedAt ?? lastSync);
        setSyncMsg("Sync complete");
      }
    } catch {
      setSyncMsg("Network error — try again");
    } finally {
      setSyncing(false);
    }
  }

  if (!connected) {
    return (
      <div className="bg-white border border-zinc-200 rounded-lg p-6 shadow-sm w-full max-w-sm">
        <p className="text-xs text-zinc-400 uppercase tracking-wide mb-3">Gmail</p>
        <p className="text-sm text-zinc-500 mb-4">
          Gmail access not yet granted. Sign out and sign back in to connect.
        </p>
        <p className="text-xs text-zinc-400">
          Your next sign-in will request <code className="bg-zinc-100 px-1 rounded">gmail.readonly</code> access.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-6 shadow-sm w-full max-w-sm">
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-zinc-400 uppercase tracking-wide">Gmail</p>
        <span className="text-xs text-emerald-600 font-medium bg-emerald-50 px-2 py-0.5 rounded-full">
          Connected
        </span>
      </div>
      <div className="space-y-1 mb-5">
        <p className="text-sm text-zinc-700">
          <span className="font-medium">{count.toLocaleString()}</span>{" "}
          <span className="text-zinc-400">messages stored</span>
        </p>
        {lastSync ? (
          <p className="text-xs text-zinc-400">
            Last sync: {new Date(lastSync).toLocaleString()}
          </p>
        ) : (
          <p className="text-xs text-zinc-400">Not yet synced</p>
        )}
      </div>
      <button
        onClick={handleSync}
        disabled={syncing}
        className="w-full px-4 py-2 text-sm bg-zinc-800 text-white rounded-lg hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {syncing ? "Syncing…" : "Sync Now"}
      </button>
      {syncMsg && (
        <p className="text-xs text-zinc-500 mt-2 text-center">{syncMsg}</p>
      )}
    </div>
  );
}
