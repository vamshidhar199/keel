import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { hasSlackConnected } from "@/lib/slack";
import { enqueue } from "@/lib/queue/enqueue";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const connected = await hasSlackConnected(session.user.id);
  if (!connected) {
    return NextResponse.json({ error: "Slack not connected" }, { status: 400 });
  }

  await enqueue({ type: "sync_slack", userId: session.user.id });
  return NextResponse.json({ queued: true });
}
