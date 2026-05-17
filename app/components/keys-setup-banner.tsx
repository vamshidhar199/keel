import Link from "next/link";
import { userHasOwnKeys, getSharedStatus } from "@/lib/llm-keys";

// Server-rendered banner that nags signed-in users when they haven't
// configured their own API keys. Three states:
//
// 1. Both keys missing AND shared fallback OFF/exhausted: red "you must
//    configure keys" message. Nothing in the app that needs an LLM will
//    work without this.
// 2. Both keys missing AND shared fallback ON with budget: amber "free
//    trial" notice with remaining-budget hint.
// 3. Only one provider missing: amber "you're missing one — half of the
//    app won't work".
// 4. Both keys configured: render nothing.
export async function KeysSetupBanner({ userId }: { userId: string }) {
  const [has, shared] = await Promise.all([
    userHasOwnKeys(userId),
    getSharedStatus(),
  ]);

  if (has.anthropic && has.openai) return null;

  const missingProviders: string[] = [];
  if (!has.anthropic) missingProviders.push("Anthropic");
  if (!has.openai) missingProviders.push("OpenAI");

  const bothMissing = !has.anthropic && !has.openai;
  const trialCovers = shared.enabled && !shared.exhausted;

  // Pick tone + copy.
  let tone: "red" | "amber";
  let title: string;
  let body: string;

  if (bothMissing && trialCovers) {
    tone = "amber";
    title = "You're on the free trial";
    const remaining = Math.max(0, shared.capUsd - shared.spentUsd);
    body =
      remaining < shared.capUsd * 0.2
        ? `Today's shared budget is almost out (about $${remaining.toFixed(2)} left). Add your own keys to keep working.`
        : `Mettrie is running on a shared API budget. Add your own Anthropic + OpenAI keys when you're ready to use it for real.`;
  } else if (bothMissing && !trialCovers) {
    tone = "red";
    title = shared.enabled
      ? "The free trial is fully booked"
      : "Connect your API keys to use Mettrie";
    body = shared.enabled
      ? "Today's shared budget is exhausted. Paste your own Anthropic + OpenAI keys in Settings to keep going."
      : "Paste your Anthropic + OpenAI keys in Settings → Developer. Nothing in the app will work without them.";
  } else {
    tone = "amber";
    title = `Missing your ${missingProviders.join(" + ")} key`;
    body = trialCovers
      ? `You've got one key configured — the other is on the shared trial. Add your own key for full control.`
      : `Half the app won't work until you configure your ${missingProviders.join(" and ")} key in Settings.`;
  }

  const styles =
    tone === "red"
      ? {
          bg: "rgba(239, 68, 68, 0.08)",
          border: "rgba(239, 68, 68, 0.3)",
          fg: "#ef4444",
        }
      : {
          bg: "rgba(245, 158, 11, 0.08)",
          border: "rgba(245, 158, 11, 0.3)",
          fg: "#f59e0b",
        };

  return (
    <div
      className="ml-16 px-6 py-3"
      style={{ background: styles.bg, borderBottom: `1px solid ${styles.border}` }}
    >
      <div className="max-w-6xl mx-auto flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <span
            className="material-symbols-outlined text-[18px] leading-none shrink-0"
            style={{ color: styles.fg }}
          >
            {tone === "red" ? "warning" : "info"}
          </span>
          <div className="min-w-0">
            <p className="text-[12px] font-semibold" style={{ color: styles.fg }}>
              {title}
            </p>
            <p className="text-[11px]" style={{ color: "var(--c-muted)" }}>
              {body}
            </p>
          </div>
        </div>
        <Link
          href="/settings"
          className="text-[11px] font-semibold px-3 py-1.5 rounded-md shrink-0"
          style={{
            background: styles.fg,
            color: "white",
          }}
        >
          Open Settings →
        </Link>
      </div>
    </div>
  );
}
