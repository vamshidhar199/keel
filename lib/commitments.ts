import { withUser } from "./db";

export interface OpenCommitment {
  id: string;
  text: string;
  entity_slug: string | null;
  created_at: Date;
}

// Surface only open commitments whose underlying email is recent. After
// `withinDays` (default 7), a promise hasn't been acted on or marked done —
// presume stale and drop it from the brief. Falls back to commitments.created_at
// when there's no source raw_event (manual entries, future sources).
export async function listOpenCommitments(
  userId: string,
  limit = 5,
  withinDays = 7
): Promise<OpenCommitment[]> {
  return withUser(userId, async (c) => {
    const { rows } = await c.query<OpenCommitment>(
      `SELECT c.id, c.text, c.entity_slug, c.created_at
         FROM commitments c
         LEFT JOIN raw_events r ON r.id = c.raw_event_id
        WHERE c.status = 'open'
          AND COALESCE(r.date_sent, c.created_at) > now() - ($1 || ' days')::interval
        ORDER BY COALESCE(r.date_sent, c.created_at) DESC
        LIMIT $2`,
      [withinDays, limit]
    );
    return rows;
  });
}

export async function setCommitmentStatus(
  userId: string,
  commitmentId: string,
  status: "done" | "dismissed"
): Promise<void> {
  await withUser(userId, async (c) => {
    await c.query(
      `UPDATE commitments
         SET status = $1, resolved_at = now()
       WHERE id = $2 AND status = 'open'`,
      [status, commitmentId]
    );
  });
}
