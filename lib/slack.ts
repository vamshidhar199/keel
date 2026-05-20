import { getMetaDb } from "./db";
import { encrypt, decrypt } from "./crypto";

// ── Token storage ──────────────────────────────────────────────────────────

interface SlackAccount {
  access_token: string;
  team_id: string;
}

async function getSlackAccount(userId: string): Promise<SlackAccount | null> {
  const db = getMetaDb();
  const { rows } = await db.query(
    `SELECT access_token, session_state AS team_id
     FROM accounts WHERE "userId" = $1 AND provider = 'slack'`,
    [userId]
  );
  if (!rows[0]) return null;
  return { access_token: decrypt(rows[0].access_token), team_id: rows[0].team_id };
}

export async function hasSlackConnected(userId: string): Promise<boolean> {
  return (await getSlackAccount(userId)) !== null;
}

export async function saveSlackTokens(
  userId: string,
  authedUser: { id: string; access_token: string; scope: string },
  teamId: string
): Promise<void> {
  const db = getMetaDb();
  await db.query(
    `INSERT INTO accounts
       ("userId", type, provider, "providerAccountId", access_token, scope, token_type, session_state)
     VALUES ($1, 'oauth', 'slack', $2, $3, $4, 'user', $5)
     ON CONFLICT (provider, "providerAccountId")
     DO UPDATE SET access_token = EXCLUDED.access_token, scope = EXCLUDED.scope`,
    [userId, authedUser.id, encrypt(authedUser.access_token), authedUser.scope, teamId]
  );
}

// ── Slack Web API ──────────────────────────────────────────────────────────

async function callSlack(
  token: string,
  method: string,
  params: Record<string, string> = {}
): Promise<any> {
  const url = new URL(`https://slack.com/api/${method}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack API ${method} error: ${data.error}`);
  return data;
}

// ── Conversations ──────────────────────────────────────────────────────────

export interface SlackConversation {
  id: string;
  name: string;
  kind: "im" | "mpim" | "private_channel" | "public_channel";
  dmUserId?: string; // set for im type
}

export async function listConversations(userId: string): Promise<SlackConversation[]> {
  const account = await getSlackAccount(userId);
  if (!account) throw new Error("Slack not connected");

  const results: SlackConversation[] = [];
  let cursor: string | undefined;

  do {
    const params: Record<string, string> = {
      types: "public_channel,private_channel,im,mpim",
      exclude_archived: "true",
      limit: "200",
    };
    if (cursor) params.cursor = cursor;

    const data = await callSlack(account.access_token, "conversations.list", params);

    for (const ch of data.channels ?? []) {
      if (ch.is_im) {
        results.push({ id: ch.id, name: ch.id, kind: "im", dmUserId: ch.user });
      } else if (ch.is_mpim) {
        results.push({ id: ch.id, name: ch.name ?? ch.id, kind: "mpim" });
      } else if (ch.is_private && ch.is_member) {
        results.push({ id: ch.id, name: ch.name ?? ch.id, kind: "private_channel" });
      } else if (!ch.is_private && ch.is_member) {
        results.push({ id: ch.id, name: ch.name ?? ch.id, kind: "public_channel" });
      }
    }

    cursor = data.response_metadata?.next_cursor || undefined;
  } while (cursor);

  return results;
}

// ── Messages ───────────────────────────────────────────────────────────────

export interface SlackMessage {
  ts: string;
  userSlackId: string;
  text: string;
}

export async function fetchConversationHistory(
  userId: string,
  channelId: string,
  oldest?: string
): Promise<SlackMessage[]> {
  const account = await getSlackAccount(userId);
  if (!account) throw new Error("Slack not connected");

  const messages: SlackMessage[] = [];
  let cursor: string | undefined;

  do {
    const params: Record<string, string> = { channel: channelId, limit: "200" };
    if (oldest) params.oldest = oldest;
    if (cursor) params.cursor = cursor;

    const data = await callSlack(account.access_token, "conversations.history", params);

    for (const m of data.messages ?? []) {
      if (m.type === "message" && m.text && !m.subtype) {
        messages.push({ ts: m.ts, userSlackId: m.user ?? "", text: m.text });
      }
    }

    cursor = data.has_more ? data.response_metadata?.next_cursor : undefined;
  } while (cursor);

  return messages;
}

// ── User name resolution ───────────────────────────────────────────────────

export async function resolveUserNames(
  userId: string,
  slackUserIds: string[]
): Promise<Map<string, string>> {
  const account = await getSlackAccount(userId);
  if (!account) return new Map();

  const unique = [...new Set(slackUserIds)].filter(Boolean);
  const names = new Map<string, string>();

  await Promise.all(
    unique.map(async (slackId) => {
      try {
        const data = await callSlack(account.access_token, "users.info", { user: slackId });
        names.set(slackId, data.user?.real_name ?? data.user?.name ?? slackId);
      } catch {
        names.set(slackId, slackId);
      }
    })
  );

  return names;
}

// ── Team info ──────────────────────────────────────────────────────────────

export async function getTeamName(userId: string): Promise<string | null> {
  const account = await getSlackAccount(userId);
  if (!account) return null;
  try {
    const data = await callSlack(account.access_token, "team.info");
    return data.team?.name ?? null;
  } catch {
    return null;
  }
}
