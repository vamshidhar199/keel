import { NextResponse } from "next/server";

// Per-user DB provisioning was removed in the shared-DB + RLS migration.
// Users are ready to write pages as soon as they sign in.
export async function POST() {
  return NextResponse.json({ ok: true, message: "No provisioning needed — shared DB with RLS." });
}
