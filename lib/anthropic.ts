import Anthropic from "@anthropic-ai/sdk";
import { getMetaDb } from "./db";
import { resolveAnthropicKey, type KeySource } from "./llm-keys";

interface ResolvedClient {
  client: Anthropic;
  source: KeySource;
}

// maxRetries=8: the SDK already does retry-after-aware exponential backoff
// on 429s (see node_modules/@anthropic-ai/sdk/.../client.ts shouldRetry +
// retryRequest). Default is 2. Bumping to 8 buys ~5-8 minutes of cumulative
// wait when the org TPM ceiling is saturated, which is more than the 60s
// rolling window typically takes to recover.
async function getClient(userId: string): Promise<ResolvedClient> {
  const { key, source } = await resolveAnthropicKey(userId);
  return { client: new Anthropic({ apiKey: key, maxRetries: 8 }), source };
}

// Model constants — change here to upgrade globally.
export const HAIKU = "claude-haiku-4-5-20251001";
export const SONNET = "claude-sonnet-4-6";

async function logCost(
  userId: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  source: KeySource
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
    `INSERT INTO llm_costs (user_id, model, input_tokens, output_tokens, cost_usd, key_source, called_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [userId, model, inputTokens, outputTokens, cost, source]
  );
}

export interface WebCitation {
  title: string;
  url: string;
}

// Structured system prompt for prompt-caching callers. Blocks are sent in
// order; mark a block with cache_control to cache it for ~5 min. Cached
// blocks must be a PREFIX of the system. Minimum cacheable block is 1024
// tokens for Sonnet/Haiku 4.x — Anthropic rejects smaller blocks. Pass a
// plain string to skip caching entirely.
export type SystemPrompt =
  | string
  | Array<{
      type: "text";
      text: string;
      cache_control?: { type: "ephemeral" };
    }>;

// All LLM calls go through this function — never call the Anthropic client directly.
export async function callClaude(
  userId: string,
  model: typeof HAIKU | typeof SONNET,
  messages: Anthropic.MessageParam[],
  opts: { maxTokens?: number; system?: SystemPrompt } = {}
): Promise<string> {
  const { client, source } = await getClient(userId);
  const response = await client.messages.create({
    model,
    max_tokens: opts.maxTokens ?? 4096,
    system: opts.system as Anthropic.Messages.MessageCreateParams["system"],
    messages,
  });

  const usage = response.usage;
  await logCost(userId, model, usage.input_tokens, usage.output_tokens, source);

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
  const { client, source } = await getClient(userId);
  const response = await client.messages.create({
    model,
    max_tokens: opts.maxTokens ?? 4096,
    system: opts.system,
    messages,
    tools: [{ type: "web_search_20250305", name: "web_search" }] as any,
  });

  await logCost(userId, model, response.usage.input_tokens, response.usage.output_tokens, source);

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
  const { client, source } = await getClient(userId);
  const stream = client.messages.stream({
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
  await logCost(userId, model, final.usage.input_tokens, final.usage.output_tokens, source);

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
