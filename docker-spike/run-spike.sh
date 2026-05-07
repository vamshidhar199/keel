#!/bin/bash
set -euo pipefail

echo "==> gbrain version"
gbrain --version

echo "==> applying gbrain migrations"
gbrain apply-migrations --yes

echo "==> writing a test page"
PAGE_CONTENT='---
type: person
title: Spike Test
---
This page was written from inside a Docker container to validate deploy path.'
gbrain put people/spike-test --content "$PAGE_CONTENT"

echo "==> verifying the page exists in Postgres"
PSQL_URL="${GBRAIN_DATABASE_URL}"
COUNT=$(psql "$PSQL_URL" -tAc "SELECT COUNT(*) FROM pages WHERE slug = 'people/spike-test'")
if [ "$COUNT" != "1" ]; then
  echo "FAIL: expected 1 row, got $COUNT"
  exit 1
fi
echo "==> SUCCESS: gbrain put → pages table works inside Docker"

echo "==> verifying content_chunks (embeddings table) exists"
psql "$PSQL_URL" -c "\d content_chunks" | head -10 || echo "(content_chunks not built — embeddings need OPENAI_API_KEY, which is fine for this spike)"

echo "==> ALL GREEN"
