import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { withUser, getAdminDb, getMetaDb } from "../db";
import { randomUUID } from "crypto";

let userA: string, userB: string;

beforeAll(async () => {
  userA = randomUUID();
  userB = randomUUID();
  const admin = getAdminDb();
  await admin.query(
    `INSERT INTO users (id, email) VALUES ($1, $2), ($3, $4)`,
    [userA, `a-${userA}@test`, userB, `b-${userB}@test`]
  );
});

afterAll(async () => {
  const admin = getAdminDb();
  await admin.query(`DELETE FROM users WHERE id = ANY($1)`, [[userA, userB]]);
  await getAdminDb().end();
  await getMetaDb().end();
});

describe("RLS cross-tenant isolation", () => {
  test("user A cannot see user B's pages", async () => {
    await withUser(userA, (c) =>
      c.query(
        `INSERT INTO pages (user_id, slug, title, compiled_truth)
         VALUES ($1, 'secret-doc', 'Secret', '# secret content')`,
        [userA]
      )
    );
    const { rows } = await withUser(userB, (c) =>
      c.query(`SELECT slug FROM pages WHERE slug = 'secret-doc'`)
    );
    expect(rows).toEqual([]);
  });

  test("user A cannot insert a page with user B's id", async () => {
    await expect(
      withUser(userA, (c) =>
        c.query(
          `INSERT INTO pages (user_id, slug, title, compiled_truth)
           VALUES ($1, 'evil', 'evil', 'evil')`,
          [userB]
        )
      )
    ).rejects.toThrow(/row.level security|row violates/i);
  });

  test("query without withUser context throws (default-deny)", async () => {
    // The RLS policy does `user_id = current_setting('app.user_id')::uuid`.
    // Without withUser the var is either unset (→ "unrecognized configuration parameter")
    // or has a leftover default value (→ "invalid input syntax for type uuid"). Either
    // way the query fails — that's the safety property RLS guarantees.
    await expect(
      getMetaDb().query(`SELECT * FROM pages`)
    ).rejects.toThrow(/unrecognized configuration parameter|app\.user_id|invalid input syntax for type uuid/i);
  });

  test("user A cannot see user B's card_recipes", async () => {
    await withUser(userA, (c) =>
      c.query(
        `INSERT INTO card_recipes (user_id, name, nl_rule)
         VALUES ($1, 'A-secret-recipe', 'private rule')`,
        [userA]
      )
    );
    const { rows } = await withUser(userB, (c) =>
      c.query(`SELECT name FROM card_recipes WHERE name = 'A-secret-recipe'`)
    );
    expect(rows).toEqual([]);
  });

  test("user A cannot insert a card_recipe with user B's id", async () => {
    await expect(
      withUser(userA, (c) =>
        c.query(
          `INSERT INTO card_recipes (user_id, name, nl_rule)
           VALUES ($1, 'evil', 'evil')`,
          [userB]
        )
      )
    ).rejects.toThrow(/row.level security|row violates/i);
  });

  test("user A cannot see user B's digest_feedback", async () => {
    // Need a digest row first to FK against.
    const { rows: dRows } = await withUser(userA, (c) =>
      c.query<{ id: string }>(
        `INSERT INTO digests (user_id, local_date, content)
         VALUES ($1, '2099-01-01', '{}'::jsonb)
         RETURNING id`,
        [userA]
      )
    );
    const digestId = dRows[0].id;
    await withUser(userA, (c) =>
      c.query(
        `INSERT INTO digest_feedback (user_id, digest_id, section, item_ref, signal)
         VALUES ($1, $2, 'awaiting_reply', 'a-secret-item', -1)`,
        [userA, digestId]
      )
    );
    const { rows } = await withUser(userB, (c) =>
      c.query(`SELECT item_ref FROM digest_feedback WHERE item_ref = 'a-secret-item'`)
    );
    expect(rows).toEqual([]);
  });

  test("user A cannot insert digest_feedback with user B's id", async () => {
    const { rows: dRows } = await withUser(userA, (c) =>
      c.query<{ id: string }>(
        `INSERT INTO digests (user_id, local_date, content)
         VALUES ($1, '2099-01-02', '{}'::jsonb)
         RETURNING id`,
        [userA]
      )
    );
    const digestId = dRows[0].id;
    await expect(
      withUser(userA, (c) =>
        c.query(
          `INSERT INTO digest_feedback (user_id, digest_id, section, item_ref, signal)
           VALUES ($1, $2, 'awaiting_reply', 'evil', -1)`,
          [userB, digestId]
        )
      )
    ).rejects.toThrow(/row.level security|row violates/i);
  });

  test("user A cannot see user B's workflows", async () => {
    await withUser(userA, (c) =>
      c.query(
        `INSERT INTO workflows
           (user_id, name, trigger_cron, prompt_template, next_run_at)
         VALUES ($1, 'A-secret-workflow', 'daily_8am', 'secret prompt', now() + interval '1 day')`,
        [userA]
      )
    );
    const { rows } = await withUser(userB, (c) =>
      c.query(`SELECT name FROM workflows WHERE name = 'A-secret-workflow'`)
    );
    expect(rows).toEqual([]);
  });

  test("user A cannot insert a workflow with user B's id", async () => {
    await expect(
      withUser(userA, (c) =>
        c.query(
          `INSERT INTO workflows
             (user_id, name, trigger_cron, prompt_template, next_run_at)
           VALUES ($1, 'evil', 'daily_8am', 'evil', now())`,
          [userB]
        )
      )
    ).rejects.toThrow(/row.level security|row violates/i);
  });

  test("user A cannot see user B's page_sources", async () => {
    // Seed a page + raw_event for B, plus a page_sources row linking them.
    const { rows: pageRows } = await withUser(userB, (c) =>
      c.query<{ id: string }>(
        `INSERT INTO pages (user_id, slug, title, compiled_truth)
         VALUES ($1, 'projects/b-private', 'B private', '# b')
         RETURNING id`,
        [userB]
      )
    );
    const pageId = pageRows[0].id;
    const eventRes = await getMetaDb().query<{ id: string }>(
      `INSERT INTO raw_events
         (user_id, source, source_ref, subject, from_addr, body_text)
       VALUES ($1, 'gmail', $2, $3, $4, $5)
       RETURNING id`,
      [userB, `b-evt-${pageId}`, "x", "x", "x"]
    );
    const eventId = eventRes.rows[0].id;
    await withUser(userB, (c) =>
      c.query(
        `INSERT INTO page_sources (page_id, user_id, raw_event_id)
         VALUES ($1, $2, $3)`,
        [pageId, userB, eventId]
      )
    );

    const { rows } = await withUser(userA, (c) =>
      c.query(`SELECT page_id FROM page_sources WHERE page_id = $1`, [pageId])
    );
    expect(rows).toEqual([]);

    // cleanup
    await withUser(userB, (c) =>
      c.query(`DELETE FROM page_sources WHERE page_id = $1`, [pageId])
    );
    await getMetaDb().query(`DELETE FROM raw_events WHERE id = $1`, [eventId]);
  });

  test("user A cannot insert page_sources with user B's id", async () => {
    // Need a page B owns to FK against.
    const { rows: pageRows } = await withUser(userB, (c) =>
      c.query<{ id: string }>(
        `INSERT INTO pages (user_id, slug, title, compiled_truth)
         VALUES ($1, 'projects/b-fk-target', 'b', '# b')
         RETURNING id`,
        [userB]
      )
    );
    const pageId = pageRows[0].id;
    const eventRes = await getMetaDb().query<{ id: string }>(
      `INSERT INTO raw_events
         (user_id, source, source_ref, subject, from_addr, body_text)
       VALUES ($1, 'gmail', $2, $3, $4, $5)
       RETURNING id`,
      [userB, `b-fk-evt-${pageId}`, "x", "x", "x"]
    );
    await expect(
      withUser(userA, (c) =>
        c.query(
          `INSERT INTO page_sources (page_id, user_id, raw_event_id)
           VALUES ($1, $2, $3)`,
          [pageId, userB, eventRes.rows[0].id]
        )
      )
    ).rejects.toThrow(/row.level security|row violates/i);

    // cleanup
    await getMetaDb().query(`DELETE FROM raw_events WHERE id = $1`, [eventRes.rows[0].id]);
  });

  test("user A cannot see user B's skills", async () => {
    await withUser(userB, (c) =>
      c.query(
        `INSERT INTO skills (user_id, name, slug, instructions)
         VALUES ($1, 'B private skill', 'b-private-skill', 'private text')`,
        [userB]
      )
    );
    const { rows } = await withUser(userA, (c) =>
      c.query(`SELECT name FROM skills WHERE slug = 'b-private-skill'`)
    );
    expect(rows).toEqual([]);
  });

  test("user A cannot insert a skill with user B's id", async () => {
    await expect(
      withUser(userA, (c) =>
        c.query(
          `INSERT INTO skills (user_id, name, slug, instructions)
           VALUES ($1, 'evil', 'evil-a', 'evil')`,
          [userB]
        )
      )
    ).rejects.toThrow(/row.level security|row violates/i);
  });

  test("user A cannot see user B's files", async () => {
    await withUser(userB, (c) =>
      c.query(
        `INSERT INTO files (user_id, filename, mime_type, byte_size, parse_status)
         VALUES ($1, 'b-secret.pdf', 'application/pdf', 100, 'parsed')`,
        [userB]
      )
    );
    const { rows } = await withUser(userA, (c) =>
      c.query(`SELECT filename FROM files WHERE filename = 'b-secret.pdf'`)
    );
    expect(rows).toEqual([]);
  });

  test("user A cannot insert a file with user B's id", async () => {
    await expect(
      withUser(userA, (c) =>
        c.query(
          `INSERT INTO files (user_id, filename, mime_type, byte_size, parse_status)
           VALUES ($1, 'evil.pdf', 'application/pdf', 100, 'parsed')`,
          [userB]
        )
      )
    ).rejects.toThrow(/row.level security|row violates/i);
  });

  test("user A cannot see user B's workflow_runs", async () => {
    // Seed a workflow row for B, then a run row for B's workflow.
    const { rows: wfRows } = await withUser(userB, (c) =>
      c.query<{ id: string }>(
        `INSERT INTO workflows
           (user_id, name, trigger_cron, prompt_template, next_run_at)
         VALUES ($1, 'B-private-run', 'daily_8am', 'p', now() + interval '1 day')
         RETURNING id`,
        [userB]
      )
    );
    const wfId = wfRows[0].id;
    await withUser(userB, (c) =>
      c.query(
        `INSERT INTO workflow_runs
           (workflow_id, user_id, status, output_text, source_refs)
         VALUES ($1, $2, 'success', 'b-secret', '[]'::jsonb)`,
        [wfId, userB]
      )
    );
    const { rows } = await withUser(userA, (c) =>
      c.query(`SELECT output_text FROM workflow_runs WHERE output_text = 'b-secret'`)
    );
    expect(rows).toEqual([]);
  });
});
