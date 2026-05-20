# Tier 1 Intelligent UI — implementation spec

> **Status:** implemented (kept for the *why*). The spec below describes the originally-scoped scope; see "What also shipped beyond the spec" right below for the additions made during implementation.
> **Originally scoped:** 1.1, 1.2, 1.3, 1.6, 1.7. Items 1.4 and 1.5 were deferred and remain so.

---

## What also shipped beyond the spec

The original spec covered landing change, opener, dynamic suggestions, admin-surface moves, and copy. While iterating on the live page, several additions were made:

| Addition | Files | Why |
|---|---|---|
| **Streaming `/api/query`** | `app/api/query/route.ts`, `lib/anthropic.ts` (`streamClaudeWithWebSearch`), `lib/synthesize.ts` (`synthesizeAnswerStream`) | The non-streaming flow felt slow ("looks broken"). Switched to NDJSON streaming with phase events: `searching` → `reading {count}` → `thinking` → `delta` ×N → `citations` → `done`. |
| **Status pills + streaming cursor** | `ask-client.tsx` (`<StatusPill>`, `<StreamingTurn>`) | Show users the model is *working*, not hung. First-person copy ("Searching your inbox…", "Reading N sources…", "Thinking it through…"). |
| **Real markdown rendering** | new `app/(app)/ask/render-markdown.tsx`; deps: `react-markdown`, `remark-gfm`, `rehype-raw` | Old custom regex renderer only handled `**bold**` and `[chunk:N]`. Headings, lists, links, code, tables, blockquotes now render properly. Custom node overrides keep the in-house glass-card aesthetic. |
| **Sidebar hover-to-expand** | `app/components/sidebar.tsx`, `app/(app)/layout.tsx` (`ml-64` → `ml-16`) | Reclaim horizontal real estate for the conversation column; collapsed sidebar shows icons + active indicator, expands to 256px on hover with labels fading in. |
| **Message styling pivot** | `ask-client.tsx` (`<UserPill>`, `<AssistantTurn>`) | User questions render as a gradient pill on the right; assistant turns get a sparkle (`auto_awesome`) avatar header above a glass-card bubble. Matches the chat-product reference (Claude.ai / ChatGPT). |
| **Empty-state design iterations** | `ask-client.tsx`, `app/globals.css` | Two iterations: an editorial/serif direction (rejected) and the current Claude.ai-style chat-bubble + 3-card grid (kept). |
| **Sidebar nav reduced to Ask + Home** | `sidebar.tsx`, `settings/page.tsx` ("Your knowledge" section) | Extension of 1.6: `/pages` and `/graph` also moved under Settings alongside `/sources`. Conversation is now the only top-level surface; data exploration is a deliberate detour. |
| **1.4 superseded by Tier 2 bento hub** | `app/(app)/overview/page.tsx` | The original 1.4 ("Recent thinking" stream as one-sentence cards) was deferred and is now effectively replaced by the proactive bento hub on `/overview` — see `docs/tier-2-digests.md`. The "Active threads" card serves the same intent (recently-touched pages) without per-card LLM cost. |

The original Tier 1 spec is preserved in full below. Treat it as the *intent* document; the live code is the source of truth for what's actually there.

---

## Implementation order (after approval)

1. `lib/migrate.ts` + `lib/briefing.ts` + tests
2. 1.1 (landing) + 1.6 (admin surfaces) + 1.7 (copy)
3. 1.2 + 1.3 (server-prefetched `/ask`)

Each step should be independently reviewable.

---

## 1.1 — Default landing = `/ask`

Three touch points. No logic changes — pure redirect/nav changes.

### Touch point 1 — authenticated redirect on root page

**File:** `app/page.tsx:6`

```diff
- if (session?.user?.id) redirect("/overview");
+ if (session?.user?.id) redirect("/ask");
```

### Touch point 2 — post-login redirect target

**File:** `app/page.tsx:31`

```diff
- await signIn("google", { redirectTo: "/overview" });
+ await signIn("google", { redirectTo: "/ask" });
```

### Touch point 3 — sidebar NAV order + logo href + Sources removal

**File:** `app/components/sidebar.tsx`

NAV array (lines 9–15): reorder so Ask is first, rename Dashboard→Home, remove Sources (moves to Settings in 1.6).

```diff
 const NAV = [
-  { href: "/overview", label: "Dashboard", icon: "dashboard" },
-  { href: "/ask", label: "Ask", icon: "chat_bubble" },
+  { href: "/ask", label: "Ask", icon: "chat_bubble" },
+  { href: "/overview", label: "Home", icon: "home" },
   { href: "/pages", label: "Pages", icon: "folder_copy" },
   { href: "/graph", label: "Graph", icon: "account_tree" },
-  { href: "/sources", label: "Sources", icon: "hub" },
 ];
```

Logo href (line 20):

```diff
- <Link href="/overview" className="block">
+ <Link href="/ask" className="block">
```

---

## 1.2 + 1.3 — Dynamic opener and suggested questions

### Migration — `user_briefings` table

**File:** `lib/migrate.ts`

Add a new schema constant above `runMigrations`:

```typescript
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
```

Add Step 8 to `runMigrations()`, after the existing Step 7 grants block:

```typescript
// Step 8: user_briefings cache table
try {
  await db.query(SCHEMA_BRIEFINGS);
  console.log("[migrate] user_briefings ok");
} catch (err) {
  console.error("[migrate] user_briefings failed:", (err as Error).message);
}
```

### Cache helper — `lib/briefing.ts`

New file. The `getOrGenerate` function keeps the LLM call outside the DB transaction to avoid holding a connection while waiting on Claude.

```typescript
import { withUser } from "./db";

export type JsonValue =
  | string | number | boolean | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export async function getOrGenerate(
  userId: string,
  kind: string,
  ttlSeconds: number,
  generator: () => Promise<JsonValue>
): Promise<JsonValue> {
  const cached = await withUser(userId, async (client) => {
    const { rows } = await client.query<{ content: JsonValue }>(
      `SELECT content FROM user_briefings
       WHERE user_id = $1 AND kind = $2
         AND generated_at > NOW() - ($3::numeric * interval '1 second')`,
      [userId, kind, ttlSeconds]
    );
    return rows.length > 0 ? rows[0].content : null;
  });

  if (cached !== null) return cached;

  const content = await generator();

  await withUser(userId, async (client) => {
    await client.query(
      `INSERT INTO user_briefings (user_id, kind, content, generated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id, kind)
       DO UPDATE SET content = EXCLUDED.content, generated_at = NOW()`,
      [userId, kind, JSON.stringify(content)]
    );
  });

  return content;
}
```

**Cache key format.** Both kinds include the current `YYYY-MM-DD` date so a cached "today" opener cannot bleed past midnight. The date is computed server-side in UTC. Example keys: `ask_opener:2026-05-14`, `ask_suggestions:2026-05-14`.

**TTL.** 3600 seconds (1 hour) for both kinds.

### Tests — `lib/__tests__/briefing.test.ts`

Three test cases:

1. **Cache hit** — `withUser` returns a non-null row; `generator` is never called; the cached value is returned.
2. **Cache miss** — `withUser` returns null; `generator` is called once; the upsert is called with the result.
3. **Generator error** — `generator` throws; `getOrGenerate` propagates the error and the upsert is not called.

Mock `withUser` and `generator` only. Do not mock `callClaude`.

### `/ask` data flow — server + client split

#### New file: `app/(app)/ask/ask-client.tsx`

Rename the current `AskPage` default export to `AskClient`. Add props:

```typescript
interface AskClientProps {
  opener: string | null;
  suggestions: Array<{ icon: string; label: string; statVar: string }> | null;
}
```

Move the `SUGGESTED` const into this file (it is no longer referenced from the server component).

In the empty-state render block (currently around line 121), when `messages.length === 0 && !loading`:

- Use `suggestions ?? SUGGESTED` for the button list.
- If `opener` is not null, render it between the icon and the h2:

```tsx
{opener && (
  <p className="text-sm mb-4" style={{ color: "var(--c-muted)" }}>
    {opener}
  </p>
)}
```

Apply the 1.7 copy changes to this file as well (see §1.7).

#### Rewritten `app/(app)/ask/page.tsx`

Replace the file entirely with a server component. No `"use client"` directive.

```typescript
import { auth } from "@/auth";
import { listPages } from "@/lib/gbrain";
import { getOrGenerate } from "@/lib/briefing";
import { callClaude, HAIKU } from "@/lib/anthropic";
import { withUser } from "@/lib/db";
import { AskClient } from "./ask-client";

const TTL = 3600;

function todayKey(prefix: string): string {
  return `${prefix}:${new Date().toISOString().slice(0, 10)}`;
}

export default async function AskPage() {
  const session = await auth();
  const userId = session!.user!.id;

  const recentPages = await listPages(userId, { limit: 5 });

  if (recentPages.length < 5) {
    return <AskClient opener={null} suggestions={null} />;
  }

  const pageList = recentPages
    .map((p) => `- ${p.title}${p.type ? ` (${p.type})` : ""}`)
    .join("\n");

  const [opener, suggestionsRaw] = await Promise.all([
    getOrGenerate(userId, todayKey("ask_opener"), TTL, async () => {
      const last24h = await withUser(userId, async (client) => {
        const { rows } = await client.query<{ title: string; type: string }>(
          `SELECT title, type FROM pages
           WHERE user_id = $1 AND updated_at > NOW() - INTERVAL '24 hours'
           ORDER BY updated_at DESC LIMIT 20`,
          [userId]
        );
        return rows;
      });
      if (last24h.length === 0) return null;
      const context = last24h
        .map((p) => `- ${p.title}${p.type ? ` (${p.type})` : ""}`)
        .join("\n");
      return callClaude(
        userId,
        HAIKU,
        [{ role: "user", content: `Pages updated in the last 24 hours:\n${context}\n\nWrite exactly 2 sentences about what you notice. Start with "I noticed" or "I've been watching" or similar. Be specific — name topics, people, or themes. Do not use words like "great", "amazing", or "excited".` }],
        {
          system: "You are Mettrie, a personal knowledge system. You speak in first person. You are observant and direct — never sycophantic.",
          maxTokens: 150,
        }
      );
    }),
    getOrGenerate(userId, todayKey("ask_suggestions"), TTL, async () => {
      const raw = await callClaude(
        userId,
        HAIKU,
        [{ role: "user", content: `The 5 most recent pages in this user's knowledge base:\n${pageList}\n\nReturn a JSON array of exactly 3 questions the user would want to ask about their own data today. Be specific to this content. Return only valid JSON — no preamble.\n\nExample: ["Who has been most active in my inbox?", "What's the status of Project X?", "What needs my reply today?"]` }],
        {
          system: "You are Mettrie, a personal knowledge system. Generate timely, specific questions a user would ask about their own data.",
          maxTokens: 300,
        }
      );
      try {
        return JSON.parse(raw as string) as string[];
      } catch {
        return null;
      }
    }),
  ]);

  const suggestionsArray = Array.isArray(suggestionsRaw)
    ? (suggestionsRaw as string[]).slice(0, 3).map((label, i) => ({
        icon: ["trending_up", "groups", "description"][i],
        label,
        statVar: (["stat2", "stat1", "stat3"] as const)[i],
      }))
    : null;

  return (
    <AskClient
      opener={typeof opener === "string" ? opener : null}
      suggestions={suggestionsArray}
    />
  );
}
```

---

## 1.6 — Move admin surfaces

### `app/components/sidebar.tsx` — remove Sources from NAV

Already covered in §1.1 touch point 3. The NAV array after the change has 4 items: Ask, Home, Pages, Graph.

### `app/(app)/settings/page.tsx` — add Data section with Sources link

Add a new `<section>` between the Developer section and the Session (sign-out) section:

```tsx
{/* Data */}
<section>
  <p className="text-[10px] uppercase tracking-widest mb-3" style={{ color: "var(--c-subtle)" }}>Data</p>
  <div className="glass-card rounded-xl overflow-hidden">
    <Link
      href="/sources"
      className="flex items-center justify-between px-5 py-4 transition-opacity hover:opacity-80"
      style={{ borderBottom: "1px solid var(--c-divider)" }}
    >
      <div>
        <p className="text-sm font-medium" style={{ color: "var(--c-fg)" }}>Sources</p>
        <p className="text-xs mt-0.5" style={{ color: "var(--c-subtle)" }}>Gmail sync, extraction status</p>
      </div>
      <span className="material-symbols-outlined text-xl leading-none" style={{ color: "var(--c-muted)" }}>chevron_right</span>
    </Link>
  </div>
</section>
```

Add `import Link from "next/link";` to the file (it doesn't currently import Link).

### `app/(app)/overview/page.tsx` — remove System Status pill and stats grid

**Remove System Status pill** (lines 26–34): delete the `<div className="glass-card ...">` block in the header. Header becomes:

```tsx
<header className="header-glass sticky top-0 h-16 flex items-center px-6 z-30">
  <h1 className="text-2xl font-bold" style={{ color: "var(--c-fg)" }}>Home</h1>
</header>
```

**Replace stats grid** (lines 47–72) with a placeholder. Keep the `extractionStatus` variable in the Promise.all destructuring — 1.4 will consume it.

```tsx
{/* TODO 1.4 — Recent thinking stream */}
```

Keep the `getExtractionStatus` import and call intact.

The `StatCard` component at the bottom of the file (lines 168–192) becomes unused. Delete it.

---

## 1.7 — Voice/copy pass

All string changes enumerated below. Tone: first-person, observational. Not sycophantic.

### `app/components/sidebar.tsx`

| Location | Old | New |
|---|---|---|
| Line 26 | `Enterprise Intelligence` | `Your thinking partner` |
| Line 55 | `Synthesize Knowledge` | `Ask me anything` |

### `app/(app)/ask/ask-client.tsx` (the renamed client component)

| Location | Old | New |
|---|---|---|
| h2 (was line 137) | `Knowledge Synthesis` | `What's on your mind?` |
| p subheading (was line 139) | `Query your personal data landscape. Get answers with traceable sources.` | `I know your world. Ask me anything.` |

### `app/(app)/overview/page.tsx`

| Location | Old | New |
|---|---|---|
| header h1 (line 25) | `Overview` | `Home` |
| hero h2 (line 40–41) | `Welcome back, {firstName}.` | `Good to see you, {firstName}.` |
| hero p (line 43) | `Your personal knowledge system is ready.` | `Here's what I'm keeping track of.` |

---

## Risk mitigations (from the roadmap)

| Risk | Mitigation |
|---|---|
| Stale "today" opener past midnight | Cache key includes `YYYY-MM-DD` (`ask_opener:2026-05-14`). At midnight a new key is used; old rows are orphaned but harmless. |
| AI personality going saccharine | System prompt explicitly bars "great", "amazing", "excited". Opener prompt requires starting with "I noticed" or "I've been watching". |
| Admin surfaces hidden and unreachable | `/sources` is linked from Settings → Data section. The route itself is not deleted or restricted. |
| LLM call during DB transaction | `getOrGenerate` uses two separate `withUser` calls — one to check cache, one to upsert — with the `generator()` call in between. |
| Empty suggestion JSON from Claude | If `JSON.parse` throws, `suggestionsRaw` falls back to `null`; `AskClient` renders the static `SUGGESTED` const. |

---

## Files changed summary

| File | Change |
|---|---|
| `lib/migrate.ts` | Add `SCHEMA_BRIEFINGS` const + Step 8 in `runMigrations` |
| `lib/briefing.ts` | New file — `getOrGenerate` cache helper |
| `lib/__tests__/briefing.test.ts` | New file — 3 test cases |
| `app/(app)/ask/page.tsx` | Rewrite as server component |
| `app/(app)/ask/ask-client.tsx` | New file — renamed client component with `opener`/`suggestions` props |
| `app/components/sidebar.tsx` | NAV reorder, Sources removal, logo href, copy |
| `app/(app)/overview/page.tsx` | Remove pill + stats grid, rename header, update hero copy |
| `app/(app)/settings/page.tsx` | Add Data section with Sources link |
| `app/page.tsx` | Two redirect targets: `/overview` → `/ask` |
