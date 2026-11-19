import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { updateSyncInterval } from "@/lib/sync";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const hours = Number(body.syncIntervalHours);
  if (!hours || hours < 1) {
    return NextResponse.json({ error: "Invalid syncIntervalHours" }, { status: 400 });
  }

  await updateSyncInterval(session.user.id, "salesforce", hours);
  return NextResponse.json({ ok: true });
}
