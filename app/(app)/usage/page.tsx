import Link from "next/link";
import { auth } from "@/auth";
import { getMetaDb } from "@/lib/db";
import { getSharedStatus } from "@/lib/llm-keys";

interface SpendByWindow {
  windowDays: number;
  total_usd: number;
  call_count: number;
  input_tokens: number;
  output_tokens: number;
}

interface SpendByModel {
  model: string;
  total_usd: number;
  call_count: number;
}

interface SpendBySource {
  source: string;
  total_usd: number;
  call_count: number;
}

interface SpendByDay {
  day: string;
  total_usd: number;
}

async function loadSpend(userId: string) {
  const db = getMetaDb();
  const [windows, byModel, bySource, byDay] = await Promise.all([
    db.query<SpendByWindow>(
      `SELECT 1 AS "windowDays",
              COALESCE(SUM(cost_usd), 0)::float AS total_usd,
              COUNT(*)::int AS call_count,
              COALESCE(SUM(input_tokens), 0)::int AS input_tokens,
              COALESCE(SUM(output_tokens), 0)::int AS output_tokens
         FROM llm_costs
        WHERE user_id = $1 AND called_at >= NOW() - INTERVAL '1 day'
       UNION ALL
       SELECT 7 AS "windowDays",
              COALESCE(SUM(cost_usd), 0)::float AS total_usd,
              COUNT(*)::int AS call_count,
              COALESCE(SUM(input_tokens), 0)::int AS input_tokens,
              COALESCE(SUM(output_tokens), 0)::int AS output_tokens
         FROM llm_costs
        WHERE user_id = $1 AND called_at >= NOW() - INTERVAL '7 days'
       UNION ALL
       SELECT 30 AS "windowDays",
              COALESCE(SUM(cost_usd), 0)::float AS total_usd,
              COUNT(*)::int AS call_count,
              COALESCE(SUM(input_tokens), 0)::int AS input_tokens,
              COALESCE(SUM(output_tokens), 0)::int AS output_tokens
         FROM llm_costs
        WHERE user_id = $1 AND called_at >= NOW() - INTERVAL '30 days'`,
      [userId]
    ),
    db.query<SpendByModel>(
      `SELECT model,
              COALESCE(SUM(cost_usd), 0)::float AS total_usd,
              COUNT(*)::int AS call_count
         FROM llm_costs
        WHERE user_id = $1 AND called_at >= NOW() - INTERVAL '30 days'
        GROUP BY model
        ORDER BY total_usd DESC`,
      [userId]
    ),
    db.query<SpendBySource>(
      `SELECT key_source AS source,
              COALESCE(SUM(cost_usd), 0)::float AS total_usd,
              COUNT(*)::int AS call_count
         FROM llm_costs
        WHERE user_id = $1 AND called_at >= NOW() - INTERVAL '30 days'
        GROUP BY key_source
        ORDER BY total_usd DESC`,
      [userId]
    ),
    db.query<SpendByDay>(
      `SELECT to_char(date_trunc('day', called_at), 'YYYY-MM-DD') AS day,
              COALESCE(SUM(cost_usd), 0)::float AS total_usd
         FROM llm_costs
        WHERE user_id = $1 AND called_at >= NOW() - INTERVAL '14 days'
        GROUP BY 1
        ORDER BY 1 ASC`,
      [userId]
    ),
  ]);
  return {
    windows: windows.rows,
    byModel: byModel.rows,
    bySource: bySource.rows,
    byDay: byDay.rows,
  };
}

function usd(n: number): string {
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

function shortNum(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function sourceLabel(s: string, mode: "off" | "trial" | "org"): string {
  if (s === "user") return "Your key";
  if (s === "shared") return mode === "org" ? "Shared key (org)" : "Free trial (shared)";
  return s;
}

export default async function UsagePage() {
  const session = await auth();
  const userId = session!.user!.id;

  const [{ windows, byModel, bySource, byDay }, shared] = await Promise.all([
    loadSpend(userId),
    getSharedStatus(),
  ]);

  const win = (days: number) => windows.find((w) => w.windowDays === days);
  const today = win(1);
  const week = win(7);
  const month = win(30);

  // Tiny inline bar chart for the daily-spend trend.
  const maxDay = Math.max(0.0001, ...byDay.map((d) => d.total_usd));

  return (
    <div className="min-h-screen">
      <header className="header-glass sticky top-0 h-16 flex items-center justify-between px-6 z-30">
        <div className="flex items-center gap-3">
          <Link
            href="/settings"
            className="material-symbols-outlined text-xl leading-none"
            style={{ color: "var(--c-muted)" }}
            aria-label="Back to settings"
          >
            arrow_back
          </Link>
          <h1 className="text-2xl font-bold" style={{ color: "var(--c-fg)" }}>
            Usage
          </h1>
        </div>
      </header>

      <div className="px-8 py-10 max-w-4xl mx-auto space-y-8">
        {/* Headline numbers */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard label="Today (last 24h)" total={today?.total_usd ?? 0} calls={today?.call_count ?? 0} />
          <StatCard label="Last 7 days" total={week?.total_usd ?? 0} calls={week?.call_count ?? 0} />
          <StatCard label="Last 30 days" total={month?.total_usd ?? 0} calls={month?.call_count ?? 0} />
        </section>

        {/* Daily trend */}
        {byDay.length > 0 && (
          <section className="glass-card rounded-2xl p-5 space-y-3">
            <p className="text-[10px] uppercase tracking-widest" style={{ color: "var(--c-subtle)" }}>
              Last 14 days
            </p>
            <div className="flex items-end gap-1.5 h-24">
              {byDay.map((d) => {
                const h = Math.max(2, Math.round((d.total_usd / maxDay) * 96));
                return (
                  <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
                    <div
                      title={`${d.day}: ${usd(d.total_usd)}`}
                      style={{
                        height: `${h}px`,
                        width: "100%",
                        background: "var(--c-primary)",
                        borderRadius: "3px 3px 0 0",
                        opacity: 0.85,
                      }}
                    />
                    <span
                      className="text-[9px] font-mono"
                      style={{ color: "var(--c-subtle)" }}
                    >
                      {d.day.slice(5)}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* By source */}
        <section className="glass-card rounded-2xl overflow-hidden">
          <div className="px-5 py-3" style={{ borderBottom: "1px solid var(--c-divider)" }}>
            <p
              className="text-[10px] uppercase tracking-widest"
              style={{ color: "var(--c-subtle)" }}
            >
              Which key paid (last 30 days)
            </p>
          </div>
          {bySource.length === 0 ? (
            <p className="px-5 py-4 text-[12px]" style={{ color: "var(--c-subtle)" }}>
              No usage yet.
            </p>
          ) : (
            <ul>
              {bySource.map((s) => (
                <li
                  key={s.source}
                  className="px-5 py-3 flex items-center justify-between"
                  style={{ borderBottom: "1px solid var(--c-divider)" }}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full"
                      style={{
                        background:
                          s.source === "user"
                            ? "var(--c-stat3-icon)"
                            : "var(--c-stat1-icon)",
                        color:
                          s.source === "user" ? "var(--c-stat3)" : "var(--c-stat1)",
                      }}
                    >
                      {sourceLabel(s.source, shared.mode)}
                    </span>
                    <span className="text-[12px]" style={{ color: "var(--c-muted)" }}>
                      {s.call_count} call{s.call_count === 1 ? "" : "s"}
                    </span>
                  </div>
                  <span className="text-[13px] font-mono" style={{ color: "var(--c-fg)" }}>
                    {usd(s.total_usd)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* By model */}
        <section className="glass-card rounded-2xl overflow-hidden">
          <div className="px-5 py-3" style={{ borderBottom: "1px solid var(--c-divider)" }}>
            <p
              className="text-[10px] uppercase tracking-widest"
              style={{ color: "var(--c-subtle)" }}
            >
              Spend by model (last 30 days)
            </p>
          </div>
          {byModel.length === 0 ? (
            <p className="px-5 py-4 text-[12px]" style={{ color: "var(--c-subtle)" }}>
              No usage yet.
            </p>
          ) : (
            <ul>
              {byModel.map((m) => (
                <li
                  key={m.model}
                  className="px-5 py-3 flex items-center justify-between"
                  style={{ borderBottom: "1px solid var(--c-divider)" }}
                >
                  <div className="min-w-0 flex-1">
                    <p
                      className="text-[12px] font-mono truncate"
                      style={{ color: "var(--c-fg)" }}
                    >
                      {m.model}
                    </p>
                    <p
                      className="text-[10px] mt-0.5"
                      style={{ color: "var(--c-subtle)" }}
                    >
                      {m.call_count} call{m.call_count === 1 ? "" : "s"}
                    </p>
                  </div>
                  <span className="text-[13px] font-mono" style={{ color: "var(--c-fg)" }}>
                    {usd(m.total_usd)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Token totals */}
        {month && (month.input_tokens > 0 || month.output_tokens > 0) && (
          <section className="glass-card rounded-2xl px-5 py-4 flex items-center justify-between">
            <p
              className="text-[10px] uppercase tracking-widest"
              style={{ color: "var(--c-subtle)" }}
            >
              Tokens (last 30 days)
            </p>
            <div className="flex items-center gap-5">
              <p className="text-[12px]" style={{ color: "var(--c-muted)" }}>
                <span className="font-mono" style={{ color: "var(--c-fg)" }}>
                  {shortNum(month.input_tokens)}
                </span>{" "}
                in
              </p>
              <p className="text-[12px]" style={{ color: "var(--c-muted)" }}>
                <span className="font-mono" style={{ color: "var(--c-fg)" }}>
                  {shortNum(month.output_tokens)}
                </span>{" "}
                out
              </p>
            </div>
          </section>
        )}

        {/* Shared budget status — only meaningful when shared fallback is on */}
        {shared.enabled && (
          <section
            className="rounded-2xl px-5 py-4 space-y-2"
            style={{
              border: `1px solid ${shared.exhausted ? "rgba(239,68,68,0.3)" : "var(--c-divider)"}`,
              background: shared.exhausted ? "rgba(239,68,68,0.05)" : "transparent",
            }}
          >
            <p
              className="text-[10px] uppercase tracking-widest"
              style={{ color: "var(--c-subtle)" }}
            >
              {shared.mode === "org"
                ? "Shared key daily ceiling (across all users)"
                : "Shared trial budget (across all users)"}
            </p>
            <div className="flex items-center justify-between">
              <p className="text-[13px]" style={{ color: "var(--c-fg)" }}>
                {usd(shared.spentUsd)} of {usd(shared.capUsd)} used
              </p>
              <p
                className="text-[11px]"
                style={{ color: shared.exhausted ? "#ef4444" : "var(--c-subtle)" }}
              >
                {shared.exhausted
                  ? shared.mode === "org"
                    ? "Daily ceiling hit — calls paused"
                    : "Exhausted — add your own key"
                  : `${usd(shared.capUsd - shared.spentUsd)} left`}
              </p>
            </div>
            <div
              className="w-full h-2 rounded-full overflow-hidden"
              style={{ background: "var(--c-card-border)" }}
            >
              <div
                style={{
                  width: `${Math.min(100, (shared.spentUsd / shared.capUsd) * 100)}%`,
                  height: "100%",
                  background: shared.exhausted ? "#ef4444" : "var(--c-primary)",
                }}
              />
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, total, calls }: { label: string; total: number; calls: number }) {
  return (
    <div className="glass-card rounded-2xl p-5">
      <p
        className="text-[10px] uppercase tracking-widest mb-2"
        style={{ color: "var(--c-subtle)" }}
      >
        {label}
      </p>
      <p className="text-[24px] font-bold font-mono" style={{ color: "var(--c-fg)" }}>
        {usd(total)}
      </p>
      <p className="text-[11px] mt-1" style={{ color: "var(--c-muted)" }}>
        {calls} call{calls === 1 ? "" : "s"}
      </p>
    </div>
  );
}
