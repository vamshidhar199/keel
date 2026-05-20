// One-off backfill: legacy raw_events have thread_ref=null and
// is_from_user=false because they were synced before those columns existed,
// and sync's `if (exists) continue` short-circuit prevents subsequent runs
// from updating them. The full Gmail message is still stored in raw_json
// (encrypted), so we can populate both columns without re-hitting Gmail.

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getMetaDb } from "@/lib/db";
import { decrypt } from "@/lib/crypto";

const BATCH_SIZE = 500;

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const userId = session.user.id;
  const db = getMetaDb();

  const { rows: userRows } = await db.query<{ email: string | null }>(
    `SELECT email FROM users WHERE id = $1`,
    [userId]
  );
  const userEmail = (userRows[0]?.email ?? "").toLowerCase();

  // Find legacy gmail rows that are missing either signal. raw_json is
  // already encrypted JSON; we decrypt + parse per row.
  const { rows } = await db.query<{
    id: string;
    raw_json: string;
  }>(
    `SELECT id, raw_json
       FROM raw_events
      WHERE user_id = $1
        AND source = 'gmail'
        AND (thread_ref IS NULL OR (is_from_user = false AND raw_json IS NOT NULL))
      LIMIT $2`,
    [userId, BATCH_SIZE]
  );

  let updatedThread = 0;
  let updatedIsFromUser = 0;
  let parseFailed = 0;

  for (const row of rows) {
    const raw = decrypt(row.raw_json);
    if (!raw) {
      parseFailed++;
      continue;
    }
    let msg: { threadId?: string; payload?: { headers?: { name?: string; value?: string }[] } };
    try {
      msg = JSON.parse(raw);
    } catch {
      parseFailed++;
      continue;
    }

    const threadId = typeof msg.threadId === "string" ? msg.threadId : null;
    const fromAddr =
      msg.payload?.headers?.find((h) => h.name?.toLowerCase() === "from")?.value ?? "";
    const isFromUser =
      userEmail.length > 0 && fromAddr.toLowerCase().includes(userEmail);

    const updates: string[] = [];
    const params: unknown[] = [];
    if (threadId) {
      params.push(threadId);
      updates.push(`thread_ref = COALESCE(thread_ref, $${params.length})`);
    }
    params.push(isFromUser);
    updates.push(`is_from_user = $${params.length}`);
    params.push(row.id);

    const res = await db.query(
      `UPDATE raw_events SET ${updates.join(", ")} WHERE id = $${params.length}`,
      params
    );
    if (res.rowCount && threadId) updatedThread++;
    if (res.rowCount) updatedIsFromUser++;
  }

  // Tell the caller whether more rows remain so they can hit the endpoint again.
  const { rows: remaining } = await db.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt
       FROM raw_events
      WHERE user_id = $1
        AND source = 'gmail'
        AND thread_ref IS NULL`,
    [userId]
  );

  return NextResponse.json({
    processed: rows.length,
    updatedThreadRef: updatedThread,
    updatedIsFromUser,
    parseFailed,
    remainingNullThreadRef: Number(remaining[0]?.cnt ?? "0"),
  });
}
