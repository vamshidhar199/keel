import { getMetaDb } from "./db";
import { decrypt } from "./crypto";

export type KeySource = "user" | "shared";

export interface ResolvedKey {
  key: string;
  source: KeySource;
}

// Whether to fall back to the env-var shared key when a user hasn't configured
// their own. Default: ON in dev (so local "just works"), OFF in production (so
// a public deploy can't silently route all users onto your bill). Override
// explicitly with SHARED_API_FALLBACK='true' or 'false' if you want the prod
// behavior in dev or vice versa.
function sharedFallbackEnabled(): boolean {
  if (process.env.SHARED_API_FALLBACK === "true") return true;
  if (process.env.SHARED_API_FALLBACK === "false") return false;
  return process.env.NODE_ENV !== "production";
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
  spentUsd: number;
  capUsd: number;
  exhausted: boolean;
}

export async function getSharedStatus(): Promise<SharedStatus> {
  const enabled = sharedFallbackEnabled();
  const capUsd = sharedDailyCapUsd();
  if (!enabled) return { enabled: false, spentUsd: 0, capUsd, exhausted: false };
  const spentUsd = await getSharedDailyTotal();
  return { enabled, spentUsd, capUsd, exhausted: spentUsd >= capUsd };
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
