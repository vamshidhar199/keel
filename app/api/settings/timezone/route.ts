import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getMetaDb } from "@/lib/db";

// Loose IANA timezone format check. Real validation happens at PG via the
// AT TIME ZONE expression — invalid tz raises and we return the prior value.
const TZ_RE = /^[A-Za-z][A-Za-z0-9_+\-/]{1,63}$/;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const tz = typeof body.tz === "string" ? body.tz.trim() : "";
  if (!tz || !TZ_RE.test(tz)) {
    return NextResponse.json({ error: "invalid tz" }, { status: 400 });
  }

  const db = getMetaDb();
  try {
    await db.query(`UPDATE users SET timezone = $1 WHERE id = $2`, [tz, session.user.id]);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "tz rejected" }, { status: 400 });
  }
}
