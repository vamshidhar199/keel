import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { getMetaDb, getAdminDb, withUser } from "../db";
import { getOrGenerate } from "../briefing";
import { randomUUID } from "crypto";

let userId: string;

beforeAll(async () => {
  userId = randomUUID();
  await getAdminDb().query(
    `INSERT INTO users (id, email) VALUES ($1, $2)`,
    [userId, `briefing-test-${userId}@test`]
  );
});

afterAll(async () => {
  await withUser(userId, (c) =>
    c.query(`DELETE FROM user_briefings WHERE user_id = $1`, [userId])
  );
  await getAdminDb().query(`DELETE FROM users WHERE id = $1`, [userId]);
  await getAdminDb().end();
  await getMetaDb().end();
});

describe("getOrGenerate", () => {
  test("returns cached value and skips generator when row exists within TTL", async () => {
    const kind = `test_cached:${randomUUID()}`;
    await withUser(userId, (c) =>
      c.query(
        `INSERT INTO user_briefings (user_id, kind, content, generated_at)
         VALUES ($1, $2, $3, NOW())`,
        [userId, kind, JSON.stringify("cached-value")]
      )
    );

    let generatorCalled = false;
    const result = await getOrGenerate(userId, kind, 3600, async () => {
      generatorCalled = true;
      return "fresh-value";
    });

    expect(result).toBe("cached-value");
    expect(generatorCalled).toBe(false);
  });

  test("calls generator and upserts result on cache miss", async () => {
    const kind = `test_miss:${randomUUID()}`;
    let generatorCalled = false;

    const result = await getOrGenerate(userId, kind, 3600, async () => {
      generatorCalled = true;
      return "generated-value";
    });

    expect(result).toBe("generated-value");
    expect(generatorCalled).toBe(true);

    const { rows } = await withUser(userId, (c) =>
      c.query(
        `SELECT content FROM user_briefings WHERE user_id = $1 AND kind = $2`,
        [userId, kind]
      )
    );
    expect(rows[0]?.content).toBe("generated-value");
  });

  test("propagates generator error and does not upsert", async () => {
    const kind = `test_error:${randomUUID()}`;

    await expect(
      getOrGenerate(userId, kind, 3600, async () => {
        throw new Error("generator failed");
      })
    ).rejects.toThrow("generator failed");

    const { rows } = await withUser(userId, (c) =>
      c.query(
        `SELECT content FROM user_briefings WHERE user_id = $1 AND kind = $2`,
        [userId, kind]
      )
    );
    expect(rows).toHaveLength(0);
  });
});
