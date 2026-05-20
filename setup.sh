#!/bin/bash
# Mettrie local dev setup script
# Run from the repo root: bash setup.sh

set -e

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

step() { echo -e "\n${BOLD}▶ $1${NC}"; }
ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}!${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; exit 1; }

echo -e "${BOLD}Mettrie — Local Dev Setup${NC}"
echo "────────────────────────────────────────"

# ── 1. Check prerequisites ────────────────────────────────────────────────────

step "Checking prerequisites"

if ! command -v bun &>/dev/null; then
  warn "Bun not found. Installing..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
  ok "Bun installed"
else
  ok "Bun $(bun --version)"
fi

if ! command -v brew &>/dev/null; then
  fail "Homebrew not found. Install it from https://brew.sh then re-run this script."
fi
ok "Homebrew found"

if ! command -v colima &>/dev/null; then
  warn "Colima not found. Installing..."
  brew install colima docker docker-compose
  ok "Colima + Docker installed"
else
  ok "Colima $(colima version 2>/dev/null | head -1 | awk '{print $3}')"
fi

# ── 2. Start Colima + Postgres ────────────────────────────────────────────────

step "Starting Colima"

if ! colima status 2>/dev/null | grep -q "Running"; then
  colima start --cpu 2 --memory 4 --disk 20
  ok "Colima started"
else
  ok "Colima already running"
fi

step "Starting PostgreSQL (pgvector)"

if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "mettrie-postgres"; then
  ok "mettrie-postgres container already running"
else
  if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -q "mettrie-postgres"; then
    docker start mettrie-postgres
    ok "mettrie-postgres container restarted"
  else
    docker run -d \
      --name mettrie-postgres \
      --restart unless-stopped \
      -e POSTGRES_USER=mettrie \
      -e POSTGRES_PASSWORD=mettrie_dev \
      -e POSTGRES_DB=mettrie_meta \
      -p 5432:5432 \
      pgvector/pgvector:pg16
    ok "mettrie-postgres container created and started"
    echo "  Waiting for Postgres to be ready..."
    sleep 4
  fi
fi

# ── 3. Create mettrie_app role (non-superuser, NOBYPASSRLS) ───────────────────

step "Setting up mettrie_app database role"

docker exec mettrie-postgres psql -U mettrie -d mettrie_meta -c "
DO \$\$
BEGIN
  CREATE ROLE mettrie_app LOGIN PASSWORD 'mettrie_app_dev' NOBYPASSRLS;
EXCEPTION WHEN duplicate_object THEN
  -- role already exists
END \$\$;
GRANT CONNECT ON DATABASE mettrie_meta TO mettrie_app;
GRANT USAGE ON SCHEMA public TO mettrie_app;
" 2>/dev/null && ok "mettrie_app role ready" || warn "Could not create mettrie_app role — run migrations first to create tables, then re-run setup.sh"

# ── 4. Install app dependencies ───────────────────────────────────────────────

step "Installing app dependencies"

APP_DIR="$(dirname "$0")"

if [ ! -f "$APP_DIR/package.json" ]; then
  fail "Could not find package.json next to setup.sh. Run this script from the repo root."
fi

cd "$APP_DIR"
bun install
ok "Dependencies installed"

# ── 5. Set up .env.local ──────────────────────────────────────────────────────

step "Setting up environment variables"

if [ -f ".env.local" ]; then
  ok ".env.local already exists — skipping"
  warn "Make sure all values are filled in (especially API keys and OAuth credentials)"
else
  cp .env.example .env.local

  # Auto-generate AUTH_SECRET
  AUTH_SECRET_VAL=$(openssl rand -base64 32)
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s|AUTH_SECRET=.*|AUTH_SECRET=$AUTH_SECRET_VAL|" .env.local
  else
    sed -i "s|AUTH_SECRET=.*|AUTH_SECRET=$AUTH_SECRET_VAL|" .env.local
  fi

  ok ".env.local created"
  warn "You still need to fill in:"
  warn "  - GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (from Google Cloud Console)"
  warn "  - SLACK_CLIENT_ID and SLACK_CLIENT_SECRET (from api.slack.com/apps — shared with team)"
  warn "  - ANTHROPIC_API_KEY (from console.anthropic.com)"
  warn "  - OPENAI_API_KEY (from platform.openai.com)"
fi

cd - > /dev/null

# ── 6. Done ───────────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}────────────────────────────────────────${NC}"
echo -e "${GREEN}${BOLD}Setup complete!${NC}"
echo ""
echo "Next steps:"
echo "  1. Fill in the API keys in .env.local (get values from your team lead)"
echo ""
echo "  2. Google OAuth — add the redirect URI in Google Cloud Console:"
echo "       http://localhost:3002/api/auth/callback/google"
echo "     Also add your Google email as a Test User:"
echo "       APIs & Services → OAuth consent screen → Test users"
echo ""
echo "  3. Slack OAuth — get SLACK_CLIENT_ID + SLACK_CLIENT_SECRET from your team lead."
echo "     The Slack app is shared. You connect your own Slack account from the Sources page."
echo ""
echo "  4. Start the dev server:"
echo "       bun run dev -- --port 3002"
echo ""
echo "  5. Open http://localhost:3002"
echo ""
echo "See README.md for full instructions and troubleshooting."
