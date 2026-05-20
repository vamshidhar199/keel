import { NextRequest, NextResponse } from "next/server";
import { drain } from "@/lib/queue/drain";

export async function POST(req: NextRequest) {
  const secret = process.env.QUEUE_SECRET;
  if (secret && req.headers.get("x-queue-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await drain();
  return NextResponse.json(result);
}
