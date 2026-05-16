import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getMetaDb } from "@/lib/db";

export interface UserPreferences {
  digest_enabled: boolean;
  digest_hour_local: number;
  show_commitments: boolean;
  show_awaiting_reply: boolean;
  show_active_threads: boolean;
  show_quiet_but_important: boolean;
  show_opportunities: boolean;
  ai_memories: string;
}

const DEFAULTS: UserPreferences = {
  digest_enabled: true,
  digest_hour_local: 8,
  show_commitments: true,
  show_awaiting_reply: true,
  show_active_threads: true,
  show_quiet_but_important: true,
  show_opportunities: true,
  ai_memories: "",
};

const MAX_MEMORIES_LEN = 4000;

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getMetaDb();
  const { rows } = await db.query<UserPreferences>(
    `SELECT digest_enabled, digest_hour_local,
            show_commitments, show_awaiting_reply,
            show_active_threads, show_quiet_but_important,
            show_opportunities, ai_memories
     FROM user_preferences WHERE user_id = $1`,
    [session.user.id]
  );

  return NextResponse.json(rows[0] ?? DEFAULTS);
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));

  const hour = Number(body.digest_hour_local);
  if (body.digest_hour_local !== undefined && (!Number.isInteger(hour) || hour < 0 || hour > 23)) {
    return NextResponse.json(
      { error: "digest_hour_local must be 0-23" },
      { status: 400 }
    );
  }

  const aiMemories =
    typeof body.ai_memories === "string"
      ? body.ai_memories.slice(0, MAX_MEMORIES_LEN)
      : null;

  const db = getMetaDb();
  await db.query(
    `INSERT INTO user_preferences
       (user_id, digest_enabled, digest_hour_local,
        show_commitments, show_awaiting_reply,
        show_active_threads, show_quiet_but_important,
        show_opportunities, ai_memories, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, ''), now())
     ON CONFLICT (user_id) DO UPDATE SET
       digest_enabled            = COALESCE($2, user_preferences.digest_enabled),
       digest_hour_local         = COALESCE($3, user_preferences.digest_hour_local),
       show_commitments          = COALESCE($4, user_preferences.show_commitments),
       show_awaiting_reply       = COALESCE($5, user_preferences.show_awaiting_reply),
       show_active_threads       = COALESCE($6, user_preferences.show_active_threads),
       show_quiet_but_important  = COALESCE($7, user_preferences.show_quiet_but_important),
       show_opportunities        = COALESCE($8, user_preferences.show_opportunities),
       ai_memories               = COALESCE($9, user_preferences.ai_memories),
       updated_at                = now()`,
    [
      session.user.id,
      typeof body.digest_enabled === "boolean" ? body.digest_enabled : null,
      Number.isInteger(hour) ? hour : null,
      typeof body.show_commitments === "boolean" ? body.show_commitments : null,
      typeof body.show_awaiting_reply === "boolean" ? body.show_awaiting_reply : null,
      typeof body.show_active_threads === "boolean" ? body.show_active_threads : null,
      typeof body.show_quiet_but_important === "boolean" ? body.show_quiet_but_important : null,
      typeof body.show_opportunities === "boolean" ? body.show_opportunities : null,
      aiMemories,
    ]
  );

  return NextResponse.json({ ok: true });
}
