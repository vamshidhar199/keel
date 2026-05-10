import { NextRequest, NextResponse } from "next/server";
import { schedulerTick } from "@/lib/sync";

// Driven by Railway Cron (or any external scheduler) every 30 minutes.
// Replaces the in-process setInterval that died when Railway slept the container.
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await schedulerTick();
  return NextResponse.json({ ok: true });
}
