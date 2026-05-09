import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { provisionGbrainDb } from "@/lib/gbrain";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  try {
    await provisionGbrainDb(session.user.id);
    return NextResponse.json({ ok: true, userId: session.user.id });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
