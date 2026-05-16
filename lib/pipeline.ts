import { getMetaDb, withUser } from "./db";
import { extractEmail } from "./extract";
import { findExistingPage, composePage, getKnownEntities } from "./compose";
import { putPage } from "./gbrain";
import { decrypt } from "./crypto";

interface RawEventRow {
  id: string;
  subject: string;
  from_addr: string;
  date_sent: Date | null;
  body_text: string;
}

export interface PipelineResult {
  eventId: string;
  status: "skipped" | "extracted" | "failed";
  pagesWritten: string[];
  error?: string;
}

export async function processRawEvent(
  userId: string,
  eventId: string
): Promise<PipelineResult> {
  const db = getMetaDb();

  const { rows } = await db.query<RawEventRow>(
    `SELECT id, subject, from_addr, date_sent, body_text
     FROM raw_events WHERE id = $1 AND user_id = $2`,
    [eventId, userId]
  );
  if (!rows[0]) throw new Error(`raw_event ${eventId} not found`);
  const event = rows[0];
  const subject = decrypt(event.subject) ?? "";
  const fromAddr = decrypt(event.from_addr) ?? "";
  const bodyText = decrypt(event.body_text) ?? "";

  // Mark as in-progress to prevent double-processing.
  await db.query(
    `UPDATE raw_events SET extraction_status = 'processing' WHERE id = $1`,
    [eventId]
  );

  try {
    // Fetch known entities once — used by both Haiku (slug reuse) and Sonnet (wikilinks).
    const knownEntities = await getKnownEntities(userId);

    // Step 1 — Haiku extraction.
    const extraction = await extractEmail(
      userId,
      {
        id: event.id,
        subject,
        from_addr: fromAddr,
        date_sent: event.date_sent?.toISOString() ?? null,
        body_text: bodyText,
      },
      knownEntities
    );

    if (!extraction.worthExtracting || extraction.entities.length === 0) {
      await db.query(
        `UPDATE raw_events SET extraction_status = 'skipped', extracted_at = now() WHERE id = $1`,
        [eventId]
      );
      return { eventId, status: "skipped", pagesWritten: [] };
    }

    const pagesWritten: string[] = [];

    // Step 2+3+4 — for each entity: resolve → compose → put.
    for (const entity of extraction.entities) {
      const existing = await findExistingPage(userId, entity.slug, entity.name);
      const resolvedSlug = existing?.slug ?? entity.slug;

      const { slug, content } = await composePage(
        userId,
        { ...entity, resolvedSlug },
        {
          eventId: event.id,
          subject,
          fromAddr,
          dateSent: event.date_sent?.toISOString() ?? null,
        },
        existing?.content ?? null,
        knownEntities
      );

      const kind =
        typeof entity.attributes?.kind === "string"
          ? (entity.attributes.kind as string)
          : undefined;
      await putPage(userId, slug, content, { kind, rawEventId: event.id });
      pagesWritten.push(slug);
    }

    // Step 5 — surface extracted commitments. Reuse the Haiku result already in
    // memory; no extra LLM call. Attribute to the first entity as a best guess.
    if (extraction.commitments.length > 0) {
      const attributedSlug = extraction.entities[0]?.slug ?? null;
      await withUser(userId, async (c) => {
        for (const text of extraction.commitments) {
          await c.query(
            `INSERT INTO commitments (user_id, raw_event_id, text, entity_slug)
             VALUES ($1, $2, $3, $4)`,
            [userId, eventId, text, attributedSlug]
          );
        }
      });
    }

    await db.query(
      `UPDATE raw_events SET extraction_status = 'extracted', extracted_at = now() WHERE id = $1`,
      [eventId]
    );

    return { eventId, status: "extracted", pagesWritten };
  } catch (err: any) {
    // err.message only — full err can echo prompt content from LLM SDKs
    console.error(`[pipeline] event=${eventId} FAILED:`, String(err?.message ?? err).slice(0, 200));
    await db.query(
      `UPDATE raw_events SET extraction_status = 'failed', extracted_at = now() WHERE id = $1`,
      [eventId]
    );
    return { eventId, status: "failed", pagesWritten: [], error: String(err?.message) };
  }
}

export interface ExtractionStatus {
  pending: number;
  processing: number;
  extracted: number;
  skipped: number;
  failed: number;
  total: number;
  pagesCreated: number;
}

export async function getExtractionStatus(userId: string): Promise<ExtractionStatus> {
  const db = getMetaDb();
  const [countsRes, pagesRes] = await Promise.all([
    db.query<{ extraction_status: string; cnt: string }>(
      `SELECT extraction_status, COUNT(*) AS cnt
       FROM raw_events WHERE user_id = $1
       GROUP BY extraction_status`,
      [userId]
    ),
    withUser(userId, async (c) => {
      const r = await c.query<{ cnt: string }>("SELECT COUNT(*) AS cnt FROM pages");
      return r.rows[0]?.cnt ?? "0";
    }).catch(() => "0"),
  ]);

  const counts: Record<string, number> = {};
  for (const row of countsRes.rows) {
    counts[row.extraction_status] = parseInt(row.cnt, 10);
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return {
    pending: counts["pending"] ?? 0,
    processing: counts["processing"] ?? 0,
    extracted: counts["extracted"] ?? 0,
    skipped: counts["skipped"] ?? 0,
    failed: counts["failed"] ?? 0,
    total,
    pagesCreated: parseInt(pagesRes as string, 10),
  };
}
