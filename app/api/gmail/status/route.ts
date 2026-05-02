import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { hasGmailScope } from "@/lib/gmail";
import { getGmailStatus } from "@/lib/sync";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const connected = await hasGmailScope(userId);
  if (!connected) {
    return NextResponse.json({ connected: false });
  }

  const status = await getGmailStatus(userId);
  return NextResponse.json(status);
}
