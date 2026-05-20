import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { withUser } from "@/lib/db";

// Idempotent thumbs feedback. signal=1 (up), -1 (down), or 0 to clear.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const digestId = typeof body.digestId === "string" ? body.digestId : null;
  const section = typeof body.section === "string" ? body.section : null;
  const itemRef = typeof body.itemRef === "string" ? body.itemRef : null;
  const signalRaw = Number(body.signal);
  if (!digestId || !section || !itemRef) {
    return NextResponse.json(
      { error: "digestId, section, and itemRef are required" },
      { status: 400 }
    );
  }
  if (signalRaw !== 1 && signalRaw !== -1 && signalRaw !== 0) {
    return NextResponse.json(
      { error: "signal must be 1, -1, or 0" },
      { status: 400 }
    );
  }

  try {
    await withUser(session.user.id, async (c) => {
      if (signalRaw === 0) {
        await c.query(
          `DELETE FROM digest_feedback
            WHERE digest_id = $1 AND section = $2 AND item_ref = $3`,
          [digestId, section, itemRef]
        );
        return;
      }
      await c.query(
        `INSERT INTO digest_feedback (user_id, digest_id, section, item_ref, signal)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id, digest_id, section, item_ref) DO UPDATE
           SET signal = EXCLUDED.signal, created_at = now()`,
        [session.user!.id, digestId, section, itemRef, signalRaw]
      );
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(
      "[feedback] failed:",
      String((err as Error)?.message ?? err).slice(0, 200)
    );
    return NextResponse.json({ error: "save failed" }, { status: 500 });
  }
}
