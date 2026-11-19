import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { hasSalesforceConnected } from "@/lib/salesforce";
import { getSalesforceStatus } from "@/lib/sync";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const connected = await hasSalesforceConnected(session.user.id);
  if (!connected) {
    return NextResponse.json({ connected: false });
  }

  const status = await getSalesforceStatus(session.user.id);
  return NextResponse.json(status);
}
