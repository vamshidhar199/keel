import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getMetaDb, withUser } from "@/lib/db";
import { setCommitmentStatus } from "@/lib/commitments";
import { decrypt } from "@/lib/crypto";
import { gmailThreadUrl } from "@/lib/gmail-url";

export interface CommitmentSourceEmail {
  from_addr: string;
  subject: string;
  date_sent: string | null;
  snippet: string;
  thread_ref: string | null;
  // Pre-built Gmail URL pinned to the logged-in user's address. Lets the
  // client open the thread without knowing the user's email, and ensures we
  // route to the right Google account when multiple are signed in.
  gmail_url: string | null;
}

export interface CommitmentDrawerPayload {
  id: string;
  text: string;
  status: "open" | "done" | "dismissed";
  created_at: string;
  resolved_at: string | null;
  entitySlugs: string[];
  source_email: CommitmentSourceEmail | null;
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
  const userId = session.user.id;

  // Commitment + aggregated entity slugs come from the per-user tenant DB
  // (RLS-scoped via withUser). raw_events lives in the meta DB and is
  // queried separately by id once we know the commitment is the user's.
  const row = await withUser(userId, async (c) => {
    const { rows } = await c.query<{
      id: string;
      text: string;
      status: string;
      created_at: Date;
      resolved_at: Date | null;
      raw_event_id: string | null;
      entity_slugs: string[] | null;
    }>(
      `SELECT c.id, c.text, c.status, c.created_at, c.resolved_at, c.raw_event_id,
              COALESCE(
                array_agg(ce.entity_slug ORDER BY ce.entity_slug)
                  FILTER (WHERE ce.entity_slug IS NOT NULL),
                ARRAY[]::text[]
              ) AS entity_slugs
         FROM commitments c
         LEFT JOIN commitment_entities ce ON ce.commitment_id = c.id
        WHERE c.id = $1
        GROUP BY c.id`,
      [id]
    );
    return rows[0] ?? null;
  });

  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let sourceEmail: CommitmentSourceEmail | null = null;
  if (row.raw_event_id) {
    const db = getMetaDb();
    const { rows: evRows } = await db.query<{
      from_addr: string | null;
      subject: string | null;
      body_text: string | null;
      date_sent: Date | null;
      thread_ref: string | null;
    }>(
      `SELECT from_addr, subject, body_text, date_sent, thread_ref
         FROM raw_events
        WHERE id = $1 AND user_id = $2`,
      [row.raw_event_id, userId]
    );
    const ev = evRows[0];
    if (ev) {
      const bodyText = decrypt(ev.body_text) ?? "";
      sourceEmail = {
        from_addr: decrypt(ev.from_addr) ?? "",
        subject: decrypt(ev.subject) ?? "",
        date_sent: ev.date_sent?.toISOString() ?? null,
        snippet: bodyText.slice(0, 400).replace(/\s+/g, " ").trim(),
        thread_ref: ev.thread_ref,
        gmail_url: gmailThreadUrl(session.user.email, ev.thread_ref),
      };
    }
  }

  const payload: CommitmentDrawerPayload = {
    id: row.id,
    text: row.text,
    status: row.status as "open" | "done" | "dismissed",
    created_at: row.created_at.toISOString(),
    resolved_at: row.resolved_at?.toISOString() ?? null,
    entitySlugs: row.entity_slugs ?? [],
    source_email: sourceEmail,
  };
  return NextResponse.json(payload);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const status = body.status;
  if (status !== "done" && status !== "dismissed") {
    return NextResponse.json(
      { error: "status must be 'done' or 'dismissed'" },
      { status: 400 }
    );
  }

  try {
    await setCommitmentStatus(session.user.id, id, status);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Update failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
