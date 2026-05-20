import { withUser } from "./db";
import { embedText } from "./embeddings";
import { parseFrontmatter } from "./compose";

function chunkText(text: string, maxChars = 3000): string[] {
  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let current = "";
  for (const para of paragraphs) {
    if (current && current.length + 2 + para.length > maxChars) {
      chunks.push(current.trim());
      current = para;
    } else {
      current = current ? current + "\n\n" + para : para;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  if (chunks.length === 0) chunks.push(text);
  return chunks;
}

function extractWikilinks(content: string): string[] {
  const matches = [...content.matchAll(/\[\[([^\]]+)\]\]/g)];
  return [...new Set(matches.map((m) => m[1]))];
}

export interface PutPageOpts {
  // Explicit kind tag wins over frontmatter.kind; null clears, undefined preserves.
  kind?: string | null;
  // When provided, the resulting page_id is linked back to this raw_event via
  // page_sources — powers the "engaged in source thread?" query.
  rawEventId?: string;
}

// Write a page to the shared mettrie_meta DB with RLS isolation.
export async function putPage(
  userId: string,
  slug: string,
  content: string,
  opts: PutPageOpts = {}
): Promise<{ pageId: string }> {
  const { title, type, frontmatter, body } = parseFrontmatter(content);
  const chunks = chunkText(body);

  // Resolve kind: explicit opts.kind wins; else frontmatter.kind; else null.
  const fmKind = typeof frontmatter.kind === "string" ? frontmatter.kind : null;
  const kind = opts.kind !== undefined ? opts.kind : fmKind;

  // Embed all chunks in parallel outside the transaction to keep the txn short.
  const embeddings = await Promise.all(chunks.map((c) => embedText(userId, c)));

  return await withUser(userId, async (c) => {
    const pageRes = await c.query<{ id: string }>(
      `INSERT INTO pages (user_id, slug, title, type, kind, compiled_truth, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (user_id, slug) DO UPDATE
         SET title = EXCLUDED.title,
             type = EXCLUDED.type,
             kind = COALESCE(EXCLUDED.kind, pages.kind),
             compiled_truth = EXCLUDED.compiled_truth,
             updated_at = now()
       RETURNING id`,
      [userId, slug, title, type || null, kind, content]
    );
    const pageId = pageRes.rows[0].id;

    await c.query(`DELETE FROM content_chunks WHERE page_id = $1`, [pageId]);
    for (let i = 0; i < chunks.length; i++) {
      await c.query(
        `INSERT INTO content_chunks (user_id, page_id, chunk_index, chunk_text, embedding)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, pageId, i, chunks[i], `[${embeddings[i].join(",")}]`]
      );
    }

    // Rewrite wikilinks for this page.
    await c.query(`DELETE FROM links WHERE from_page_id = $1`, [pageId]);
    const wikilinks = extractWikilinks(content);
    for (const targetSlug of wikilinks) {
      await c.query(
        `INSERT INTO links (user_id, from_page_id, to_page_slug) VALUES ($1, $2, $3)`,
        [userId, pageId, targetSlug]
      );
    }

    if (opts.rawEventId) {
      await c.query(
        `INSERT INTO page_sources (page_id, user_id, raw_event_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (page_id, raw_event_id) DO NOTHING`,
        [pageId, userId, opts.rawEventId]
      );
    }

    return { pageId };
  });
}

export interface BrainSearchHit {
  chunk_id: string;
  page_id: string;
  slug: string;
  title: string;
  chunk_text: string;
  score: number;
}

// Vector similarity search against the user's content_chunks via RLS.
export async function brainSearch(
  userId: string,
  query: string,
  limit = 8
): Promise<BrainSearchHit[]> {
  const queryVector = await embedText(userId, query);
  const vectorLiteral = `[${queryVector.join(",")}]`;

  return withUser(userId, async (c) => {
    const { rows } = await c.query<BrainSearchHit>(
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
  });
}

// Find pages whose title appears as a substring of the question (entity detection).
export async function findEntityPages(
  userId: string,
  question: string
): Promise<{ slug: string; title: string; type: string }[]> {
  return withUser(userId, async (c) => {
    const { rows } = await c.query<{ slug: string; title: string; type: string }>(
      `SELECT slug, title, type
       FROM pages
       WHERE length(title) >= 4
         AND $1 ILIKE '%' || title || '%'
       ORDER BY length(title) DESC
       LIMIT 3`,
      [question]
    );
    return rows;
  });
}

// Fetch all content chunks for the given page slugs as BrainSearchHit rows.
export async function getEntityChunks(
  userId: string,
  slugs: string[]
): Promise<BrainSearchHit[]> {
  if (slugs.length === 0) return [];
  return withUser(userId, async (c) => {
    const { rows } = await c.query<BrainSearchHit>(
      `SELECT cc.id   AS chunk_id,
              cc.page_id,
              p.slug,
              p.title,
              cc.chunk_text,
              1.0::float AS score
       FROM content_chunks cc
       JOIN pages p ON p.id = cc.page_id
       WHERE p.slug = ANY($1)
       ORDER BY p.slug, cc.chunk_index`,
      [slugs]
    );
    return rows;
  });
}

export interface PageSummary {
  slug: string;
  title: string;
  type: string;
  kind: string | null;
  updated_at: string;
  link_count: number;
}

// List all pages for the user, optionally filtered by type and/or kind, with
// an optional exclude-kind for surfaces that don't want job listings polluting
// their view (e.g. the /ask opener and suggestion contexts).
export async function listPages(
  userId: string,
  opts: { type?: string; kind?: string; excludeKind?: string; limit?: number } = {}
): Promise<PageSummary[]> {
  return withUser(userId, async (c) => {
    const params: unknown[] = [];
    const wheres: string[] = [];
    if (opts.type) {
      params.push(opts.type);
      wheres.push(`p.type = $${params.length}`);
    }
    if (opts.kind) {
      params.push(opts.kind);
      wheres.push(`p.kind = $${params.length}`);
    }
    if (opts.excludeKind) {
      params.push(opts.excludeKind);
      wheres.push(`(p.kind IS NULL OR p.kind <> $${params.length})`);
    }
    const where = wheres.length ? `WHERE ${wheres.join(" AND ")}` : "";
    params.push(opts.limit ?? 500);
    const limitParam = `$${params.length}`;

    const { rows } = await c.query<PageSummary>(
      `SELECT p.slug, p.title, p.type, p.kind, p.updated_at,
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
  });
}

export interface PageDetail {
  slug: string;
  title: string;
  type: string;
  frontmatter: Record<string, unknown>;
  body: string;
  updated_at: string;
}

// Fetch a single page by slug.
export async function getPage(
  userId: string,
  slug: string
): Promise<PageDetail | null> {
  return withUser(userId, async (c) => {
    const { rows } = await c.query<{
      slug: string;
      title: string;
      type: string;
      compiled_truth: string;
      updated_at: string;
    }>(
      `SELECT slug, title, type, compiled_truth, updated_at
       FROM pages WHERE slug = $1 LIMIT 1`,
      [slug]
    );
    const row = rows[0];
    if (!row) return null;

    const { frontmatter, body } = parseFrontmatter(row.compiled_truth ?? "");
    return {
      slug: row.slug,
      title: row.title,
      type: row.type,
      frontmatter,
      body,
      updated_at: row.updated_at,
    };
  });
}

export interface GraphData {
  nodes: { slug: string; title: string; type: string; link_count: number }[];
  edges: { source: string; target: string }[];
}

// Fetch the full knowledge graph for visualization.
export async function getGraph(userId: string): Promise<GraphData> {
  return withUser(userId, async (c) => {
    const [nodesRes, edgesRes] = await Promise.all([
      c.query<{ slug: string; title: string; type: string; link_count: number }>(
        `SELECT p.slug, p.title, p.type,
                COALESCE(l.cnt, 0)::int AS link_count
         FROM pages p
         LEFT JOIN (
           SELECT from_page_id, COUNT(*) AS cnt FROM links GROUP BY from_page_id
         ) l ON l.from_page_id = p.id`
      ),
      c.query<{ source: string; target: string }>(
        `SELECT pf.slug AS source, l.to_page_slug AS target
         FROM links l
         JOIN pages pf ON pf.id = l.from_page_id`
      ),
    ]);
    return { nodes: nodesRes.rows, edges: edgesRes.rows };
  });
}

// Fetch incoming wikilinks (which other pages link TO this slug).
export async function getBacklinks(
  userId: string,
  slug: string
): Promise<{ slug: string; title: string; type: string }[]> {
  return withUser(userId, async (c) => {
    const { rows } = await c.query<{ slug: string; title: string; type: string }>(
      `SELECT DISTINCT pf.slug, pf.title, pf.type
       FROM links l
       JOIN pages pf ON pf.id = l.from_page_id
       WHERE l.to_page_slug = $1
       ORDER BY pf.title`,
      [slug]
    );
    return rows;
  });
}
