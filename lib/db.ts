import { Pool, PoolClient } from "pg";

let pool: Pool | undefined;
let adminPool: Pool | undefined;

export function getMetaDb(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }
  return pool;
}

export function getAdminDb(): Pool {
  if (!adminPool) {
    adminPool = new Pool({
      connectionString: process.env.ADMIN_DATABASE_URL,
      max: 5,
    });
  }
  return adminPool;
}

/**
 * Run `fn` inside a transaction with `app.user_id` set so RLS-protected
 * tables filter to this user only. This is the ONLY sanctioned way to
 * query `pages`, `content_chunks`, or `links`.
 *
 * Why a transaction: `SET LOCAL` is transaction-scoped, so the var dies
 * at COMMIT and the connection returns to the pool clean. Safe under
 * pgBouncer transaction-mode pooling (RDS Proxy, Supavisor, etc.).
 */
export async function withUser<T>(
  userId: string,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getMetaDb().connect();
  try {
    await client.query("BEGIN");
    // set_config(...) lets us pass userId as a parameter; SET LOCAL doesn't.
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
