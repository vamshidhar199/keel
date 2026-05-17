# Skills

> User-creatable named system-prompt addendums that shape how `/ask` responds. Inspired by Claude Skills / Custom GPTs.
> Status: shipped.

---

## What a skill is

A saved chunk of instructions the user can pick before asking a question. When the user invokes a skill in `/ask`, the skill's `instructions` get injected into the system prompt for that single turn.

Examples:
- "Always quote dollar amounts" → injects whenever invoked.
- "Reply in three bullets, no more" → terse output mode.
- "When I ask about people, always show how long it's been since we last talked."

Skills do **not** change which data the AI looks at (no filtering, no retrieval modifications) — they only modify behavior. That was a deliberate v1 scope choice.

---

## Data model

```sql
CREATE TABLE skills (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,                -- normalized for /command typeahead
  description TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL,        -- the system-prompt addendum
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  CONSTRAINT skills_user_slug_key UNIQUE (user_id, slug)
);
ALTER TABLE skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE skills FORCE ROW LEVEL SECURITY;
```

Per-user uniqueness on `(user_id, slug)` because the slug is what the user types in `/command` to invoke. `slugifySkillName` normalizes the name into a usable slug; if it collides, `uniqueSlug` appends a number.

---

## Creation

Two paths to create a skill:

### NL drafter (the killer UX)
`POST /api/skills/generate` takes `{ request: string }` like *"When I ask about people, always show how long it's been since we last talked"* and returns `{ draft: SkillDraft }` with `{ name, slug, description, instructions }`.

Behind the scenes (`lib/skills.ts:generateSkillFromNL`):
1. Sonnet call with a strict system prompt explaining what a skill is + the expected JSON shape.
2. Response goes through `parseSkillDraft()` — robust to fenced JSON, prose-wrapped JSON, missing fields, etc. Auto-derives slug if model didn't include one.
3. Returns the draft for the UI to display.

The draft is **non-persistent** — user reviews + saves explicitly through `POST /api/skills`.

### Manual editor
A form on `/skills` with fields for name, slug (auto-suggested), description, instructions. For users who prefer not to use the drafter.

---

## Invocation in `/ask`

Two parallel invocation paths, both wired into the chat input:

### Pill picker
A "Skills" chip above the chat input. Click → searchable dropdown of all enabled skills with type-to-filter, keyboard navigation (↑↓ + Enter), and a "None" option. Picking sets `activeSkillId` in component state + `localStorage` for persistence across reloads.

### Slash autocomplete
When the user types `/<prefix>` at the start of the input, a popover appears with matching skill slugs. Arrow keys to navigate, Enter to select. Picking sets the active skill **and clears the input** — the `/<slug>` text was just a command, not part of the question.

Both paths converge on the same `activeSkillId` state. The active skill renders as a badge above the input ("Skill: Three-bullet brief ✕") so the user knows it's active.

The chat input sends `skillId` in the POST body of `/api/query`.

### Server-side injection

`POST /api/query` does:
1. Look up the skill if `skillId` (or fallback `skillSlug`) is in the body. Disabled skills silently dropped.
2. Pass the skill's `instructions` as `skillInstructions` to `synthesizeAnswerStream`.
3. In synthesize, the final system prompt is composed as `[SYSTEM_PROMPT, ownerLine, <active_skill> block].join('\n\n')`. The skill block is XML-tagged: `<active_skill>\n${instructions}\n</active_skill>` so Sonnet treats it as a distinct directive.

---

## Settings management surface

`/skills` page mirrors the `/workflows` structure:
- **NL drafter hero card** at the top (always visible)
- **List** of saved skills with toggle (enabled/disabled) + delete + collapsible "Show instructions" reveal
- **"Write one manually"** collapsible — auto-opens for empty state

`/settings` has a "Skills" section linking to `/skills`.

Sidebar nav includes a "Skills" entry (icon `auto_fix_high`).

---

## Scaling past N skills

The pill dropdown is the obvious bottleneck at 20+ skills. We addressed this:
- **Auto-focused search input** at the top of the dropdown (filters by name OR slug OR description, case-insensitive substring).
- **Keyboard nav**: ↑↓ to move highlighted item, Enter to pick, Esc to close.
- **Mouse + keyboard cooperate**: hover updates the highlight too.
- **Empty state**: "No skill matches '…'" instead of an empty menu.
- The slash autocomplete already filtered by prefix and capped at 8 results.

---

## What skills are NOT

Worth being explicit:
- **Skills do not filter data.** Whatever search hits `/ask` finds, the skill sees. It can shape the response but not the inputs.
- **Skills are per-turn only.** Picking a skill doesn't change subsequent turns unless still selected.
- **No conversation memory of past skill picks.** Each turn is independent.
- **No shared skills.** Per-user only. No marketplace.

---

## Tests

`lib/__tests__/skills.test.ts` covers:
- `slugifySkillName` edge cases (emojis, special chars, length cap, fallback)
- `parseSkillDraft` (clean JSON, fenced, prose-wrapped, missing fields, garbage, auto-slug)
- CRUD lifecycle (create, read, by-slug, update, delete)
- Slug collision auto-resolve (`collide` → `collide-2`)
- `listSkills(true)` filter excluding disabled

RLS isolation tests confirm cross-user `skills` reads and writes are blocked.

---

## Deferred

- **Templates** (like the 4 hardcoded workflow templates). NL drafter + manual is enough; templates can come once we see what shapes users gravitate to.
- **Data-filtering skills** ("only finance pages"). v1 was system-prompt-only. Adding retrieval scopes is a much bigger change.
- **Curated reading list** in a skill (force specific pages into context). Same concern.
- **Skill sharing between users.** Marketplace-class.

---

## Files

| Path | Role |
|---|---|
| `lib/skills.ts` | CRUD + slugifier + NL drafter + parser |
| `app/api/skills/route.ts` + `[id]/route.ts` + `generate/route.ts` | API |
| `app/api/query/route.ts` | Looks up skill by id or slug, passes `instructions` to synthesize |
| `lib/synthesize.ts:synthesizeAnswerStream` | Optional `skillInstructions` param, injected as `<active_skill>` block |
| `app/(app)/skills/page.tsx` + `skills-client.tsx` | Management surface |
| `app/(app)/ask/skill-picker.tsx` | Pill dropdown + slash autocomplete client components |
| `app/(app)/ask/ask-client.tsx` | Wires picker into the chat input, persists `activeSkillId` in localStorage |
| `app/components/sidebar.tsx` | Skills nav entry |
