# Documentation Index

Start here. Each doc is self-contained but cross-links where useful.

---

## Architecture & decisions

- **[design-decisions.md](./design-decisions.md)** — Running ADR-style log of every significant architectural choice with the *why* and tradeoffs. **Read this first** if you're new to the codebase or trying to understand why something is shaped the way it is.

## Infrastructure foundations

- **[shared-db-rls.md](./shared-db-rls.md)** — Phase 1: single shared `mettrie_meta` Postgres database with Row Level Security on every tenant table. The `withUser()` pattern. Why it's the security wall.
- **[postgres-queue.md](./postgres-queue.md)** — Phase 2: Postgres-backed job queue, `SELECT FOR UPDATE SKIP LOCKED`, per-user concurrency cap, retry/reaper logic, cron-driven drain.

## Billing & operations

- **[api-keys-and-billing.md](./api-keys-and-billing.md)** — How LLM API keys are handled. `SHARED_KEY_MODE` (off / trial / org), user-key precedence, daily cost cap, the banner UX, the `/usage` dashboard, deployment scenarios.
- **[deployment.md](./deployment.md)** — Operational: Railway deploy, env vars, cron config, migration step. **§0 is the Railway-specific quickstart — read first if deploying to Railway**, since the platform's default `DATABASE_URL` is a superuser and bypasses RLS.

## Feature docs (intelligent surface)

- **[tier-1-intelligent-ui.md](./tier-1-intelligent-ui.md)** + **[tier-1-intelligent-ui-brief.md](./tier-1-intelligent-ui-brief.md)** — Tier 1: streaming `/ask`, dynamic opener + suggestions, /overview becoming a "thinking partner" instead of a dashboard.
- **[tier-2-digests.md](./tier-2-digests.md)** — Tier 2: proactive daily brief, bento hub on `/overview`, commitments tracker, AI Memories, recipes, thumbs feedback, adaptive recap, Opportunities card.
- **[tier-3-workflows.md](./tier-3-workflows.md)** — Tier 3: user-creatable scheduled workflows, cron presets + custom cadences, NL workflow generator, /overview surfacing, the workflow run drawer.
- **[skills.md](./skills.md)** — User-creatable skills invokable in `/ask`. NL drafter + pill + slash autocomplete UX.
- **[file-uploads.md](./file-uploads.md)** — Files as a source: parser dispatch, integration with the email extraction pipeline.

## Roadmap

- **[roadmap.md](./roadmap.md)** — Infrastructure phases 3-5 (separate worker, per-user LLM keys, S3 for raw_json).
- **[intelligent-ui-roadmap.md](./intelligent-ui-roadmap.md)** — Tier-by-tier roadmap with what's shipped, what's deferred, why.

---

## How to navigate this

**"I want to understand a specific feature"** → look in *Feature docs*.
**"Why does the code do X this way?"** → check *design-decisions.md*.
**"I'm deploying somewhere new"** → *deployment.md* + *api-keys-and-billing.md*.
**"Something looks weird in the DB / queue"** → *shared-db-rls.md* + *postgres-queue.md*.
**"What's next on the roadmap?"** → *intelligent-ui-roadmap.md*.

---

## How to contribute

When you ship a significant change:

1. If it introduces a non-trivial design decision, **append** an entry to `design-decisions.md` (don't edit older ones — the history is the value).
2. If it's a new feature, write a self-contained doc in `docs/` and add a line here.
3. If it changes how existing features work, update the relevant feature doc *and* note the change with a "Last updated" line at the top.
4. Cross-link generously. Future-you will thank you.
