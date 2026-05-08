import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getMetaDb } from "@/lib/db";

async function verifySlackSignature(req: NextRequest, body: string): Promise<boolean> {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret) return false;

  const timestamp = req.headers.get("x-slack-request-timestamp");
  const signature = req.headers.get("x-slack-signature");
  if (!timestamp || !signature) return false;

  // Reject requests older than 5 minutes
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  const expected = "v0=" + createHmac("sha256", secret)
    .update(`v0:${timestamp}:${body}`)
    .digest("hex");

  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const body = await req.text();

  const valid = await verifySlackSignature(req, body);
  if (!valid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const payload = JSON.parse(body);

  // Slack URL verification handshake
  if (payload.type === "url_verification") {
    return NextResponse.json({ challenge: payload.challenge });
  }

  if (payload.type === "event_callback") {
    const db = getMetaDb();
    const { event, team_id } = payload;

    if (event.type === "tokens_revoked") {
      const revokedUserIds: string[] = event.tokens?.oauth ?? [];
      if (revokedUserIds.length > 0) {
        await db.query(
          `DELETE FROM accounts
           WHERE provider = 'slack'
             AND "providerAccountId" = ANY($1)
             AND session_state = $2`,
          [revokedUserIds, team_id]
        );
      }
    }

    if (event.type === "app_uninstalled") {
      await db.query(
        `DELETE FROM accounts WHERE provider = 'slack' AND session_state = $1`,
        [team_id]
      );
    }
  }

  return NextResponse.json({ ok: true });
}
