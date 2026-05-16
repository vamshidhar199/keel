import { getAdminDb, getMetaDb, withUser } from "./db";
import { decrypt } from "./crypto";
import { parseFrontmatter } from "./compose";

// One-shot backfill to align legacy data with the new engagement signals:
//
// 1. Re-parse `evidence` array out of each page's compiled_truth frontmatter
//    and write rows into `page_sources` (page_id, raw_event_id, user_id).
//    Lets the new "engaged in source thread?" join work on pages that pre-date
//    the link table.
//
// 2. Walk every raw_event, decrypt `from_addr` (app-side; encrypted at rest),
//    and set `is_from_user = true` when the address matches the user's email.
//    Powers "user has actually replied" detection.
//
// 3. Heuristic `pages.kind = 'job_listing'` for project pages whose title
//    looks like a job role. Imperfect but moves the dial without needing a
//    full re-extraction pass.
//
// Idempotent — safe to run repeatedly.

interface BackfillStats {
  page_sources_inserted: number;
  raw_events_marked_from_user: number;
  pages_tagged_job_listing: number;
}

const JOB_TITLE_PATTERN =
  /\b(engineer|developer|manager|director|designer|lead|architect|scientist|analyst|consultant|specialist|founding\s+member|product\s+manager|head\s+of)\b/i;

export async function backfillEngagement(): Promise<BackfillStats> {
  const stats: BackfillStats = {
    page_sources_inserted: 0,
    raw_events_marked_from_user: 0,
    pages_tagged_job_listing: 0,
  };

  // Iterate users via the admin pool — RLS bypassed for an admin task that
  // spans tenants. All tenant writes still go through `withUser`.
  const admin = getAdminDb();
  const { rows: users } = await admin.query<{ id: string; email: string | null }>(
    `SELECT id, email FROM users WHERE email IS NOT NULL`
  );

  for (const user of users) {
    const userEmail = (user.email ?? "").toLowerCase();
    if (!userEmail) continue;

    stats.page_sources_inserted += await backfillPageSourcesForUser(user.id);
    stats.raw_events_marked_from_user += await backfillIsFromUserForUser(
      user.id,
      userEmail
    );
    stats.pages_tagged_job_listing += await tagJobListingsForUser(user.id);
  }

  return stats;
}

async function backfillPageSourcesForUser(userId: string): Promise<number> {
  let inserted = 0;
  await withUser(userId, async (c) => {
    // Strategy A — JSON-style evidence (current shape from injectEvidence).
    const { rows: pages } = await c.query<{ id: string; compiled_truth: string }>(
      `SELECT id, compiled_truth FROM pages`
    );
    for (const page of pages) {
      const { frontmatter } = parseFrontmatter(page.compiled_truth ?? "");
      const evidence = frontmatter.evidence;
      if (!Array.isArray(evidence)) continue;
      const eventIds = new Set<string>();
      for (const entry of evidence) {
        if (entry && typeof entry === "object" && typeof (entry as { event_id?: unknown }).event_id === "string") {
          eventIds.add((entry as { event_id: string }).event_id);
        }
      }
      if (eventIds.size === 0) continue;
      const { rows: events } = await c.query<{ id: string }>(
        `SELECT id FROM raw_events WHERE id = ANY($1)`,
        [[...eventIds]]
      );
      for (const ev of events) {
        const r = await c.query(
          `INSERT INTO page_sources (page_id, user_id, raw_event_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (page_id, raw_event_id) DO NOTHING`,
          [page.id, userId, ev.id]
        );
        inserted += r.rowCount ?? 0;
      }
    }

    // Strategy B — derive from commitments. The compose pipeline rewrites
    // 'evidence' into a YAML-list of human prose (losing event_ids), so
    // strategy A misses most legacy pages. commitments preserves the link via
    // (entity_slug, raw_event_id), so we can backfill page_sources by joining
    // pages.slug = commitments.entity_slug.
    const r = await c.query<{ ins: string }>(
      `INSERT INTO page_sources (page_id, user_id, raw_event_id)
       SELECT DISTINCT p.id, c.user_id, c.raw_event_id
         FROM commitments c
         JOIN pages p ON p.slug = c.entity_slug
        WHERE c.raw_event_id IS NOT NULL
       ON CONFLICT (page_id, raw_event_id) DO NOTHING
       RETURNING 1::text AS ins`
    );
    inserted += r.rowCount ?? 0;
  });
  return inserted;
}

async function backfillIsFromUserForUser(
  userId: string,
  userEmail: string
): Promise<number> {
  const db = getMetaDb();
  // raw_events is NOT RLS-protected (filtered by user_id at the app layer).
  const { rows } = await db.query<{ id: string; from_addr: string | null }>(
    `SELECT id, from_addr
       FROM raw_events
      WHERE user_id = $1 AND is_from_user = false`,
    [userId]
  );

  const matchedIds: string[] = [];
  for (const r of rows) {
    const fromAddr = decrypt(r.from_addr ?? null) ?? "";
    if (fromAddr.toLowerCase().includes(userEmail)) {
      matchedIds.push(r.id);
    }
  }
  if (matchedIds.length === 0) return 0;

  await db.query(
    `UPDATE raw_events SET is_from_user = true WHERE id = ANY($1)`,
    [matchedIds]
  );
  return matchedIds.length;
}

async function tagJobListingsForUser(userId: string): Promise<number> {
  let count = 0;
  await withUser(userId, async (c) => {
    const { rows } = await c.query<{ id: string; title: string }>(
      `SELECT id, title FROM pages
        WHERE type = 'project' AND kind IS NULL`
    );
    const matched = rows.filter((r) => JOB_TITLE_PATTERN.test(r.title)).map((r) => r.id);
    if (matched.length === 0) return;
    await c.query(
      `UPDATE pages SET kind = 'job_listing' WHERE id = ANY($1)`,
      [matched]
    );
    count = matched.length;
  });
  return count;
}
