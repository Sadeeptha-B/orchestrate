# Orchestrate's Cloudflare backend — a walkthrough

This is the conceptual tour of Orchestrate's small serverless backend: the part that lets a no‑backend, browser‑only app talk to Google Calendar and Todoist *safely*. It's written to be read top‑to‑bottom — each piece introduces the concept it needs (OAuth, refresh tokens, serverless Functions, KV, CSRF, proxies) right where that concept first matters, and explains *why* the code is shaped the way it is, not just what it does.

If you just want the click‑by‑click setup (Google Cloud console, Cloudflare dashboard), that's a separate page: [../deployment.md](../deployment.md). For where this sits in the wider app, see [synthesis.md §7](../synthesis.md); for the design history and the alternatives that were weighed, see the roadmap docs ([engagement_record_strategy.md](../roadmap/engagement_record_strategy.md) — this is **option E2** — and [persistence_and_backend_migration.md](../roadmap/persistence_and_backend_migration.md)).

---

## 1. The problem: a browser is a bad place to keep a secret

Orchestrate is a **static single‑page app** (SPA). All of its real data — your plans, habits, sessions — lives in the browser's `localStorage`. There's no application database and no server that "owns" your data. That's a deliberate, low‑cost design.

But two features need to reach *out* to other services:

- **Google Calendar** — to list your calendars and (eventually) write events.
- **Todoist** — the source of truth for tasks; the app reads and writes them constantly.

Both require a **credential** — a secret string that proves "this app is allowed to act as you." And here's the tension that shapes this entire backend:

> A credential that can act as you, indefinitely, must **not** live in the browser.

Anything the browser holds is recoverable by anyone with access to that browser profile (and, for anything in the JS bundle, by literally anyone on the internet who views source). A long‑lived credential sitting in `localStorage` is "encrypted" only in the sense of being mildly inconvenient to read — the key sits right next to it. So the job of this backend is narrow and specific: **hold the credentials that can't safely live in the browser, and nothing else.** It is a credential vault and a request broker — not an app server.

The two integrations need *different* kinds of credential, and that difference drives almost every decision below. Let's look at each.

---

## 2. Two integrations, two kinds of credential

### Google Calendar uses OAuth

**OAuth 2.0** is the "Sign in with Google / allow this app to access your calendar" protocol. Instead of you handing your Google password to Orchestrate, Google issues the app scoped, revocable credentials. There are three secrets in play, and it's worth being precise about each because they have very different lifetimes and risk:

- **Client ID + client secret** — these identify *the application itself* to Google (think of them as the app's own username/password with Google). The client secret must stay server‑side; it's what lets the app exchange codes for tokens.
- **Access token** — a short‑lived (~1 hour) bearer token used to actually call the Calendar API. "Bearer" means whoever holds it can use it, no questions asked — so short lifetimes matter.
- **Refresh token** — a long‑lived credential whose only job is to mint fresh access tokens when the old one expires. This is the crown jewel: with it, a server can act as you for as long as you don't revoke it. It absolutely cannot live in the browser.

The original version of this integration (the roadmap's **option E1**) used Google's browser‑only token client: no backend, access tokens minted directly in the page and held only in memory. That works *while a tab is open*, but it can never hold a refresh token — so the connection dies with the tab and can never do unattended work. To get a durable, cross‑device connection (and a future where a server can write calendar events with no tab open), we need the **server‑mediated authorization‑code flow** (option E2), where the refresh token lives on the server. That's what §6 walks through.

### Todoist uses a personal token

Todoist is simpler and, in a way, blunter. You generate a **personal API token** in Todoist's developer settings — a single long‑lived string that *is* the credential. There's no OAuth dance, no short‑lived/long‑lived split: that one token can read and write your tasks forever, until you revoke it. Which means it's exactly the kind of secret that must never touch the browser. We'll see in §8 that this leads to a different shape than Google — a **proxy** rather than a token‑minting endpoint.

So: two integrations, both needing a server to hold a secret. Where does that server come from for a static site?

---

## 3. The enabling move: Cloudflare Pages + Functions

Orchestrate is hosted on **Cloudflare Pages**, which serves the static build (HTML/JS/CSS) from Cloudflare's edge. The thing that makes Pages more than just a file host is **Pages Functions**: small pieces of server‑side code that deploy *alongside* the static site and run on Cloudflare's **Workers** runtime.

A few concepts to introduce here, because they're load‑bearing:

- **Serverless / Workers.** You don't run or manage a server. You write a function; Cloudflare runs it on demand at the edge, scales it, and bills per invocation. There's no always‑on process and no machine to patch. The flip side is that the function is **stateless** — it keeps nothing between requests, so any durable state must go somewhere external (that's §4).
- **File‑based routing.** Functions live in a [`functions/`](../../functions/) directory at the repo root, and the file path *is* the URL path: `functions/api/auth/google/login.ts` answers `GET /api/auth/google/login`. Files whose names start with `_` (like `_shared.ts`) are treated as shared modules, not routes.
- **Same origin.** This is the quietly crucial part. The Functions are served from the *same domain* as the app (`yourapp.pages.dev/api/...`). Because the browser sees the app and the backend as one origin, requests between them are "same‑origin": no CORS preflight to configure, and the browser will happily attach a custom header (we'll use one as our key) on every call. If the backend lived on a different domain, we'd be fighting CORS and cross‑site cookie rules the whole way.

> Aside — and a nice bonus of the Cloudflare move: serving from `yourapp.pages.dev` (or a custom domain) gives Orchestrate its **own origin**, so its `localStorage` is isolated from other sites. On GitHub Pages, every project under `you.github.io` shares one origin and therefore one `localStorage` namespace; the move to Pages fixes that for free.

So we now have somewhere to run server code, on the same origin as the app. Two questions remain: *where do the secrets actually sit* (§4), and *how do we stop the public internet from using our backend* (§5).

---

## 4. Where the secrets live: Workers KV

Our stateless Functions need to remember a few things between requests — the Google refresh token, the Todoist token, a cached access token. That's durable state, and a Worker can't hold it. We need external storage.

The requirement is modest and specific: **store a handful of small, long‑lived strings, and read one of them on essentially every request.** Cloudflare offers several storage products; here's why **Workers KV** is the right fit, by elimination:

- **Could a cookie hold these?** No — and it's worth being clear *why*, because "just use a cookie" is a common instinct. A cookie is **browser** state: whatever is in a cookie is, by definition, sitting in the client. The entire point of this backend is to keep the refresh/personal tokens *off* the client. A cookie is the wrong tool for *storing* a secret. (Cookies are great for carrying a *session id* — but we deliberately don't do sessions; see §5.)
- **Workers KV — chosen.** A globally‑replicated key‑value store with very fast edge reads, that binds to a Function in one line of config. Perfect for "read one small value per request."
- **D1 (Cloudflare's SQLite)** — a real relational database. Overkill *for the credential store*: it's ~4 keys, no relationships, no queries. (D1 *is* used elsewhere — the v7.9 **state sync sidecar** mirrors the app's data slices to a D1 table; see §4a. Different problem, different tool: durable app data with read-your-writes, not a hot per-request credential read.)
- **Durable Objects** — give you strong consistency and coordination between concurrent writers. We have a single user and "last write wins" is fine, so there's nothing to coordinate; DO would add cost and complexity for zero benefit.
- **R2 (object storage)** — for files/blobs, not tiny hot values.

KV has one characteristic to be aware of: it's **eventually consistent**. A write may take up to ~60 seconds to become visible everywhere on the globe. For us that's harmless — a single person doesn't connect on their laptop and read from their phone in the same second, and the access‑token cache simply refreshes on a miss. (If we ever needed read‑your‑writes within a second across regions, KV would be the wrong choice. We don't.)

Concretely, the one KV namespace (bound as `OAUTH_KV`) holds a handful of keys:

| Key | Shape | TTL | Role |
|---|---|---|---|
| `google:refresh_token` | string | none | The long‑lived refresh token. Never leaves the Worker. |
| `google:access_token` | JSON `{ access_token, expires_at }` | ≈1 hr | A cache of the current access token so repeated calls don't hammer Google. Auto‑expires. |
| `google:scope` | string | none | The scopes Google granted, surfaced by `/status`. |
| `todoist:token` | string | none | The Todoist personal token. Never leaves the Worker. |

That's the whole "credential database." Notice there's no per‑user namespacing — the keys are global. That's not an oversight; it encodes a core assumption we'll confront head‑on in §5.

---

## 4a. Where the app data lives: D1 (the sync sidecar)

The KV store above holds *credentials*. The app's actual **data** (the day plan, settings, saved history, life context) lived only in each browser's `localStorage` — which meant the production deployment and local dev were two separate installations pointing at the same Google/Todoist account, silently duplicating things like the Orchestrate calendar. v7.9 fixes that with a **D1 sync sidecar**: a cloud mirror of the four slices, so every origin/device converges on one logical store.

Why D1 here when KV was right for credentials? Different requirements: this is **durable app data** the user edits and reloads across devices, needing **read‑your‑writes** (you change a setting and expect it on the next load) — exactly where KV's eventual consistency is wrong and D1's strong consistency is right. It's also the natural home for future relational reads (v8 reviews over engagement history). Single‑user still means no `user_id` and last‑write‑wins is fine.

- **Binding:** `SYNC_DB` (D1), declared in [`wrangler.toml`](../../wrangler.toml). Schema in [`db/schema.sql`](../../db/schema.sql): one table `slices(key, value, schema_version, updated_at)`, one row per slice.
- **Endpoints** (guarded by the same `X-App-Secret`): `GET /api/state` returns all slices; `PUT /api/state/:key` upserts one with a last‑write‑wins guard inside the SQL (`WHERE excluded.updated_at >= slices.updated_at`, else **409** with the current row). Error vocabulary matches the rest: `unauthorized` (401), `server_not_configured` (500), `storage_unavailable` (503), plus `unknown_slice` (404) / `invalid_body` (400) / `conflict` (409). Code: [`functions/api/state/`](../../functions/api/state/).
- **Client half:** [`src/lib/cloudSync.ts`](../../src/lib/cloudSync.ts) + the `SyncGate` cold‑start gate. The conflict model and merge rules are documented in [data-model.md](../data-model.md) §7.

---

## 5. Locking the door: one shared secret

We've put secrets on the server. But the server is on the public internet — anyone can send a request to `https://yourapp.pages.dev/api/auth/google/token`. If those endpoints were open, a stranger could mint Google access tokens for your account and drive your Todoist. We need a guard.

The instinct from "normal" web apps is **sessions**: a login form, a server‑side session store, session cookies, expiry, logout, CSRF tokens. That's a lot of machinery — and all of it exists to answer the question "*which* user is this?" Orchestrate has a deliberate, simplifying answer: **there is only one user.** It's a personal tool. So instead of accounts, the whole auth model is a single **shared secret**.

Here's how it works:

- You generate a high‑entropy string and set it on the Cloudflare project as `APP_SHARED_SECRET` (§10).
- You enter that same string once in the app's Settings. It's saved in `localStorage` (key `orchestrate-cf-secret`) and sent as the **`X-App-Secret` header** on every backend request.
- Each guarded Function compares the header to the env var. Match → proceed; mismatch → `401`.

Why a header rather than a cookie or session?

- **No accounts, by design.** There's no "which user," so there's nothing for a session to track.
- **Stateless.** The check is a string comparison against an env var — no session store, no lifecycle, no extra KV. This fits the stateless‑Worker model perfectly.
- **One secret, both integrations.** The same value guards Google and Todoist; it's stored once and rides every request. (In the code, the secret lives in [`src/lib/appSecret.ts`](../../src/lib/appSecret.ts) and is surfaced to React reactively through the [`useAppSecret`](../../src/hooks/useAppSecret.ts) hook, so the UI updates the moment it's entered or changed.)

The honest trade‑off: a header secret is a **bearer credential** — anyone who has it gets in, and it doesn't expire on its own. We accept that because it's high‑entropy, only ever travels over HTTPS, sits in a header (not a URL, so it can't leak via browser history or `Referer`), and can be **rotated instantly** (change the env var, re‑enter it). For a single‑user tool, that's a proportionate guard. (§11 revisits what it deliberately is *not*.)

### What "public + single‑tenant" really means

It's worth making the consequences explicit, because the app being publicly reachable can feel alarming:

- **The SPA is inert without the secret.** It's just JavaScript. The bundle contains no client secret and no tokens. Unauthenticated, the most it can do is render the "enter app secret" prompt.
- **KV holds exactly one person's tokens, in global keys.** There is no per‑user partitioning — the design assumes a single operator. That's why the keys in §4 are just `google:refresh_token`, not `user:123:google:refresh_token`.
- **The shared secret is the entire perimeter.** Whoever holds it can act as you. Treat it like a password: don't commit it; rotate it if it leaks.
- **Two people with the same secret share one identity.** A second person entering your secret would read and write *your* Google and Todoist — there is no "second user," just two clients of the same single tenant. That's acceptable precisely because this is a personal tool. It is **not** a multi‑tenant design, and turning it into one would require real per‑user auth and per‑user KV key namespacing — not just handing out the secret.

With the door locked, we can finally walk the interesting path: the Google OAuth flow.

---

## 6. Walkthrough: connecting Google Calendar

This is the **authorization‑code flow** — the full, server‑mediated OAuth dance. Here's the whole thing at a glance, then we'll narrate it:

```
Browser (SPA)                Pages Functions (Worker)            Google
  | enter shared secret           |                                |
  | Connect ───fetch /login──────▶| build consent URL (signed state)|
  | ◀──{ url }────────────────────|                                |
  | ──redirect──────────────────────────────────────────────────▶ | consent screen
  |                               | ◀──/callback?code&state─────── |
  |                               | exchange code → tokens (uses    |
  |                               |   the client secret)            |
  |                               | store refresh_token in KV      |
  | ◀──redirect /settings?gcal=connected ─────────────────────────|
  | need a token ──fetch /token──▶| refresh_token → access_token   |
  | ◀──{ access_token }───────────|                                |
  | ──Bearer call──────────────────────────────────────────────▶  | Calendar API
```

**Step 1 — kick off the login.** You enter the shared secret and click *Connect*. The browser calls [`GET /api/auth/google/login`](../../functions/api/auth/google/login.ts) with the `X-App-Secret` header. The Worker doesn't redirect you itself — it builds the Google **consent URL** and hands it back as `{ url }`, and the browser navigates to it. (Returning the URL rather than redirecting keeps the secret in a header instead of leaking it into a redirect.)

That consent URL carries several parameters, each a deliberate choice:

- `client_id`, `redirect_uri`, `response_type=code` — standard: "this app, send the result back here, and give me an authorization *code*."
- `scope` — the permissions requested. We ask for the **least** that the feature needs: `calendar.calendarlist.readonly` (to list your calendars) and `calendar.events` (write plumbing for later).
- `access_type=offline` **and** `prompt=consent` — this pair is what makes Google issue a **refresh token**. Google only returns one when you explicitly ask for offline access, and `prompt=consent` forces it to re‑issue one even on a repeat authorization. Without these two, you'd get an access token that dies in an hour with no way to renew server‑side — defeating the entire point of the migration.
- `state` — a value we'll get back unchanged on the callback. This is our defense against **CSRF** (cross‑site request forgery): without it, an attacker could trick your browser into completing an OAuth callback *they* initiated, linking your session to *their* account. We'll come back to how `state` is built, because it's a neat trick.

**Step 2 — you consent at Google.** Google shows its consent screen. (Because the app's consent screen is left in **Testing** mode — fine for a single user — you'll see a one‑time "Google hasn't verified this app" notice. See [deployment.md](../deployment.md) for the Testing‑mode details.) You approve.

**Step 3 — Google calls us back.** Google redirects the browser to [`GET /api/auth/google/callback?code=…&state=…`](../../functions/api/auth/google/callback.ts). Two things to notice:

- This endpoint is **not** guarded by the shared secret. It can't be — *Google* is the caller, and Google can't attach our custom header. So how do we know this callback is legitimate and not a forgery? That's what `state` is for.
- **The clever part: stateless CSRF protection.** When `/login` built the URL, it set `state = <timestamp>.<nonce>.<HMAC‑SHA256(timestamp.nonce, APP_SHARED_SECRET)>`. HMAC is a keyed signature — only someone who knows the secret can produce a valid one. On the callback, the Worker recomputes the signature and checks it matches and that the timestamp is under 10 minutes old. Because the signature *is* the proof, we don't have to store the nonce anywhere and look it up — no KV round‑trip, no session. The signature is self‑verifying. (This also dodges KV's eventual‑consistency: a stored nonce might not be readable yet on the callback.)

**Step 4 — exchange the code for tokens.** A `code` isn't a credential you can use; it's a one‑time voucher. The Worker POSTs it to Google's token endpoint **together with the client secret** (this is the moment the client secret earns its keep — it proves the request comes from the real app, not someone who merely intercepted the code). Google responds with `{ access_token, refresh_token, expires_in, scope }`.

**Step 5 — store the crown jewel.** The Worker writes the refresh token (and the scope, and a cached copy of the access token) into KV, then redirects the browser back to `/settings?tab=integrations&gcal=connected`.

**Step 6 — the UI catches up.** The Settings page notices `?gcal=connected`, calls `/status` to confirm the server really holds a token, flips to **Connected**, and loads your calendar list. (The frontend orchestration lives in [`GoogleCalendarContext.tsx`](../../src/context/GoogleCalendarContext.tsx) and [`GoogleCalendarSetup.tsx`](../../src/components/settings/GoogleCalendarSetup.tsx).)

At the end of this, the refresh token sits safely in KV and the browser has seen nothing more dangerous than a short‑lived access token.

---

## 7. Walkthrough: actually using the calendar

Connecting is the hard part; using it is easy. Whenever the app needs to call the Calendar API:

1. The provider first checks its **in‑memory** access‑token cache. If it has a token that's still valid, it uses it directly — no backend call at all.
2. Otherwise it calls [`GET /api/auth/google/token`](../../functions/api/auth/google/token.ts) (with the shared secret). The Worker:
   - returns the **KV‑cached** access token if it isn't near expiry, otherwise
   - calls Google's token endpoint with `grant_type=refresh_token` to mint a fresh one, re‑caches it in KV (with a TTL matching its lifetime), and returns it.
3. The browser then calls the Calendar REST API **directly**, using that token as a `Bearer` header ([`googleCalendarApi.ts`](../../src/lib/googleCalendarApi.ts)). Google's API sends CORS headers for browser Bearer requests, so these calls don't need to go through our Worker — only the *token minting* does.

There's a subtle but important consequence here: the browser only ever holds a token that's useless in an hour. If that token leaks, the damage window is tiny, and the refresh token that could renew it indefinitely is never exposed.

**On reload.** When the app starts (and whenever the shared secret changes — the provider watches it reactively via `useAppSecret`), it calls `/status` once. If the server still holds a refresh token, you're **Connected** with no interaction — the connection survives reloads and works on any device once the secret is entered. The persisted `settings.googleCalendarConnected` flag is just a cached hint of the last‑known result, and it's written *only when the value actually changes*, so a Todoist‑only user who never touched Google doesn't pay a settings write on every load.

**Disconnect** ([`disconnect.ts`](../../functions/api/auth/google/disconnect.ts)) revokes the refresh token at Google (best‑effort) and deletes the KV keys; the browser drops its in‑memory token and the connected flag.

---

## 8. Walkthrough: Todoist, and why it's a *proxy* instead

Now the contrast that makes the design click. Todoist's credential is a single long‑lived personal token — it *is* the keys to the kingdom, with no short‑lived derivative to hand out. So the Google pattern ("mint a disposable token and let the browser call the API directly") doesn't apply: there's no disposable token to mint. If we want the token to stay off the browser, the browser can never call Todoist directly at all.

The answer is a **proxy**. A proxy is a server endpoint that stands in front of the real API: the browser calls *us*, we attach the secret and forward the call to *them*, and relay the response back. The token is added server‑side and never appears in the browser.

That's exactly [`functions/api/todoist/[[path]].ts`](../../functions/api/todoist/%5B%5Bpath%5D%5D.ts) — a **catch‑all** route (the `[[path]]` syntax matches any sub‑path). Its job each request:

1. Check the shared secret.
2. Read `todoist:token` from KV.
3. Rewrite `/api/todoist/<anything>` → `https://api.todoist.com/<anything>`, copy the method/body, **inject** `Authorization: Bearer <token>`, and forward.
4. Relay Todoist's response straight back.

The frontend is none the wiser that it's not talking to Todoist directly: [`todoistApi.ts`](../../src/lib/todoistApi.ts) just points `API_BASE` at `/api/todoist/api/v1` (same origin, in both dev and prod), and [`TodoistContext.tsx`](../../src/context/TodoistContext.tsx) attaches the `X-App-Secret` header instead of a token. (This also retired the old Vite dev proxy — the Function is the proxy now.)

Storing and checking the token is a tiny trio of endpoints that mirror the Google ones:

| Route | Method | Purpose |
|---|---|---|
| [`/api/todoist-auth/token`](../../functions/api/todoist-auth/token.ts) | POST | Validates the pasted token against Todoist's `/projects` endpoint, then stores it in KV. |
| [`/api/todoist-auth/status`](../../functions/api/todoist-auth/status.ts) | GET | Reports `{ configured }` — whether a token is held. |
| [`/api/todoist-auth/disconnect`](../../functions/api/todoist-auth/disconnect.ts) | POST | Deletes the token from KV. |

One real consequence to be honest about: because the token lives server‑side, **every** Todoist operation — every reschedule, complete, habit sync, task refresh — now goes through the Worker. It's not a one‑time thing. That sounds expensive; §12 shows why, at single‑user scale, it's free. (The UI for all this is [`TodoistSetup.tsx`](../../src/components/todoist/TodoistSetup.tsx).)

---

## 9. The shared plumbing: routing, the guard, and the error model

Both integrations lean on a little common machinery in [`functions/_shared.ts`](../../functions/_shared.ts), worth understanding because it's where the consistency comes from.

**Routing recap.** Everything under `/api/*` is a Function; everything else is a static file. The SPA's client‑side routes (`/settings`, `/focus`, …) are handled by a catch‑all in [`public/_redirects`](../../public/_redirects) (`/* → /index.html 200`) so deep links work. Crucially, Pages matches Functions **before** that static fallback, so `/api/...` calls hit the Worker and aren't swallowed by the SPA fallback.

**One guard to rule them all.** Every secret‑guarded endpoint starts with `requireAppSecret(request, env)`. It returns a ready‑made error `Response` (or `null` if the request is allowed), so each handler is just:

```ts
const authError = requireAppSecret(request, env);
if (authError) return authError;
```

**A deliberate error vocabulary.** Rather than letting failures collapse into an opaque `500`, the backend distinguishes them — which is what lets the setup screens show a useful message instead of "something broke":

| Condition | Status | `error` code |
|---|---|---|
| `APP_SHARED_SECRET` not set on the Worker | `500` | `server_not_configured` |
| `X-App-Secret` missing or wrong | `401` | `unauthorized` |
| A KV read/write threw | `503` | `storage_unavailable` |
| Upstream (Todoist or Google) unreachable / non‑JSON | `502` | `todoist_unreachable` / `google_unreachable` |

The split between `server_not_configured` (a *deploy* problem — you forgot to set the secret) and `unauthorized` (a *secret* problem — you typed it wrong) matters: before this distinction, a misconfigured Worker looked exactly like a wrong password, which is maddening to debug. The Google side raises these as a `GoogleWorkerError` from its KV/fetch wrappers in [`_lib.ts`](../../functions/api/auth/google/_lib.ts); the callback turns them into `?gcal=error&reason=<code>`. The frontend maps every code to a human sentence (in [`GoogleCalendarSetup.tsx`](../../src/components/settings/GoogleCalendarSetup.tsx) and [`TodoistSetup.tsx`](../../src/components/todoist/TodoistSetup.tsx)).

> Implementation note: `_lib.ts` re‑exports `json` and `requireAppSecret` from `_shared.ts` rather than keeping its own copies, so the Google and Todoist functions share one guard and one error model.

---

## 10. Configuration: what lives where

All server config lives on the **Cloudflare Pages project** (per environment — Production and, if you use them, Preview). None of it is baked into the frontend bundle, which is the whole point.

| Name | Kind | Used by | What it does |
|---|---|---|---|
| `GOOGLE_CLIENT_ID` | secret | Google `login`/`callback`/`token` | Identifies the app to Google. |
| `GOOGLE_CLIENT_SECRET` | secret | Google `callback`/`token` | Proves the app's identity during code exchange + refresh. **Never shipped to the browser.** |
| `APP_SHARED_SECRET` | secret | every guarded endpoint + `state` signing | The single‑user guard, and the HMAC key for OAuth `state`. You enter the same value in the app. |
| `APP_ORIGIN` | plaintext (optional) | Google `login`/`callback` | Pins the canonical origin for the redirect URI (see below). Defaults to the request origin. |
| `OAUTH_KV` | KV binding | all credential storage | Binds the KV namespace (also declared in [`wrangler.toml`](../../wrangler.toml)). |
| `SYNC_DB` | D1 binding | `/api/state` (v7.9) | Binds the D1 database mirroring the app-data slices (declared in [`wrangler.toml`](../../wrangler.toml); schema in [`db/schema.sql`](../../db/schema.sql)). |

The browser side has exactly **one** related value: the shared secret in `localStorage` (`orchestrate-cf-secret`). There are no `VITE_*` build‑time variables for these integrations anymore — the Google client ID moved server‑side along with everything else.

**Why `APP_ORIGIN` exists.** Cloudflare Pages serves every deployment at a unique preview URL (`<hash>.<project>.pages.dev`) in addition to your real domain. Google's OAuth, though, requires the `redirect_uri` to *exactly* match one you registered. If the Worker derived the origin from whichever preview URL happened to serve the request, the redirect URI would drift and Google would reject it (`redirect_uri_mismatch`). Setting `APP_ORIGIN` pins one canonical origin, so there's one redirect URI to register and previews don't break it.

**Local development.** The same names go in a gitignored `.dev.vars` file, and you run the stack with `wrangler pages dev` (which actually executes the Functions). Note the parity gap: plain `npm run dev` (Vite) serves the SPA but **not** the Functions, so both integrations will just show their connect prompt under it. Use `wrangler pages dev` when you need the backend. (Full steps: [deployment.md](../deployment.md) Part D.)

---

## 11. The security model, in one place

Pulling the threads together:

- **The guard.** `login`, `token`, `status`, `disconnect`, and the Todoist proxy all require `X-App-Secret === APP_SHARED_SECRET`. The `callback` can't (Google calls it) and is instead protected by the signed `state` (§6).
- **Secret separation.** The Google client secret and refresh token, and the Todoist token, never reach the browser. A fully compromised browser leaks only the shared secret and a ≤1‑hour access token — and the shared secret can be rotated without touching Google or Todoist.
- **Transport.** Everything is HTTPS — same‑origin between browser and Worker, HTTPS out to Google/Todoist. The secret rides a header, never a URL.
- **What it deliberately is *not*.** The secret comparison isn't constant‑time, and there's no rate limiting or lockout. At single‑user scale with a high‑entropy secret, brute force is out of the threat model. If the secret leaks, rotate it; if you suspect a token leaked, Disconnect (which revokes/clears it) or revoke access from the provider's own settings.

If you ever wanted defense‑in‑depth beyond the single secret, the low‑effort upgrade is to front the whole app with **Cloudflare Access** (Google SSO at the edge), which would gate even the static site behind your Google login — no app code required. It's noted here as a future option, not a current need.

---

## 12. Cost & quotas

A fair question, given §8 established that *every* Todoist call now hits the Worker: does this rack up Cloudflare charges? For a single user, no — it sits orders of magnitude inside the free tier. The reasoning:

- **What's billed:** Pages **Functions invocations** (your `/api/*` calls) count as Workers requests. Each proxied/OAuth call is **1 invocation + 1 KV read**; KV *writes* happen only when you connect, so they're negligible.
- **What's free:** **static asset requests** (the SPA itself) are free and unlimited — loading the app costs nothing.

| Resource | Free plan (verify — Cloudflare adjusts these) | Realistic single‑user load |
|---|---|---|
| Functions / Workers requests | ~100,000 / day | a few hundred → low thousands on a heavy day |
| KV reads | ~100,000 / day | = the call count (1 per call) |
| KV writes | ~1,000 / day | ~0 (only on connect) |

An intense hour of planning — 100+ reschedules/completes plus the periodic refreshes — is roughly **150–300 invocations**, about 0.2% of the daily free allowance. You'd need ~100,000 Todoist operations *in a day* to approach the ceiling, which one person can't reach by hand. And on the Free plan there's no surprise bill: if you somehow hit the limit, Functions return errors until the UTC reset rather than auto‑charging. (The paid plan is $5/mo for ~10M requests/month, strictly opt‑in.)

Two things keep the count down for free: the frontend's **stale‑while‑revalidate** cache (it won't refetch task/project data younger than 5 minutes, and dedupes focus‑refreshes within 30s — see [synthesis.md §6.2](../synthesis.md)), and Google's **in‑memory + KV access‑token caches** (§7). The only thing that would change this calculus is going multi‑user — which is explicitly out of scope.

---

## 13. Assumptions that would force a redesign

Everything above rests on a small set of assumptions. They're sound for a personal tool; the point of listing them is that if one stops holding, the design should be revisited — not patched.

- **Exactly one user / one tenant.** KV keys are global; there is no per‑user namespacing. Multi‑user is not a config change — it's a different design.
- **The shared secret is the sole guard** (no rate limiting, lockout, or constant‑time compare). Fine for one high‑entropy secret; not fine if the secret must be shared widely.
- **KV's ~≤60s eventual consistency is acceptable** for token reads/writes.
- **Same‑origin** browser↔Worker, so there's no CORS and the secret can ride a header.
- **The browser is trusted enough** to hold the shared secret and a ≤1‑hour access token — it already holds all the app data anyway.
- **No app‑data backend.** The Worker is a credential vault + proxy; app state stays in `localStorage`. Whether *that* should change is a separate question, tracked in [persistence_and_backend_migration.md](../roadmap/persistence_and_backend_migration.md).

And a few sharp edges worth knowing:

- **KV "backup."** If the namespace is deleted or rebound, both connections drop — but the tokens are re‑obtainable (re‑paste Todoist, re‑consent Google), so it's a reconnect, not data loss. No backup story is needed.
- **Preview environments** return `server_not_configured` unless you copy the vars/bindings into Cloudflare's Preview environment — intentional, so throwaway previews don't carry live secrets.
- **Secret rotation** changes the HMAC key, so any OAuth login *in flight* during rotation fails with `reason=state` (just retry), and every browser must re‑enter the new value.
- **Observability.** Failures come back as explicit codes (not opaque 500s), and Worker logs are available via the Cloudflare dashboard or `wrangler tail`, so a broken deploy is diagnosable.

---

## 14. The frontend side, briefly

For completeness, the browser half of all this:

| File | Role |
|---|---|
| [`src/lib/appSecret.ts`](../../src/lib/appSecret.ts) | Stores/reads the shared secret; notifies subscribers when it changes. |
| [`src/hooks/useAppSecret.ts`](../../src/hooks/useAppSecret.ts) | Reactive hook so the UI re‑renders the instant the secret is set/cleared. |
| [`src/lib/googleAuth.ts`](../../src/lib/googleAuth.ts) | Google Worker client: `startGoogleLogin`, `fetchAccessToken`, `fetchConnectionStatus`, `disconnectGoogle`. |
| [`src/lib/googleCalendarApi.ts`](../../src/lib/googleCalendarApi.ts) | Thin Calendar REST client; takes a Bearer token (calls Google directly). |
| [`src/context/GoogleCalendarContext.tsx`](../../src/context/GoogleCalendarContext.tsx) | The provider: in‑memory token cache, connection state, connect/disconnect/refresh, reload reconnect. |
| [`src/lib/todoistApi.ts`](../../src/lib/todoistApi.ts) | Proxy base URL + `getTodoistStatus`/`storeTodoistToken`/`disconnectTodoist`. |
| [`src/context/TodoistContext.tsx`](../../src/context/TodoistContext.tsx) | Sends `X-App-Secret` on every call; resolves `isConfigured` from `/status`. |
| [`GoogleCalendarSetup.tsx`](../../src/components/settings/GoogleCalendarSetup.tsx) / [`TodoistSetup.tsx`](../../src/components/todoist/TodoistSetup.tsx) | The Settings UIs: secret entry, connect/disconnect, post‑redirect handling. |

The only client‑persisted state is the `orchestrate-cf-secret` key and a couple of cached "connected" flags in settings; the Google access token is memory‑only, and both the refresh token and the Todoist token are server‑only.

---

## See also

- [../deployment.md](../deployment.md) — the step‑by‑step setup (Google Cloud client, Cloudflare project, KV, secrets, local dev, troubleshooting).
- [../synthesis.md](../synthesis.md) §7 (integrations), §11 (persistence) — where this fits in the app.
- [../roadmap/engagement_record_strategy.md](../roadmap/engagement_record_strategy.md) — option E1 vs E2, and the calendar‑write feature this unlocks.
