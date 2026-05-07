# Docker Spike — Validate gbrain in a Linux container

**Goal:** prove the gbrain CLI can be installed in Docker and successfully `put` a page into a containerized Postgres. If this works, the Phase 1 deploy path (Railway) is unblocked.

## Run it

```bash
cd docker-spike
docker compose up --build --abort-on-container-exit
```

## Pass criteria

The `gbrain` container should exit 0 with `==> ALL GREEN` in the logs.

## What this validates

1. Bun installs cleanly in a Linux container
2. `git clone gbrain && bun install && bun link` works in Linux (we've only ever done this on macOS)
3. `gbrain apply-migrations --yes` succeeds against pgvector/pg17
4. `gbrain put` writes to the `pages` table successfully
5. The container can talk to Postgres over the docker network

## What this does NOT validate

- Embedding generation (needs OPENAI_API_KEY — out of scope for this spike)
- Next.js app shelling out to gbrain (separate concern, easier to verify once spike passes)
- Railway-specific networking (test in cloud separately if spike passes)

## Cleanup

```bash
docker compose down -v
```
