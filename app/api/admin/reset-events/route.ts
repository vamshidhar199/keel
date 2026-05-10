import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getMetaDb } from "@/lib/db";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const db = getMetaDb();
  const before = await db.query(
    `SELECT status, COUNT(*)::int AS cnt FROM raw_events
     WHERE user_id = $1 GROUP BY status`,
    [session.user.id]
  );

  const result = await db.query(
    `UPDATE raw_events SET status = 'pending'
     WHERE user_id = $1 AND status IN ('extracted', 'failed')`,
    [session.user.id]
  );

  return NextResponse.json({
    ok: true,
    before: before.rows,
    updatedRows: result.rowCount,
  });
}
