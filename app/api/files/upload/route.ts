import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { uploadFile } from "@/lib/files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Allow large request bodies (up to 25MB for the multipart envelope around a 20MB file).
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file field in body" }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  try {
    const record = await uploadFile(session.user.id, {
      filename: file.name,
      mime: file.type,
      bytes,
    });
    return NextResponse.json({ file: record });
  } catch (err) {
    const msg = String((err as Error)?.message ?? err).slice(0, 400);
    console.error("[files] upload failed:", msg);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
