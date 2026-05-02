import { execFile } from "child_process";
import { promisify } from "util";
import { URL } from "url";
import { getMetaDb, getGbrainDb } from "./db";

const execFileAsync = promisify(execFile);

// Builds the DATABASE_URL for a given user's gbrain DB.
function gbrainDbUrl(userId: string): string {
  const base = process.env.DATABASE_URL!;
  const url = new URL(base);
  url.pathname = `/gbrain_user_${userId}`;
  return url.toString();
}

// Invokes the gbrain CLI with the correct DB for the given user.
async function gbrain(userId: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("gbrain", args, {
    env: { ...process.env, DATABASE_URL: gbrainDbUrl(userId) },
    timeout: 60_000,
  });
  return stdout;
}

// Provision a fresh gbrain DB for a new user and run migrations.
export async function provisionGbrainDb(userId: string): Promise<void> {
  const dbName = `gbrain_user_${userId}`;

  // CREATE DATABASE cannot run inside a transaction; use a raw client on the meta DB.
  const metaClient = await getMetaDb().connect();
  try {
    await metaClient.query(`CREATE DATABASE "${dbName}"`);
  } catch (err: any) {
    if (err.code !== "42P04") throw err; // 42P04 = database already exists
  } finally {
    metaClient.release();
  }

  // Enable pgvector in the new DB.
  const gbPool = getGbrainDb(userId);
  try {
    await gbPool.query("CREATE EXTENSION IF NOT EXISTS vector");
  } finally {
    await gbPool.end();
  }

  // Run gbrain schema migrations. Warns if CLI not yet installed (B0-004).
  try {
    await gbrain(userId, ["doctor", "--migrate"]);
  } catch {
    console.warn(`[gbrain] doctor --migrate skipped for "${dbName}" — install gbrain CLI to complete B0-004`);
  }
}

// Write a page to the user's gbrain instance.
export async function putPage(
  userId: string,
  slug: string,
  opts: { type: string; frontmatter: Record<string, unknown>; body: string }
): Promise<void> {
  // TODO (B3-006): invoke `gbrain put_page <slug> --type ... --frontmatter ... --body ...`
  throw new Error("putPage not implemented yet");
}

// Hybrid search across the user's gbrain instance.
export async function brainSearch(
  userId: string,
  query: string,
  limit = 10
): Promise<{ chunk_id: string; slug: string; content: string; score: number }[]> {
  // TODO (B4-001): invoke `gbrain brain_search --query ... --limit ...`
  throw new Error("brainSearch not implemented yet");
}

// List pages in the user's gbrain instance.
export async function listPages(
  userId: string,
  opts: { type?: string; limit?: number; offset?: number } = {}
): Promise<{ slug: string; title: string; type: string; updated_at: string }[]> {
  // TODO (B5-001)
  throw new Error("listPages not implemented yet");
}

// Fetch a single page by slug.
export async function getPage(
  userId: string,
  slug: string
): Promise<{ slug: string; title: string; type: string; frontmatter: unknown; body: string } | null> {
  // TODO (B5-001)
  throw new Error("getPage not implemented yet");
}
