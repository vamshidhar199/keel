import { getMetaDb, withUser } from "./db";
import { encrypt } from "./crypto";
import { parseFile, resolveMime, isSupportedMime } from "./file-parsers";
import { enqueue } from "./queue/enqueue";

export interface FileRecord {
  id: string;
  filename: string;
  mime_type: string;
  byte_size: number;
  parse_status: "pending" | "parsing" | "parsed" | "failed";
  parse_error: string | null;
  raw_event_id: string | null;
  uploaded_at: string;
}

interface FileRow {
  id: string;
  filename: string;
  mime_type: string;
  byte_size: number;
  parse_status: string;
  parse_error: string | null;
  raw_event_id: string | null;
  uploaded_at: Date;
}

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB hard cap

function toRecord(r: FileRow): FileRecord {
  return {
    id: r.id,
    filename: r.filename,
    mime_type: r.mime_type,
    byte_size: r.byte_size,
    parse_status: r.parse_status as FileRecord["parse_status"],
    parse_error: r.parse_error,
    raw_event_id: r.raw_event_id,
    uploaded_at: r.uploaded_at.toISOString(),
  };
}

// Persist a freshly uploaded file: store encrypted raw_bytes, run the parser,
// and (on success) drop a raw_events row that the standard extraction pipeline
// will pick up via the next extract_emails drain.
export async function uploadFile(
  userId: string,
  input: { filename: string; mime: string; bytes: Buffer }
): Promise<FileRecord> {
  const filename = input.filename.trim().slice(0, 240) || "untitled";
  const resolvedMime = resolveMime(input.mime, filename);
  if (!isSupportedMime(resolvedMime)) {
    throw new Error(`Unsupported file type: ${resolvedMime}`);
  }
  if (input.bytes.byteLength > MAX_BYTES) {
    throw new Error(`File too large (max 20MB): ${input.bytes.byteLength} bytes`);
  }

  // Step 1: INSERT files row, status=pending, with encrypted raw_bytes.
  const file = await withUser(userId, async (c) => {
    const r = await c.query<FileRow>(
      `INSERT INTO files (user_id, filename, mime_type, byte_size, raw_bytes, parse_status)
       VALUES ($1, $2, $3, $4, $5, 'parsing')
       RETURNING id, filename, mime_type, byte_size, parse_status, parse_error,
                 raw_event_id, uploaded_at`,
      [userId, filename, resolvedMime, input.bytes.byteLength, encryptBytes(input.bytes), "parsing"]
    );
    return r.rows[0];
  });

  // Step 2: parse out-of-transaction (parsing can be slow).
  let text: string;
  try {
    text = await parseFile(resolvedMime, input.bytes);
  } catch (err) {
    const msg = String((err as Error)?.message ?? err).slice(0, 400);
    console.error("[files] parse failed:", msg);
    await withUser(userId, async (c) => {
      await c.query(
        `UPDATE files SET parse_status = 'failed', parse_error = $1 WHERE id = $2`,
        [msg, file.id]
      );
    });
    return { ...toRecord(file), parse_status: "failed", parse_error: msg };
  }

  if (!text.trim()) {
    const msg = "Parsed file is empty.";
    await withUser(userId, async (c) => {
      await c.query(
        `UPDATE files SET parse_status = 'failed', parse_error = $1 WHERE id = $2`,
        [msg, file.id]
      );
    });
    return { ...toRecord(file), parse_status: "failed", parse_error: msg };
  }

  // Step 3: create a raw_events row from the parsed text. raw_events is NOT
  // RLS-protected (filtered by user_id at the app layer), so write via meta pool.
  const db = getMetaDb();
  const eventRes = await db.query<{ id: string }>(
    `INSERT INTO raw_events
       (user_id, source, source_ref, subject, from_addr, body_text, date_sent, extraction_status)
     VALUES ($1, 'file', $2, $3, $4, $5, now(), 'pending')
     ON CONFLICT (user_id, source, source_ref) DO UPDATE
       SET body_text = EXCLUDED.body_text,
           extraction_status = 'pending',
           extracted_at = NULL
     RETURNING id`,
    [
      userId,
      file.id,
      encrypt(`File: ${filename}`),
      encrypt("(upload)"),
      encrypt(text.slice(0, 200_000)), // 200KB cap on the body to keep extraction tokens bounded
    ]
  );
  const rawEventId = eventRes.rows[0].id;

  // Step 4: mark file parsed + link to raw_event.
  const updated = await withUser(userId, async (c) => {
    const r = await c.query<FileRow>(
      `UPDATE files SET parse_status = 'parsed', raw_event_id = $1
        WHERE id = $2
        RETURNING id, filename, mime_type, byte_size, parse_status, parse_error,
                  raw_event_id, uploaded_at`,
      [rawEventId, file.id]
    );
    return r.rows[0];
  });

  // Step 5: enqueue extraction. Self-trigger inside enqueue() drains it.
  await enqueue({ type: "extract_emails", userId, limit: 1 });

  return toRecord(updated);
}

function encryptBytes(bytes: Buffer): Buffer {
  // Reuse the string encryption path by base64-wrapping. Postgres stores BYTEA
  // either way; we want the at-rest property without inventing a parallel
  // binary-encryption helper.
  const enc = encrypt(bytes.toString("base64"));
  return Buffer.from(enc, "utf-8");
}

export async function listFiles(userId: string, limit = 50): Promise<FileRecord[]> {
  return withUser(userId, async (c) => {
    const r = await c.query<FileRow>(
      `SELECT id, filename, mime_type, byte_size, parse_status, parse_error,
              raw_event_id, uploaded_at
         FROM files
        ORDER BY uploaded_at DESC
        LIMIT $1`,
      [limit]
    );
    return r.rows.map(toRecord);
  });
}

export async function getFile(userId: string, id: string): Promise<FileRecord | null> {
  return withUser(userId, async (c) => {
    const r = await c.query<FileRow>(
      `SELECT id, filename, mime_type, byte_size, parse_status, parse_error,
              raw_event_id, uploaded_at
         FROM files WHERE id = $1 LIMIT 1`,
      [id]
    );
    return r.rows[0] ? toRecord(r.rows[0]) : null;
  });
}

export async function deleteFile(userId: string, id: string): Promise<void> {
  // Two-phase: (1) lookup + delete files row inside withUser, (2) delete the
  // linked raw_event afterwards on the main pool. Doing the raw_events delete
  // inside the same transaction would deadlock — raw_events DELETE cascades
  // via ON DELETE SET NULL to files.raw_event_id, which is locked by the
  // outer transaction that's still open waiting for the callback to return.
  const evId = await withUser(userId, async (c) => {
    const r = await c.query<{ raw_event_id: string | null }>(
      `SELECT raw_event_id FROM files WHERE id = $1`,
      [id]
    );
    const captured = r.rows[0]?.raw_event_id ?? null;
    await c.query(`DELETE FROM files WHERE id = $1`, [id]);
    return captured;
  });
  if (evId) {
    const db = getMetaDb();
    await db.query(`DELETE FROM raw_events WHERE id = $1 AND user_id = $2`, [evId, userId]);
  }
}
