# File Uploads as a Source

> Users drop in arbitrary documents (PDF, Word, Excel, CSV, TXT, MD) and Keel extracts entities + commitments + pages just like it would from an email.
> Status: shipped.

---

## Why

Gmail + Slack cover ongoing comms but miss everything else:
- Resumes, contracts, design docs, meeting notes
- Spreadsheets of contacts / deal trackers
- Reading material in PDFs
- Anything emailed AROUND Keel ("forward this to my Keel")

The pragmatic answer: let users drop files in directly. Make them land in the same extraction pipeline as emails so all downstream features (pages, brief, /ask, workflows, recipes) Just Work without per-source branching.

---

## Architecture in one sentence

A file upload becomes a `raw_events` row with `source='file'`, and the existing extraction pipeline takes it from there.

---

## Supported formats

| Format | Library | Notes |
|---|---|---|
| PDF | `pdf-parse` | Selectable text only. Scanned/image PDFs need OCR (deferred). |
| Word `.docx`, `.doc` | `mammoth` | Plain-text extraction. |
| Excel `.xlsx`, `.xls` | `xlsx` (SheetJS) | Each sheet flattened to pipe-delimited rows. |
| CSV / TSV | `csv-parse/sync` | Header + data rows flattened similarly. |
| Plain text | native | UTF-8 decode. |
| Markdown | native | UTF-8 decode. |

Dispatcher lives in `lib/file-parsers/index.ts:parseFile(mime, bytes)`. Each format has its own file. Heavy native libs are dynamically `import()`'d so they don't load unless that file type is actually uploaded.

**Mime fallback:** browsers sometimes send `application/octet-stream` for files dragged from the file manager. `resolveMime(rawMime, filename)` falls back to the extension when the mime is generic.

---

## Data model

```sql
CREATE TABLE files (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  filename TEXT NOT NULL,           -- plaintext (need for UI)
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  raw_bytes BYTEA,                  -- encrypted (base64 → ciphertext)
  parse_status TEXT DEFAULT 'pending',  -- pending | parsing | parsed | failed
  parse_error TEXT,
  raw_event_id UUID REFERENCES raw_events(id) ON DELETE SET NULL,
  uploaded_at TIMESTAMPTZ
);
ALTER TABLE files ENABLE ROW LEVEL SECURITY;
ALTER TABLE files FORCE ROW LEVEL SECURITY;
```

- `raw_bytes` encrypted at rest. Stored in BYTEA after base64 round-trip through the standard `lib/crypto.ts:encrypt` (which is string-oriented).
- `filename` plaintext — needed for the list view.
- `raw_event_id` is the link back into the standard extraction pipeline (see below).

---

## Upload flow

`POST /api/files/upload` (multipart). Sequence in `lib/files.ts:uploadFile`:

1. **Validate** — size cap 20MB, mime in supported list (with extension fallback).
2. **INSERT files row** with `parse_status='parsing'` and encrypted `raw_bytes`.
3. **Parse out-of-tx** — `parseFile(mime, bytes)` returns plain text. On failure → mark `parse_status='failed'` with `parse_error` populated, return early.
4. **Create raw_events row**:
   ```sql
   INSERT INTO raw_events (user_id, source, source_ref, subject, from_addr, body_text, date_sent, extraction_status)
   VALUES ($1, 'file', $file_id, encrypt('File: <name>'), encrypt('(upload)'), encrypt($text), now(), 'pending');
   ```
   Body text capped at 200 KB to keep extraction tokens bounded.
5. **Link back** — `UPDATE files SET parse_status='parsed', raw_event_id=...`
6. **Enqueue extraction** — `enqueue({ type: 'extract_emails', userId, limit: 1 })`. The `enqueue()` self-trigger fires a `/api/queue/drain` immediately.

From the user's perspective: drag → drop → "Parsing…" → "Extracted" (or "Failed" with hover-to-see error) → pages appear in `/overview` on the next refresh.

---

## Why we reuse the email pipeline

The extraction prompt was designed for emails, but file uploads fit naturally:
- `subject` field carries the filename (`"File: contract.pdf"`)
- `from_addr` is `"(upload)"`
- `body_text` is the parsed text content
- `date_sent` is the upload time

The extractor reads this shape and produces entities + commitments the same way. Pages get created. `page_sources` links file-derived raw_events to the resulting pages. Everything downstream — brief generation, `/ask` synthesis, workflow filtering, recipe matching — sees the file content as just more knowledge in the graph.

No per-source branching in the extraction layer.

---

## Deletion flow (subtle deadlock story)

`deleteFile(userId, id)` had to be split into two phases to avoid a deadlock:

```ts
// 1. Inside withUser — grab the linked raw_event_id, delete the file row.
const evId = await withUser(userId, async (c) => {
  const r = await c.query('SELECT raw_event_id FROM files WHERE id = $1', [id]);
  const captured = r.rows[0]?.raw_event_id ?? null;
  await c.query('DELETE FROM files WHERE id = $1', [id]);
  return captured;
});

// 2. Outside the transaction — delete the raw_event on the main pool.
if (evId) {
  await getMetaDb().query('DELETE FROM raw_events WHERE id = $1 AND user_id = $2', [evId, userId]);
}
```

**Why two phases:** `files.raw_event_id REFERENCES raw_events(id) ON DELETE SET NULL`. If we tried to delete the raw_event inside the same `withUser` transaction, Postgres would need to update `files.raw_event_id` via the FK cascade — but the file row is locked by the very transaction that's trying to complete. Deadlock.

**Lesson:** any FK cascade that touches a row your transaction has open lock on must run outside that transaction. Discovered the hard way during integration tests that hung at 30s timeouts.

Side effect of deletion: extracted pages stay (their `page_sources` rows just orphan). User can clean those up via `/pages` if they want.

---

## UI

`<FilesPanel />` is the third card on `/sources` alongside `GmailPanel` and `SlackPanel`. Contains:
- Drag-and-drop zone (also click-to-browse via hidden file input)
- List of uploaded files with: filename, size, uploaded-at, status pill (Pending / Parsing / Extracted / Failed), delete button on hover
- Error messages inline below the file row when `parse_status='failed'`

The Extraction analytics panel above counts files alongside emails because they share `raw_events`. So "Pending: 12" includes files in flight.

---

## Failure modes

| Symptom | Cause |
|---|---|
| `Unsupported file type: image/png` | User tried to upload a format we don't parse. Add to `isSupportedMime` + handler if needed. |
| `File too large (max 20MB)` | Self-explanatory. Cap is in `lib/files.ts:MAX_BYTES`. |
| `Parsed file is empty` | PDF was probably scanned image; mammoth/xlsx couldn't pull text. Stays at `parse_status='failed'` with this in `parse_error`. |
| Pages didn't appear | Extraction itself may have skipped (`worth_extracting = false`) or failed. Check `raw_events.extraction_status` for the linked `raw_event_id`. |

---

## Tests

`lib/__tests__/files.test.ts` covers:
- `resolveMime` fallback by extension
- `isSupportedMime` allow-list
- `parseFile` dispatch — text/plain decode, CSV pipe-delimit, unsupported-mime rejection
- Files lifecycle (list, get, delete) — seeded via direct SQL to avoid running the full parser pipeline (which would need real PDF/DOCX bytes)
- Note: full E2E parser tests would require fixture files; not added in v1.

RLS isolation tests confirm cross-user `files` reads/writes blocked.

---

## Deferred

- **OCR for scanned PDFs / images.** Selectable text only in v1.
- **File chunking for >20 MB documents.** v1 caps at 20 MB and stores extracted text in one `raw_events.body_text`. Larger files would need multi-row chunking.
- **Re-extract on demand** (using stored `raw_bytes`). The infrastructure is there — bytes are stored, encryption key is available — but no UI action surfaces it yet.
- **Direct file viewer** in the page drawer. Today, opening a file-derived page in the drawer shows the extracted page content; you can't see the original file.

---

## Files

| Path | Role |
|---|---|
| `lib/file-parsers/index.ts` | Mime dispatch, `parseFile`, `resolveMime`, `isSupportedMime` |
| `lib/file-parsers/{pdf,docx,xlsx,csv,text}.ts` | One file per format |
| `lib/files.ts` | `uploadFile`, `listFiles`, `getFile`, `deleteFile` |
| `app/api/files/upload/route.ts` | POST handler (multipart) |
| `app/api/files/route.ts` + `[id]/route.ts` | GET list, DELETE |
| `app/files-panel.tsx` | Drag-drop UI |
| `app/(app)/sources/page.tsx` | Mounts `<FilesPanel />` |
| `lib/migrate.ts:SCHEMA_FILES` | Table definition |
