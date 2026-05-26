import { withUser } from "./db";

export interface OpenCommitment {
  id: string;
  text: string;
  entitySlugs: string[];
  created_at: Date;
}

// Surface open commitments extracted within `withinDays` (default 30). Note:
// the staleness clock measures from extraction time (c.created_at), NOT the
// source email's send date. An initial sync that backfills a year of email
// produces commitments TODAY even if the underlying emails are old — those
// are brand-new to the user, not stale. Ordered by extraction time so the
// most recently-surfaced promises appear first.
export async function listOpenCommitments(
  userId: string,
  limit = 5,
  withinDays = 30
): Promise<OpenCommitment[]> {
  return withUser(userId, async (c) => {
    const { rows } = await c.query<{
      id: string;
      text: string;
      entity_slugs: string[] | null;
      created_at: Date;
    }>(
      `SELECT c.id, c.text, c.created_at,
              COALESCE(
                array_agg(ce.entity_slug ORDER BY ce.entity_slug)
                  FILTER (WHERE ce.entity_slug IS NOT NULL),
                ARRAY[]::text[]
              ) AS entity_slugs
         FROM commitments c
         LEFT JOIN commitment_entities ce ON ce.commitment_id = c.id
        WHERE c.status = 'open'
          AND c.created_at > now() - ($1 || ' days')::interval
        GROUP BY c.id
        ORDER BY c.created_at DESC
        LIMIT $2`,
      [withinDays, limit]
    );
    return rows.map((r) => ({
      id: r.id,
      text: r.text,
      entitySlugs: r.entity_slugs ?? [],
      created_at: r.created_at,
    }));
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
