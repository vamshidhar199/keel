import Link from "next/link";
import { auth, signOut } from "@/auth";
import { getMetaDb } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { PageHeader } from "../../components/page-header";
import { ThemeToggle } from "../../components/theme-toggle";
import { ApiKeysPanel } from "./api-keys-panel";
import { BriefPanel } from "./brief-panel";
import { RecipesPanel } from "./recipes-panel";

function maskKey(key: string | null): string | null {
  if (!key) return null;
  return key.slice(0, 8) + "••••••••••••••••";
}

export default async function SettingsPage() {
  const session = await auth();
  const user = session!.user!;

  const db = getMetaDb();
  const [keysRes, tzRes] = await Promise.all([
    db.query(
      "SELECT anthropic_api_key, openai_api_key FROM user_api_keys WHERE user_id = $1",
      [user.id]
    ),
    db.query<{ timezone: string }>(
      "SELECT timezone FROM users WHERE id = $1",
      [user.id]
    ),
  ]);
  const savedKeys = keysRes.rows[0] ?? null;
  const timezone = tzRes.rows[0]?.timezone ?? "UTC";

  return (
    <div className="min-h-screen">
      <PageHeader title="Settings" />

      <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        {/* Account */}
        <section>
          <p className="text-[10px] uppercase tracking-widest mb-3" style={{ color: "var(--c-subtle)" }}>Account</p>
          <div className="glass-card rounded-xl overflow-hidden">
            {[
              { label: "Name", value: user.name ?? "—" },
              { label: "Email", value: user.email ?? "—" },
              { label: "User ID", value: user.id ?? "—", mono: true },
            ].map(({ label, value, mono }) => (
              <div
                key={label}
                className="px-5 py-4"
                style={{ borderBottom: "1px solid var(--c-divider)" }}
              >
                <p className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: "var(--c-subtle)" }}>{label}</p>
                <p className={`text-sm ${mono ? "font-mono text-[11px]" : ""}`} style={{ color: "var(--c-fg)" }}>{value}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Daily brief */}
        <section>
          <p className="text-[10px] uppercase tracking-widest mb-3" style={{ color: "var(--c-subtle)" }}>Daily brief</p>
          <BriefPanel initialTimezone={timezone} />
        </section>

        {/* Custom cards */}
        <section>
          <p className="text-[10px] uppercase tracking-widest mb-3" style={{ color: "var(--c-subtle)" }}>Custom cards</p>
          <RecipesPanel />
        </section>

        {/* Workflows */}
        <section>
          <p className="text-[10px] uppercase tracking-widest mb-3" style={{ color: "var(--c-subtle)" }}>Workflows</p>
          <Link
            href="/workflows"
            className="glass-card rounded-xl flex items-center justify-between px-5 py-4 transition-opacity hover:opacity-80"
          >
            <div>
              <p className="text-sm font-medium" style={{ color: "var(--c-fg)" }}>Scheduled AI workflows</p>
              <p className="text-xs mt-0.5" style={{ color: "var(--c-subtle)" }}>Tiny AI agents that run on a schedule and deliver content to /workflows</p>
            </div>
            <span className="material-symbols-outlined text-xl leading-none" style={{ color: "var(--c-muted)" }}>chevron_right</span>
          </Link>
        </section>

        {/* Skills */}
        <section>
          <p className="text-[10px] uppercase tracking-widest mb-3" style={{ color: "var(--c-subtle)" }}>Skills</p>
          <Link
            href="/skills"
            className="glass-card rounded-xl flex items-center justify-between px-5 py-4 transition-opacity hover:opacity-80"
          >
            <div>
              <p className="text-sm font-medium" style={{ color: "var(--c-fg)" }}>Custom chat behaviors</p>
              <p className="text-xs mt-0.5" style={{ color: "var(--c-subtle)" }}>Saved instructions you can invoke from the Ask page</p>
            </div>
            <span className="material-symbols-outlined text-xl leading-none" style={{ color: "var(--c-muted)" }}>chevron_right</span>
          </Link>
        </section>

        {/* Appearance */}
        <section>
          <p className="text-[10px] uppercase tracking-widest mb-3" style={{ color: "var(--c-subtle)" }}>Appearance</p>
          <div className="glass-card rounded-xl px-5 py-4">
            <ThemeToggle />
          </div>
        </section>

        {/* Developer */}
        <section>
          <p className="text-[10px] uppercase tracking-widest mb-3" style={{ color: "var(--c-subtle)" }}>Developer</p>
          <ApiKeysPanel
            initialAnthropicKey={maskKey(decrypt(savedKeys?.anthropic_api_key ?? null))}
            initialOpenaiKey={maskKey(decrypt(savedKeys?.openai_api_key ?? null))}
          />
        </section>

        {/* Your knowledge */}
        <section>
          <p className="text-[10px] uppercase tracking-widest mb-3" style={{ color: "var(--c-subtle)" }}>Your knowledge</p>
          <div className="glass-card rounded-xl overflow-hidden">
            <Link
              href="/pages"
              className="flex items-center justify-between px-5 py-4 transition-opacity hover:opacity-80"
              style={{ borderBottom: "1px solid var(--c-divider)" }}
            >
              <div>
                <p className="text-sm font-medium" style={{ color: "var(--c-fg)" }}>Pages</p>
                <p className="text-xs mt-0.5" style={{ color: "var(--c-subtle)" }}>Browse what I&apos;ve extracted from your data</p>
              </div>
              <span className="material-symbols-outlined text-xl leading-none" style={{ color: "var(--c-muted)" }}>chevron_right</span>
            </Link>
            <Link
              href="/graph"
              className="flex items-center justify-between px-5 py-4 transition-opacity hover:opacity-80"
              style={{ borderBottom: "1px solid var(--c-divider)" }}
            >
              <div>
                <p className="text-sm font-medium" style={{ color: "var(--c-fg)" }}>Graph</p>
                <p className="text-xs mt-0.5" style={{ color: "var(--c-subtle)" }}>See how people, projects, and topics connect</p>
              </div>
              <span className="material-symbols-outlined text-xl leading-none" style={{ color: "var(--c-muted)" }}>chevron_right</span>
            </Link>
            <Link
              href="/sources"
              className="flex items-center justify-between px-5 py-4 transition-opacity hover:opacity-80"
            >
              <div>
                <p className="text-sm font-medium" style={{ color: "var(--c-fg)" }}>Sources</p>
                <p className="text-xs mt-0.5" style={{ color: "var(--c-subtle)" }}>Gmail and Slack sync, extraction status</p>
              </div>
              <span className="material-symbols-outlined text-xl leading-none" style={{ color: "var(--c-muted)" }}>chevron_right</span>
            </Link>
          </div>
        </section>

        {/* Sign out */}
        <section>
          <p className="text-[10px] uppercase tracking-widest mb-3" style={{ color: "var(--c-subtle)" }}>Session</p>
          <div className="glass-card rounded-xl p-5">
            <p className="text-sm mb-5" style={{ color: "var(--c-muted)" }}>
              Sign out of your account on this device.
            </p>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/" });
              }}
            >
              <button
                type="submit"
                className="px-5 py-2.5 text-sm font-semibold rounded-xl transition-all hover:brightness-110"
                style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", color: "#ef4444" }}
              >
                Sign out
              </button>
            </form>
          </div>
        </section>
      </div>
    </div>
  );
}
