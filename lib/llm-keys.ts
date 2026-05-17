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

// Friendly error pointing the user at where to fix this.
class MissingKeyError extends Error {
  constructor(provider: string) {
    super(
      `No ${provider} API key configured. Open Settings → Developer to paste your key.`
    );
    this.name = "MissingKeyError";
  }
}

export async function resolveAnthropicKey(userId: string): Promise<ResolvedKey> {
  const db = getMetaDb();
  const { rows } = await db.query<{ anthropic_api_key: string | null }>(
    "SELECT anthropic_api_key FROM user_api_keys WHERE user_id = $1",
    [userId]
  );
  const userKey = decrypt(rows[0]?.anthropic_api_key ?? null);
  if (userKey) return { key: userKey, source: "user" };

  if (sharedFallbackEnabled() && process.env.ANTHROPIC_API_KEY) {
    return { key: process.env.ANTHROPIC_API_KEY, source: "shared" };
  }
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

  if (sharedFallbackEnabled() && process.env.OPENAI_API_KEY) {
    return { key: process.env.OPENAI_API_KEY, source: "shared" };
  }
  throw new MissingKeyError("OpenAI");
}
