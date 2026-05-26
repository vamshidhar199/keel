import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getMetaDb, withUser } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { extractEmail } from "@/lib/extract";

// Re-runs Haiku extraction over already-extracted raw_events to populate the
// commitments table for data that pre-dates PR 1. Admin-only, chunked via
// ?limit and ?offset query params.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 25), 100);
  const offset = Math.max(Number(url.searchParams.get("offset") ?? 0), 0);
  const userId = session.user.id;

  const db = getMetaDb();
  const { rows } = await db.query<{
    id: string;
    subject: string;
    from_addr: string;
    date_sent: Date | null;
    body_text: string;
  }>(
    `SELECT id, subject, from_addr, date_sent, body_text
     FROM raw_events
     WHERE user_id = $1 AND extraction_status = 'extracted'
       AND id NOT IN (SELECT raw_event_id FROM commitments WHERE user_id = $1 AND raw_event_id IS NOT NULL)
     ORDER BY date_sent DESC NULLS LAST
     OFFSET $2 LIMIT $3`,
    [userId, offset, limit]
  );

  // Admin backfill skips the open-commitments LLM judge: this only runs over
  // raw_events that have NO existing commitments (the NOT IN filter above), so
  // there's nothing to dedupe against. Every action will come back as "create".
  let inserted = 0;
  for (const ev of rows) {
    try {
      const result = await extractEmail(userId, {
        id: ev.id,
        subject: decrypt(ev.subject) ?? "",
        from_addr: decrypt(ev.from_addr) ?? "",
        date_sent: ev.date_sent?.toISOString() ?? null,
        body_text: decrypt(ev.body_text) ?? "",
      });
      if (result.commitmentActions.length > 0) {
        await withUser(userId, async (c) => {
          for (const a of result.commitmentActions) {
            const primarySlug = a.entitySlugs[0] ?? null;
            const { rows: ins } = await c.query<{ id: string }>(
              `INSERT INTO commitments (user_id, raw_event_id, text, entity_slug)
               VALUES ($1, $2, $3, $4) RETURNING id`,
              [userId, ev.id, a.text, primarySlug]
            );
            for (const slug of a.entitySlugs) {
              await c.query(
                `INSERT INTO commitment_entities (commitment_id, user_id, entity_slug)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (commitment_id, entity_slug) DO NOTHING`,
                [ins[0].id, userId, slug]
              );
            }
          }
        });
        inserted += result.commitmentActions.length;
      }
    } catch (err) {
      console.error(`[backfill-commitments] event=${ev.id} failed:`, (err as Error).message);
    }
  }

  return NextResponse.json({
    processed: rows.length,
    inserted,
    nextOffset: rows.length === limit ? offset + limit : null,
  });
}
