import { google } from "googleapis";
import { getMetaDb } from "./db";
import { encrypt, decrypt } from "./crypto";

async function getOAuth2Client(userId: string) {
  const db = getMetaDb();
  const { rows } = await db.query(
    `SELECT access_token, refresh_token, expires_at FROM accounts WHERE "userId" = $1 AND provider = 'google'`,
    [userId]
  );
  if (!rows[0]) throw new Error(`No Google account found for user ${userId}`);

  const access_token = decrypt(rows[0].access_token);
  const refresh_token = decrypt(rows[0].refresh_token);
  const expires_at = rows[0].expires_at;

  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.NEXTAUTH_URL}/api/auth/callback/google`
  );

  client.setCredentials({
    access_token,
    refresh_token,
    expiry_date: expires_at ? expires_at * 1000 : undefined,
  });

  // Persist refreshed tokens back to the accounts table (encrypted).
  client.on("tokens", async (tokens) => {
    await db.query(
      `UPDATE accounts SET access_token = $1, expires_at = $2
       WHERE "userId" = $3 AND provider = 'google'`,
      [
        encrypt(tokens.access_token ?? access_token),
        tokens.expiry_date ? Math.floor(tokens.expiry_date / 1000) : expires_at,
        userId,
      ]
    );
  });

  return client;
}

export async function getGmailClient(userId: string) {
  const auth = await getOAuth2Client(userId);
  return google.gmail({ version: "v1", auth });
}

export async function hasGmailScope(userId: string): Promise<boolean> {
  const db = getMetaDb();
  const { rows } = await db.query(
    `SELECT scope FROM accounts WHERE "userId" = $1 AND provider = 'google'`,
    [userId]
  );
  const scope: string = rows[0]?.scope ?? "";
  return scope.includes("gmail");
}

export interface MessagePage {
  ids: string[];
  nextPageToken?: string;
}

export async function listMessageIds(
  userId: string,
  pageToken?: string
): Promise<MessagePage> {
  const gmail = await getGmailClient(userId);
  // Pull both inbox and sent mail. `labelIds` is AND-combined, so we use `q`
  // (Gmail search) which is OR-friendly. SENT capture is required for the
  // "user has replied" engagement signal that powers Active threads.
  const res = await gmail.users.messages.list({
    userId: "me",
    maxResults: 100,
    q: "in:inbox OR in:sent",
    pageToken,
  });
  const ids = (res.data.messages ?? []).map((m) => m.id!).filter(Boolean);
  return { ids, nextPageToken: res.data.nextPageToken ?? undefined };
}

export async function fetchMessage(userId: string, messageId: string) {
  const gmail = await getGmailClient(userId);
  const res = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });
  return res.data;
}

export function extractTextBody(payload: any): string {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return Buffer.from(payload.body.data, "base64").toString("utf-8");
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      const text = extractTextBody(part);
      if (text) return text;
    }
  }
  return "";
}
