import { execFile } from "child_process";
import { promisify } from "util";
import { URL } from "url";
import { getMetaDb, getGbrainDb } from "./db";
import { embedText } from "./embeddings";

const execFileAsync = promisify(execFile);

// Builds the DATABASE_URL for a given user's gbrain DB.
function gbrainDbUrl(userId: string): string {
  const base = process.env.DATABASE_URL!;
  const url = new URL(base);
  url.pathname = `/gbrain_user_${userId}`;
  return url.toString();
}

// Invokes the gbrain CLI with the correct DB for the given user.
// gbrain is a subprocess and can't read our DB, so we resolve the user's
// OpenAI key here (env wins, DB fallback — matches anthropic.ts/embeddings.ts)
// and inject it into the subprocess env.
async function gbrain(userId: string, args: string[]): Promise<string> {
  const bunBin = process.env.BUN_BIN ?? "/Users/monishavamshi/.bun/bin";

  const { rows } = await getMetaDb().query(
    "SELECT openai_api_key FROM user_api_keys WHERE user_id = $1",
    [userId]
  );
  const openaiKey = process.env.OPENAI_API_KEY || rows[0]?.openai_api_key;

  const { stdout } = await execFileAsync(
    `${bunBin}/gbrain`,
    args,
    {
      env: {
        ...process.env,
        PATH: `${bunBin}:${process.env.PATH}`,
        GBRAIN_DATABASE_URL: gbrainDbUrl(userId),
        ...(openaiKey ? { OPENAI_API_KEY: openaiKey } : {}),
      },
      timeout: 60_000,
    }
  );
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

  // Enable pgvector and grant BYPASSRLS using a superuser connection.
  // In prod: set SUPER_DATABASE_URL=postgresql://postgres:pass@host:5432/postgres
  // In dev: leave unset — falls back to local socket (peer auth, no password needed).
  const { Pool: PgPool } = await import("pg");
  const superBase = process.env.SUPER_DATABASE_URL ?? "postgresql://localhost:5432/postgres";
  const superUrl = new URL(superBase);
  superUrl.pathname = `/${dbName}`;
  const superPool = new PgPool({ connectionString: superUrl.toString() });
  try {
    await superPool.query("CREATE EXTENSION IF NOT EXISTS vector");
    const dbUser = new URL(process.env.DATABASE_URL!).username;
    await superPool.query(`ALTER ROLE "${dbUser}" BYPASSRLS`);
  } finally {
    await superPool.end();
  }

  // Run gbrain schema migrations.
  await gbrain(userId, ["apply-migrations", "--yes"]);
}

// Write a page to the user's gbrain instance.
// `content` must be a complete markdown string with YAML frontmatter.
export async function putPage(userId: string, slug: string, content: string): Promise<void> {
  await gbrain(userId, ["put", slug, "--content", content]);
}

export interface BrainSearchHit {
  chunk_id: number;
  page_id: number;
  slug: string;
  title: string;
  chunk_text: string;
  score: number;
}

// Vector similarity search against the user's gbrain content_chunks table.
// Bypasses the gbrain CLI (which truncates chunk_text to 100 chars and has subprocess overhead).
// Embeds the query via OpenAI, then ranks chunks by cosine similarity.
export async function brainSearch(
  userId: string,
  query: string,
  limit = 8
): Promise<BrainSearchHit[]> {
  const queryVector = await embedText(userId, query);
  const vectorLiteral = `[${queryVector.join(",")}]`;

  const db = getGbrainDb(userId);
  try {
    const { rows } = await db.query<BrainSearchHit>(
      `SELECT cc.id   AS chunk_id,
              cc.page_id,
              p.slug,
              p.title,
              cc.chunk_text,
              1 - (cc.embedding <=> $1::vector) AS score
       FROM content_chunks cc
       JOIN pages p ON p.id = cc.page_id
       WHERE cc.embedding IS NOT NULL
       ORDER BY cc.embedding <=> $1::vector
       LIMIT $2`,
      [vectorLiteral, limit]
    );
    return rows;
  } finally {
    await db.end();
  }
}

// Find pages whose title appears as a substring of the question (entity detection).
// Used to surface the full compiled entity page alongside vector search results.
export async function findEntityPages(
  userId: string,
  question: string
): Promise<{ slug: string; title: string; type: string }[]> {
  const db = getGbrainDb(userId);
  try {
    const { rows } = await db.query<{ slug: string; title: string; type: string }>(
      `SELECT slug, title, type
       FROM pages
       WHERE length(title) >= 4
         AND $1 ILIKE '%' || title || '%'
       ORDER BY length(title) DESC
       LIMIT 3`,
      [question]
    );
    return rows;
  } finally {
    await db.end();
  }
}

// Fetch all content chunks for the given page slugs as BrainSearchHit rows.
// Score is set to 1.0 so entity chunks sort before vector hits when merged.
export async function getEntityChunks(
  userId: string,
  slugs: string[]
): Promise<BrainSearchHit[]> {
  if (slugs.length === 0) return [];
  const db = getGbrainDb(userId);
  try {
    const { rows } = await db.query<BrainSearchHit>(
      `SELECT cc.id   AS chunk_id,
              cc.page_id,
              p.slug,
              p.title,
              cc.chunk_text,
              1.0::float AS score
       FROM content_chunks cc
       JOIN pages p ON p.id = cc.page_id
       WHERE p.slug = ANY($1)
       ORDER BY p.slug, cc.id`,
      [slugs]
    );
    return rows;
  } finally {
    await db.end();
  }
}

export interface PageSummary {
  slug: string;
  title: string;
  type: string;
  updated_at: string;
  link_count: number;
}

// List all pages in the user's gbrain DB, optionally filtered by type.
// link_count is the number of outgoing wikilinks from this page (for graph node sizing).
export async function listPages(
  userId: string,
  opts: { type?: string; limit?: number } = {}
): Promise<PageSummary[]> {
  const db = getGbrainDb(userId);
  try {
    const params: any[] = [];
    let where = "";
    if (opts.type) {
      params.push(opts.type);
      where = `WHERE p.type = $${params.length}`;
    }
    params.push(opts.limit ?? 500);
    const limitParam = `$${params.length}`;

    const { rows } = await db.query<PageSummary>(
      `SELECT p.slug, p.title, p.type, p.updated_at,
              COALESCE(l.cnt, 0)::int AS link_count
       FROM pages p
       LEFT JOIN (
         SELECT from_page_id, COUNT(*) AS cnt
         FROM links
         GROUP BY from_page_id
       ) l ON l.from_page_id = p.id
       ${where}
       ORDER BY p.updated_at DESC
       LIMIT ${limitParam}`,
      params
    );
    return rows;
  } finally {
    await db.end();
  }
}

export interface PageDetail {
  slug: string;
  title: string;
  type: string;
  frontmatter: Record<string, unknown>;
  body: string;
  updated_at: string;
}

// Fetch a single page by slug. Splits compiled_truth into frontmatter + body.
export async function getPage(
  userId: string,
  slug: string
): Promise<PageDetail | null> {
  const db = getGbrainDb(userId);
  try {
    const { rows } = await db.query<{
      slug: string;
      title: string;
      type: string;
      frontmatter: Record<string, unknown>;
      compiled_truth: string;
      updated_at: string;
    }>(
      `SELECT slug, title, type, frontmatter, compiled_truth, updated_at
       FROM pages WHERE slug = $1 LIMIT 1`,
      [slug]
    );
    const row = rows[0];
    if (!row) return null;

    // Strip the YAML frontmatter block from compiled_truth to get the body.
    const body = (row.compiled_truth ?? "").replace(/^---\n[\s\S]*?\n---\n?/, "").trim();

    return {
      slug: row.slug,
      title: row.title,
      type: row.type,
      frontmatter: row.frontmatter ?? {},
      body,
      updated_at: row.updated_at,
    };
  } finally {
    await db.end();
  }
}

export interface GraphData {
  nodes: { slug: string; title: string; type: string; link_count: number }[];
  edges: { source: string; target: string }[];
}

// Fetch the full knowledge graph for visualization.
export async function getGraph(userId: string): Promise<GraphData> {
  const db = getGbrainDb(userId);
  try {
    const [nodes, edges] = await Promise.all([
      db.query<{ slug: string; title: string; type: string; link_count: number }>(
        `SELECT p.slug, p.title, p.type,
                COALESCE(l.cnt, 0)::int AS link_count
         FROM pages p
         LEFT JOIN (
           SELECT from_page_id, COUNT(*) AS cnt FROM links GROUP BY from_page_id
         ) l ON l.from_page_id = p.id`
      ),
      db.query<{ source: string; target: string }>(
        `SELECT pf.slug AS source, pt.slug AS target
         FROM links l
         JOIN pages pf ON pf.id = l.from_page_id
         JOIN pages pt ON pt.id = l.to_page_id`
      ),
    ]);
    return { nodes: nodes.rows, edges: edges.rows };
  } finally {
    await db.end();
  }
}

// Fetch incoming wikilinks (which other pages link TO this slug).
export async function getBacklinks(
  userId: string,
  slug: string
): Promise<{ slug: string; title: string; type: string }[]> {
  const db = getGbrainDb(userId);
  try {
    const { rows } = await db.query<{ slug: string; title: string; type: string }>(
      `SELECT DISTINCT pf.slug, pf.title, pf.type
       FROM links l
       JOIN pages pf ON pf.id = l.from_page_id
       JOIN pages pt ON pt.id = l.to_page_id
       WHERE pt.slug = $1
       ORDER BY pf.title`,
      [slug]
    );
    return rows;
  } finally {
    await db.end();
  }
}
