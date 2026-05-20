import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { enqueue } from "@/lib/queue/enqueue";
import { hasGmailScope } from "@/lib/gmail";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const gmailConnected = await hasGmailScope(userId);
  if (!gmailConnected) {
    return NextResponse.json({ error: "Gmail not connected" }, { status: 400 });
  }

  await enqueue({ type: "sync_gmail", userId });

  return NextResponse.json({ queued: true });
}
