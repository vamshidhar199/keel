import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getMetaDb } from "@/lib/db";
import { encrypt, decrypt } from "@/lib/crypto";

function maskKey(key: string | null): string | null {
  if (!key) return null;
  return key.slice(0, 8) + "••••••••••••••••";
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getMetaDb();
  const { rows } = await db.query(
    "SELECT anthropic_api_key, openai_api_key FROM user_api_keys WHERE user_id = $1",
    [session.user.id]
  );

  const row = rows[0];
  return NextResponse.json({
    anthropicKey: maskKey(decrypt(row?.anthropic_api_key ?? null)),
    openaiKey: maskKey(decrypt(row?.openai_api_key ?? null)),
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const anthropicKey = typeof body.anthropicKey === "string" ? body.anthropicKey.trim() : undefined;
  const openaiKey = typeof body.openaiKey === "string" ? body.openaiKey.trim() : undefined;

  const db = getMetaDb();
  // encrypt() returns "" for empty input, so the NULLIF($n, '') check still
  // distinguishes "user didn't submit this field" from a real value.
  await db.query(
    `INSERT INTO user_api_keys (user_id, anthropic_api_key, openai_api_key, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (user_id) DO UPDATE SET
       anthropic_api_key = COALESCE(NULLIF($2, ''), user_api_keys.anthropic_api_key),
       openai_api_key    = COALESCE(NULLIF($3, ''), user_api_keys.openai_api_key),
       updated_at        = now()`,
    [session.user.id, encrypt(anthropicKey ?? ""), encrypt(openaiKey ?? "")]
  );

  return NextResponse.json({ ok: true });
}
