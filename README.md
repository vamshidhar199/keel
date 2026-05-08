# Mettrie — Local Development Setup

A self-improving personal knowledge system that extracts structured knowledge from Gmail and Slack and lets you query it conversationally.

---

## What you need

| Tool | Purpose |
|---|---|
| [Bun](https://bun.sh) | JavaScript runtime + package manager (replaces Node/npm) |
| [Colima](https://github.com/abiosoft/colima) + Docker CLI | Runs PostgreSQL locally in a container |
| [gbrain CLI](https://github.com/garrytan/gbrain) | Stores and chunks knowledge pages into Postgres |
| Google Cloud project | OAuth for sign-in + Gmail API access |
| Slack App | OAuth for Slack workspace access |
| Anthropic API key | Claude for extraction and answer synthesis |
| OpenAI API key | Embeddings for semantic search (text-embedding-3-large) |

---

## Step 1 — Install system dependencies

### Bun
```bash
curl -fsSL https://bun.sh/install | bash
```
Restart your terminal, then verify:
```bash
bun --version
```

### Colima + Docker CLI (macOS)
```bash
brew install colima docker docker-compose
```

### PostgreSQL client (for debugging, optional)
```bash
brew install postgresql
```

---

## Step 2 — Start PostgreSQL via Colima

```bash
colima start --cpu 2 --memory 4 --disk 20
docker run -d \
  --name mettrie-postgres \
  --restart unless-stopped \
  -e POSTGRES_USER=mettrie \
  -e POSTGRES_PASSWORD=mettrie_dev \
  -e POSTGRES_DB=mettrie_meta \
  -p 5432:5432 \
  pgvector/pgvector:pg16
```

Verify it's running:
```bash
docker ps
```

You should see `mettrie-postgres` in the list.

> **Note:** Run `colima start` again if your machine restarts. Docker containers with `--restart unless-stopped` will come back automatically once Colima is up.

---

## Step 3 — Install and link gbrain CLI

gbrain is a local CLI that stores knowledge pages into Postgres and runs embeddings.

```bash
# Clone gbrain (use the garrytan/gbrain repo)
git clone https://github.com/garrytan/gbrain.git ~/gbrain
cd ~/gbrain
bun install
bun link        # makes `gbrain` available globally via bun
```

Verify:
```bash
~/.bun/bin/gbrain --help
```

---

## Step 4 — Clone this repo and install dependencies

```bash
git clone <this-repo-url> mettrie
cd mettrie/app
bun install
```

---

## Step 5 — Set up Google OAuth + Gmail API

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project (or use an existing one)
3. Enable these APIs:
   - **Gmail API** — for reading emails
   - **Google People API** — for user profile info
4. Go to **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**
   - Application type: **Web application**
   - Authorised redirect URIs: `http://localhost:3002/api/auth/callback/google`
5. Copy the **Client ID** and **Client Secret**
6. Go to **APIs & Services → OAuth consent screen**
   - Add scopes: `email`, `profile`, `https://www.googleapis.com/auth/gmail.readonly`
   - Under **Test users**: add the Google email of every developer who needs to sign in locally

> **Team note:** The Google OAuth app stays in Testing mode for local dev. Each new developer must be added as a test user or they'll get an "access blocked" error at sign-in.

---

## Step 6 — Set up Slack OAuth

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App → From scratch**
   - Name: `Mettrie Dev`
   - Workspace: pick a workspace you own (create a free one at slack.com/get-started if needed)
2. Go to **OAuth & Permissions → User Token Scopes** → add each scope:
   ```
   channels:history  channels:read
   groups:history    groups:read
   im:history        im:read
   mpim:history      mpim:read
   users:read        team:read
   ```
3. Under **Redirect URLs** → add: `http://localhost:3002/api/slack/callback` → Save URLs
4. Click **Install to Workspace** → Allow
5. Go to **Basic Information → App Credentials** → copy **Client ID** and **Client Secret**

> **Team note:** For local dev, all developers share the same `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET`. Each developer connects their own Slack account via OAuth — their tokens are stored separately in the DB. Public distribution (so users can connect any workspace) requires an HTTPS URL and is enabled at Railway deploy time.

---

## Step 7 — Create your .env.local

```bash
cp .env.example .env.local
```

Open `.env.local` and fill in every value:

```env
# PostgreSQL — matches the docker run command in Step 2
DATABASE_URL=postgresql://mettrie:mettrie_dev@localhost:5432/mettrie_meta

# Auth.js secret — generate with: openssl rand -base64 32
AUTH_SECRET=<paste output here>

# Google OAuth — from Step 5
GOOGLE_CLIENT_ID=<your client id>
GOOGLE_CLIENT_SECRET=<your client secret>

# Slack OAuth — from Step 6 (shared across all devs)
SLACK_CLIENT_ID=<your slack client id>
SLACK_CLIENT_SECRET=<your slack client secret>

# Anthropic — from console.anthropic.com → API Keys
ANTHROPIC_API_KEY=sk-ant-...

# OpenAI — from platform.openai.com → API Keys
OPENAI_API_KEY=sk-...

# Path to bun binary directory (gbrain uses bun as its runtime)
BUN_BIN=/Users/<your-username>/.bun/bin

# Dev server URL
NEXTAUTH_URL=http://localhost:3002
```

> `AUTH_SECRET` and `BUN_BIN` are personal — generate your own. Everything else is shared across the team.

---

## Step 8 — Run the dev server

```bash
bun run dev -- --port 3002
```

Open [http://localhost:3002](http://localhost:3002).

Sign in with Google. On first sign-in the app automatically:
1. Runs database migrations (creates all tables in `mettrie_meta`)
2. Provisions a personal gbrain database for your user (`gbrain_user_<uuid>`)
3. Redirects you to the Overview dashboard

---

## Step 9 — Connect sources and extract knowledge

1. Go to **Sources** in the sidebar
2. **Gmail**: click the sync button to pull your emails into the database
3. **Slack**: click **Connect Slack** → authorize → then click the sync button
4. Click **Extract all** to run the AI extraction pipeline over all synced messages
5. Go to **Pages** to see your extracted knowledge
6. Go to **Ask** to query it conversationally

---

## Adding a new developer to the team

1. **Share these values** from your `.env.local`:
   - `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`
   - `SLACK_CLIENT_ID` + `SLACK_CLIENT_SECRET`
   - `ANTHROPIC_API_KEY` + `OPENAI_API_KEY`

2. **Add them as a Google OAuth test user:**
   Google Cloud Console → APIs & Services → OAuth consent screen → Test users → add their Google email.
   Without this, they'll get "Access blocked" when signing in.

3. **Slack**: they share the same Slack app. They connect their own Slack account via OAuth from the Sources page. Each developer's tokens are stored separately — they only see their own workspace data.

4. They run `bash setup.sh` from the repo root and fill in their own `AUTH_SECRET` and `BUN_BIN`.

> Once deployed to Railway (HTTPS), Slack public distribution is enabled and any user can connect any workspace without needing to be added manually.

---

## Project structure

```
mettrie/
└── app/                        # Next.js application
    ├── app/
    │   ├── (app)/              # Authenticated shell (sidebar layout)
    │   │   ├── layout.tsx      # Sidebar + auth guard
    │   │   ├── overview/       # Dashboard
    │   │   ├── ask/            # Conversational query UI
    │   │   ├── pages/          # Knowledge page list + detail
    │   │   ├── graph/          # Force-directed knowledge graph
    │   │   ├── sources/        # Gmail + Slack sync + extraction controls
    │   │   └── settings/       # Account + sign out
    │   ├── api/
    │   │   ├── gmail/          # Gmail OAuth + sync routes
    │   │   ├── slack/          # Slack OAuth + sync routes (connect, callback, sync, status, settings)
    │   │   └── ...
    │   └── components/         # Shared UI components
    ├── lib/
    │   ├── extract.ts          # Claude extraction (Haiku)
    │   ├── synthesize.ts       # Claude answer synthesis (Sonnet)
    │   ├── gbrain.ts           # gbrain CLI wrapper + direct pgvector queries
    │   ├── embeddings.ts       # OpenAI text-embedding-3-large
    │   ├── gmail.ts            # Gmail API client
    │   ├── slack.ts            # Slack API client + token storage
    │   ├── sync.ts             # syncGmail, syncSlack, schedulerTick
    │   ├── pipeline.ts         # Extraction pipeline
    │   ├── migrate.ts          # mettrie_meta schema migrations
    │   └── db.ts               # Postgres connection pools
    └── .env.example            # All required env vars documented
```

---

## Key architecture decisions

**gbrain is used for storage only.** The `gbrain put` CLI stores pages as markdown with frontmatter, handles chunking, and runs embeddings via OpenAI. We do not use gbrain's native query CLI.

**Search is direct pgvector.** `brainSearch` in `lib/gbrain.ts` queries the `content_chunks` table directly using `embedding <=> query_embedding` cosine similarity. This is type-agnostic and fast.

**Per-user databases.** Each user gets their own Postgres database (`gbrain_user_<uuid>`). The main app metadata (users, sessions, raw emails) lives in `mettrie_meta`.

**Adding a new entity type** (e.g. `deal`, `event`) only requires changes in:
1. `lib/extract.ts` — add to `EntityType` union + Claude prompt
2. `app/components/type-badge.tsx` — badge colour
3. `app/(app)/graph/graph-canvas.tsx` — node colour
4. `app/(app)/graph/page.tsx` — legend colour

---

## Troubleshooting

**`gbrain` command not found**
Make sure `~/.bun/bin` is in your PATH, or set `BUN_BIN` in `.env.local` to the full path.

**`ECONNREFUSED` on port 5432**
Colima isn't running. Run `colima start`.

**Google sign-in fails / "Access blocked"**
You are not added as a test user. Go to Google Cloud Console → APIs & Services → OAuth consent screen → Test users → add your Google email.

**Google sign-in fails / redirect URI mismatch**
Check that `http://localhost:3002/api/auth/callback/google` is listed in your OAuth client's authorised redirect URIs.

**Slack "Connect" does nothing or errors**
Check that `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET` are set in `.env.local` and the dev server was restarted after adding them.

**Slack sync shows 0 messages**
The sync uses `last_synced_at` as the oldest timestamp. If you posted messages before the first sync ran, reset the cursor:
```bash
bun --eval "
const { Pool } = (await import('pg'));
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
await pool.query(\"DELETE FROM sync_cursors WHERE user_id = '<your-user-id>' AND source = 'slack'\");
await pool.end();
"
```
Then trigger sync again from Sources.

**Extraction returns no pages**
Check that `ANTHROPIC_API_KEY` is set and has credits at console.anthropic.com. Run extraction on a small batch first (Extract 20).

**Graph shows nothing**
Pages need to be extracted first (Sources → Extract). The graph only shows pages that have links between them.

**`pgvector` extension not found**
You must use the `pgvector/pgvector:pg16` Docker image, not plain `postgres:16`. Re-run the `docker run` command from Step 2.
