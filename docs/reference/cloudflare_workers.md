# Reference — Cloudflare Workers (Functions) backend

How Orchestrate's serverless backend works, end to end: the Cloudflare Pages Functions that run the **Google Calendar OAuth** flow (§1–§8) and **proxy Todoist** (§9), the variables and secrets, the KV storage, the security model, and the **cost/quota** picture (§10). This is the **conceptual / "how it works"** reference. For the **step-by-step setup** (Google Cloud + Cloudflare dashboard), see [../deployment.md](../deployment.md).

For where this sits in the broader app, see [synthesis.md §7 (External Integrations)](../synthesis.md). For the design rationale and the alternatives that were weighed, see [roadmap/engagement_record_strategy.md](../roadmap/engagement_record_strategy.md) (this is **option E2**) and [roadmap/persistence_and_backend_migration.md](../roadmap/persistence_and_backend_migration.md).

---

## 1. Why this exists

The original integration used the browser-only **Google Identity Services (GIS) token client** (roadmap option E1): a build-time client ID, no backend, access tokens minted directly in the browser and held only in memory. It works while a tab is open, but it can't hold a **refresh token** securely and can't write unattended.

Moving the static site to **Cloudflare Pages** brought same-origin **serverless Functions** into reach, which unlocked the **server-mediated auth-code flow** (option E2):

- The **client secret** and the long-lived **refresh token** live server-side (in the Worker + KV), never in the browser.
- The browser holds only a single **shared secret** and asks the Worker for short-lived access tokens on demand.
- This is the foundation for future **unattended** calendar writes (a server writing engagement events with no tab open), though no feature writes events yet — `createEvent` is still plumbing.

A side benefit: serving from `<project>.pages.dev` (or a custom domain) gives the app its **own origin**, so its `localStorage` is isolated — unlike GitHub Pages project sites, which all share the single `<user>.github.io` origin.

---

## 2. Architecture at a glance

```
Browser (SPA)                Pages Functions (Worker)            Google
  | enter shared secret           |                                |
  | Connect ───fetch /login──────▶| build consent URL (state HMAC) |
  | ◀──{ url }────────────────────|                                |
  | ──redirect──────────────────────────────────────────────────▶ | consent
  |                               | ◀──/callback?code&state─────── |
  |                               | exchange code → tokens         |
  |                               | store refresh_token in KV      |
  | ◀──redirect /settings?gcal=connected ─────────────────────────|
  | need a token ──fetch /token──▶| refresh_token → access_token   |
  | ◀──{ access_token }───────────|                                |
  | ──Bearer call──────────────────────────────────────────────▶  | Calendar API
```

Three trust zones:

| Zone | Holds | Notes |
|---|---|---|
| **Browser** | The shared secret (`localStorage`), a short-lived access token (in memory) | Never sees the client secret or the refresh token. |
| **Worker (Functions)** | Client ID/secret, the shared secret, signing logic | Stateless code; reads config from env, state from KV. |
| **Workers KV** | Refresh token, cached access token, granted scope | The only durable server-side state. |

---

## 3. The Cloudflare Functions

Pages Functions live in [`functions/`](../../functions/) at the repo root; the file path maps to the route. All OAuth endpoints are under `functions/api/auth/google/`. Files prefixed `_` are modules, not routes.

| File | Route | Method | Guard | Purpose |
|---|---|---|---|---|
| [`login.ts`](../../functions/api/auth/google/login.ts) | `/api/auth/google/login` | GET | shared secret | Builds the Google consent URL (with a signed `state`) and returns it as `{ url }`. |
| [`callback.ts`](../../functions/api/auth/google/callback.ts) | `/api/auth/google/callback` | GET | signed `state` | Google redirects here. Verifies `state`, exchanges the `code` for tokens, stores the refresh token in KV, redirects back into the app. |
| [`token.ts`](../../functions/api/auth/google/token.ts) | `/api/auth/google/token` | GET | shared secret | Returns a fresh access token (`{ access_token, expires_in }`) from the KV cache or minted via the refresh token. |
| [`status.ts`](../../functions/api/auth/google/status.ts) | `/api/auth/google/status` | GET | shared secret | Reports `{ connected, scope }` — whether a refresh token is held. |
| [`disconnect.ts`](../../functions/api/auth/google/disconnect.ts) | `/api/auth/google/disconnect` | POST | shared secret | Revokes the refresh token at Google and clears all KV keys. |
| [`_lib.ts`](../../functions/api/auth/google/_lib.ts) | — | — | — | Google-specific helpers: `Env` type, state HMAC, Google token calls, KV storage (wrapped to throw `GoogleWorkerError` on KV/upstream failure). Re-exports `json` + `requireAppSecret` from the top-level [`_shared.ts`](../../functions/_shared.ts) (no longer keeps its own copy). |

The `_redirects` file ([`public/_redirects`](../../public/_redirects)) provides the SPA deep-link fallback (`/* → /index.html 200`). Pages Functions match `/api/*` **before** the static `_redirects` rules, so the OAuth routes aren't swallowed by the catch-all.

**Shared guard + error model (both Google and Todoist functions).** Every secret-guarded endpoint enters through `requireAppSecret(request, env)` from [`_shared.ts`](../../functions/_shared.ts), which returns a ready `Response` (so the handler just `if (authError) return authError`):

| Condition | Status | `error` code |
|---|---|---|
| `APP_SHARED_SECRET` missing from the Worker env | `500` | `server_not_configured` |
| `X-App-Secret` missing or wrong | `401` | `unauthorized` |
| KV read/write threw | `503` | `storage_unavailable` |
| Upstream (Todoist / Google token endpoint) unreachable or non-JSON | `502` | `todoist_unreachable` / `google_unreachable` |

Distinguishing `server_not_configured` (500) from `unauthorized` (401) means a misdeployed Worker (no secret set) no longer masquerades as "wrong secret." KV/upstream failures surface as `503`/`502` instead of an unhandled `500`. The Google side raises these as a `GoogleWorkerError` from its KV/fetch wrappers, caught per-endpoint; the callback maps them to `?gcal=error&reason=<code>`. The frontend setup forms map each code to a human message ([`GoogleCalendarSetup.tsx`](../../src/components/settings/GoogleCalendarSetup.tsx) / [`TodoistSetup.tsx`](../../src/components/todoist/TodoistSetup.tsx)).

---

## 4. The OAuth flow, step by step

### 4.1 Connect (interactive consent)

1. The user enters the shared secret in **Settings → Integrations** (stored in `localStorage` under `orchestrate-cf-secret`) and clicks **Connect**.
2. The browser calls `GET /api/auth/google/login` with the `X-App-Secret` header. The Worker checks the secret, generates a signed `state`, and returns the Google consent URL.
3. The browser navigates to that URL. Google shows the consent screen. The URL requests `access_type=offline` + `prompt=consent`, which guarantees a **refresh token** is issued.
4. Google redirects to `GET /api/auth/google/callback?code=…&state=…`. The Worker verifies `state` (HMAC + freshness), then POSTs the `code` to Google's token endpoint **with the client secret** to get `{ access_token, refresh_token, expires_in, scope }`.
5. The Worker stores the refresh token (and scope, and a cached access token) in KV, then redirects the browser to `/settings?tab=integrations&gcal=connected`.
6. The Settings page sees `?gcal=connected`, calls `/status` to confirm, flips the UI to **Connected**, and loads the calendar list.

### 4.2 Using the calendar (minting access tokens)

Whenever the app needs to call the Calendar API (e.g. list calendars):

1. The provider checks its **in-memory** access-token cache; if valid, it uses it directly.
2. Otherwise it calls `GET /api/auth/google/token` (with `X-App-Secret`). The Worker:
   - returns the **KV-cached** access token if it isn't near expiry, else
   - calls Google's token endpoint with `grant_type=refresh_token` to mint a new one, re-caches it in KV, and returns it.
3. The browser uses the returned token as a `Bearer` header against `https://www.googleapis.com/calendar/v3/...` ([`src/lib/googleCalendarApi.ts`](../../src/lib/googleCalendarApi.ts)). Google's endpoints are CORS-friendly for Bearer requests, so these calls go **directly** browser→Google (no proxy).

### 4.3 Auto-reconnect on load

On startup — and whenever the shared secret changes (the provider reads it reactively via `useAppSecret`) — the provider calls `/status` once. If the server still holds a refresh token, the app is **Connected** without any user interaction; the connection survives reloads and works on any device once the shared secret is entered. The persisted `settings.googleCalendarConnected` flag is no longer the gate for this check — it's kept only as a cache of the last-known result, written **only when the value actually changes** (so a Todoist-only user who never connected Google doesn't incur a settings write on every load). ([`src/context/GoogleCalendarContext.tsx`](../../src/context/GoogleCalendarContext.tsx).)

### 4.4 Disconnect

**Disconnect** calls `POST /api/auth/google/disconnect`: the Worker revokes the refresh token at Google (best-effort) and deletes the KV keys. The browser clears its in-memory token and the `googleCalendarConnected` flag.

---

## 5. Variables & secrets

All server-side config lives on the **Cloudflare Pages project** (Settings → Environment variables / bindings), per environment (Production / Preview). None of it is baked into the frontend bundle.

| Name | Kind | Set where | Used by | What it does |
|---|---|---|---|---|
| `GOOGLE_CLIENT_ID` | Secret | Cloudflare env | Worker (`login`, `callback`, `token`) | Identifies the app to Google in the auth URL and token calls. |
| `GOOGLE_CLIENT_SECRET` | Secret | Cloudflare env | Worker (`callback`, `token`) | Authenticates the app to Google's token endpoint during code exchange + refresh. **Server-only — never shipped to the browser.** |
| `APP_SHARED_SECRET` | Secret | Cloudflare env | Worker (every guarded endpoint + state signing) | The single-user auth: guards the endpoints and is the HMAC key for OAuth `state`. The user enters the **same value** in the app. |
| `APP_ORIGIN` | Plaintext (optional) | Cloudflare env | Worker (`login`, `callback`) | Pins the canonical origin used to build the redirect URI + post-auth redirect. If unset, the Worker derives it from the request origin. See [deployment.md](../deployment.md) for picking this. |
| `OAUTH_KV` | KV binding | Cloudflare bindings + [`wrangler.toml`](../../wrangler.toml) | Worker (storage) | Binds the KV namespace holding the refresh token + cached access token + scope. |

Browser-side, the **only** related value is the shared secret in `localStorage` (`orchestrate-cf-secret`), sent as the `X-App-Secret` header on each request. It must equal `APP_SHARED_SECRET`. There are **no `VITE_*` env vars** for this integration anymore — the client ID moved server-side.

Local development uses the same names in a gitignored `.dev.vars` file (see [deployment.md](../deployment.md) Part D).

---

## 6. KV storage

The `OAUTH_KV` namespace holds three keys for the single user:

| Key | Shape | TTL | Notes |
|---|---|---|---|
| `google:refresh_token` | string | none | The long-lived refresh token. The crown jewel — never leaves the Worker. |
| `google:access_token` | JSON `{ access_token, expires_at }` | `expires_in` (≈1 hr) | Short-lived cache so repeated `/token` calls don't hammer Google. Auto-expires. |
| `google:scope` | string | none | The space-delimited granted scopes, surfaced by `/status`. |

`getAccessToken()` in `_lib.ts` reads the cache first, refreshes on miss, and — if Google replies `invalid_grant` (refresh token revoked/expired) — **clears all three keys** so the app cleanly reports "disconnected."

---

## 7. Security model

This is a **single-user personal tool**; the auth model is deliberately one shared secret, not accounts (see the roadmap's "at most one shared secret" framing).

- **Endpoint guard.** `login`, `token`, `status`, `disconnect` require `X-App-Secret === APP_SHARED_SECRET`. Without it, an attacker who finds the endpoint URL can't mint tokens, read status, or disconnect.
- **`callback` isn't secret-guarded** (Google calls it, and can't send a custom header). Instead it's protected by the **signed `state`**: `login` issues `state = <ts>.<nonce>.<HMAC-SHA256(ts.nonce, APP_SHARED_SECRET)>`, and `callback` rejects any `state` whose signature doesn't verify or that's older than 10 minutes. This is stateless CSRF protection — no server round-trip to store the nonce.
- **Secret separation.** The Google **client secret** and **refresh token** never reach the browser. A compromised browser leaks only the shared secret and a ≤1-hour access token — and the shared secret can be rotated (change `APP_SHARED_SECRET`, re-enter it) without touching Google.
- **Transport.** Everything is same-origin HTTPS (browser↔Worker) or HTTPS to Google. The shared secret travels in a request header, not the URL, so it doesn't land in browser history or referer logs.
- **What it is *not*.** The shared-secret comparison isn't constant-time, and there's no rate limiting — acceptable given a single high-entropy secret and a personal-scale tool. If `APP_SHARED_SECRET` leaks, rotate it; if you suspect the refresh token leaked, **Disconnect** (revokes at Google) or revoke access from your Google Account's security settings.

---

## 8. Frontend integration map

| File | Role |
|---|---|
| [`src/lib/googleAuth.ts`](../../src/lib/googleAuth.ts) | The Worker client: stores/reads the shared secret, and exposes `startGoogleLogin`, `fetchAccessToken`, `fetchConnectionStatus`, `disconnectGoogle`. "Configured" (shared secret set) is read reactively via the `useAppSecret` hook. |
| [`src/context/GoogleCalendarContext.tsx`](../../src/context/GoogleCalendarContext.tsx) | Provider: in-memory access-token cache, connection state, `connect`/`disconnect`/`checkConnection`/`refreshCalendars`/`createEvent`, auto-reconnect on load. |
| [`src/lib/googleCalendarApi.ts`](../../src/lib/googleCalendarApi.ts) | Thin Calendar REST v3 client; takes a Bearer access token. Unchanged by the OAuth migration. |
| [`src/components/settings/GoogleCalendarSetup.tsx`](../../src/components/settings/GoogleCalendarSetup.tsx) | Settings UI: shared-secret entry, Connect/Disconnect, calendar picker, and the `?gcal=` post-redirect handling. |

The only client-persisted state is the `orchestrate-cf-secret` localStorage key and the `googleCalendarConnected` flag in settings; the access token is memory-only and the refresh token is server-only.

---

## 9. Todoist token proxy (same machinery)

The Todoist integration (v7.2) reuses this exact backend pattern — the **same** `OAUTH_KV` namespace and `APP_SHARED_SECRET`, just a different token and a simpler shape (a Todoist personal token never expires, so there's no refresh dance).

**Functions:**

| File | Route | Method | Guard | Purpose |
|---|---|---|---|---|
| [`functions/api/todoist/[[path]].ts`](../../functions/api/todoist/%5B%5Bpath%5D%5D.ts) | `/api/todoist/*` | any | shared secret | Catch-all **proxy**: reads `todoist:token` from KV, forwards the request to `https://api.todoist.com/*` with the `Authorization` header injected. |
| [`functions/api/todoist-auth/token.ts`](../../functions/api/todoist-auth/token.ts) | `/api/todoist-auth/token` | POST | shared secret | Validates the token (against Todoist `/projects`) and stores it in KV. |
| [`functions/api/todoist-auth/status.ts`](../../functions/api/todoist-auth/status.ts) | `/api/todoist-auth/status` | GET | shared secret | `{ configured }` — whether a token is held. |
| [`functions/api/todoist-auth/disconnect.ts`](../../functions/api/todoist-auth/disconnect.ts) | `/api/todoist-auth/disconnect` | POST | shared secret | Deletes `todoist:token` from KV. |
| [`functions/_shared.ts`](../../functions/_shared.ts) | — | — | — | The common backend helpers: `json`, `checkSecret`/`hasSharedSecret`, `requireAppSecret`, the `TodoistEnv` type, and the `TODOIST_API` / `todoist:token` constants. Used by the Todoist functions **and** re-exported (in part) by the Google `_lib.ts`. |

**KV key:** `todoist:token` (string; no TTL). **Why a proxy** (vs. the Google "mint a token for the browser" model): a Todoist personal token *is* the long-lived credential, so it must never reach the browser — the only safe shape is to keep it server-side and proxy every call. (Google's access tokens are short-lived and safe to hand to the browser, so Google returns a token instead of proxying.)

**Frontend:** [`src/lib/todoistApi.ts`](../../src/lib/todoistApi.ts) sets `API_BASE = /api/todoist/api/v1` (same-origin, dev + prod) and exposes `getTodoistStatus` / `storeTodoistToken` / `disconnectTodoist`; [`src/context/TodoistContext.tsx`](../../src/context/TodoistContext.tsx) sends `X-App-Secret` on every call (no token in the browser) and resolves `isConfigured` from `/status`; [`src/components/todoist/TodoistSetup.tsx`](../../src/components/todoist/TodoistSetup.tsx) holds the shared-secret + token entry. The shared secret itself lives in [`src/lib/appSecret.ts`](../../src/lib/appSecret.ts) (used by both integrations; `googleAuth.ts` re-exports it). The legacy `settings.todoistToken*` fields are deprecated.

**Dev caveat:** like the Google flow, the proxy only runs under `wrangler pages dev` — plain `npm run dev` has no Functions, so Todoist shows the connect prompt.

---

## 10. Cost & quotas

**The Todoist proxy is per-request, not one-time.** Because the token lives server-side, the browser can't call Todoist directly — every Todoist operation (schedule, reschedule, complete, habit sync, task/project refresh) is **1 Function invocation + 1 KV read** (`todoist:token`). The Google endpoints are likewise per-call. This is intrinsic to the security model and can't be avoided without putting the token back in the browser.

For a **single-user** tool that's effectively free — usage sits orders of magnitude inside Cloudflare's free tier.

**What's billed vs. not:**

- **Pages Functions invocations** (the `/api/*` calls) count as Workers requests.
- **Static asset requests** (the SPA's HTML/JS/CSS) are **free and unlimited** on Pages — loading the app costs nothing.
- Each proxied call = 1 invocation + 1 KV **read**. KV **writes** happen only on connect (token save), so they're negligible.

**Free-tier headroom** (Cloudflare's current tiers — verify, they adjust occasionally):

| Resource | Free plan | Realistic single-user load |
|---|---|---|
| Functions / Workers requests | ~100,000 / day | a few hundred → low thousands on a heavy planning day |
| KV reads | ~100,000 / day | = the call count (1 read each) |
| KV writes | ~1,000 / day | ~0 (only on connect) |

An intense hour of planning (100+ reschedules/completes plus periodic refreshes) is roughly **150–300 invocations** — ~0.2% of the daily free allowance. You'd need ~100,000 Todoist operations in a single day to approach the ceiling, which one person can't reach by hand.

**No surprise bill on the Free plan:** if the daily limit were ever hit, Functions return errors until the UTC reset rather than auto-charging. The Paid plan ($5/mo, ~10M requests/month included) is strictly opt-in.

**Already-present mitigations:** the frontend's stale-while-revalidate cache (≤5 min hydration, 30s focus-refresh dedup — see [synthesis.md §6.2](../synthesis.md)) means tab-switches and re-renders don't spam the proxy; only genuine mutations and stale refreshes invoke it.

**When this *would* matter** (none apply to Orchestrate): going **multi-user** (the only real volume multiplier — explicitly out of scope), a **cron/background Worker** hammering the API (we have none), or tens of thousands of ops/day. If ever needed, a short-lived in-Worker token cache could collapse the per-call KV read, but it's unnecessary at single-user scale.

---

## 11. See also

- [../deployment.md](../deployment.md) — step-by-step setup (Google Cloud client, Cloudflare project, KV, secrets, local dev, troubleshooting).
- [../synthesis.md](../synthesis.md) §7 (integrations), §11 (persistence) — where this fits in the app.
- [../roadmap/engagement_record_strategy.md](../roadmap/engagement_record_strategy.md) — option E1 vs E2, and the calendar-write feature this unlocks.
