import { getAdminDb, getMetaDb } from "./db";
import type { Pool } from "pg";

const SCHEMA_CORE = `
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
  raw_json TEXT,
  extraction_status TEXT NOT NULL DEFAULT 'pending',
  extracted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT raw_events_pkey PRIMARY KEY (id),
  CONSTRAINT raw_events_user_source_ref_key UNIQUE (user_id, source, source_ref)
);

ALTER TABLE raw_events
  ADD COLUMN IF NOT EXISTS extraction_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS extracted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_raw_events_extraction_status
  ON raw_events (user_id, extraction_status);

CREATE TABLE IF NOT EXISTS llm_costs (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  model TEXT NOT NULL,
  input_tokens INT NOT NULL,
  output_tokens INT NOT NULL,
  cost_usd NUMERIC(10, 6) NOT NULL,
  called_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT llm_costs_pkey PRIMARY KEY (id)
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

CREATE TABLE IF NOT EXISTS user_api_keys (
  user_id UUID NOT NULL,
  anthropic_api_key TEXT,
  openai_api_key TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_api_keys_pkey PRIMARY KEY (user_id)
);
`;

const SCHEMA_TENANT_TABLES = `
CREATE TABLE IF NOT EXISTS pages (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  type TEXT,
  compiled_truth TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pages_pkey PRIMARY KEY (id),
  CONSTRAINT pages_user_slug_key UNIQUE (user_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_pages_user_id ON pages (user_id);

CREATE TABLE IF NOT EXISTS content_chunks (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  page_id UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL,
  chunk_text TEXT NOT NULL,
  embedding vector(1536) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT content_chunks_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_content_chunks_user_id ON content_chunks (user_id);

CREATE TABLE IF NOT EXISTS links (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  from_page_id UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  to_page_slug TEXT NOT NULL,
  CONSTRAINT links_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_links_user_id ON links (user_id);
`;

const SCHEMA_JOBS = `
CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at TIMESTAMPTZ,
  claimed_by TEXT,
  claim_expires_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jobs_pending
  ON jobs (scheduled_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_jobs_processing_userid
  ON jobs ((payload->>'userId'))
  WHERE status = 'processing';
`;

const SCHEMA_RLS = `
ALTER TABLE pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE pages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pages_isolation ON pages;
CREATE POLICY pages_isolation ON pages
  USING       (user_id = current_setting('app.user_id')::uuid)
  WITH CHECK  (user_id = current_setting('app.user_id')::uuid);

ALTER TABLE content_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_chunks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS content_chunks_isolation ON content_chunks;
CREATE POLICY content_chunks_isolation ON content_chunks
  USING       (user_id = current_setting('app.user_id')::uuid)
  WITH CHECK  (user_id = current_setting('app.user_id')::uuid);

ALTER TABLE links ENABLE ROW LEVEL SECURITY;
ALTER TABLE links FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS links_isolation ON links;
CREATE POLICY links_isolation ON links
  USING       (user_id = current_setting('app.user_id')::uuid)
  WITH CHECK  (user_id = current_setting('app.user_id')::uuid);
`;

const SCHEMA_BRIEFINGS = `
CREATE TABLE IF NOT EXISTS user_briefings (
  user_id UUID NOT NULL,
  kind TEXT NOT NULL,
  content JSONB NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind)
);
ALTER TABLE user_briefings ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_briefings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_briefings_isolation ON user_briefings;
CREATE POLICY user_briefings_isolation ON user_briefings
  USING       (user_id = current_setting('app.user_id')::uuid)
  WITH CHECK  (user_id = current_setting('app.user_id')::uuid);
`;

// Proactive layer — commitments tracker, daily digest, user preferences, timezone.
// commitments + digests are RLS-protected (per-user data).
// users.timezone + user_preferences live alongside users / user_api_keys, no RLS
// (filtered by app code via WHERE user_id = $1).
const SCHEMA_PROACTIVE = `
ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'UTC';

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id UUID PRIMARY KEY,
  digest_enabled BOOLEAN NOT NULL DEFAULT true,
  digest_hour_local INT NOT NULL DEFAULT 8,
  show_commitments BOOLEAN NOT NULL DEFAULT true,
  show_awaiting_reply BOOLEAN NOT NULL DEFAULT true,
  show_active_threads BOOLEAN NOT NULL DEFAULT true,
  show_quiet_but_important BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS commitments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  raw_event_id UUID REFERENCES raw_events(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  entity_slug TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_commitments_user_open
  ON commitments (user_id, status) WHERE status = 'open';
ALTER TABLE commitments ENABLE ROW LEVEL SECURITY;
ALTER TABLE commitments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commitments_isolation ON commitments;
CREATE POLICY commitments_isolation ON commitments
  USING       (user_id = current_setting('app.user_id')::uuid)
  WITH CHECK  (user_id = current_setting('app.user_id')::uuid);

CREATE TABLE IF NOT EXISTS digests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  local_date DATE NOT NULL,
  content JSONB NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT digests_user_date_key UNIQUE (user_id, local_date)
);
ALTER TABLE digests ENABLE ROW LEVEL SECURITY;
ALTER TABLE digests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS digests_isolation ON digests;
CREATE POLICY digests_isolation ON digests
  USING       (user_id = current_setting('app.user_id')::uuid)
  WITH CHECK  (user_id = current_setting('app.user_id')::uuid);

ALTER TABLE raw_events ADD COLUMN IF NOT EXISTS thread_ref TEXT;
CREATE INDEX IF NOT EXISTS idx_raw_events_user_thread
  ON raw_events (user_id, thread_ref) WHERE thread_ref IS NOT NULL;
`;

// Tier 2 v2 — customizable brief.
// - ai_memories: free-text persistent prefs piped into every brief LLM call.
// - users.last_seen_at: powers the adaptive time-window recap.
// - digest_feedback: per-item thumbs up/down (RLS-protected).
// - card_recipes: user-defined NL rules that run as extra cards (RLS-protected).
const SCHEMA_PROACTIVE_V2 = `
ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS ai_memories TEXT NOT NULL DEFAULT '';

ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS digest_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  digest_id UUID NOT NULL REFERENCES digests(id) ON DELETE CASCADE,
  section TEXT NOT NULL,
  item_ref TEXT NOT NULL,
  signal SMALLINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT digest_feedback_unique UNIQUE (user_id, digest_id, section, item_ref)
);
CREATE INDEX IF NOT EXISTS idx_digest_feedback_user_recent
  ON digest_feedback (user_id, created_at DESC);
ALTER TABLE digest_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE digest_feedback FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS digest_feedback_isolation ON digest_feedback;
CREATE POLICY digest_feedback_isolation ON digest_feedback
  USING       (user_id = current_setting('app.user_id')::uuid)
  WITH CHECK  (user_id = current_setting('app.user_id')::uuid);

CREATE TABLE IF NOT EXISTS card_recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  nl_rule TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_card_recipes_user_enabled
  ON card_recipes (user_id) WHERE enabled = true;
ALTER TABLE card_recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE card_recipes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS card_recipes_isolation ON card_recipes;
CREATE POLICY card_recipes_isolation ON card_recipes
  USING       (user_id = current_setting('app.user_id')::uuid)
  WITH CHECK  (user_id = current_setting('app.user_id')::uuid);
`;

// Tier 3 — user-creatable workflows.
// workflows: scheduled NL filter + NL prompt + delivery, all RLS-protected.
// workflow_runs: append-only history of each invocation's output / error.
// trigger_cron is a curated preset key (e.g. 'weekday_8am'), not raw cron — kept
// simple for v1 so we don't need a cron parser.
const SCHEMA_WORKFLOWS = `
CREATE TABLE IF NOT EXISTS workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  trigger_cron TEXT NOT NULL,
  filter_nl TEXT NOT NULL DEFAULT '',
  prompt_template TEXT NOT NULL,
  delivery_type TEXT NOT NULL DEFAULT 'in_app',
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_workflows_due
  ON workflows (next_run_at) WHERE enabled = true;
ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflows FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workflows_isolation ON workflows;
CREATE POLICY workflows_isolation ON workflows
  USING       (user_id = current_setting('app.user_id')::uuid)
  WITH CHECK  (user_id = current_setting('app.user_id')::uuid);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  ran_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL,
  output_text TEXT,
  error TEXT,
  source_refs JSONB NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_recent
  ON workflow_runs (workflow_id, ran_at DESC);
ALTER TABLE workflow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workflow_runs_isolation ON workflow_runs;
CREATE POLICY workflow_runs_isolation ON workflow_runs
  USING       (user_id = current_setting('app.user_id')::uuid)
  WITH CHECK  (user_id = current_setting('app.user_id')::uuid);
`;

// Pages v2 + engagement signal.
// - pages.kind: optional tag set by extraction (e.g. 'job_listing'). Lets us
//   route opportunities to their own card and keep 'Active threads' clean.
// - raw_events.is_from_user: true when the email's From header matches the
//   user's address. Set at sync time (plaintext available pre-encryption).
//   Powers the "user has actually replied in this thread" signal.
// - page_sources: which raw_events produced each page. Lets us answer
//   "is this page tied to a thread I'm engaged in?" via JOINs.
const SCHEMA_PAGES_V2 = `
ALTER TABLE pages ADD COLUMN IF NOT EXISTS kind TEXT;
CREATE INDEX IF NOT EXISTS idx_pages_user_kind ON pages (user_id, kind) WHERE kind IS NOT NULL;

ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS show_opportunities BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS show_workflow_runs BOOLEAN NOT NULL DEFAULT true;

-- Bento layout = ordered array of { key, size } objects. Order in the array
-- = visual order on /overview. size = 'normal' (1 col) or 'wide' (full row).
-- Cards not in the array fall back to default order, default size 'normal'.
ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS bento_layout JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Custom workflow cadence. When workflows.trigger_cron = 'custom', this
-- JSONB holds { weekdays: int[], hour: int, minute: int }. NULL means
-- the workflow is using one of the preset keys.
ALTER TABLE workflows
  ADD COLUMN IF NOT EXISTS trigger_custom JSONB;

ALTER TABLE raw_events
  ADD COLUMN IF NOT EXISTS is_from_user BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_raw_events_user_thread_from
  ON raw_events (user_id, thread_ref) WHERE is_from_user = true;

CREATE TABLE IF NOT EXISTS page_sources (
  page_id UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  raw_event_id UUID NOT NULL REFERENCES raw_events(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (page_id, raw_event_id)
);
CREATE INDEX IF NOT EXISTS idx_page_sources_event ON page_sources (raw_event_id);
ALTER TABLE page_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE page_sources FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS page_sources_isolation ON page_sources;
CREATE POLICY page_sources_isolation ON page_sources
  USING       (user_id = current_setting('app.user_id')::uuid)
  WITH CHECK  (user_id = current_setting('app.user_id')::uuid);
`;

// File uploads as a source. Encrypted raw_bytes + parsed text routed through
// the standard extraction pipeline via a linked raw_events row.
const SCHEMA_FILES = `
CREATE TABLE IF NOT EXISTS files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  raw_bytes BYTEA,
  parse_status TEXT NOT NULL DEFAULT 'pending',
  parse_error TEXT,
  raw_event_id UUID REFERENCES raw_events(id) ON DELETE SET NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_files_user_recent ON files (user_id, uploaded_at DESC);
ALTER TABLE files ENABLE ROW LEVEL SECURITY;
ALTER TABLE files FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS files_isolation ON files;
CREATE POLICY files_isolation ON files
  USING       (user_id = current_setting('app.user_id')::uuid)
  WITH CHECK  (user_id = current_setting('app.user_id')::uuid);
`;

// User-creatable Skills — named system-prompt addendums invokable in /ask.
const SCHEMA_SKILLS = `
CREATE TABLE IF NOT EXISTS skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT skills_user_slug_key UNIQUE (user_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_skills_user_enabled ON skills (user_id) WHERE enabled = true;
ALTER TABLE skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE skills FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS skills_isolation ON skills;
CREATE POLICY skills_isolation ON skills
  USING       (user_id = current_setting('app.user_id')::uuid)
  WITH CHECK  (user_id = current_setting('app.user_id')::uuid);
`;

export async function runMigrations(): Promise<void> {
  // Prefer ADMIN_DATABASE_URL (superuser) for CREATE EXTENSION and role grants.
  // Fall back to DATABASE_URL for local dev where ADMIN_DATABASE_URL is not yet set.
  const db: Pool = process.env.ADMIN_DATABASE_URL ? getAdminDb() : getMetaDb();

  // Step 1: core auth + event tables (idempotent, always run first).
  await db.query(SCHEMA_CORE);
  console.log("[migrate] core schema ok");

  // Step 2: jobs queue table — no external deps, always safe to run.
  await db.query(SCHEMA_JOBS);
  console.log("[migrate] jobs table ok");

  // Step 3: enable pgvector extension (requires superuser).
  try {
    await db.query("CREATE EXTENSION IF NOT EXISTS vector");
    console.log("[migrate] pgvector extension ok");
  } catch (err) {
    console.error("[migrate] pgvector extension failed (non-fatal):", (err as Error).message);
  }

  // Step 4: tenant tables (pages, content_chunks, links) — requires vector type.
  try {
    await db.query(SCHEMA_TENANT_TABLES);
    console.log("[migrate] tenant tables ok");
  } catch (err) {
    console.error("[migrate] tenant tables failed:", (err as Error).message);
  }

  // Step 5: ivfflat index — skip on empty table (retried on next startup).
  try {
    await db.query(
      `CREATE INDEX IF NOT EXISTS idx_content_chunks_embedding ON content_chunks
       USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)`
    );
    console.log("[migrate] ivfflat index ok");
  } catch (err) {
    console.warn("[migrate] ivfflat index skipped:", (err as Error).message);
  }

  // Step 6: RLS policies — only run if tenant tables exist.
  try {
    await db.query(SCHEMA_RLS);
    console.log("[migrate] RLS policies ok");
  } catch (err) {
    console.error("[migrate] RLS policies failed:", (err as Error).message);
  }

  // Step 7: user_briefings cache table.
  try {
    await db.query(SCHEMA_BRIEFINGS);
    console.log("[migrate] user_briefings ok");
  } catch (err) {
    console.error("[migrate] user_briefings failed:", (err as Error).message);
  }

  // Step 8: proactive layer — commitments, digests, user_preferences, users.timezone.
  try {
    await db.query(SCHEMA_PROACTIVE);
    console.log("[migrate] proactive schema ok");
  } catch (err) {
    console.error("[migrate] proactive schema failed:", (err as Error).message);
  }

  // Step 8b: proactive v2 — AI Memories, recipes, feedback, last_seen_at.
  try {
    await db.query(SCHEMA_PROACTIVE_V2);
    console.log("[migrate] proactive v2 schema ok");
  } catch (err) {
    console.error("[migrate] proactive v2 schema failed:", (err as Error).message);
  }

  // Step 8c: Tier 3 workflows — scheduled NL workflows + run history.
  try {
    await db.query(SCHEMA_WORKFLOWS);
    console.log("[migrate] workflows schema ok");
  } catch (err) {
    console.error("[migrate] workflows schema failed:", (err as Error).message);
  }

  // Step 8d: pages v2 — kind tag, engagement signal, page_sources.
  try {
    await db.query(SCHEMA_PAGES_V2);
    console.log("[migrate] pages v2 schema ok");
  } catch (err) {
    console.error("[migrate] pages v2 schema failed:", (err as Error).message);
  }

  // Step 8e: file uploads as a source.
  try {
    await db.query(SCHEMA_FILES);
    console.log("[migrate] files schema ok");
  } catch (err) {
    console.error("[migrate] files schema failed:", (err as Error).message);
  }

  // Step 8f: user-creatable Skills.
  try {
    await db.query(SCHEMA_SKILLS);
    console.log("[migrate] skills schema ok");
  } catch (err) {
    console.error("[migrate] skills schema failed:", (err as Error).message);
  }

  // Step 9 (final): grant app role on all tables. Must run after every CREATE TABLE
  // above so newly created tables receive grants in the same migration run.
  try {
    await db.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO mettrie_app`
    );
    await db.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public
       GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO mettrie_app`
    );
    console.log("[migrate] mettrie_app grants ok");
  } catch {
    // mettrie_app role not yet created — manual one-time setup required (see README)
  }

  console.log("[migrate] mettrie_meta schema up to date");
}
