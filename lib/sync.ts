import { getMetaDb } from "./db";
import { listMessageIds, fetchMessage, extractTextBody } from "./gmail";

// Maximum pages to fetch per sync run (100 messages per page).
// First sync fetches up to 3 pages; incremental syncs fetch 1.
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
        [
          userId,
          id,
          subject,
          fromAddr,
          dateHeader ? new Date(dateHeader) : null,
          bodyText,
          msg,
        ]
      );
      newMessages++;
    }

    lastPageToken = nextPageToken;
    pageToken = nextPageToken;
    pagesProcessed++;
  } while (pageToken && pagesProcessed < maxPages);

  // Persist cursor so the next sync continues where we left off.
  await db.query(
    `INSERT INTO sync_cursors (user_id, source, cursor, last_synced_at)
     VALUES ($1, 'gmail', $2, now())
     ON CONFLICT (user_id, source)
     DO UPDATE SET cursor = EXCLUDED.cursor, last_synced_at = now()`,
    [userId, lastPageToken ?? ""]
  );

  return { newMessages, source: "gmail" };
}

export async function getGmailStatus(userId: string): Promise<{
  connected: boolean;
  lastSyncedAt: string | null;
  messageCount: number;
}> {
  const db = getMetaDb();

  const [cursorRes, countRes] = await Promise.all([
    db.query(
      `SELECT last_synced_at FROM sync_cursors WHERE user_id = $1 AND source = 'gmail'`,
      [userId]
    ),
    db.query(
      `SELECT COUNT(*) AS cnt FROM raw_events WHERE user_id = $1 AND source = 'gmail'`,
      [userId]
    ),
  ]);

  return {
    connected: true,
    lastSyncedAt: cursorRes.rows[0]?.last_synced_at?.toISOString() ?? null,
    messageCount: parseInt(countRes.rows[0]?.cnt ?? "0", 10),
  };
}
