import { getMetaDb } from "./db";
import { encrypt, decrypt } from "./crypto";

// ── Per-user Connected App credentials ────────────────────────────────────
//
// Each customer admin creates a Connected App in their own Salesforce org and
// pastes the Consumer Key/Secret into Mettrie at first connect. These live
// in user_api_keys (encrypted) and back every OAuth round-trip.

export interface SalesforceAppCreds {
  clientId: string;
  clientSecret: string;
}

export async function getSalesforceAppCreds(userId: string): Promise<SalesforceAppCreds | null> {
  const db = getMetaDb();
  const { rows } = await db.query(
    `SELECT salesforce_consumer_key, salesforce_consumer_secret
     FROM user_api_keys WHERE user_id = $1`,
    [userId]
  );
  if (!rows[0]?.salesforce_consumer_key || !rows[0]?.salesforce_consumer_secret) {
    return null;
  }
  return {
    clientId: decrypt(rows[0].salesforce_consumer_key),
    clientSecret: decrypt(rows[0].salesforce_consumer_secret),
  };
}

export async function saveSalesforceAppCreds(
  userId: string,
  clientId: string,
  clientSecret: string
): Promise<void> {
  const db = getMetaDb();
  await db.query(
    `INSERT INTO user_api_keys (user_id, salesforce_consumer_key, salesforce_consumer_secret, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (user_id) DO UPDATE SET
       salesforce_consumer_key = EXCLUDED.salesforce_consumer_key,
       salesforce_consumer_secret = EXCLUDED.salesforce_consumer_secret,
       updated_at = now()`,
    [userId, encrypt(clientId), encrypt(clientSecret)]
  );
}

export async function hasSalesforceAppCreds(userId: string): Promise<boolean> {
  return (await getSalesforceAppCreds(userId)) !== null;
}

// ── Token storage ──────────────────────────────────────────────────────────

interface SalesforceAccount {
  access_token: string;
  refresh_token: string;
  instance_url: string;
}

async function getSalesforceAccount(userId: string): Promise<SalesforceAccount | null> {
  const db = getMetaDb();
  const { rows } = await db.query(
    `SELECT access_token, refresh_token, session_state AS instance_url
     FROM accounts WHERE "userId" = $1 AND provider = 'salesforce'`,
    [userId]
  );
  if (!rows[0]) return null;
  return {
    access_token: decrypt(rows[0].access_token),
    refresh_token: decrypt(rows[0].refresh_token),
    instance_url: rows[0].instance_url,
  };
}

export async function hasSalesforceConnected(userId: string): Promise<boolean> {
  return (await getSalesforceAccount(userId)) !== null;
}

export async function saveSalesforceTokens(
  userId: string,
  tokens: {
    salesforceUserId: string;
    access_token: string;
    refresh_token: string;
    instance_url: string;
    scope: string;
  }
): Promise<void> {
  const db = getMetaDb();
  await db.query(
    `INSERT INTO accounts
       ("userId", type, provider, "providerAccountId",
        access_token, refresh_token, scope, token_type, session_state)
     VALUES ($1, 'oauth', 'salesforce', $2, $3, $4, $5, 'bearer', $6)
     ON CONFLICT (provider, "providerAccountId")
     DO UPDATE SET
       access_token = EXCLUDED.access_token,
       refresh_token = EXCLUDED.refresh_token,
       scope = EXCLUDED.scope,
       session_state = EXCLUDED.session_state`,
    [
      userId,
      tokens.salesforceUserId,
      encrypt(tokens.access_token),
      encrypt(tokens.refresh_token),
      tokens.scope,
      tokens.instance_url,
    ]
  );
}

export async function getInstanceUrl(userId: string): Promise<string | null> {
  const acct = await getSalesforceAccount(userId);
  return acct?.instance_url ?? null;
}

// ── Token refresh ──────────────────────────────────────────────────────────

async function refreshAccessToken(userId: string): Promise<void> {
  const acct = await getSalesforceAccount(userId);
  if (!acct) throw new Error("Salesforce not connected");
  const creds = await getSalesforceAppCreds(userId);
  if (!creds) throw new Error("Salesforce Connected App credentials missing");

  // Refresh against the org's own instance URL — Salesforce ties refresh
  // tokens to the host that issued them, so login.salesforce.com would fail
  // for tokens originally issued via a My Domain or test.salesforce.com.
  const res = await fetch(`${acct.instance_url}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: acct.refresh_token,
    }),
  });

  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(`Salesforce token refresh failed: ${data.error ?? res.status} ${data.error_description ?? ""}`.trim());
  }

  const db = getMetaDb();
  // Salesforce may rotate refresh_token on refresh; persist whichever is returned.
  await db.query(
    `UPDATE accounts
     SET access_token = $1,
         refresh_token = COALESCE($2, refresh_token),
         session_state = COALESCE($3, session_state)
     WHERE "userId" = $4 AND provider = 'salesforce'`,
    [
      encrypt(data.access_token),
      data.refresh_token ? encrypt(data.refresh_token) : null,
      data.instance_url ?? null,
      userId,
    ]
  );
}

// ── REST API wrapper ───────────────────────────────────────────────────────

// Call a Salesforce REST API path. `path` must begin with `/services/...`.
// Refreshes the access token on 401 and retries once.
async function callSalesforce<T = unknown>(
  userId: string,
  method: "GET" | "POST",
  path: string,
  body?: unknown
): Promise<T> {
  let acct = await getSalesforceAccount(userId);
  if (!acct) throw new Error("Salesforce not connected");

  const doFetch = (token: string, url: string) =>
    fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

  let res = await doFetch(acct.access_token, `${acct.instance_url}${path}`);

  if (res.status === 401) {
    await refreshAccessToken(userId);
    acct = await getSalesforceAccount(userId);
    if (!acct) throw new Error("Salesforce not connected after refresh");
    res = await doFetch(acct.access_token, `${acct.instance_url}${path}`);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Salesforce ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

// ── SOQL types + queries ───────────────────────────────────────────────────

const API_VERSION = "v60.0";

interface QueryResponse<T> {
  totalSize: number;
  done: boolean;
  records: T[];
  nextRecordsUrl?: string;
}

export interface SalesforceAccountRecord {
  Id: string;
  Name: string | null;
  Website: string | null;
  Industry: string | null;
  Phone: string | null;
  BillingCity: string | null;
  BillingCountry: string | null;
  Description: string | null;
  LastModifiedDate: string;
}

export interface SalesforceContactRecord {
  Id: string;
  FirstName: string | null;
  LastName: string | null;
  Email: string | null;
  Phone: string | null;
  Title: string | null;
  AccountId: string | null;
  Account: { Name: string | null } | null;
  Description: string | null;
  LastModifiedDate: string;
}

async function runQuery<T>(userId: string, soql: string): Promise<T[]> {
  const records: T[] = [];
  let path: string | undefined = `/services/data/${API_VERSION}/query?q=${encodeURIComponent(soql)}`;
  while (path) {
    const page: QueryResponse<T> = await callSalesforce<QueryResponse<T>>(userId, "GET", path);
    records.push(...page.records);
    path = page.done ? undefined : page.nextRecordsUrl;
  }
  return records;
}

const ACCOUNT_FIELDS =
  "Id, Name, Website, Industry, Phone, BillingCity, BillingCountry, Description, LastModifiedDate";

const CONTACT_FIELDS =
  "Id, FirstName, LastName, Email, Phone, Title, AccountId, Account.Name, Description, LastModifiedDate";

// `cursorIso` is an ISO 8601 timestamp; SF SOQL accepts it unquoted in WHERE.
export async function listAccounts(
  userId: string,
  cursorIso: string
): Promise<SalesforceAccountRecord[]> {
  const soql =
    `SELECT ${ACCOUNT_FIELDS} FROM Account ` +
    `WHERE LastModifiedDate > ${cursorIso} ` +
    `ORDER BY LastModifiedDate ASC LIMIT 200`;
  return runQuery<SalesforceAccountRecord>(userId, soql);
}

export async function listContacts(
  userId: string,
  cursorIso: string
): Promise<SalesforceContactRecord[]> {
  const soql =
    `SELECT ${CONTACT_FIELDS} FROM Contact ` +
    `WHERE LastModifiedDate > ${cursorIso} ` +
    `ORDER BY LastModifiedDate ASC LIMIT 200`;
  return runQuery<SalesforceContactRecord>(userId, soql);
}
