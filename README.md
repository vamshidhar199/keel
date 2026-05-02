# Mettrie App

## Prerequisites

- macOS with [Homebrew](https://brew.sh) installed
- Node.js 18+ (`node --version` to check)

## Local dev setup

Run these once to set up your machine, then the last two commands every time you work.

### 1. Install Postgres 17 + pgvector

```bash
brew install postgresql@17 pgvector
brew services start postgresql@17
```

**Why pg17 and not pg16?** pgvector's Homebrew formula only ships pre-built binaries for pg17/18. pg16 requires building from source, which fails on recent macOS due to SDK header issues. Use pg17.

**Why not Docker?** Docker Desktop has persistent VM corruption issues on macOS Apple Silicon. Native Homebrew Postgres is simpler and more reliable for local dev. Production uses Supabase/Neon (managed Postgres) — same wire protocol, no code changes to deploy.

### 2. Create the Mettrie database user and metadata DB

```bash
# Create the mettrie user (run as your mac user, not as mettrie)
psql postgres -c "CREATE USER mettrie WITH PASSWORD 'mettrie_dev' CREATEDB;"

# Create the metadata database
createdb -U mettrie mettrie_meta

# Enable pgvector (must run as superuser, i.e. your mac username)
psql -d mettrie_meta -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

Run this block only once. If you get "already exists" errors, that's fine — skip ahead.

### 3. Set up environment variables

```bash
cp .env.example .env.local
```

Open `.env.local` and fill in:
- `AUTH_SECRET` → run `openssl rand -base64 32` and paste the output
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` → see Google OAuth setup below
- `ANTHROPIC_API_KEY` → from console.anthropic.com → API Keys

`DATABASE_URL` is pre-filled and works with the setup above. Leave it as-is for local dev.

### 4. Install dependencies and run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) (may use port 3002 if 3000 is taken).

---

## Google OAuth setup (needed for P1 — auth)

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (e.g. `mettrie-mvp`)
3. Enable these APIs: **Gmail API**, **Google People API**
4. Go to **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**
5. Application type: **Web application**
6. Authorized redirect URIs: `http://localhost:3000/api/auth/callback/google`
7. Copy the Client ID and Client Secret into `.env.local`

> Note: while in development, Google will show an "unverified app" warning to sign-in users. Add tester emails under **OAuth consent screen → Test users** to allow specific accounts to sign in.

---

## Per-user gbrain databases

Each Mettrie user gets their own Postgres database (`gbrain_user_<id>`). These are created automatically when a user signs up — you don't create them manually. They live on the same Postgres server as `mettrie_meta`.

To inspect a user's gbrain DB directly:
```bash
psql -d gbrain_user_<id>
```

---

## Resetting local state

To wipe all data and start fresh:
```bash
# Drop and recreate the metadata DB
dropdb mettrie_meta && createdb -U mettrie mettrie_meta
psql -d mettrie_meta -c "CREATE EXTENSION IF NOT EXISTS vector;"

# Drop all per-user gbrain DBs (replace with actual user IDs)
dropdb gbrain_user_<id>
```

---

## Project structure

```
lib/              Server-side core modules — never imported by client code
  db.ts           Postgres pool for metadata DB + per-user gbrain DB helper
  gbrain.ts       gbrain CLI wrapper (put_page, brain_search, etc.)
  anthropic.ts    Anthropic SDK wrapper — all Haiku/Sonnet calls go here
app/              Next.js App Router — pages and API routes
public/           Static assets
```

## Build plan and backlog

See `../BUILD_PLAN.md` for the phased plan and `../BUILD_BACKLOG.md` for ticket status.
