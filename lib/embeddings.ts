import OpenAI from "openai";
import { getMetaDb } from "./db";
import { resolveOpenAIKey, type KeySource } from "./llm-keys";

interface ResolvedClient {
  client: OpenAI;
  source: KeySource;
}

async function getClient(userId: string): Promise<ResolvedClient> {
  const { key, source } = await resolveOpenAIKey(userId);
  return { client: new OpenAI({ apiKey: key }), source };
}

// Must match the model + dimensions gbrain uses for content_chunks.embedding (vector(1536)).
// gbrain stores `text-embedding-3-large` truncated to 1536 dims.
export const EMBEDDING_MODEL = "text-embedding-3-large";
export const EMBEDDING_DIMS = 1536;

const DAILY_SOFT_CAP_USD = 5.0;

async function checkDailyCap(userId: string): Promise<void> {
  const db = getMetaDb();
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(cost_usd), 0) AS total
     FROM llm_costs
     WHERE user_id = $1 AND called_at >= NOW() - INTERVAL '24 hours'`,
    [userId]
  );
  if (parseFloat(rows[0].total) >= DAILY_SOFT_CAP_USD) {
    throw new Error(`Daily LLM spend cap reached for user ${userId}`);
  }
}

async function logCost(
  userId: string,
  inputTokens: number,
  source: KeySource
): Promise<void> {
  // text-embedding-3-large: $0.13 per 1M tokens
  const cost = inputTokens * 0.00000013;
  const db = getMetaDb();
  await db.query(
    `INSERT INTO llm_costs (user_id, model, input_tokens, output_tokens, cost_usd, key_source, called_at)
     VALUES ($1, $2, $3, 0, $4, $5, NOW())`,
    [userId, EMBEDDING_MODEL, inputTokens, cost, source]
  );
}

// Generate an embedding vector for the given text. Cost is logged + capped.
export async function embedText(userId: string, text: string): Promise<number[]> {
  await checkDailyCap(userId);

  const { client, source } = await getClient(userId);
  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
    dimensions: EMBEDDING_DIMS,
  });

  await logCost(userId, response.usage.total_tokens, source);
  return response.data[0].embedding;
}
