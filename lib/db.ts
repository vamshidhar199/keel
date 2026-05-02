import { Pool } from "pg";

// Mettrie metadata database — users, sessions, raw_events, llm_costs, etc.
// Each user's gbrain data lives in a separate DB; see lib/gbrain.ts.
let pool: Pool | undefined;

export function getMetaDb(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return pool;
}

// Returns a one-off Pool pointed at a specific user's gbrain database.
// Do not cache — caller is responsible for calling pool.end() when done.
export function getGbrainDb(userId: string): Pool {
  const base = process.env.DATABASE_URL!;
  const url = new URL(base);
  url.pathname = `/gbrain_user_${userId}`;
  return new Pool({ connectionString: url.toString() });
}
