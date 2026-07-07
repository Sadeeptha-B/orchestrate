# Orchestrate's Cloudflare backend — a walkthrough

This is the conceptual tour of Orchestrate's small serverless backend: the part that lets a browser-first app talk to Google Calendar and Todoist *safely*, sync its state across devices, and serve a handful of pre-approved users independently. It's written to be read top‑to‑bottom — each piece introduces the concept it needs (OAuth, refresh tokens, serverless Functions, KV, Cloudflare Access, JWTs, proxies) right where that concept first matters, and explains *why* the code is shaped the way it is, not just what it does.

If you just want the click‑by‑click setup (Google Cloud console, Cloudflare dashboard, Zero Trust), that's a separate page: [../deployment.md](../deployment.md). For where this sits in the wider app, see [synthesis.md §7](../synthesis.md); for the design history and the alternatives that were weighed, see the roadmap docs ([engagement_record_strategy.md](../roadmap/engagement_record_strategy.md) — this is **option E2** — and [persistence_and_backend_migration.md](../roadmap/persistence_and_backend_migration.md)).

---

## 1. The problem: a browser is a bad place to keep a secret

Orchestrate is a **static single‑page app** (SPA). Its working data — your plans, habits, sessions — lives in the browser's `localStorage` (mirrored to a small cloud store, §4a). There's no traditional app server. That's a deliberate, low‑cost design.

But two features need to reach *out* to other services:

- **Google Calendar** — to list your calendars and read/write events.
- **Todoist** — the source of truth for tasks; the app reads and writes them constantly.

Both require a **credential** — a secret string that proves "this app is allowed to act as you." And here's the tension that shapes this entire backend:

> A credential that can act as you, indefinitely, must **not** live in the browser.

Anything the browser holds is recoverable by anyone with access to that browser profile (and, for anything in the JS bundle, by literally anyone on the internet who views source). So the job of this backend is narrow and specific: **hold the credentials that can't safely live in the browser, mirror the app's data slices, and nothing else.** It is a credential vault, a request broker, and a small sync store — not an app server.

The two integrations need *different* kinds of credential, and that difference drives almost every decision below.

---

## 2. Two integrations, two kinds of credential

### Google Calendar uses OAuth

**OAuth 2.0** is the "Sign in with Google / allow this app to access your calendar" protocol. Instead of you handing your Google password to Orchestrate, Google issues the app scoped, revocable credentials. There are three secrets in play, with very different lifetimes and risk:

- **Client ID + client secret** — these identify *the application itself* to Google. The client secret must stay server‑side; it's what lets the app exchange codes for tokens.
- **Access token** — a short‑lived (~1 hour) bearer token used to actually call the Calendar API. "Bearer" means whoever holds it can use it, no questions asked — so short lifetimes matter.
- **Refresh token** — a long‑lived credential whose only job is to mint fresh access tokens when the old one expires. This is the crown jewel: with it, a server can act as you for as long as you don't revoke it. It absolutely cannot live in the browser.

The original version of this integration (the roadmap's **option E1**) used Google's browser‑only token client — it could never hold a refresh token, so the connection died with the tab. The current design is the **server‑mediated authorization‑code flow** (option E2), where the refresh token lives on the server. That's what §6 walks through.

### Todoist uses a personal token

Todoist is simpler and, in a way, blunter. You generate a **personal API token** in Todoist's developer settings — a single long‑lived string that *is* the credential. There's no OAuth dance, no short‑lived/long‑lived split: that one token can read and write your tasks forever, until you revoke it. Which means it's exactly the kind of secret that must never touch the browser. We'll see in §8 that this leads to a different shape than Google — a **proxy** rather than a token‑minting endpoint.

So: two integrations, both needing a server to hold a secret. Where does that server come from for a static site?

---

## 3. The enabling move: Cloudflare Pages + Functions

Orchestrate is hosted on **Cloudflare Pages**, which serves the static build (HTML/JS/CSS) from Cloudflare's edge. The thing that makes Pages more than just a file host is **Pages Functions**: small pieces of server‑side code that deploy *alongside* the static site and run on Cloudflare's **Workers** runtime.

A few concepts to introduce here, because they're load‑bearing:

- **Serverless / Workers.** You don't run or manage a server. You write a function; Cloudflare runs it on demand at the edge, scales it, and bills per invocation. The flip side is that the function is **stateless** — it keeps nothing between requests, so any durable state must go somewhere external (§4).
- **File‑based routing.** Functions live in a [`functions/`](../../functions/) directory at the repo root, and the file path *is* the URL path: `functions/api/auth/google/login.ts` answers `GET /api/auth/google/login`. Files whose names start with `_` (like `_shared.ts`) are treated as shared modules, not routes.
- **Same origin.** This is the quietly crucial part. The Functions are served from the *same domain* as the app (`yourapp.pages.dev/api/...`). Because the browser sees the app and the backend as one origin, requests between them are "same‑origin": no CORS to configure, and — since v7.10 — the **Cloudflare Access session cookie rides along automatically** on every call (§5). If the backend lived on a different domain, we'd be fighting CORS and cross‑site cookie rules the whole way.

So we now have somewhere to run server code, on the same origin as the app. Two questions remain: *where do the secrets actually sit* (§4), and *who is allowed to use our backend, and how do we tell users apart* (§5).

---

## 4. Where the secrets live: Workers KV

Our stateless Functions need to remember a few things between requests — each user's Google refresh token, their Todoist token, a cached access token. That's durable state, and a Worker can't hold it. We need external storage.

The requirement is modest and specific: **store a handful of small, long‑lived strings, and read one of them on essentially every request.** Cloudflare offers several storage products; **Workers KV** is the right fit: a globally‑replicated key‑value store with very fast edge reads, that binds to a Function in one line of config. (D1 — a real relational database — would be overkill for the credential store; it *is* used for the state sync, §4a. Durable Objects would add coordination we don't need; R2 is for blobs.)

KV has one characteristic to be aware of: it's **eventually consistent**. A write may take up to ~60 seconds to become visible everywhere on the globe. For us that's harmless — a person doesn't connect on their laptop and read from their phone in the same second, and the access‑token cache simply refreshes on a miss.

Concretely, the one KV namespace (bound as `OAUTH_KV`) holds a handful of keys **per user**, namespaced by the verified Access identity (§5):

| Key | Shape | TTL | Role |
|---|---|---|---|
| `user:<email>:google:refresh_token` | string | none | That user's long‑lived refresh token. Never leaves the Worker. |
| `user:<email>:google:access_token` | JSON `{ access_token, expires_at }` | ≈1 hr | A cache of the current access token so repeated calls don't hammer Google. Auto‑expires. |
| `user:<email>:google:scope` | string | none | The scopes Google granted, surfaced by `/status`. |
| `user:<email>:todoist:token` | string | none | That user's Todoist personal token. Never leaves the Worker. |

The `user:<email>:` prefix (built by `userKey()` in [`functions/_shared.ts`](../../functions/_shared.ts)) is what makes the app **multi‑user**: each pre‑approved account's credentials are isolated, so one person connecting their Google account can never overwrite or read another's.

---

## 4a. Where the app data lives: D1 (the sync sidecar)

The KV store above holds *credentials*. The app's actual **data** (the day plan, settings, saved history, life context) lives in each browser's `localStorage`, mirrored to a **D1 sync sidecar** (v7.9): a cloud copy of the four slices, so every origin/device converges on one logical store per user.

Why D1 here when KV was right for credentials? Different requirements: this is **durable app data** the user edits and reloads across devices, needing **read‑your‑writes** (you change a setting and expect it on the next load) — exactly where KV's eventual consistency is wrong and D1's strong consistency is right. It's also the natural home for future relational reads (v8 reviews over engagement history).

- **Binding:** `SYNC_DB` (D1), declared in [`wrangler.toml`](../../wrangler.toml). Schema in [`db/schema.sql`](../../db/schema.sql): one table `slices(user_id, key, value, schema_version, updated_at)` with primary key `(user_id, key)` — one row per user per slice. `user_id` is the verified Access email (§5), so each account has its own four rows; v7.10 added the column (migration: [`db/migrate_add_user_id.sql`](../../db/migrate_add_user_id.sql)).
- **Endpoints** (identity‑guarded like everything else): `GET /api/state` returns the caller's identity plus their slices (`{ user, slices }` — the `user` field drives the client's identity‑switch guard, §5); `PUT /api/state/:key` upserts one slice with a last‑write‑wins guard inside the SQL (`WHERE excluded.updated_at >= slices.updated_at`, else **409** with the current row). Error vocabulary matches the rest: `unauthorized` (401), `server_not_configured` (500), `storage_unavailable` (503), plus `unknown_slice` (404) / `invalid_body` (400) / `conflict` (409). Code: [`functions/api/state/`](../../functions/api/state/).
- **Client half:** [`src/lib/cloudSync.ts`](../../src/lib/cloudSync.ts) + the `SyncGate` cold‑start gate. The conflict model and merge rules are documented in [data-model.md](../data-model.md) §7.

---

## 5. Locking the door: Cloudflare Access

We've put secrets on the server. But the server is on the public internet — anyone can send a request to `https://yourapp.pages.dev/api/auth/google/token`. And unlike the original single‑user design (which guarded everything with one shared secret — see git history for that era), the app is now used by a *handful* of pre‑approved people, each of whom must see only their own data. So the guard has to answer two questions on every request: **is this person allowed in at all**, and **which person is it**?

Rather than building accounts, sessions, and a login screen into the app, Orchestrate pushes the whole problem to the edge with **Cloudflare Access** (part of Cloudflare Zero Trust):

- The entire origin — static assets *and* `/api/*` — sits behind an Access **application**. An unauthenticated visitor never even receives the app bundle; they get a Google sign‑in page.
- The Access **policy** is the allowlist: `Allow → Emails ∈ [you + the people you've approved]`. Adding a friend is a dashboard edit, not a code change. (The free Zero Trust plan covers 50 users — far more than needed.)
- The **identity provider** is Google SSO, reusing the *same* Google OAuth client as the calendar integration (one extra authorized redirect URI pointing at `<team>.cloudflareaccess.com`). One Google Cloud project serves both login and calendar.
- After sign‑in, Access sets a session cookie (`CF_Authorization`) on the origin. Because app and backend are same‑origin (§3), every `fetch('/api/…')` carries it automatically — the client attaches **no credential of its own** anymore.

### How a Function knows who's calling

Access doesn't just gate requests — it **injects identity**. Every request that passes the edge carries a `Cf-Access-Jwt-Assertion` header: a **JWT** (JSON Web Token — a signed statement of claims) asserting who authenticated. The Worker must *verify* it rather than trust it blindly (defense in depth — e.g. against a misconfigured route or a direct-to-origin path):

- `requireUser(request, env)` in [`functions/_shared.ts`](../../functions/_shared.ts) verifies the JWT's signature against the Zero Trust team's public keys (fetched from `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` via `jose`'s remote JWKS, cached per isolate), and checks the issuer and the application's **AUD tag** (`CF_ACCESS_AUD`).
- The verified `email` claim (lowercased) becomes the user id — the KV key prefix (§4) and the D1 `user_id` (§4a).
- Every endpoint starts with the same three lines:

```ts
const auth = await requireUser(request, env);
if (auth instanceof Response) return auth;
// auth.email is the verified identity
```

Errors reuse the established vocabulary: missing/invalid JWT → `401 unauthorized`; `CF_ACCESS_TEAM_DOMAIN`/`CF_ACCESS_AUD` unset → `500 server_not_configured`.

**Local dev bypass.** `wrangler pages dev` has no Access in front of it, so `.dev.vars` sets `DEV_USER_EMAIL` — when present, `requireUser` skips verification and assumes that identity. Setting a different email simulates a second user (their own KV keys, their own D1 rows). It must never be set in production.

### What multi‑user means for the browser

One subtlety: `localStorage` is per **browser profile**, not per Access identity. If you sign out and a friend signs in on the same machine, their cloud data must not merge with your local slices. The client handles this with an **identity‑switch guard**: `GET /api/state` returns the caller's email, the client compares it with the `orchestrate-user` stamp in localStorage, and on a mismatch clears all local app state before merging ([`src/lib/cloudSync.ts`](../../src/lib/cloudSync.ts)). And when the Access session **expires**, `/api/*` fetches stop returning JSON (the edge redirects to the login page) — the client detects this (`redirect: 'manual'` + `SessionExpiredError` in [`src/lib/identity.ts`](../../src/lib/identity.ts)) and surfaces a "reload to sign in again" banner; a reload re-runs the SSO, usually silently.

### Two allowlists, one Google client

Being allowed **into the app** (the Access policy) and letting the app **touch your calendar** (Google's consent) are separate grants. Because the Google OAuth client is in **Testing** mode, each user who connects their calendar must also be listed as a **test user** in the Google Cloud console (cap 100). Both lists are managed against the same Google client; [deployment.md](../deployment.md) covers both.

---

## 6. Walkthrough: connecting Google Calendar

This is the **authorization‑code flow** — the full, server‑mediated OAuth dance. Note this is a *second, independent* Google interaction from the Access login in §5: that one proved who you are; this one grants the app calendar access. Here's the whole thing at a glance, then we'll narrate it:

```
Browser (SPA, behind Access)     Pages Functions (Worker)            Google
  | Connect ───fetch /login──────▶| verify Access JWT                |
  |                               | build consent URL                |
  |                               |   (state signs email+return)    |
  | ◀──{ url }────────────────────|                                 |
  | ──redirect──────────────────────────────────────────────────▶  | consent screen
  |                               | ◀──/callback?code&state──────── |
  |                               | verify Access JWT (cookie rode  |
  |                               |   the redirect) + state match   |
  |                               | exchange code → tokens (uses    |
  |                               |   the client secret)            |
  |                               | store refresh_token in KV under |
  |                               |   user:<email>:…                |
  | ◀──redirect /settings?gcal=connected (or /?gcal=… for onboarding)
  | need a token ──fetch /token──▶| refresh_token → access_token    |
  | ◀──{ access_token }───────────|                                 |
  | ──Bearer call──────────────────────────────────────────────▶   | Calendar API
```

**Step 1 — kick off the login.** You click *Connect* (in Settings, or the onboarding flow). The browser calls [`GET /api/auth/google/login`](../../functions/api/auth/google/login.ts) — optionally with `?return=home` so the callback lands back on `/` (onboarding) instead of the Settings tab. The Worker verifies the caller's identity, builds the Google **consent URL** and hands it back as `{ url }`; the browser navigates to it.

That consent URL carries several parameters, each a deliberate choice:

- `client_id`, `redirect_uri`, `response_type=code` — standard: "this app, send the result back here, and give me an authorization *code*."
- `scope` — the least the features need: `calendar.calendarlist.readonly`, `calendar.events`, and `calendar.app.created` (the app‑managed Orchestrate calendar, v7.7).
- `access_type=offline` **and** `prompt=consent` — this pair is what makes Google issue a **refresh token**. Without these two, you'd get an access token that dies in an hour with no way to renew server‑side — defeating the point.
- `state` — a value we get back unchanged on the callback: our **CSRF** defense, and now also the **identity binding**.

**How `state` is built (stateless, self‑verifying, identity‑bound).** `/login` signs a small JSON payload — timestamp, nonce, **the caller's email**, and the allowlisted return target — as `base64url(payload).HMAC‑SHA256(payload, OAUTH_STATE_SECRET)`. Only the server knows the signing key, so only our `/login` can mint a valid state; the signature *is* the proof, so nothing needs storing in KV (which also dodges KV's eventual consistency). Binding the email means a callback can only complete for the same person who started the flow — user A can't be tricked into storing user B's tokens.

**Step 2 — you consent at Google.** (Testing mode shows a one‑time "Google hasn't verified this app" notice; each user must be on the test‑user list — §5.)

**Step 3 — Google calls us back.** Google redirects the browser to [`GET /api/auth/google/callback?code=…&state=…`](../../functions/api/auth/google/callback.ts). In the single‑user era this was the one unauthenticated endpoint; now the redirect **passes through Access** — the browser carries its session cookie — so the callback *also* has a verified identity. It checks: valid signature, fresh (≤10 min), and **state.email === JWT email**.

**Step 4 — exchange the code for tokens.** A `code` isn't a credential; it's a one‑time voucher. The Worker POSTs it to Google's token endpoint **together with the client secret** (the moment the client secret earns its keep). Google responds with `{ access_token, refresh_token, expires_in, scope }`.

**Step 5 — store the crown jewel.** The Worker writes the refresh token (plus scope and a cached access token) into KV under the verified user's keys, then redirects the browser to the state's return target (`/settings?tab=integrations&gcal=connected`, or `/?gcal=connected` for onboarding).

**Step 6 — the UI catches up.** Wherever the redirect lands, the mounted `GoogleConnectCard` processes `?gcal=…` (via the [`useGcalCallback`](../../src/hooks/useGcalCallback.ts) hook), calls `/status` to confirm the server really holds a token, flips to **Connected**, and loads the calendar list. (Frontend orchestration: [`GoogleCalendarContext.tsx`](../../src/context/GoogleCalendarContext.tsx).)

---

## 7. Walkthrough: actually using the calendar

Connecting is the hard part; using it is easy. Whenever the app needs to call the Calendar API:

1. The provider first checks its **in‑memory** access‑token cache. If it has a token that's still valid, it uses it directly — no backend call at all.
2. Otherwise it calls [`GET /api/auth/google/token`](../../functions/api/auth/google/token.ts). The Worker:
   - returns the **KV‑cached** access token if it isn't near expiry, otherwise
   - calls Google's token endpoint with `grant_type=refresh_token` to mint a fresh one, re‑caches it in KV (with a TTL matching its lifetime), and returns it.
3. The browser then calls the Calendar REST API **directly**, using that token as a `Bearer` header ([`googleCalendarApi.ts`](../../src/lib/googleCalendarApi.ts)). Google's API sends CORS headers for browser Bearer requests, so these calls don't need to go through our Worker — only the *token minting* does.

There's a subtle but important consequence here: the browser only ever holds a token that's useless in an hour. If that token leaks, the damage window is tiny, and the refresh token that could renew it indefinitely is never exposed.

**On reload.** When the app starts, the provider calls `/status` once. If the server holds a refresh token for this user, you're **Connected** with no interaction — the connection survives reloads and works on any device (the Access login is the only per‑device step). The persisted `settings.googleCalendarConnected` flag is just a cached hint, written only when the value actually changes.

**Disconnect** ([`disconnect.ts`](../../functions/api/auth/google/disconnect.ts)) revokes the refresh token at Google (best‑effort) and deletes that user's KV keys.

---

## 8. Walkthrough: Todoist, and why it's a *proxy* instead

Now the contrast that makes the design click. Todoist's credential is a single long‑lived personal token — it *is* the keys to the kingdom, with no short‑lived derivative to hand out. So the Google pattern ("mint a disposable token and let the browser call the API directly") doesn't apply. If we want the token to stay off the browser, the browser can never call Todoist directly at all.

The answer is a **proxy**: the browser calls *us*, we attach the secret and forward the call to *them*, and relay the response back. That's exactly [`functions/api/todoist/[[path]].ts`](../../functions/api/todoist/%5B%5Bpath%5D%5D.ts) — a **catch‑all** route (the `[[path]]` syntax matches any sub‑path). Its job each request:

1. Verify the Access JWT → the caller's email.
2. Read `user:<email>:todoist:token` from KV.
3. Rewrite `/api/todoist/<anything>` → `https://api.todoist.com/<anything>`, copy the method/body, **inject** `Authorization: Bearer <token>`, and forward.
4. Relay Todoist's response straight back.

The frontend is none the wiser that it's not talking to Todoist directly: [`todoistApi.ts`](../../src/lib/todoistApi.ts) just points `API_BASE` at `/api/todoist/api/v1` (same origin, in both dev and prod); no headers to attach — the Access cookie is the authentication.

Storing and checking the token is a tiny trio of endpoints that mirror the Google ones:

| Route | Method | Purpose |
|---|---|---|
| [`/api/todoist-auth/token`](../../functions/api/todoist-auth/token.ts) | POST | Validates the pasted token against Todoist's `/projects` endpoint, then stores it under the caller's KV key. |
| [`/api/todoist-auth/status`](../../functions/api/todoist-auth/status.ts) | GET | Reports `{ configured }` — whether the caller holds a token. |
| [`/api/todoist-auth/disconnect`](../../functions/api/todoist-auth/disconnect.ts) | POST | Deletes the caller's token from KV. |

One real consequence to be honest about: because the token lives server‑side, **every** Todoist operation goes through the Worker. That sounds expensive; §12 shows why, at this scale, it's free. (The UI for all this is the reusable [`TodoistConnectCard`](../../src/components/todoist/TodoistConnectCard.tsx), mounted by Settings and onboarding.)

---

## 9. The shared plumbing: routing, the guard, and the error model

Both integrations lean on common machinery in [`functions/_shared.ts`](../../functions/_shared.ts), worth understanding because it's where the consistency comes from.

**Routing recap.** Everything under `/api/*` is a Function; everything else is a static file. The SPA's client‑side routes (`/settings`, `/focus`, …) are handled by a catch‑all in [`public/_redirects`](../../public/_redirects) (`/* → /index.html 200`) so deep links work. Pages matches Functions **before** that static fallback. And in front of *all* of it sits the Access application (§5).

**One guard to rule them all.** Every endpoint starts with `requireUser(request, env)` — it returns either the verified `{ email }` or a ready‑made error `Response` to relay. There is exactly one implementation of JWT verification, shared by the Google functions (re‑exported through [`_lib.ts`](../../functions/api/auth/google/_lib.ts)), the Todoist proxy/auth trio, the state endpoints, and [`/api/me`](../../functions/api/me.ts) (a tiny "who am I" endpoint).

**A deliberate error vocabulary.** Rather than letting failures collapse into an opaque `500`, the backend distinguishes them — which is what lets the setup screens show a useful message instead of "something broke":

| Condition | Status | `error` code |
|---|---|---|
| Access env (`CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD`) not set on the Worker | `500` | `server_not_configured` |
| `Cf-Access-Jwt-Assertion` missing, unverifiable, or without an email claim | `401` | `unauthorized` |
| A KV/D1 read/write threw | `503` | `storage_unavailable` |
| Upstream (Todoist or Google) unreachable / non‑JSON | `502` | `todoist_unreachable` / `google_unreachable` |

The split between `server_not_configured` (a *deploy* problem) and `unauthorized` (an *identity* problem) matters: before this distinction, a misconfigured Worker looked exactly like an auth failure, which is maddening to debug. The Google side raises these as a `GoogleWorkerError` from its KV/fetch wrappers in `_lib.ts`; the callback turns them into `?gcal=error&reason=<code>`. The frontend maps every code to a human sentence (in [`useGcalCallback.ts`](../../src/hooks/useGcalCallback.ts) and [`TodoistConnectCard.tsx`](../../src/components/todoist/TodoistConnectCard.tsx)).

---

## 10. Configuration: what lives where

All server config lives on the **Cloudflare Pages project** (per environment — Production and, if you use them, Preview). None of it is baked into the frontend bundle, which is the whole point.

| Name | Kind | Used by | What it does |
|---|---|---|---|
| `CF_ACCESS_TEAM_DOMAIN` | plaintext | every guarded endpoint | The Zero Trust team domain (e.g. `myteam.cloudflareaccess.com`) — where the JWT's public keys live. |
| `CF_ACCESS_AUD` | secret | every guarded endpoint | The Access application's AUD tag; the JWT's audience must match. |
| `GOOGLE_CLIENT_ID` | secret | Google `login`/`callback`/`token` | Identifies the app to Google. |
| `GOOGLE_CLIENT_SECRET` | secret | Google `callback`/`token` | Proves the app's identity during code exchange + refresh. **Never shipped to the browser.** |
| `OAUTH_STATE_SECRET` | secret | Google `login`/`callback` | Server‑only HMAC key signing the OAuth `state` (§6). Nobody types this anywhere but the dashboard. |
| `APP_ORIGIN` | plaintext (optional) | Google `login`/`callback` | Pins the canonical origin for the redirect URI (see below). Defaults to the request origin. |
| `DEV_USER_EMAIL` | `.dev.vars` only | `requireUser` | Local‑dev identity bypass (§5). **Never set in production.** |
| `OAUTH_KV` | KV binding | credential storage | Binds the KV namespace (declared in [`wrangler.toml`](../../wrangler.toml)). |
| `SYNC_DB` | D1 binding | `/api/state` | Binds the D1 database mirroring the app‑data slices (schema: [`db/schema.sql`](../../db/schema.sql)). |

The browser side holds **no auth-related value at all** — just the `orchestrate-user` identity stamp (§5) and a couple of cached "connected" flags in settings.

**Why `APP_ORIGIN` exists.** Cloudflare Pages serves every deployment at a unique preview URL (`<hash>.<project>.pages.dev`) in addition to your real domain. Google's OAuth requires the `redirect_uri` to *exactly* match one you registered; pinning `APP_ORIGIN` keeps one canonical redirect URI so previews don't break it.

**Local development.** The Google/state config goes in a gitignored `.dev.vars` plus `DEV_USER_EMAIL`, and you run the stack with `wrangler pages dev` (which actually executes the Functions). Note the parity gap: plain `npm run dev` (Vite) serves the SPA but **not** the Functions, so both integrations will just show their connect prompt under it. (Full steps: [deployment.md](../deployment.md) Part D.)

---

## 11. The security model, in one place

Pulling the threads together:

- **The perimeter is Cloudflare Access.** Nothing — not even the static bundle — is served to an unauthenticated visitor. The allowlist is the Access policy; sessions, expiry, and the login UI are Cloudflare's problem, not app code.
- **The guard is JWT verification.** Every Function independently verifies `Cf-Access-Jwt-Assertion` (signature, issuer, audience) rather than trusting the edge blindly. The verified email is the tenant key for KV and D1.
- **Per‑user isolation.** Credentials are namespaced (`user:<email>:…`), sync rows are keyed `(user_id, key)`, and the OAuth `state` binds the initiating identity — so users cannot read, overwrite, or complete flows for each other.
- **Secret separation.** The Google client secret, per‑user refresh tokens, and Todoist tokens never reach the browser. A fully compromised browser leaks only a ≤1‑hour Google access token and that user's own app data.
- **Transport.** Everything is HTTPS; identity rides an HttpOnly cookie set by Access, never a URL or app‑managed storage.
- **What it deliberately is *not*.** There's no app‑level rate limiting or audit logging (Zero Trust's own logs cover sign‑ins). Access session length is a dashboard setting; an expired session shows a "reload to sign in" banner rather than an in‑app re‑auth flow.

---

## 12. Cost & quotas

A fair question, given §8 established that *every* Todoist call hits the Worker: does this rack up Cloudflare charges? For a handful of users, no — it sits orders of magnitude inside the free tiers. The reasoning:

- **What's billed:** Pages **Functions invocations** (your `/api/*` calls) count as Workers requests. Each proxied/OAuth call is **1 invocation + 1 KV read**; KV *writes* happen only when someone connects, so they're negligible. D1's free tier (5M reads / 100k writes per day) dwarfs a few users' slice pushes.
- **What's free:** **static asset requests** (the SPA itself) are free and unlimited, and **Zero Trust is free up to 50 users**.

| Resource | Free plan (verify — Cloudflare adjusts these) | Realistic small‑group load |
|---|---|---|
| Functions / Workers requests | ~100,000 / day | a few hundred → low thousands per active user‑day |
| KV reads | ~100,000 / day | ≈ the call count (1 per call) |
| KV writes | ~1,000 / day | ~0 (only on connect) |
| Access (Zero Trust) seats | 50 users | a handful |

An intense hour of planning — 100+ reschedules/completes plus periodic refreshes — is roughly **150–300 invocations**, about 0.2% of the daily free allowance per person. Two things keep the count down for free: the frontend's **stale‑while‑revalidate** cache (see [synthesis.md §6.2](../synthesis.md)), and Google's **in‑memory + KV access‑token caches** (§7).

---

## 13. Assumptions that would force a redesign

Everything above rests on a small set of assumptions. They're sound for a personal tool shared with a few people; if one stops holding, the design should be revisited — not patched.

- **A small, personally‑approved user set.** Identity is an email allowlist in one Zero Trust dashboard; "signup" is you adding a friend. Beyond ~50 users (the free-plan seat cap) or beyond people you personally trust, this needs real onboarding, quotas, and isolation review.
- **Cloudflare Access fronts everything.** The Workers trust the edge to have run authentication (they verify the JWT, but there's no second factor). Serving the origin from anywhere that bypasses Access would break the model.
- **Google's Testing‑mode consent** caps calendar-connected users at 100 test users and shows scary screens; friends must be added to the test‑user list by hand.
- **KV's ~≤60s eventual consistency is acceptable** for token reads/writes.
- **Same‑origin** browser↔Worker, so the Access cookie rides every request and there's no CORS.
- **Whole‑slice LWW sync per user.** No concurrent multi‑writer editing of one account; the identity‑switch guard assumes one active identity per browser profile at a time.

And a few sharp edges worth knowing:

- **KV "backup."** If the namespace is deleted or rebound, connections drop — but tokens are re‑obtainable (re‑paste Todoist, re‑consent Google), so it's a reconnect, not data loss. D1, in contrast, holds real data — it's included in Cloudflare's Time Travel restore window.
- **Preview environments** are deliberately not configured: no Access app, no secrets — they return `server_not_configured` rather than carrying live credentials.
- **Rotating `OAUTH_STATE_SECRET`** invalidates any OAuth login *in flight* (`reason=state` — just retry). Nothing else depends on it.
- **The service worker** never caches redirected responses, so an Access login page can't be cached as the app shell ([`public/sw.js`](../../public/sw.js)).
- **Observability.** Failures come back as explicit codes (not opaque 500s); Worker logs are in the Cloudflare dashboard or `wrangler tail`; sign‑in activity is in the Zero Trust logs.

---

## 14. The frontend side, briefly

For completeness, the browser half of all this:

| File | Role |
|---|---|
| [`src/lib/identity.ts`](../../src/lib/identity.ts) | The client's identity utilities: the `orchestrate-user` stamp, `SessionExpiredError`, redirect‑aware `apiFetch`, `/api/me` client. |
| [`src/lib/googleAuth.ts`](../../src/lib/googleAuth.ts) | Google Worker client: `startGoogleLogin` (with return target), `fetchAccessToken`, `fetchConnectionStatus`, `disconnectGoogle`. |
| [`src/lib/googleCalendarApi.ts`](../../src/lib/googleCalendarApi.ts) | Thin Calendar REST client; takes a Bearer token (calls Google directly). |
| [`src/context/GoogleCalendarContext.tsx`](../../src/context/GoogleCalendarContext.tsx) | The provider: in‑memory token cache, connection state, connect/disconnect/refresh, reload reconnect. |
| [`src/lib/todoistApi.ts`](../../src/lib/todoistApi.ts) | Proxy base URL + `getTodoistStatus`/`storeTodoistToken`/`disconnectTodoist`. |
| [`src/context/TodoistContext.tsx`](../../src/context/TodoistContext.tsx) | Resolves `isConfigured` from `/status`; session‑expiry and auth‑failure surfacing. |
| [`src/lib/cloudSync.ts`](../../src/lib/cloudSync.ts) | The sync sidecar client: cold‑start pull‑and‑merge, identity‑switch guard, debounced pushes. |
| [`src/hooks/useGcalCallback.ts`](../../src/hooks/useGcalCallback.ts) | Processes the OAuth callback redirect wherever it lands (Settings or onboarding). |
| [`TodoistConnectCard.tsx`](../../src/components/todoist/TodoistConnectCard.tsx) / [`GoogleConnectCard.tsx`](../../src/components/settings/GoogleConnectCard.tsx) | Reusable connect/status cards, mounted by Settings and the onboarding flow. |
| [`src/components/onboarding/Onboarding.tsx`](../../src/components/onboarding/Onboarding.tsx) | First‑run journey: what the app is → connect Todoist (required) → connect Google Calendar (encouraged). |

The only client‑persisted auth‑adjacent state is the `orchestrate-user` identity stamp and a couple of cached "connected" flags in settings; the Google access token is memory‑only, and both the refresh token and the Todoist token are server‑only.

---

## See also

- [../deployment.md](../deployment.md) — the step‑by‑step setup (Google Cloud client, Cloudflare project, Zero Trust/Access, KV, D1, secrets, local dev, troubleshooting).
- [../synthesis.md](../synthesis.md) §7 (integrations), §11 (persistence) — where this fits in the app.
- [../roadmap/engagement_record_strategy.md](../roadmap/engagement_record_strategy.md) — option E1 vs E2, and the calendar‑write feature this unlocks.
