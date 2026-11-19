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
  hasSavedCreds: boolean;
  instanceLabel: string | null;
  lastSyncedAt: string | null;
  nextSyncAt: string | null;
  recordCount: number;
  syncIntervalHours: number;
}

export function SalesforcePanel({
  connected,
  hasSavedCreds,
  instanceLabel,
  lastSyncedAt,
  nextSyncAt,
  recordCount,
  syncIntervalHours: initialInterval,
}: Props) {
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [count, setCount] = useState(recordCount);
  const [lastSync, setLastSync] = useState(lastSyncedAt);
  const [nextSync, setNextSync] = useState(nextSyncAt);
  const [intervalHours, setIntervalHours] = useState(initialInterval);
  const [savingInterval, setSavingInterval] = useState(false);
  const [intervalMsg, setIntervalMsg] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  async function handleSync() {
    setSyncing(true); setSyncMsg(null);
    try {
      const res = await fetch("/api/salesforce/sync", { method: "POST" });
      if (!res.ok) { const b = await res.json(); setSyncMsg(`Error: ${b.error}`); return; }
      await new Promise((r) => setTimeout(r, 2500));
      const s = await fetch("/api/salesforce/status");
      if (s.ok) {
        const d = await s.json();
        setCount(d.recordCount ?? count);
        setLastSync(d.lastSyncedAt ?? lastSync);
        setNextSync(d.nextSyncAt ?? nextSync);
        setSyncMsg("Sync queued");
      }
    } catch { setSyncMsg("Network error"); }
    finally { setSyncing(false); }
  }

  async function handleSaveInterval(newHours: number) {
    setSavingInterval(true); setIntervalMsg(null);
    try {
      const res = await fetch("/api/salesforce/settings", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ syncIntervalHours: newHours }),
      });
      if (!res.ok) { setIntervalMsg("Failed"); return; }
      setIntervalHours(newHours); setIntervalMsg("Saved");
      setTimeout(() => setIntervalMsg(null), 2000);
      if (lastSync) { const n = new Date(lastSync); n.setHours(n.getHours() + newHours); setNextSync(n.toISOString()); }
    } catch { setIntervalMsg("Error"); }
    finally { setSavingInterval(false); }
  }

  if (!connected) {
    return <SalesforceConnectCard hasSavedCreds={hasSavedCreds} />;
  }

  return (
    <div className="glass-card rounded-xl p-6 flex flex-col justify-between min-h-[220px] transition-all">
      {/* Top */}
      <div className="flex justify-between items-start">
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center"
          style={{ background: "var(--c-primary-m)", border: "1px solid var(--c-card-border)" }}
        >
          <span className="material-symbols-outlined text-xl leading-none" style={{ color: "var(--c-primary)", fontVariationSettings: "'FILL' 1" }}>cloud</span>
        </div>
        <span
          className="text-[11px] font-medium px-3 py-1 rounded-full"
          style={{
            background: "var(--c-connected-bg)",
            color: "var(--c-connected-text)",
            border: "1px solid var(--c-connected-border)",
          }}
        >
          Connected
        </span>
      </div>

      {/* Info */}
      <div className="mt-4">
        <h4 className="text-xl font-semibold" style={{ color: "var(--c-fg)" }}>Salesforce</h4>
        {instanceLabel && <p className="text-[11px] mt-0.5" style={{ color: "var(--c-subtle)" }}>{instanceLabel}</p>}
        <p className="text-sm mt-1" style={{ color: "var(--c-subtle)" }}>Index Accounts and Contacts from your CRM.</p>
      </div>

      {/* Settings drawer */}
      {showSettings && (
        <div className="mt-4 space-y-2">
          <div className="flex items-center gap-3">
            <select
              value={intervalHours}
              onChange={(e) => handleSaveInterval(Number(e.target.value))}
              disabled={savingInterval}
              className="flex-1 text-sm rounded-lg px-3 py-2 focus:outline-none disabled:opacity-50"
              style={{ background: "var(--c-card)", border: "1px solid var(--c-card-border)", color: "var(--c-fg)" }}
            >
              {INTERVAL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            {intervalMsg && <span className="text-[11px]" style={{ color: "var(--c-stat2)" }}>{intervalMsg}</span>}
          </div>
        </div>
      )}

      {/* Bottom row */}
      <div className="mt-4 flex items-center justify-between">
        <div>
          <p className="text-[11px]" style={{ color: "var(--c-subtle)" }}>
            {lastSync ? `Last sync: ${new Date(lastSync).toLocaleString()}` : "Not yet synced"}
          </p>
          {count > 0 && <p className="text-[11px]" style={{ color: "var(--c-subtle)" }}>{count.toLocaleString()} records</p>}
          {syncMsg && <p className="text-[11px] mt-0.5" style={{ color: "var(--c-stat2)" }}>{syncMsg}</p>}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSettings((v) => !v)}
            className="p-1.5 transition-colors rounded-lg"
            style={{ color: "var(--c-subtle)" }}
          >
            <span className="material-symbols-outlined text-[18px] leading-none">settings</span>
          </button>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="p-1.5 transition-colors rounded-lg disabled:opacity-40"
            style={{ color: "var(--c-subtle)" }}
          >
            <span className="material-symbols-outlined text-[18px] leading-none">refresh</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// Disconnected state: Connected App credentials + domain + sandbox.
// Submits as a real POST form so the response can 303-redirect the browser
// straight to Salesforce's authorize URL.
//
// If the user already saved Consumer Key/Secret, those fields can be left
// blank — the server reuses the stored values. Pasting new values updates
// them.
function SalesforceConnectCard({ hasSavedCreds }: { hasSavedCreds: boolean }) {
  return (
    <div
      className="glass-card rounded-xl p-6 flex flex-col justify-between min-h-[220px] transition-all"
      style={{ borderStyle: "dashed" }}
    >
      <div className="flex justify-between items-start">
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center"
          style={{ background: "var(--c-surface-low)", border: "1px solid var(--c-surface-low-b)" }}
        >
          <span className="material-symbols-outlined text-xl leading-none" style={{ color: "var(--c-subtle)" }}>cloud</span>
        </div>
      </div>
      <div className="mt-4">
        <h4 className="text-xl font-semibold" style={{ color: "var(--c-fg)" }}>Salesforce</h4>
        <p className="text-sm mt-1" style={{ color: "var(--c-subtle)" }}>Index Accounts and Contacts from your CRM.</p>
      </div>

      <form action="/api/salesforce/connect" method="POST" className="mt-4 space-y-2">
        <input
          name="consumerKey"
          type="password"
          autoComplete="off"
          placeholder={hasSavedCreds ? "Consumer Key (saved — leave blank to reuse)" : "Consumer Key"}
          className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none font-mono"
          style={{ background: "var(--c-card)", border: "1px solid var(--c-card-border)", color: "var(--c-fg)" }}
        />
        <input
          name="consumerSecret"
          type="password"
          autoComplete="off"
          placeholder={hasSavedCreds ? "Consumer Secret (saved — leave blank to reuse)" : "Consumer Secret"}
          className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none font-mono"
          style={{ background: "var(--c-card)", border: "1px solid var(--c-card-border)", color: "var(--c-fg)" }}
        />
        <input
          name="domain"
          type="text"
          placeholder="My Domain (e.g. acme.my.salesforce.com)"
          className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none"
          style={{ background: "var(--c-card)", border: "1px solid var(--c-card-border)", color: "var(--c-fg)" }}
        />
        <label className="flex items-center gap-2 text-[11px]" style={{ color: "var(--c-subtle)" }}>
          <input name="sandbox" type="checkbox" value="1" />
          This is a sandbox
        </label>
        <button
          type="submit"
          className="w-full text-center py-2.5 rounded-lg text-[11px] font-semibold transition-all hover:brightness-110"
          style={{ background: "var(--c-btn-bg)", border: "1px solid var(--c-btn-border)", color: "var(--c-fg)" }}
        >
          Connect Salesforce
        </button>
        <p className="text-[10px] mt-1" style={{ color: "var(--c-subtle)" }}>
          Need a Consumer Key? In your Salesforce org: Setup → App Manager → New Connected App.
          Set the Callback URL to {`${typeof window !== "undefined" ? window.location.origin : ""}/api/salesforce/callback`} and select scopes
          {" "}<span className="font-mono">api</span>, <span className="font-mono">refresh_token</span>, <span className="font-mono">offline_access</span>.
        </p>
      </form>
    </div>
  );
}
