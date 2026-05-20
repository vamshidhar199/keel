import { getAdminDb, getMetaDb } from "./db";
import { listMessageIds, fetchMessage, extractTextBody } from "./gmail";
import {
  listConversations,
  fetchConversationHistory,
  resolveUserNames,
  getTeamName,
} from "./slack";
import { encrypt, encryptJson } from "./crypto";

const MAX_INITIAL_PAGES = 3;

export interface SyncResult {
  newMessages: number;
  source: string;
}

export async function syncGmail(userId: string): Promise<SyncResult> {
  const db = getMetaDb();

  const [cursorRes, emailRes] = await Promise.all([
    db.query(
      `SELECT cursor FROM sync_cursors WHERE user_id = $1 AND source = 'gmail'`,
      [userId]
    ),
    db.query<{ email: string | null }>(
      `SELECT email FROM users WHERE id = $1`,
      [userId]
    ),
  ]);
  const isInitialSync = cursorRes.rows.length === 0;
  let pageToken: string | undefined = cursorRes.rows[0]?.cursor || undefined;
  const maxPages = isInitialSync ? MAX_INITIAL_PAGES : 1;
  const userEmail = (emailRes.rows[0]?.email ?? "").toLowerCase();

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
      const isFromUser = userEmail.length > 0 && fromAddr.toLowerCase().includes(userEmail);

      await db.query(
        `INSERT INTO raw_events
           (user_id, source, source_ref, subject, from_addr, date_sent, body_text, raw_json, thread_ref, is_from_user)
         VALUES ($1, 'gmail', $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (user_id, source, source_ref)
           DO UPDATE SET thread_ref = COALESCE(raw_events.thread_ref, EXCLUDED.thread_ref)`,
        [
          userId,
          id,
          encrypt(subject),
          encrypt(fromAddr),
          dateHeader ? new Date(dateHeader) : null,
          encrypt(bodyText),
          encryptJson(msg),
          msg.threadId ?? null,
          isFromUser,
        ]
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
// whose sync interval has elapsed, and enqueues a daily digest for any user
// whose chosen local hour matches now.
//
// Runs on the admin pool because the digest-existence check joins the
// RLS-protected `digests` table across users. The app role (mettrie_app)
// would fail the RLS policy without `app.user_id` set; admin (mettrie) is a
// superuser and bypasses RLS, which is correct for this cross-tenant scan.
export async function schedulerTick(): Promise<void> {
  const db = getAdminDb();

  const { cleanupBriefings } = await import("./briefing");
  const deleted = await cleanupBriefings();
  if (deleted > 0) console.log(`[scheduler] purged ${deleted} stale user_briefings rows`);

  const { enqueue } = await import("./queue/enqueue");

  // Daily digest enqueue. Unique constraint on digests(user_id, local_date)
  // makes a second fire in the matching hour a no-op, so cron's 30-min cadence
  // is safe even though we match on hour granularity.
  const { rows: digestUsers } = await db.query<{
    id: string;
    email: string;
    timezone: string;
  }>(
    `SELECT u.id, u.email, u.timezone
     FROM users u
     JOIN user_preferences p ON p.user_id = u.id
     WHERE p.digest_enabled = true
       AND u.email IS NOT NULL
       AND EXTRACT(HOUR FROM (now() AT TIME ZONE u.timezone)) = p.digest_hour_local
       AND NOT EXISTS (
         SELECT 1 FROM digests
         WHERE user_id = u.id
           AND local_date = (now() AT TIME ZONE u.timezone)::date
       )`
  );
  for (const u of digestUsers) {
    const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: u.timezone }).format(
      new Date()
    );
    console.log(`[scheduler] enqueueing generate_daily_digest user=${u.id} date=${localDate}`);
    await enqueue({
      type: "generate_daily_digest",
      userId: u.id,
      userEmail: u.email,
      localDate,
    });
  }

  // Source syncs.
  const { rows: syncRows } = await db.query<{ user_id: string; source: string }>(
    `SELECT user_id, source FROM sync_cursors
     WHERE last_synced_at + (sync_interval_hours * interval '1 hour') < now()`
  );
  for (const { user_id, source } of syncRows) {
    if (source === "gmail") {
      console.log(`[scheduler] enqueueing sync_gmail for user ${user_id}`);
      await enqueue({ type: "sync_gmail", userId: user_id });
    } else if (source === "slack") {
      console.log(`[scheduler] enqueueing sync_slack for user ${user_id}`);
      await enqueue({ type: "sync_slack", userId: user_id });
    }
  }

  // Due Tier 3 workflows. listDueWorkflows runs as admin to span all users
  // (workflows is RLS-protected); the runner uses withUser for tenant queries.
  const { listDueWorkflows } = await import("./workflows");
  const due = await listDueWorkflows();
  for (const w of due) {
    console.log(`[scheduler] enqueueing run_workflow user=${w.user_id} workflow=${w.id}`);
    await enqueue({ type: "run_workflow", userId: w.user_id, workflowId: w.id });
  }
}

// ── Slack ──────────────────────────────────────────────────────────────────

export async function syncSlack(userId: string): Promise<SyncResult> {
  const db = getMetaDb();

  const { rows } = await db.query(
    `SELECT cursor, last_synced_at FROM sync_cursors WHERE user_id = $1 AND source = 'slack'`,
    [userId]
  );
  const isInitialSync = rows.length === 0;
  // Initial sync: last 30 days. Subsequent: since last sync.
  const oldest = isInitialSync
    ? String(Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000))
    : String(Math.floor(new Date(rows[0].last_synced_at).getTime() / 1000));

  // Sync DMs, group DMs, and private channels (highest signal).
  const allConversations = await listConversations(userId);
  const toSync = allConversations.filter(
    (c) => c.kind === "im" || c.kind === "mpim" || c.kind === "private_channel" || c.kind === "public_channel"
  );

  // Collect all messages across conversations.
  type RawMsg = {
    sourceRef: string;
    subject: string;
    userSlackId: string;
    dateSent: Date;
    text: string;
  };
  const allMessages: RawMsg[] = [];

  // Resolve DM partner names upfront.
  const dmUserIds = toSync.filter((c) => c.dmUserId).map((c) => c.dmUserId!);
  const dmNames = dmUserIds.length > 0 ? await resolveUserNames(userId, dmUserIds) : new Map<string, string>();

  for (const convo of toSync) {
    try {
      const msgs = await fetchConversationHistory(userId, convo.id, oldest);
      const channelLabel =
        convo.kind === "im"
          ? `DM with ${dmNames.get(convo.dmUserId ?? "") ?? convo.dmUserId ?? convo.id}`
          : `#${convo.name}`;

      for (const m of msgs) {
        allMessages.push({
          sourceRef: `${convo.id}/${m.ts}`,
          subject: `[Slack] ${channelLabel}`,
          userSlackId: m.userSlackId,
          dateSent: new Date(parseFloat(m.ts) * 1000),
          text: m.text,
        });
      }
    } catch (err) {
      console.error(`[slack-sync] failed to fetch ${convo.id}:`, String((err as Error)?.message ?? err).slice(0, 200));
    }
  }

  if (allMessages.length === 0) {
    await db.query(
      `INSERT INTO sync_cursors (user_id, source, cursor, last_synced_at)
       VALUES ($1, 'slack', $2, now())
       ON CONFLICT (user_id, source) DO UPDATE SET last_synced_at = now()`,
      [userId, rows[0]?.cursor ?? ""]
    );
    return { newMessages: 0, source: "slack" };
  }

  // Resolve all sender names in one pass.
  const allSlackIds = [...new Set(allMessages.map((m) => m.userSlackId))];
  const names = await resolveUserNames(userId, allSlackIds);

  // Merge DM names into the main names map.
  for (const [id, name] of dmNames) names.set(id, name);

  let newMessages = 0;
  for (const msg of allMessages) {
    const senderName = names.get(msg.userSlackId) ?? msg.userSlackId;
    const resolvedText = msg.text.replace(
      /<@([A-Z0-9]+)>/g,
      (_, id) => names.get(id) ?? `@${id}`
    );

    const result = await db.query(
      `INSERT INTO raw_events
         (user_id, source, source_ref, subject, from_addr, date_sent, body_text)
       VALUES ($1, 'slack', $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, source, source_ref) DO NOTHING`,
      [
        userId,
        msg.sourceRef,
        encrypt(msg.subject),
        encrypt(senderName),
        msg.dateSent,
        encrypt(resolvedText),
      ]
    );
    if (result.rowCount && result.rowCount > 0) newMessages++;
  }

  // Store team name in cursor for status display (avoids extra API call on status page).
  let cursor = rows[0]?.cursor ?? "";
  if (!cursor) {
    cursor = (await getTeamName(userId)) ?? "";
  }

  await db.query(
    `INSERT INTO sync_cursors (user_id, source, cursor, last_synced_at)
     VALUES ($1, 'slack', $2, now())
     ON CONFLICT (user_id, source)
     DO UPDATE SET cursor = EXCLUDED.cursor, last_synced_at = now()`,
    [userId, cursor]
  );

  return { newMessages, source: "slack" };
}

export interface SlackStatus {
  connected: boolean;
  teamName: string | null;
  lastSyncedAt: string | null;
  nextSyncAt: string | null;
  messageCount: number;
  syncIntervalHours: number;
}

export async function getSlackStatus(userId: string): Promise<SlackStatus> {
  const db = getMetaDb();

  const [cursorRes, countRes] = await Promise.all([
    db.query(
      `SELECT cursor, last_synced_at, sync_interval_hours FROM sync_cursors
       WHERE user_id = $1 AND source = 'slack'`,
      [userId]
    ),
    db.query(
      `SELECT COUNT(*) AS cnt FROM raw_events WHERE user_id = $1 AND source = 'slack'`,
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
    teamName: row?.cursor ?? null, // cursor stores workspace name after first sync
    lastSyncedAt,
    nextSyncAt,
    messageCount: parseInt(countRes.rows[0]?.cnt ?? "0", 10),
    syncIntervalHours,
  };
}
