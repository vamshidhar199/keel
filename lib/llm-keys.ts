import { getMetaDb } from "./db";
import { decrypt } from "./crypto";

export type KeySource = "user" | "shared";

export interface ResolvedKey {
  key: string;
  source: KeySource;
}

// How the deployment treats the shared (env-var) API key.
//
//   'off'    — no shared fallback. Users MUST configure their own keys.
//              The banner pushes them to Settings. Use for public deploys
//              where every user is expected to BYO.
//   'trial'  — shared fallback active, treated as a TRIAL. Banner nags the
//              user with budget hints and a "Add your own key" CTA. Use
//              during a controlled free-trial period (e.g. Product Hunt).
//   'org'    — shared fallback active, treated as the INTENDED MODE. Banner
//              stays hidden when both keys are empty. Use for a solo deploy
//              (you're the only user) or a company-wide deploy with one
//              shared corporate API key. /usage relabels accordingly.
//
// Default: 'trial' in dev (local "just works" with trial framing), 'off' in
// production (safe by default for public deploys).
//
// Legacy SHARED_API_FALLBACK=true|false is honored as 'trial'|'off' if the
// new SHARED_KEY_MODE is unset.
export type SharedKeyMode = "off" | "trial" | "org";

export function getSharedKeyMode(): SharedKeyMode {
  const raw = (process.env.SHARED_KEY_MODE ?? "").toLowerCase().trim();
  if (raw === "off" || raw === "trial" || raw === "org") return raw;
  // Legacy alias.
  if (process.env.SHARED_API_FALLBACK === "true") return "trial";
  if (process.env.SHARED_API_FALLBACK === "false") return "off";
  return process.env.NODE_ENV === "production" ? "off" : "trial";
}

function sharedFallbackEnabled(): boolean {
  return getSharedKeyMode() !== "off";
}

// Global daily-spend ceiling for the SHARED fallback path only. Per-user caps
// in callClaude / embedText still apply on top. Default $10/day across all
// users using the shared key — small enough to bound risk during a free-trial
// period, big enough not to break a small beta.
function sharedDailyCapUsd(): number {
  const raw = process.env.SHARED_DAILY_USD_CAP;
  if (!raw) return 10;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 10;
  return n;
}

// Cheap-enough cache to avoid hitting the DB on every single LLM call. The
// SUM(cost_usd) query is fast but we make a LOT of calls. 10s of staleness
// at the budget boundary is acceptable for a circuit breaker.
let cachedSharedSpend: { total: number; at: number } | null = null;
const SHARED_SPEND_CACHE_MS = 10_000;

async function getSharedDailyTotal(): Promise<number> {
  const now = Date.now();
  if (cachedSharedSpend && now - cachedSharedSpend.at < SHARED_SPEND_CACHE_MS) {
    return cachedSharedSpend.total;
  }
  const db = getMetaDb();
  const { rows } = await db.query<{ total: string }>(
    `SELECT COALESCE(SUM(cost_usd), 0)::text AS total
       FROM llm_costs
      WHERE key_source = 'shared'
        AND called_at >= NOW() - INTERVAL '24 hours'`
  );
  const total = Number(rows[0]?.total ?? 0);
  cachedSharedSpend = { total, at: now };
  return total;
}

// Forces the next read to hit the DB. Call after a known-significant write.
export function invalidateSharedSpendCache(): void {
  cachedSharedSpend = null;
}

// Friendly error pointing the user at where to fix this.
class MissingKeyError extends Error {
  constructor(provider: string) {
    super(
      `No ${provider} API key configured. Open Settings → Developer to paste your key.`
    );
    this.name = "MissingKeyError";
  }
}

// Thrown when shared fallback is enabled but the global daily cap is exhausted.
// Suggests configuring a personal key.
class SharedFallbackExhaustedError extends Error {
  constructor() {
    super(
      "Free trial fully booked for the next 24 hours. Add your own Anthropic + OpenAI keys in Settings → Developer to keep going."
    );
    this.name = "SharedFallbackExhaustedError";
  }
}

// Public helper for UIs that want to display state without raising.
export interface SharedStatus {
  enabled: boolean;
  mode: SharedKeyMode;
  spentUsd: number;
  capUsd: number;
  exhausted: boolean;
}

export async function getSharedStatus(): Promise<SharedStatus> {
  const mode = getSharedKeyMode();
  const enabled = mode !== "off";
  const capUsd = sharedDailyCapUsd();
  if (!enabled) return { enabled: false, mode, spentUsd: 0, capUsd, exhausted: false };
  const spentUsd = await getSharedDailyTotal();
  return { enabled, mode, spentUsd, capUsd, exhausted: spentUsd >= capUsd };
}

async function getSharedKey(envVar: string | undefined): Promise<string | null> {
  if (!sharedFallbackEnabled()) return null;
  if (!envVar) return null;
  const total = await getSharedDailyTotal();
  if (total >= sharedDailyCapUsd()) {
    throw new SharedFallbackExhaustedError();
  }
  return envVar;
}

export async function resolveAnthropicKey(userId: string): Promise<ResolvedKey> {
  const db = getMetaDb();
  const { rows } = await db.query<{ anthropic_api_key: string | null }>(
    "SELECT anthropic_api_key FROM user_api_keys WHERE user_id = $1",
    [userId]
  );
  const userKey = decrypt(rows[0]?.anthropic_api_key ?? null);
  if (userKey) return { key: userKey, source: "user" };

  const sharedKey = await getSharedKey(process.env.ANTHROPIC_API_KEY);
  if (sharedKey) return { key: sharedKey, source: "shared" };
  throw new MissingKeyError("Anthropic");
}

export async function resolveOpenAIKey(userId: string): Promise<ResolvedKey> {
  const db = getMetaDb();
  const { rows } = await db.query<{ openai_api_key: string | null }>(
    "SELECT openai_api_key FROM user_api_keys WHERE user_id = $1",
    [userId]
  );
  const userKey = decrypt(rows[0]?.openai_api_key ?? null);
  if (userKey) return { key: userKey, source: "user" };

  const sharedKey = await getSharedKey(process.env.OPENAI_API_KEY);
  if (sharedKey) return { key: sharedKey, source: "shared" };
  throw new MissingKeyError("OpenAI");
}

// Whether the signed-in user has configured both API keys. Used by the
// onboarding banner to decide whether to nag.
export async function userHasOwnKeys(userId: string): Promise<{
  anthropic: boolean;
  openai: boolean;
}> {
  const db = getMetaDb();
  const { rows } = await db.query<{
    anthropic_api_key: string | null;
    openai_api_key: string | null;
  }>(
    "SELECT anthropic_api_key, openai_api_key FROM user_api_keys WHERE user_id = $1",
    [userId]
  );
  const a = decrypt(rows[0]?.anthropic_api_key ?? null);
  const o = decrypt(rows[0]?.openai_api_key ?? null);
  return { anthropic: !!a, openai: !!o };
}
