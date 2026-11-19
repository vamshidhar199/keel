import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { hasSalesforceConnected } from "@/lib/salesforce";
import { enqueue } from "@/lib/queue/enqueue";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const connected = await hasSalesforceConnected(session.user.id);
  if (!connected) {
    return NextResponse.json({ error: "Salesforce not connected" }, { status: 400 });
  }

  await enqueue({ type: "sync_salesforce", userId: session.user.id });
  return NextResponse.json({ queued: true });
}
