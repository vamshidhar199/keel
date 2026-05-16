import Anthropic from "@anthropic-ai/sdk";
import { getMetaDb } from "./db";
import { decrypt } from "./crypto";

async function getClient(userId: string): Promise<Anthropic> {
  const db = getMetaDb();
  const { rows } = await db.query(
    "SELECT anthropic_api_key FROM user_api_keys WHERE user_id = $1",
    [userId]
  );
  const key = process.env.ANTHROPIC_API_KEY || decrypt(rows[0]?.anthropic_api_key);
  if (!key) throw new Error("No Anthropic API key configured for this user");
  return new Anthropic({ apiKey: key });
}

// Model constants — change here to upgrade globally.
export const HAIKU = "claude-haiku-4-5-20251001";
export const SONNET = "claude-sonnet-4-6";

// Per-user daily soft cap in USD. Rejects calls if exceeded.
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
  model: string,
  inputTokens: number,
  outputTokens: number
): Promise<void> {
  // Approximate cost per token (USD). Update if Anthropic pricing changes.
  const pricing: Record<string, { input: number; output: number }> = {
    [HAIKU]:  { input: 0.00000025, output: 0.00000125 },
    [SONNET]: { input: 0.000003,   output: 0.000015   },
  };
  const p = pricing[model] ?? { input: 0, output: 0 };
  const cost = inputTokens * p.input + outputTokens * p.output;

  const db = getMetaDb();
  await db.query(
    `INSERT INTO llm_costs (user_id, model, input_tokens, output_tokens, cost_usd, called_at)
     VALUES ($1, $2, $3, $4, $5, NOW())`,
    [userId, model, inputTokens, outputTokens, cost]
  );
}

export interface WebCitation {
  title: string;
  url: string;
}

// All LLM calls go through this function — never call the Anthropic client directly.
export async function callClaude(
  userId: string,
  model: typeof HAIKU | typeof SONNET,
  messages: Anthropic.MessageParam[],
  opts: { maxTokens?: number; system?: string } = {}
): Promise<string> {
  await checkDailyCap(userId);

  const anthropic = await getClient(userId);
  const response = await anthropic.messages.create({
    model,
    max_tokens: opts.maxTokens ?? 4096,
    system: opts.system,
    messages,
  });

  const usage = response.usage;
  await logCost(userId, model, usage.input_tokens, usage.output_tokens);

  const block = response.content[0];
  if (block.type !== "text") throw new Error("Unexpected non-text response from Claude");
  return block.text;
}

// Like callClaude but with Anthropic's built-in web search tool enabled.
// Anthropic executes searches server-side; we just parse the response blocks.
export async function callClaudeWithWebSearch(
  userId: string,
  model: typeof HAIKU | typeof SONNET,
  messages: Anthropic.MessageParam[],
  opts: { maxTokens?: number; system?: string } = {}
): Promise<{ text: string; webCitations: WebCitation[] }> {
  await checkDailyCap(userId);

  const anthropic = await getClient(userId);
  const response = await anthropic.messages.create({
    model,
    max_tokens: opts.maxTokens ?? 4096,
    system: opts.system,
    messages,
    tools: [{ type: "web_search_20250305", name: "web_search" }] as any,
  });

  await logCost(userId, model, response.usage.input_tokens, response.usage.output_tokens);

  let text = "";
  const webCitations: WebCitation[] = [];
  const seen = new Set<string>();

  for (const block of response.content as any[]) {
    if (block.type === "text") {
      text += block.text;
    } else if (block.type === "web_search_result_location") {
      const url: string = block.url ?? "";
      if (url && !seen.has(url)) {
        seen.add(url);
        webCitations.push({ title: block.title ?? url, url });
      }
    }
  }

  return { text: text.trim(), webCitations };
}

// Streaming variant of callClaudeWithWebSearch. Invokes onText for each text
// delta as it arrives; returns the assembled final result the same way.
export async function streamClaudeWithWebSearch(
  userId: string,
  model: typeof HAIKU | typeof SONNET,
  messages: Anthropic.MessageParam[],
  opts: { maxTokens?: number; system?: string; onText?: (delta: string) => void } = {}
): Promise<{ text: string; webCitations: WebCitation[] }> {
  await checkDailyCap(userId);

  const anthropic = await getClient(userId);
  const stream = anthropic.messages.stream({
    model,
    max_tokens: opts.maxTokens ?? 4096,
    system: opts.system,
    messages,
    tools: [{ type: "web_search_20250305", name: "web_search" }] as any,
  });

  if (opts.onText) {
    stream.on("text", opts.onText);
  }

  const final = await stream.finalMessage();
  await logCost(userId, model, final.usage.input_tokens, final.usage.output_tokens);

  let text = "";
  const webCitations: WebCitation[] = [];
  const seen = new Set<string>();

  for (const block of final.content as any[]) {
    if (block.type === "text") {
      text += block.text;
    } else if (block.type === "web_search_result_location") {
      const url: string = block.url ?? "";
      if (url && !seen.has(url)) {
        seen.add(url);
        webCitations.push({ title: block.title ?? url, url });
      }
    }
  }

  return { text: text.trim(), webCitations };
}
