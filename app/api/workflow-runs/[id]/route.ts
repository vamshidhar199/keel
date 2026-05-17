import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { withUser } from "@/lib/db";

export interface RunDrawerSource {
  ref: string;
  kind: "thread" | "page" | "commitment" | "other";
  label: string;
}

export interface RunDrawerPayload {
  run_id: string;
  workflow_id: string;
  workflow_name: string;
  status: "success" | "failed" | "no_data";
  ran_at: string;
  output_text: string | null;
  error: string | null;
  source_refs: RunDrawerSource[];
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const payload = await withUser(session.user.id, async (c) => {
    const r = await c.query<{
      run_id: string;
      workflow_id: string;
      workflow_name: string;
      status: string;
      ran_at: Date;
      output_text: string | null;
      error: string | null;
      source_refs: RunDrawerSource[];
    }>(
      `SELECT wr.id AS run_id, wr.workflow_id, w.name AS workflow_name,
              wr.status, wr.ran_at, wr.output_text, wr.error, wr.source_refs
         FROM workflow_runs wr
         JOIN workflows w ON w.id = wr.workflow_id
        WHERE wr.id = $1
        LIMIT 1`,
      [id]
    );
    const row = r.rows[0];
    if (!row) return null;
    const out: RunDrawerPayload = {
      run_id: row.run_id,
      workflow_id: row.workflow_id,
      workflow_name: row.workflow_name,
      status: row.status as RunDrawerPayload["status"],
      ran_at: row.ran_at.toISOString(),
      output_text: row.output_text,
      error: row.error,
      source_refs: row.source_refs ?? [],
    };
    return out;
  });

  if (!payload) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json(payload);
}
