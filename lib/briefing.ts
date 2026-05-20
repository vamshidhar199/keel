import { withUser, getAdminDb } from "./db";

export type JsonValue =
  | string | number | boolean | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export async function getOrGenerate(
  userId: string,
  kind: string,
  ttlSeconds: number,
  generator: () => Promise<JsonValue>
): Promise<JsonValue> {
  const cached = await withUser(userId, async (client) => {
    const { rows } = await client.query<{ content: JsonValue }>(
      `SELECT content FROM user_briefings
       WHERE user_id = $1 AND kind = $2
         AND generated_at > NOW() - ($3::numeric * interval '1 second')`,
      [userId, kind, ttlSeconds]
    );
    return rows.length > 0 ? rows[0].content : undefined;
  });

  if (cached !== undefined) return cached;

  const result = await generator();

  await withUser(userId, async (client) => {
    await client.query(
      `INSERT INTO user_briefings (user_id, kind, content, generated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id, kind)
       DO UPDATE SET content = EXCLUDED.content, generated_at = NOW()`,
      [userId, kind, JSON.stringify(result)]
    );
  });

  return result;
}

export async function cleanupBriefings(maxAgeDays = 7): Promise<number> {
  const { rowCount } = await getAdminDb().query(
    `DELETE FROM user_briefings WHERE generated_at < NOW() - ($1::int * interval '1 day')`,
    [maxAgeDays]
  );
  return rowCount ?? 0;
}
