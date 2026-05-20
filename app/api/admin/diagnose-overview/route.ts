// TEMPORARY DIAGNOSTIC — delete this file after use.
// Returns the data shape that determines why /overview cards are empty.

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getMetaDb, withUser } from "@/lib/db";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const userId = session.user.id;
  const db = getMetaDb();

  const [userRow, isFromUserBreakdown, rawEventsRecent, awaitingReplyTrace, sampleFromAddrs] =
    await Promise.all([
      db.query<{ email: string | null; timezone: string | null; last_seen_at: Date | null }>(
        `SELECT email, timezone, last_seen_at FROM users WHERE id = $1`,
        [userId]
      ),
      db.query<{ is_from_user: boolean; cnt: string }>(
        `SELECT is_from_user, COUNT(*)::text AS cnt FROM raw_events
          WHERE user_id = $1 AND source = 'gmail'
          GROUP BY is_from_user`,
        [userId]
      ),
      db.query<{ cnt: string }>(
        `SELECT COUNT(*)::text AS cnt FROM raw_events
          WHERE user_id = $1 AND source = 'gmail'
            AND date_sent > now() - INTERVAL '14 days'`,
        [userId]
      ),
      // Reproduces listAwaitingReply's DISTINCT ON: latest message per thread.
      // We can't decrypt from_addr here without the key, so we return counts
      // grouped by is_from_user on the latest-per-thread set — same plaintext
      // signal listAwaitingReply uses downstream.
      db.query<{ is_from_user: boolean; cnt: string }>(
        `WITH latest_per_thread AS (
           SELECT DISTINCT ON (thread_ref)
             thread_ref, is_from_user, date_sent
           FROM raw_events
           WHERE user_id = $1 AND source = 'gmail'
             AND thread_ref IS NOT NULL
             AND date_sent > now() - INTERVAL '14 days'
           ORDER BY thread_ref, date_sent DESC
         )
         SELECT is_from_user, COUNT(*)::text AS cnt
         FROM latest_per_thread
         GROUP BY is_from_user`,
        [userId]
      ),
      // First 5 raw_events with thread_ref in the last 14 days — gives us
      // is_from_user + a peek at the encrypted from_addr length so we can
      // verify the field is being populated.
      db.query<{ id: string; is_from_user: boolean; from_addr_len: number }>(
        `SELECT id, is_from_user, octet_length(from_addr) AS from_addr_len
           FROM raw_events
          WHERE user_id = $1 AND source = 'gmail'
            AND thread_ref IS NOT NULL
            AND date_sent > now() - INTERVAL '14 days'
          ORDER BY date_sent DESC
          LIMIT 5`,
        [userId]
      ),
    ]);

  const tenant = await withUser(userId, async (c) => {
    const [pagesByType, pagesByKind, ageBuckets, commitments, activeThreadsEligible, opportunities] =
      await Promise.all([
        c.query<{ type: string | null; cnt: string }>(
          `SELECT type, COUNT(*)::text AS cnt FROM pages GROUP BY type ORDER BY cnt DESC`
        ),
        c.query<{ kind: string | null; cnt: string }>(
          `SELECT kind, COUNT(*)::text AS cnt FROM pages GROUP BY kind ORDER BY cnt DESC`
        ),
        c.query<{ bucket: string; cnt: string }>(
          `SELECT
             CASE
               WHEN updated_at > now() - INTERVAL '7 days' THEN '0-7d'
               WHEN updated_at > now() - INTERVAL '14 days' THEN '7-14d'
               WHEN updated_at > now() - INTERVAL '30 days' THEN '14-30d'
               ELSE '30d+'
             END AS bucket,
             COUNT(*)::text AS cnt
           FROM pages
           GROUP BY bucket ORDER BY bucket`
        ),
        c.query<{ status: string; cnt: string }>(
          `SELECT status, COUNT(*)::text AS cnt FROM commitments GROUP BY status`
        ),
        // Replicates listActiveThreads's WHERE clause to surface why it's empty
        c.query<{ cnt: string }>(
          `SELECT COUNT(*)::text AS cnt
             FROM pages p
            WHERE p.type IN ('project', 'topic')
              AND p.updated_at > now() - INTERVAL '14 days'
              AND (p.kind IS NULL OR p.kind <> 'job_listing')
              AND EXISTS (
                SELECT 1
                  FROM page_sources ps
                  JOIN raw_events src ON src.id = ps.raw_event_id
                  JOIN raw_events mine ON mine.user_id = ps.user_id
                                       AND mine.thread_ref = src.thread_ref
                                       AND mine.thread_ref IS NOT NULL
                                       AND mine.is_from_user = true
                 WHERE ps.page_id = p.id
              )`
        ),
        // Replicates listOpportunities
        c.query<{ cnt: string }>(
          `SELECT COUNT(*)::text AS cnt FROM pages
            WHERE kind = 'job_listing'
              AND type = 'project'
              AND updated_at > now() - INTERVAL '14 days'`
        ),
      ]);
    return {
      pagesByType: pagesByType.rows,
      pagesByKind: pagesByKind.rows,
      pageAgeBuckets: ageBuckets.rows,
      commitments: commitments.rows,
      activeThreadsMatchingRows: Number(activeThreadsEligible.rows[0]?.cnt ?? "0"),
      opportunitiesMatchingRows: Number(opportunities.rows[0]?.cnt ?? "0"),
    };
  });

  return NextResponse.json({
    user: {
      id: userId,
      email: userRow.rows[0]?.email,
      timezone: userRow.rows[0]?.timezone,
      last_seen_at: userRow.rows[0]?.last_seen_at,
    },
    rawEvents: {
      isFromUserBreakdown: isFromUserBreakdown.rows,
      recentLast14d: Number(rawEventsRecent.rows[0]?.cnt ?? "0"),
      awaitingReplyTrace: {
        latestPerThreadLast14d: awaitingReplyTrace.rows,
        sampleRows: sampleFromAddrs.rows,
      },
    },
    tenant,
  });
}
