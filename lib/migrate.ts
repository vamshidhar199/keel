import { getMetaDb } from "./db";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  name TEXT,
  email TEXT UNIQUE,
  "emailVerified" TIMESTAMPTZ,
  image TEXT,
  CONSTRAINT users_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS accounts (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  type TEXT NOT NULL,
  provider TEXT NOT NULL,
  "providerAccountId" TEXT NOT NULL,
  refresh_token TEXT,
  access_token TEXT,
  expires_at INT,
  token_type TEXT,
  scope TEXT,
  id_token TEXT,
  session_state TEXT,
  CONSTRAINT accounts_pkey PRIMARY KEY (id),
  CONSTRAINT accounts_provider_account_key UNIQUE (provider, "providerAccountId")
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "sessionToken" TEXT NOT NULL UNIQUE,
  expires TIMESTAMPTZ NOT NULL,
  CONSTRAINT sessions_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS verification_token (
  identifier TEXT NOT NULL,
  token TEXT NOT NULL,
  expires TIMESTAMPTZ NOT NULL,
  CONSTRAINT verification_token_pkey PRIMARY KEY (identifier, token)
);

CREATE TABLE IF NOT EXISTS raw_events (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  source TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  subject TEXT,
  from_addr TEXT,
  date_sent TIMESTAMPTZ,
  body_text TEXT,
  raw_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT raw_events_pkey PRIMARY KEY (id),
  CONSTRAINT raw_events_user_source_ref_key UNIQUE (user_id, source, source_ref)
);

CREATE TABLE IF NOT EXISTS sync_cursors (
  user_id UUID NOT NULL,
  source TEXT NOT NULL,
  cursor TEXT,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_interval_hours INT NOT NULL DEFAULT 24,
  CONSTRAINT sync_cursors_pkey PRIMARY KEY (user_id, source)
);

ALTER TABLE sync_cursors
  ADD COLUMN IF NOT EXISTS sync_interval_hours INT NOT NULL DEFAULT 24;
`;

export async function runMigrations(): Promise<void> {
  const db = getMetaDb();
  await db.query(SCHEMA);
  console.log("[migrate] mettrie_meta schema up to date");
}
