import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getMetaDb } from "@/lib/db";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getMetaDb();
  await db.query(`UPDATE users SET last_seen_at = now() WHERE id = $1`, [
    session.user.id,
  ]);
  return NextResponse.json({ ok: true });
}
