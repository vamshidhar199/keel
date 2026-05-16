import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { getAdminDb, getMetaDb, withUser } from "../db";
import {
  buildMemoriesBlock,
  gapHoursFor,
  listEnabledRecipes,
  summarizeRecentDownvotes,
} from "../digest";

let userId: string;
let digestId: string;

beforeAll(async () => {
  userId = randomUUID();
  const admin = getAdminDb();
  await admin.query(
    `INSERT INTO users (id, email) VALUES ($1, $2)`,
    [userId, `digest-test-${userId}@test`]
  );
  // Seed one digest row so feedback rows can FK to it.
  const r = await withUser(userId, (c) =>
    c.query<{ id: string }>(
      `INSERT INTO digests (user_id, local_date, content)
       VALUES ($1, CURRENT_DATE, '{}'::jsonb)
       RETURNING id`,
      [userId]
    )
  );
  digestId = r.rows[0].id;
});

afterAll(async () => {
  await withUser(userId, async (c) => {
    await c.query(`DELETE FROM digest_feedback WHERE user_id = $1`, [userId]);
    await c.query(`DELETE FROM card_recipes WHERE user_id = $1`, [userId]);
    await c.query(`DELETE FROM digests WHERE user_id = $1`, [userId]);
  });
  await getAdminDb().query(`DELETE FROM users WHERE id = $1`, [userId]);
  await getAdminDb().end();
  await getMetaDb().end();
});

describe("buildMemoriesBlock", () => {
  test("returns empty string when no inputs", () => {
    const out = buildMemoriesBlock("", { total: 0, bySection: [] }, 0);
    expect(out).toBe("");
  });

  test("wraps memories in <user_memories> when present", () => {
    const out = buildMemoriesBlock("Always show dollar amounts.", { total: 0, bySection: [] }, 0);
    expect(out).toContain("<user_memories>");
    expect(out).toContain("Always show dollar amounts.");
    expect(out).toContain("</user_memories>");
  });

  test("includes feedback block when downvotes present", () => {
    const out = buildMemoriesBlock(
      "",
      { total: 3, bySection: [{ section: "awaiting_reply", count: 3 }] },
      0
    );
    expect(out).toContain("<feedback_signals>");
    expect(out).toContain("awaiting_reply: 3");
  });

  test("includes presence block when gap > 30h", () => {
    const out = buildMemoriesBlock("", { total: 0, bySection: [] }, 72);
    expect(out).toContain("<presence>");
    expect(out).toContain("3 days");
  });

  test("omits presence block when gap <= 30h", () => {
    const out = buildMemoriesBlock("", { total: 0, bySection: [] }, 12);
    expect(out).not.toContain("<presence>");
  });
});

describe("gapHoursFor", () => {
  test("returns 0 when last_seen_at is null", () => {
    expect(gapHoursFor(null)).toBe(0);
  });

  test("returns ~24 for a date 1 day ago", () => {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const gap = gapHoursFor(oneDayAgo);
    expect(gap).toBeGreaterThanOrEqual(23);
    expect(gap).toBeLessThanOrEqual(25);
  });

  test("never returns negative", () => {
    const future = new Date(Date.now() + 60 * 60 * 1000);
    expect(gapHoursFor(future)).toBe(0);
  });
});

describe("digest_feedback upsert", () => {
  test("INSERT then re-INSERT with different signal updates in place (idempotent toggle)", async () => {
    const itemRef = `thread-${randomUUID()}`;

    await withUser(userId, (c) =>
      c.query(
        `INSERT INTO digest_feedback (user_id, digest_id, section, item_ref, signal)
         VALUES ($1, $2, 'awaiting_reply', $3, -1)
         ON CONFLICT (user_id, digest_id, section, item_ref) DO UPDATE
           SET signal = EXCLUDED.signal`,
        [userId, digestId, itemRef]
      )
    );
    await withUser(userId, (c) =>
      c.query(
        `INSERT INTO digest_feedback (user_id, digest_id, section, item_ref, signal)
         VALUES ($1, $2, 'awaiting_reply', $3, 1)
         ON CONFLICT (user_id, digest_id, section, item_ref) DO UPDATE
           SET signal = EXCLUDED.signal`,
        [userId, digestId, itemRef]
      )
    );

    const { rows } = await withUser(userId, (c) =>
      c.query<{ signal: number; n: string }>(
        `SELECT signal, COUNT(*) OVER ()::text AS n
           FROM digest_feedback
          WHERE digest_id = $1 AND item_ref = $2`,
        [digestId, itemRef]
      )
    );
    expect(rows.length).toBe(1);
    expect(rows[0].signal).toBe(1);
  });

  test("summarizeRecentDownvotes aggregates by section", async () => {
    // Seed three downvotes across two sections.
    const refs = [randomUUID(), randomUUID(), randomUUID()];
    for (const r of refs.slice(0, 2)) {
      await withUser(userId, (c) =>
        c.query(
          `INSERT INTO digest_feedback (user_id, digest_id, section, item_ref, signal)
           VALUES ($1, $2, 'awaiting_reply', $3, -1)`,
          [userId, digestId, r]
        )
      );
    }
    await withUser(userId, (c) =>
      c.query(
        `INSERT INTO digest_feedback (user_id, digest_id, section, item_ref, signal)
         VALUES ($1, $2, 'quiet', $3, -1)`,
        [userId, digestId, refs[2]]
      )
    );

    const summary = await summarizeRecentDownvotes(userId);
    expect(summary.total).toBeGreaterThanOrEqual(3);
    const awaiting = summary.bySection.find((s) => s.section === "awaiting_reply");
    const quiet = summary.bySection.find((s) => s.section === "quiet");
    expect(awaiting?.count).toBeGreaterThanOrEqual(2);
    expect(quiet?.count).toBeGreaterThanOrEqual(1);
  });
});

describe("card_recipes lifecycle", () => {
  test("listEnabledRecipes excludes disabled rows and caps at 5", async () => {
    await withUser(userId, async (c) => {
      // 6 enabled rows + 1 disabled
      for (let i = 0; i < 6; i++) {
        await c.query(
          `INSERT INTO card_recipes (user_id, name, nl_rule, enabled, sort_order)
           VALUES ($1, $2, $3, true, $4)`,
          [userId, `r${i}`, "anything mentioning X", i]
        );
      }
      await c.query(
        `INSERT INTO card_recipes (user_id, name, nl_rule, enabled, sort_order)
         VALUES ($1, 'disabled', 'noop', false, 99)`,
        [userId]
      );
    });

    const rows = await listEnabledRecipes(userId);
    expect(rows.length).toBe(5);
    expect(rows.every((r) => r.name !== "disabled")).toBe(true);
  });
});
