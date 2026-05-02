import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getGmailStatus, updateSyncInterval } from "@/lib/sync";

const VALID_INTERVALS = [1, 6, 12, 24];

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const status = await getGmailStatus(session.user.id);
  return NextResponse.json({ syncIntervalHours: status.syncIntervalHours });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const hours = Number(body.syncIntervalHours);
  if (!VALID_INTERVALS.includes(hours)) {
    return NextResponse.json(
      { error: "syncIntervalHours must be one of: 1, 6, 12, 24" },
      { status: 400 }
    );
  }

  await updateSyncInterval(session.user.id, "gmail", hours);
  return NextResponse.json({ syncIntervalHours: hours });
}
