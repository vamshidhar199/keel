import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { hasSlackConnected } from "@/lib/slack";
import { getSlackStatus } from "@/lib/sync";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const connected = await hasSlackConnected(session.user.id);
  if (!connected) {
    return NextResponse.json({ connected: false });
  }

  const status = await getSlackStatus(session.user.id);
  return NextResponse.json(status);
}
