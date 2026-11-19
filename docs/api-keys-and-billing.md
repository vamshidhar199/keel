# API Keys & Billing

> How Keel handles LLM API keys — who pays, when, and how to deploy for solo / company / public launch scenarios.
> See also: [`design-decisions.md`](./design-decisions.md) DD-4 for the rationale.

---

## The contract

Keel needs two API keys to function:
- **Anthropic** — for Haiku (extraction, recipes, NL drafters) and Sonnet (page composition, /ask synthesis, NL generators)
- **OpenAI** — for embeddings (`text-embedding-3-large` → pgvector content_chunks)

A key can come from either source:
1. **The user pasted it in Settings → Developer.** Stored encrypted (AES-256-GCM via `lib/crypto.ts`) in `user_api_keys.{anthropic,openai}_api_key`.
2. **The deployment's shared key** (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` env vars). Whether the system falls back to this is controlled by `SHARED_KEY_MODE`.

**User keys always win.** When both are present, the user's key is used.

---

## The three modes — `SHARED_KEY_MODE`

| Mode | Shared fallback | Banner when both user keys empty | `/usage` source label |
|---|---|---|---|
| `off` | ❌ disabled | 🔴 "Connect your API keys" | Shared never used |
| `trial` | ✅ enabled | 🟡 "You're on the free trial" + budget gauge + "add your own keys" CTA | "Free trial (shared)" |
| `org` | ✅ enabled | (silent — no banner) | "Shared key (org)" |

### `off` — BYO public deploy
Every user MUST configure their own keys before anything works. Use for public launches where you don't want to subsidize anyone.

```
SHARED_KEY_MODE=off
# ANTHROPIC_API_KEY / OPENAI_API_KEY can be unset entirely
```

### `trial` — controlled free trial
Shared fallback active, but the global daily cap (`SHARED_DAILY_USD_CAP`, default $10/day) bounds your risk. Banner pushes users to BYO. Use for Product Hunt launches.

```
SHARED_KEY_MODE=trial
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-proj-...
SHARED_DAILY_USD_CAP=20    # optional, default 10
```

### `org` — intentional shared setup
Shared fallback active, treated as policy. No banner — the company's API key is the expected default. Individual users CAN paste their own key to override; most won't. Use for:
- Solo deploys (you're the only user)
- Company-wide deploys where one corporate API account serves all employees

```
SHARED_KEY_MODE=org
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-proj-...
SHARED_DAILY_USD_CAP=200   # optional, lift the ceiling for org-scale
```

### Default behavior (env var unset)
- `NODE_ENV != 'production'` → `'trial'` (local "just works")
- `NODE_ENV == 'production'` → `'off'` (safe by default)

### Legacy compat
`SHARED_API_FALLBACK=true|false` is still honored as `trial|off` when `SHARED_KEY_MODE` is unset.

---

## The cost cap chain

When a shared-key call happens, three caps could fire (cheapest first):

| Cap | Scope | Configured by | What happens on hit |
|---|---|---|---|
| **`DAILY_SOFT_CAP_USD = 5`** | Per user, last 24h | Hardcoded in `lib/anthropic.ts` + `lib/embeddings.ts` | Throws "Daily LLM spend cap reached for user X". This applies to **both** user-key and shared-key calls — it's per-user. |
| **`SHARED_DAILY_USD_CAP`** | Across all users, shared key only, last 24h | Env var (default $10) | Throws `SharedFallbackExhaustedError` with friendly "trial booked" message. User-key calls unaffected. |
| **Anthropic / OpenAI's own limits** | Per-account | The upstream provider | 429 / 403 surfaces as a server error today (no specific handler yet). |

The shared cap is checked via cached SUM query (10s cache window) so it doesn't hit the DB on every LLM call.

---

## Key resolution flow

`lib/llm-keys.ts:resolveAnthropicKey(userId)` / `resolveOpenAIKey(userId)`:

```
1. SELECT {anthropic,openai}_api_key FROM user_api_keys WHERE user_id = $userId
2. Decrypt. If present and non-empty:
       return { key, source: 'user' }
3. else: check sharedFallbackEnabled() (= mode != 'off')
4. If shared enabled AND env var set:
       check SUM(cost_usd) WHERE key_source='shared' over 24h
       if total >= SHARED_DAILY_USD_CAP:
           throw SharedFallbackExhaustedError
       else:
           return { key: env_var, source: 'shared' }
5. else: throw MissingKeyError("Anthropic") or ("OpenAI")
```

Every call to `callClaude` / `embedText` runs this, gets back `{ client, source }`, and passes `source` through to `logCost` which writes it into `llm_costs.key_source`.

---

## The banner — `KeysSetupBanner`

Server-rendered into `app/(app)/layout.tsx`, appears across every authenticated page when keys are missing. Computes its state from:
- `userHasOwnKeys(userId)` → `{ anthropic: bool, openai: bool }`
- `getSharedStatus()` → `{ enabled, mode, spentUsd, capUsd, exhausted }`

**Decision table:**

| User keys | Shared mode | Shared budget | Banner |
|---|---|---|---|
| Both set | (any) | (any) | (none) |
| One missing | (any) | (any) | 🟡 amber "Missing your X key" |
| Both missing | `off` | n/a | 🔴 red "Connect your API keys" |
| Both missing | `trial` | OK | 🟡 amber "You're on the free trial" + budget hint |
| Both missing | `trial` | exhausted | 🔴 red "The free trial is fully booked" |
| Both missing | `org` | OK | (none) — silent |
| Both missing | `org` | exhausted | (none) — `/usage` shows the cap hit instead |

The banner has a single CTA → `/settings#api-keys`.

---

## The `/usage` dashboard

Reads from `llm_costs` for the current user:
- **3 stat cards**: spend today (24h), 7d, 30d, with call counts
- **14-day bar chart** of daily spend
- **By source**: how much was paid by the user's own key vs the shared key. Label adapts to `mode`:
  - `trial` mode → "Free trial (shared)"
  - `org` mode → "Shared key (org)"
- **By model**: per-model breakdown (Haiku / Sonnet / embedding)
- **Token totals**: input + output, 30d
- **Shared budget gauge**: when shared mode is on, shows X of $Y used with a progress bar (red when exhausted)

Linked from `/settings` under a "Usage" section.

---

## Deployment scenarios

### Local dev (your laptop)
```env
SHARED_KEY_MODE=org      # (or leave unset — defaults to 'trial')
ANTHROPIC_API_KEY=...    # your personal key
OPENAI_API_KEY=...       # your personal key
```
You're the only user. Set `org` mode to suppress the trial banner. Local "just works" without pasting your key into Settings (since you ARE the env var).

### Public launch (Product Hunt)
```env
SHARED_KEY_MODE=trial
ANTHROPIC_API_KEY=...    # your account; bound by SHARED_DAILY_USD_CAP
OPENAI_API_KEY=...
SHARED_DAILY_USD_CAP=15  # ~$450/month max exposure
```
Users see the trial banner. Cost is bounded by the daily cap. Users who want full control paste their own keys; their calls then route through their own account and are tagged `'user'` in costs.

### Public launch, BYO-only
```env
SHARED_KEY_MODE=off
# ANTHROPIC_API_KEY / OPENAI_API_KEY unset
```
Users see the red "configure your keys" banner. Nothing works until they paste keys. Zero financial exposure for you.

### Company deploy (corporate IT setup)
```env
SHARED_KEY_MODE=org
ANTHROPIC_API_KEY=...       # company Anthropic account
OPENAI_API_KEY=...          # company OpenAI account
SHARED_DAILY_USD_CAP=500    # company budget ceiling
```
Employees sign in with their Google Workspace account, never see a banner, never need to paste keys. All API costs hit the corporate accounts. Admin watches the `/usage` dashboard or queries:
```sql
SELECT user_id, model, SUM(cost_usd)
FROM llm_costs
WHERE key_source='shared' AND called_at > now() - INTERVAL '30 days'
GROUP BY user_id, model
ORDER BY SUM(cost_usd) DESC;
```

---

## Auditing

Every LLM call writes a row to `llm_costs` with:
- `user_id` (who triggered it)
- `model` (e.g. `claude-haiku-4-5-20251001`)
- `input_tokens` + `output_tokens`
- `cost_usd` (computed from current pricing table in `lib/anthropic.ts:pricing`)
- `key_source` (`'user'` or `'shared'`)
- `called_at`

This is the only billing-relevant audit log. Decrypted content never lands here.

---

## Failure modes (not yet handled)

- **User's key gets revoked mid-day.** Currently surfaces as an Anthropic 401 → server 500. No banner is shown. *TODO: catch upstream auth errors, mark the user's key as "needs attention," show a banner, pause their workflows.*
- **Rate-limit (429) bursts.** Surfaces as a generic error. *TODO: exponential backoff in `callClaude` for transient 429s.*
- **OpenAI down but Anthropic up.** Extraction stalls because embeddings fail; brain stops getting new pages. No surfacing. *TODO: status indicator on `/sources`.*

These are tracked as part of the launch-readiness checklist (see [`design-decisions.md`](./design-decisions.md) and chat history with maker).

---

## Files

| Path | Role |
|---|---|
| `lib/llm-keys.ts` | `resolveAnthropicKey`, `resolveOpenAIKey`, `getSharedKeyMode`, `getSharedStatus`, `userHasOwnKeys`, error classes |
| `lib/anthropic.ts` | `callClaude`, `callClaudeWithWebSearch`, `streamClaudeWithWebSearch` — propagate `source` into `logCost` |
| `lib/embeddings.ts` | `embedText` — propagate `source` into `logCost` |
| `lib/crypto.ts` | AES-GCM encrypt/decrypt — gates the keys at rest |
| `app/components/keys-setup-banner.tsx` | Banner component, mounted in `app/(app)/layout.tsx` |
| `app/(app)/usage/page.tsx` | Usage dashboard |
| `app/api/settings/api-keys/route.ts` | POST handler for the Settings paste box (encrypts + stores) |
| `lib/migrate.ts` | `llm_costs.key_source` column |
| `.env.example` | Documented env vars |
