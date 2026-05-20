import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { getAdminDb, getMetaDb, withUser } from "../db";
import { encrypt } from "../crypto";
import { listActiveThreads, listOpportunities } from "../digest";

let userId: string;
let pageId: string;
let inboundEventId: string;
const threadRef = `engagement-test-${randomUUID()}`;

beforeAll(async () => {
  userId = randomUUID();
  await getAdminDb().query(
    `INSERT INTO users (id, email) VALUES ($1, $2)`,
    [userId, `eng-test-${userId}@test`]
  );

  // Seed an inbound (non-user) Gmail message on the thread.
  const db = getMetaDb();
  const r = await db.query<{ id: string }>(
    `INSERT INTO raw_events
       (user_id, source, source_ref, subject, from_addr, date_sent, body_text, thread_ref, is_from_user)
     VALUES ($1, 'gmail', $2, $3, $4, now(), $5, $6, false)
     RETURNING id`,
    [
      userId,
      `inbound-${randomUUID()}`,
      encrypt("Hello"),
      encrypt("other@example.com"),
      encrypt("hi"),
      threadRef,
    ]
  );
  inboundEventId = r.rows[0].id;

  // Seed a project page with no kind, recent updated_at.
  const p = await withUser(userId, (c) =>
    c.query<{ id: string }>(
      `INSERT INTO pages (user_id, slug, title, type, compiled_truth, updated_at)
       VALUES ($1, $2, 'Test Project', 'project', '# test', now())
       RETURNING id`,
      [userId, `projects/engagement-test-${randomUUID().slice(0, 8)}`]
    )
  );
  pageId = p.rows[0].id;

  // Link the page to the inbound event.
  await withUser(userId, (c) =>
    c.query(
      `INSERT INTO page_sources (page_id, user_id, raw_event_id)
       VALUES ($1, $2, $3)`,
      [pageId, userId, inboundEventId]
    )
  );
});

afterAll(async () => {
  await withUser(userId, async (c) => {
    await c.query(`DELETE FROM page_sources WHERE user_id = $1`, [userId]);
    await c.query(`DELETE FROM pages WHERE user_id = $1`, [userId]);
  });
  await getMetaDb().query(`DELETE FROM raw_events WHERE user_id = $1`, [userId]);
  await getAdminDb().query(`DELETE FROM users WHERE id = $1`, [userId]);
  await getAdminDb().end();
  await getMetaDb().end();
});

describe("listActiveThreads — engagement filter", () => {
  test("page with only inbound (non-user) messages does NOT appear", async () => {
    const rows = await listActiveThreads(userId);
    expect(rows.find((r) => r.slug.startsWith("projects/engagement-test-"))).toBeUndefined();
  });

  test("after adding a user-sent message in the same thread, page appears", async () => {
    const db = getMetaDb();
    await db.query(
      `INSERT INTO raw_events
         (user_id, source, source_ref, subject, from_addr, date_sent, body_text, thread_ref, is_from_user)
       VALUES ($1, 'gmail', $2, $3, $4, now(), $5, $6, true)`,
      [
        userId,
        `sent-${randomUUID()}`,
        encrypt("Re: Hello"),
        encrypt("me@example.com"),
        encrypt("thanks"),
        threadRef,
      ]
    );

    const rows = await listActiveThreads(userId);
    expect(rows.find((r) => r.slug.startsWith("projects/engagement-test-"))).toBeDefined();
  });

  test("setting kind='job_listing' removes the page from active threads", async () => {
    await withUser(userId, (c) =>
      c.query(`UPDATE pages SET kind = 'job_listing' WHERE id = $1`, [pageId])
    );
    const rows = await listActiveThreads(userId);
    expect(rows.find((r) => r.slug.startsWith("projects/engagement-test-"))).toBeUndefined();
  });

  test("listOpportunities surfaces the kind='job_listing' page", async () => {
    const rows = await listOpportunities(userId);
    expect(rows.find((r) => r.slug.startsWith("projects/engagement-test-"))).toBeDefined();
  });

  test("listOpportunities ignores non-job pages", async () => {
    // Reset kind for the test page; ensure it disappears from opportunities.
    await withUser(userId, (c) =>
      c.query(`UPDATE pages SET kind = NULL WHERE id = $1`, [pageId])
    );
    const rows = await listOpportunities(userId);
    expect(rows.find((r) => r.slug.startsWith("projects/engagement-test-"))).toBeUndefined();
  });
});
