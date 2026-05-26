import Anthropic from "@anthropic-ai/sdk";
import { getMetaDb, withUser } from "./db";
import { extractEmail } from "./extract";
import { listOpenCommitments } from "./commitments";
import { findExistingPage, composePage, getKnownEntities, filterRelevantEntities } from "./compose";
import { putPage } from "./gbrain";
import { decrypt } from "./crypto";

// Cheap preflight to skip obvious bulk/transactional mail without paying for a
// Haiku call just to hear "worth_extracting=false". Conservative on purpose:
// requires BOTH an unsubscribe affordance AND promotional/transactional
// language, so recruiter pitches and personal mail with a footer
// unsubscribe link still go through the LLM.
//
// Diagnostics audit (May 2026): ~60% of one user's daily Haiku spend was
// classify-and-skip on bulk mail. This catches the densest slice of that
// pool without risking real signal.
const PROMO_SIGNALS_RE =
  /\b(% off|\$\d+ off|sale ends|free shipping|deal of the day|order #|order number|your order|your purchase|tracking number|receipt|invoice|newsletter|black friday|cyber monday|limited time offer)\b/i;

function isObviouslyBulk(
  subject: string,
  fromAddr: string,
  bodyText: string
): boolean {
  const lowBody = bodyText.toLowerCase();
  const hasUnsub =
    lowBody.includes("unsubscribe") || lowBody.includes("list-unsubscribe");
  if (!hasUnsub) return false;
  return PROMO_SIGNALS_RE.test(bodyText) || PROMO_SIGNALS_RE.test(subject);
}

// A 429 that survived the Anthropic SDK's 8 retries means the org TPM ceiling
// is saturated for longer than ~5-8 minutes. Don't kill the event — reset it
// to 'pending' and let the job-level retry in drain.ts (60s/5m/15m backoff)
// pick it up later. Catches both the SDK's typed RateLimitError and the
// status-code form (in case the SDK wrapping changes).
function isRateLimitError(err: unknown): boolean {
  if (err instanceof Anthropic.RateLimitError) return true;
  const e = err as { status?: number; message?: string } | null;
  if (e?.status === 429) return true;
  return typeof e?.message === "string" && e.message.includes("rate_limit_error");
}

interface RawEventRow {
  id: string;
  source: string;
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
    `SELECT id, source, subject, from_addr, date_sent, body_text
     FROM raw_events WHERE id = $1 AND user_id = $2`,
    [eventId, userId]
  );
  if (!rows[0]) throw new Error(`raw_event ${eventId} not found`);
  const event = rows[0];
  const subject = decrypt(event.subject) ?? "";
  const fromAddr = decrypt(event.from_addr) ?? "";
  const bodyText = decrypt(event.body_text) ?? "";

  // Cheap preflight — skip obvious bulk mail before paying for a Haiku call.
  // Decided BEFORE flipping status to 'processing' so we go straight from
  // pending → skipped in one write.
  if (isObviouslyBulk(subject, fromAddr, bodyText)) {
    await db.query(
      `UPDATE raw_events SET extraction_status = 'skipped', extracted_at = now() WHERE id = $1`,
      [eventId]
    );
    return { eventId, status: "skipped", pagesWritten: [] };
  }

  // Mark as in-progress to prevent double-processing.
  await db.query(
    `UPDATE raw_events SET extraction_status = 'processing' WHERE id = $1`,
    [eventId]
  );

  try {
    // Fetch known entities + currently open commitments. Both feed into Haiku:
    // entities so slugs get reused, commitments so the LLM can mark them as
    // updated/fulfilled instead of inserting duplicates. Pull a wider list (30
    // items, 90-day window) than the overview card shows — extraction needs
    // recall, not the trimmed UI surface.
    const [knownEntities, openCommitments] = await Promise.all([
      getKnownEntities(userId),
      listOpenCommitments(userId, 30, 90),
    ]);

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
      knownEntities,
      openCommitments.map((c) => ({ id: c.id, text: c.text, entitySlugs: c.entitySlugs }))
    );

    if (!extraction.worthExtracting || extraction.entities.length === 0) {
      await db.query(
        `UPDATE raw_events SET extraction_status = 'skipped', extracted_at = now() WHERE id = $1`,
        [eventId]
      );
      return { eventId, status: "skipped", pagesWritten: [] };
    }

    const pagesWritten: string[] = [];

    // Narrow the wikilink dictionary to entities actually referenced in this
    // email. Without this, every compose call ships the full ~500-entry list
    // (~10K tokens) regardless of relevance. Built once per event because all
    // entities in this event share the same haystack (subject + body + all
    // extracted claims).
    const haystack = [
      subject,
      bodyText,
      ...extraction.entities.flatMap((e) => [e.name, ...e.claims]),
    ].join("\n");
    const relevantEntities = filterRelevantEntities(knownEntities, haystack);

    // Step 2+3+4 — for each entity: resolve → compose → put.
    for (const entity of extraction.entities) {
      const existing = await findExistingPage(userId, entity.slug, entity.name);
      const resolvedSlug = existing?.slug ?? entity.slug;

      const { slug, content } = await composePage(
        userId,
        { ...entity, resolvedSlug },
        {
          eventId: event.id,
          source: event.source,
          subject,
          fromAddr,
          dateSent: event.date_sent?.toISOString() ?? null,
        },
        existing?.content ?? null,
        relevantEntities
      );

      const kind =
        typeof entity.attributes?.kind === "string"
          ? (entity.attributes.kind as string)
          : undefined;
      await putPage(userId, slug, content, { kind, rawEventId: event.id });
      pagesWritten.push(slug);
    }

    // Step 5 — apply LLM-judged commitment actions. The extractor decided per
    // commitment whether it's a new promise, a rephrasing of one already open
    // (action=update), or that this email fulfills an existing one
    // (resolved ids). All writes go through a single tx so a partial failure
    // can't leave commitments + commitment_entities out of sync.
    if (
      extraction.commitmentActions.length > 0 ||
      extraction.resolvedCommitmentIds.length > 0
    ) {
      await withUser(userId, async (c) => {
        for (const a of extraction.commitmentActions) {
          // Denormed primary slug on commitments.entity_slug — kept for the
          // legacy backfill-engagement path that joins on it. Source of truth
          // is the commitment_entities join table written just below.
          const primarySlug = a.entitySlugs[0] ?? null;

          let commitmentId: string;
          if (a.action === "update") {
            const { rows } = await c.query<{ id: string }>(
              `UPDATE commitments
                  SET text = $2, entity_slug = $3
                WHERE id = $1 AND status = 'open'
                RETURNING id`,
              [a.existingId, a.text, primarySlug]
            );
            // If the row was already resolved/dismissed between context load
            // and write, fall back to creating a fresh row.
            if (rows[0]) {
              commitmentId = rows[0].id;
              await c.query(
                `DELETE FROM commitment_entities WHERE commitment_id = $1`,
                [commitmentId]
              );
            } else {
              const ins = await c.query<{ id: string }>(
                `INSERT INTO commitments (user_id, raw_event_id, text, entity_slug)
                 VALUES ($1, $2, $3, $4) RETURNING id`,
                [userId, eventId, a.text, primarySlug]
              );
              commitmentId = ins.rows[0].id;
            }
          } else {
            const ins = await c.query<{ id: string }>(
              `INSERT INTO commitments (user_id, raw_event_id, text, entity_slug)
               VALUES ($1, $2, $3, $4) RETURNING id`,
              [userId, eventId, a.text, primarySlug]
            );
            commitmentId = ins.rows[0].id;
          }

          for (const slug of a.entitySlugs) {
            await c.query(
              `INSERT INTO commitment_entities (commitment_id, user_id, entity_slug)
               VALUES ($1, $2, $3)
               ON CONFLICT (commitment_id, entity_slug) DO NOTHING`,
              [commitmentId, userId, slug]
            );
          }
        }

        if (extraction.resolvedCommitmentIds.length > 0) {
          await c.query(
            `UPDATE commitments
                SET status = 'done', resolved_at = now()
              WHERE id = ANY($1::uuid[]) AND status = 'open'`,
            [extraction.resolvedCommitmentIds]
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
    const msg = String(err?.message ?? err).slice(0, 200);

    if (isRateLimitError(err)) {
      // Reset to 'pending' so the next extract_emails run picks it up. Re-throw
      // so the runner loop stops firing further LLM calls in this batch and
      // drain.ts schedules a job-level retry after 60s (then 5m, then 15m).
      console.warn(`[pipeline] event=${eventId} rate-limited; requeuing as pending: ${msg}`);
      await db.query(
        `UPDATE raw_events SET extraction_status = 'pending' WHERE id = $1`,
        [eventId]
      );
      throw err;
    }

    console.error(`[pipeline] event=${eventId} FAILED:`, msg);
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
