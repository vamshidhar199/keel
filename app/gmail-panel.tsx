"use client";

import { useState } from "react";

const INTERVAL_OPTIONS = [
  { label: "Every hour", value: 1 },
  { label: "Every 6 hours", value: 6 },
  { label: "Every 12 hours", value: 12 },
  { label: "Daily", value: 24 },
];

interface Props {
  connected: boolean;
  lastSyncedAt: string | null;
  nextSyncAt: string | null;
  messageCount: number;
  syncIntervalHours: number;
}

export function GmailPanel({
  connected,
  lastSyncedAt,
  nextSyncAt,
  messageCount,
  syncIntervalHours: initialInterval,
}: Props) {
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [count, setCount] = useState(messageCount);
  const [lastSync, setLastSync] = useState(lastSyncedAt);
  const [nextSync, setNextSync] = useState(nextSyncAt);
  const [intervalHours, setIntervalHours] = useState(initialInterval);
  const [savingInterval, setSavingInterval] = useState(false);
  const [intervalMsg, setIntervalMsg] = useState<string | null>(null);

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
      await new Promise((r) => setTimeout(r, 2500));
      const statusRes = await fetch("/api/gmail/status");
      if (statusRes.ok) {
        const status = await statusRes.json();
        setCount(status.messageCount ?? count);
        setLastSync(status.lastSyncedAt ?? lastSync);
        setNextSync(status.nextSyncAt ?? nextSync);
        setSyncMsg("Sync complete");
      }
    } catch {
      setSyncMsg("Network error — try again");
    } finally {
      setSyncing(false);
    }
  }

  async function handleSaveInterval(newHours: number) {
    setSavingInterval(true);
    setIntervalMsg(null);
    try {
      const res = await fetch("/api/gmail/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ syncIntervalHours: newHours }),
      });
      if (!res.ok) {
        setIntervalMsg("Failed to save");
        return;
      }
      setIntervalHours(newHours);
      setIntervalMsg("Saved");
      setTimeout(() => setIntervalMsg(null), 2000);
      if (lastSync) {
        const next = new Date(lastSync);
        next.setHours(next.getHours() + newHours);
        setNextSync(next.toISOString());
      }
    } catch {
      setIntervalMsg("Network error");
    } finally {
      setSavingInterval(false);
    }
  }

  if (!connected) {
    return (
      <div className="bg-white border border-zinc-200 rounded-lg p-6 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs text-zinc-400 uppercase tracking-wide">Gmail</p>
          <span className="text-xs text-zinc-400 bg-zinc-100 px-2 py-0.5 rounded-full font-medium">
            Not connected
          </span>
        </div>
        <p className="text-sm text-zinc-500">
          Gmail access not granted. Sign out and sign back in to connect.
        </p>
        <p className="text-xs text-zinc-400">
          Your next sign-in will request{" "}
          <code className="bg-zinc-100 px-1 py-0.5 rounded text-zinc-600">gmail.readonly</code> access.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-400 uppercase tracking-wide">Gmail</p>
        <span className="text-xs text-emerald-600 font-medium bg-emerald-50 px-2 py-0.5 rounded-full">
          Connected
        </span>
      </div>

      {/* Stats */}
      <div className="space-y-1">
        <p className="text-2xl font-semibold text-zinc-900">{count.toLocaleString()}</p>
        <p className="text-xs text-zinc-400">messages synced</p>
        <div className="pt-1 space-y-0.5">
          {lastSync ? (
            <p className="text-xs text-zinc-400">Last sync: {new Date(lastSync).toLocaleString()}</p>
          ) : (
            <p className="text-xs text-zinc-400">Not yet synced</p>
          )}
          {nextSync && (
            <p className="text-xs text-zinc-400">Next: {new Date(nextSync).toLocaleString()}</p>
          )}
        </div>
      </div>

      {/* Schedule */}
      <div>
        <p className="text-xs text-zinc-400 mb-2">Auto-sync schedule</p>
        <div className="flex items-center gap-3">
          <select
            value={intervalHours}
            onChange={(e) => handleSaveInterval(Number(e.target.value))}
            disabled={savingInterval}
            className="flex-1 text-sm text-zinc-700 border border-zinc-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-violet-200 disabled:opacity-50"
          >
            {INTERVAL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          {intervalMsg && <span className="text-xs text-zinc-400">{intervalMsg}</span>}
        </div>
      </div>

      {/* Sync now */}
      <div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="w-full px-4 py-2.5 text-sm font-medium bg-zinc-900 text-white rounded-lg hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {syncing ? "Syncing…" : "Sync Now"}
        </button>
        {syncMsg && <p className="text-xs text-zinc-500 mt-2 text-center">{syncMsg}</p>}
      </div>
    </div>
  );
}
