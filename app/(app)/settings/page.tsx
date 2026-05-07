import { auth, signOut } from "@/auth";
import { PageHeader } from "../../components/page-header";
import { ThemeToggle } from "../../components/theme-toggle";

export default async function SettingsPage() {
  const session = await auth();
  const user = session!.user!;

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

        {/* Appearance */}
        <section>
          <p className="text-[10px] uppercase tracking-widest mb-3" style={{ color: "var(--c-subtle)" }}>Appearance</p>
          <div className="glass-card rounded-xl px-5 py-4">
            <ThemeToggle />
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
