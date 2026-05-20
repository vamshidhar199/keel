// One-shot backfill: re-write existing plaintext rows as ciphertext.
// Idempotent (skips rows already prefixed with `enc:v1:`), safe to re-run.
// Usage: bun run lib/migrate-encrypt.ts
//
// Make sure ENCRYPTION_KEY is set in env before running.

import { getMetaDb } from "./db";
import { encrypt, isEncrypted } from "./crypto";

const BATCH = 500;

function maybeEncrypt(value: string | null): string | null {
  if (value === null || value === "") return value;
  if (isEncrypted(value)) return value;
  return encrypt(value);
}

async function backfillAccounts(): Promise<number> {
  const db = getMetaDb();
  const { rows } = await db.query<{
    id: string;
    access_token: string | null;
    refresh_token: string | null;
    id_token: string | null;
    session_state: string | null;
  }>(`SELECT id, access_token, refresh_token, id_token, session_state FROM accounts`);

  let updated = 0;
  for (const r of rows) {
    const at = maybeEncrypt(r.access_token);
    const rt = maybeEncrypt(r.refresh_token);
    const it = maybeEncrypt(r.id_token);
    if (at === r.access_token && rt === r.refresh_token && it === r.id_token) continue;
    await db.query(
      `UPDATE accounts SET access_token = $1, refresh_token = $2, id_token = $3 WHERE id = $4`,
      [at, rt, it, r.id]
    );
    updated++;
  }
  return updated;
}

async function backfillUserApiKeys(): Promise<number> {
  const db = getMetaDb();
  const { rows } = await db.query<{
    user_id: string;
    anthropic_api_key: string | null;
    openai_api_key: string | null;
  }>(`SELECT user_id, anthropic_api_key, openai_api_key FROM user_api_keys`);

  let updated = 0;
  for (const r of rows) {
    const a = maybeEncrypt(r.anthropic_api_key);
    const o = maybeEncrypt(r.openai_api_key);
    if (a === r.anthropic_api_key && o === r.openai_api_key) continue;
    await db.query(
      `UPDATE user_api_keys SET anthropic_api_key = $1, openai_api_key = $2 WHERE user_id = $3`,
      [a, o, r.user_id]
    );
    updated++;
  }
  return updated;
}

async function backfillRawEvents(): Promise<number> {
  const db = getMetaDb();
  let totalUpdated = 0;
  let lastId: string | null = null;

  while (true) {
    const params: (string | number)[] = [BATCH];
    let where = "";
    if (lastId) {
      where = "WHERE id > $2";
      params.push(lastId);
    }
    const { rows } = await db.query<{
      id: string;
      subject: string | null;
      from_addr: string | null;
      body_text: string | null;
      raw_json: string | null;
    }>(
      `SELECT id, subject, from_addr, body_text, raw_json
       FROM raw_events ${where}
       ORDER BY id ASC LIMIT $1`,
      params
    );
    if (rows.length === 0) break;

    for (const r of rows) {
      const s = maybeEncrypt(r.subject);
      const f = maybeEncrypt(r.from_addr);
      const b = maybeEncrypt(r.body_text);
      const j = maybeEncrypt(r.raw_json);
      if (
        s === r.subject &&
        f === r.from_addr &&
        b === r.body_text &&
        j === r.raw_json
      ) continue;
      await db.query(
        `UPDATE raw_events SET subject = $1, from_addr = $2, body_text = $3, raw_json = $4 WHERE id = $5`,
        [s, f, b, j, r.id]
      );
      totalUpdated++;
    }

    lastId = rows[rows.length - 1].id;
    if (rows.length < BATCH) break;
  }
  return totalUpdated;
}

async function main() {
  console.log("[encrypt-backfill] starting (idempotent)");
  const a = await backfillAccounts();
  console.log(`[encrypt-backfill] accounts: encrypted ${a} row(s)`);
  const k = await backfillUserApiKeys();
  console.log(`[encrypt-backfill] user_api_keys: encrypted ${k} row(s)`);
  const e = await backfillRawEvents();
  console.log(`[encrypt-backfill] raw_events: encrypted ${e} row(s)`);
  console.log("[encrypt-backfill] done");
  await getMetaDb().end();
}

main().catch((err) => {
  console.error("[encrypt-backfill] FAILED:", err);
  process.exit(1);
});
