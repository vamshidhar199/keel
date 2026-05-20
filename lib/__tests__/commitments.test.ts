import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { getAdminDb, getMetaDb, withUser } from "../db";
import { encrypt } from "../crypto";
import { listOpenCommitments } from "../commitments";

let userId: string;
let freshEventId: string;
let staleEventId: string;

beforeAll(async () => {
  userId = randomUUID();
  await getAdminDb().query(
    `INSERT INTO users (id, email) VALUES ($1, $2)`,
    [userId, `commit-test-${userId}@test`]
  );

  // Seed one fresh email (date_sent = today) and one stale (10 days ago).
  const insert = async (sourceRef: string, dateSent: Date) => {
    const db = getMetaDb();
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO raw_events
         (user_id, source, source_ref, subject, from_addr, date_sent, body_text, thread_ref)
       VALUES ($1, 'gmail', $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        userId,
        sourceRef,
        encrypt("test subject"),
        encrypt("sender@test"),
        dateSent,
        encrypt("body"),
        sourceRef + "-thread",
      ]
    );
    return rows[0].id;
  };
  freshEventId = await insert(`fresh-${randomUUID()}`, new Date());
  staleEventId = await insert(
    `stale-${randomUUID()}`,
    new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
  );

  // Seed commitments tied to each.
  await withUser(userId, async (c) => {
    await c.query(
      `INSERT INTO commitments (user_id, raw_event_id, text, entity_slug, status)
       VALUES ($1, $2, 'fresh promise', 'people/test', 'open')`,
      [userId, freshEventId]
    );
    await c.query(
      `INSERT INTO commitments (user_id, raw_event_id, text, entity_slug, status)
       VALUES ($1, $2, 'stale promise', 'people/test', 'open')`,
      [userId, staleEventId]
    );
  });
});

afterAll(async () => {
  await withUser(userId, async (c) => {
    await c.query(`DELETE FROM commitments WHERE user_id = $1`, [userId]);
  });
  const db = getMetaDb();
  await db.query(`DELETE FROM raw_events WHERE user_id = $1`, [userId]);
  await getAdminDb().query(`DELETE FROM users WHERE id = $1`, [userId]);
  await getAdminDb().end();
  await getMetaDb().end();
});

describe("listOpenCommitments aging", () => {
  test("default 7-day window hides commitments tied to a 10-day-old email", async () => {
    const rows = await listOpenCommitments(userId, 5);
    const texts = rows.map((r) => r.text);
    expect(texts).toContain("fresh promise");
    expect(texts).not.toContain("stale promise");
  });

  test("widening the window past the email's age brings it back", async () => {
    const rows = await listOpenCommitments(userId, 5, 14);
    const texts = rows.map((r) => r.text);
    expect(texts).toContain("fresh promise");
    expect(texts).toContain("stale promise");
  });

  test("commitments without a raw_event_id fall back to created_at and respect the window", async () => {
    // Insert a brand-new manual commitment with no raw_event_id; should appear
    // because commitments.created_at is now.
    await withUser(userId, (c) =>
      c.query(
        `INSERT INTO commitments (user_id, raw_event_id, text, entity_slug, status)
         VALUES ($1, NULL, 'manual promise', 'people/test', 'open')`,
        [userId]
      )
    );
    const rows = await listOpenCommitments(userId, 10);
    const texts = rows.map((r) => r.text);
    expect(texts).toContain("manual promise");
  });
});
