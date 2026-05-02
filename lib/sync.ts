import { getMetaDb } from "./db";
import { listMessageIds, fetchMessage, extractTextBody } from "./gmail";

const MAX_INITIAL_PAGES = 3;

export interface SyncResult {
  newMessages: number;
  source: string;
}

export async function syncGmail(userId: string): Promise<SyncResult> {
  const db = getMetaDb();

  const cursorRes = await db.query(
    `SELECT cursor FROM sync_cursors WHERE user_id = $1 AND source = 'gmail'`,
    [userId]
  );
  const isInitialSync = cursorRes.rows.length === 0;
  let pageToken: string | undefined = cursorRes.rows[0]?.cursor || undefined;
  const maxPages = isInitialSync ? MAX_INITIAL_PAGES : 1;

  let newMessages = 0;
  let pagesProcessed = 0;
  let lastPageToken: string | undefined = pageToken;

  do {
    const { ids, nextPageToken } = await listMessageIds(userId, pageToken);

    for (const id of ids) {
      const exists = await db.query(
        `SELECT 1 FROM raw_events WHERE user_id = $1 AND source = 'gmail' AND source_ref = $2`,
        [userId, id]
      );
      if (exists.rows.length > 0) continue;

      const msg = await fetchMessage(userId, id);
      const headers = msg.payload?.headers ?? [];
      const subject =
        headers.find((h) => h.name?.toLowerCase() === "subject")?.value ?? "";
      const fromAddr =
        headers.find((h) => h.name?.toLowerCase() === "from")?.value ?? "";
      const dateHeader =
        headers.find((h) => h.name?.toLowerCase() === "date")?.value;
      const bodyText = extractTextBody(msg.payload);

      await db.query(
        `INSERT INTO raw_events
           (user_id, source, source_ref, subject, from_addr, date_sent, body_text, raw_json)
         VALUES ($1, 'gmail', $2, $3, $4, $5, $6, $7)
         ON CONFLICT (user_id, source, source_ref) DO NOTHING`,
        [userId, id, subject, fromAddr, dateHeader ? new Date(dateHeader) : null, bodyText, msg]
      );
      newMessages++;
    }

    lastPageToken = nextPageToken;
    pageToken = nextPageToken;
    pagesProcessed++;
  } while (pageToken && pagesProcessed < maxPages);

  await db.query(
    `INSERT INTO sync_cursors (user_id, source, cursor, last_synced_at)
     VALUES ($1, 'gmail', $2, now())
     ON CONFLICT (user_id, source)
     DO UPDATE SET cursor = EXCLUDED.cursor, last_synced_at = now()`,
    [userId, lastPageToken ?? ""]
  );

  return { newMessages, source: "gmail" };
}

export interface GmailStatus {
  connected: boolean;
  lastSyncedAt: string | null;
  nextSyncAt: string | null;
  messageCount: number;
  syncIntervalHours: number;
}

export async function getGmailStatus(userId: string): Promise<GmailStatus> {
  const db = getMetaDb();

  const [cursorRes, countRes] = await Promise.all([
    db.query(
      `SELECT last_synced_at, sync_interval_hours FROM sync_cursors
       WHERE user_id = $1 AND source = 'gmail'`,
      [userId]
    ),
    db.query(
      `SELECT COUNT(*) AS cnt FROM raw_events WHERE user_id = $1 AND source = 'gmail'`,
      [userId]
    ),
  ]);

  const row = cursorRes.rows[0];
  const syncIntervalHours: number = row?.sync_interval_hours ?? 24;
  const lastSyncedAt: string | null = row?.last_synced_at?.toISOString() ?? null;

  let nextSyncAt: string | null = null;
  if (lastSyncedAt) {
    const next = new Date(lastSyncedAt);
    next.setHours(next.getHours() + syncIntervalHours);
    nextSyncAt = next.toISOString();
  }

  return {
    connected: true,
    lastSyncedAt,
    nextSyncAt,
    messageCount: parseInt(countRes.rows[0]?.cnt ?? "0", 10),
    syncIntervalHours,
  };
}

export async function updateSyncInterval(
  userId: string,
  source: string,
  intervalHours: number
): Promise<void> {
  const db = getMetaDb();
  await db.query(
    `INSERT INTO sync_cursors (user_id, source, sync_interval_hours, last_synced_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (user_id, source)
     DO UPDATE SET sync_interval_hours = EXCLUDED.sync_interval_hours`,
    [userId, source, intervalHours]
  );
}

// Called by the scheduler every 30 minutes. Enqueues a sync for any user
// whose sync interval has elapsed since their last sync.
export async function schedulerTick(): Promise<void> {
  const db = getMetaDb();
  const { rows } = await db.query<{ user_id: string }>(
    `SELECT user_id FROM sync_cursors
     WHERE source = 'gmail'
       AND last_synced_at + (sync_interval_hours * interval '1 hour') < now()`
  );
  if (rows.length === 0) return;

  const { enqueue } = await import("./queue");
  for (const { user_id } of rows) {
    console.log(`[scheduler] enqueueing sync_gmail for user ${user_id}`);
    enqueue({ type: "sync_gmail", userId: user_id });
  }
}
