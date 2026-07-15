# Orchestrate v7.2 — Google Calendar OAuth, Cloudflare Pages, and a first backend

## Context

v7.2 is the **Google Calendar integration** iteration — and, almost incidentally, the point where Orchestrate grew its **first piece of server-side code**. It landed in two phases:

1. **E1 — browser-only (GIS).** The first cut used the Google Identity Services (GIS) token client: a build-time `VITE_GOOGLE_CLIENT_ID`, no backend, access tokens minted in the browser and held only in memory. This shipped first (it auto-lists the user's calendars and adds `createEvent` write plumbing) and proved the feature, but it has a hard ceiling — it cannot hold a **refresh token** securely and cannot write **unattended**.
2. **E2 — server-mediated (this migration).** Moving the static site from **GitHub Pages → Cloudflare Pages** brought same-origin **serverless Functions** into reach, which unlocked the full auth-code flow with the **client secret + refresh token held server-side**. That is the current state and the bulk of what this doc describes.

The roadmap framed exactly this split — see [roadmap/engagement_record_strategy.md](../../roadmap/engagement_record_strategy.md) options **E1** vs **E2**, and [roadmap/persistence_and_backend_migration.md](../../roadmap/persistence_and_backend_migration.md) (E2 is "the single feature that most clearly wants a backend"). v7.2 is the E2 step landing earlier than the roadmap's "after v8" default, because the hosting move made it cheap.

Two motivations converged:

- **Origin isolation.** On GitHub Pages, all of a user's project sites share the single `<user>.github.io` origin, so they share `localStorage`. Cloudflare Pages gives the app its **own origin** (`<project>.pages.dev` or a custom domain), isolating its data. (A custom domain on GitHub Pages would also have fixed this — it was not the deciding factor.)
- **A real OAuth backend.** The deciding factor. Same-origin Functions let the client secret and refresh token live off the browser entirely.

## What shipped

### Hosting: GitHub Pages → Cloudflare Pages (served at root)

The app moved from `https://<user>.github.io/orchestrate/` to the **domain root** (`/`) on Cloudflare Pages. That meant unwinding the `/orchestrate/` base-path coupling in five places:

- `vite.config.ts` — `base: '/'`.
- `src/main.tsx` — router `basename="/"`, service-worker registration `/sw.js`.
- `public/sw.js` — app-shell cache paths `/orchestrate/*` → `/*`; cache name bumped `orchestrate-v2 → v3` (the activate handler purges the stale v2 caches).
- `public/manifest.json` — `start_url` / `scope` → `/`.
- `index.html` — removed the GIS `<script>` (no longer browser-OAuth) and the GitHub Pages SPA-redirect hack.

Deleted: `public/404.html` (the GH Pages 404 redirect trick) and `.github/workflows/deploy.yml` (the GH Pages deploy workflow). Added `public/_redirects` (`/* → /index.html 200`) for SPA deep-link fallback on Pages.

### Backend: Cloudflare Pages Functions (the OAuth endpoints)

New `functions/` directory at the repo root (auto-discovered by Pages; file path → route). All endpoints under `functions/api/auth/google/`:

| File | Route | Method | Guard | Purpose |
|---|---|---|---|---|
| `login.ts` | `/api/auth/google/login` | GET | shared secret | Builds the Google consent URL with a signed `state`, returns `{ url }`. |
| `callback.ts` | `/api/auth/google/callback` | GET | signed `state` | Verifies `state`, exchanges `code` → tokens, stores the refresh token in KV, redirects back to `/settings?tab=integrations&gcal=connected`. |
| `token.ts` | `/api/auth/google/token` | GET | shared secret | Returns a fresh access token (KV cache, else minted via the refresh token). |
| `status.ts` | `/api/auth/google/status` | GET | shared secret | `{ connected, scope }`. |
| `disconnect.ts` | `/api/auth/google/disconnect` | POST | shared secret | Revokes at Google + clears KV. |
| `_lib.ts` | — | — | — | Shared helpers: `Env`, secret guard, state HMAC, Google token calls, KV storage. |

Design points:

- **Three trust zones.** Browser holds only the shared secret (localStorage) + a ≤1-hour access token (memory). Worker holds the client ID/secret + signing logic (stateless; config from env). Workers KV holds the durable refresh token, a cached access token, and the granted scope.
- **Stateless CSRF on the callback.** `callback` can't take a custom header (Google calls it), so it's guarded by a signed `state`: `<ts>.<nonce>.<HMAC-SHA256(ts.nonce, APP_SHARED_SECRET)>`, rejected if the signature fails or it's >10 min old. No KV round-trip for the nonce.
- **Refresh-token guarantee.** The consent URL requests `access_type=offline` + `prompt=consent` so a refresh token is always issued.
- **`invalid_grant` self-heal.** When Google rejects the refresh token (revoked/expired), `getAccessToken()` clears all three KV keys so the app cleanly reports "disconnected."
- **Access-token cache.** `google:access_token` is cached in KV with `expirationTtl` so repeated `/token` calls don't hammer Google.

### Config & secrets

All server config lives on the Cloudflare Pages project (per environment), **never** baked into the frontend bundle:

- Secrets: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APP_SHARED_SECRET`.
- Plaintext (optional): `APP_ORIGIN` — pins the canonical origin for the redirect URI so per-deployment `*.pages.dev` preview hosts don't redirect wrongly; defaults to the request origin.
- KV binding: `OAUTH_KV` (in `wrangler.toml` + the dashboard).

Supporting files: `wrangler.toml` (Pages config + KV binding), `functions/tsconfig.json` (editor-only Worker globals — Functions are bundled by Cloudflare, not by the app's `tsc -b`, which only includes `src/`), `@cloudflare/workers-types` devDep, `functions` added to the eslint ignore list, and `.dev.vars` added to `.gitignore` (local Functions secrets). The frontend no longer needs **any** `VITE_*` var for this integration — the client ID moved server-side — so `.env.example` and `vite-env.d.ts` were stripped of `VITE_GOOGLE_CLIENT_ID`.

### Frontend rewrite

- **`src/lib/googleAuth.ts`** — rewritten from a GIS token-client wrapper into a **Worker client**: stores/reads the shared secret (`orchestrate-cf-secret`), and exposes `startGoogleLogin`, `fetchAccessToken`, `fetchConnectionStatus`, `disconnectGoogle`. `isGoogleConfigured()` now means "shared secret is set." New `AppSecretError` distinguishes a rejected secret from a signed-out state.
- **`src/context/GoogleCalendarContext.tsx`** — `connect()` now navigates to Google (no in-page token client); `getAccessToken()` calls the Worker and caches the access token in memory; added `setAppSecret` and `checkConnection`; auto-reconnect on load calls `/status` once when `settings.googleCalendarConnected` is set.
- **`src/components/settings/GoogleCalendarSetup.tsx`** — added the shared-secret entry field and the `?gcal=connected|error` post-redirect handling (via `useSearchParams`), alongside the existing connect/disconnect + calendar picker.
- **`src/lib/googleCalendarApi.ts`** — unchanged; still a thin REST v3 client taking a Bearer token.

Client-persisted state is just `orchestrate-cf-secret` (localStorage) + the `googleCalendarConnected` flag in settings. The access token is memory-only; the refresh token is server-only. **No schema migration** — `_schemaVersion` is untouched (this iteration adds no `DayPlan`/`LifeContext` shape change).

## Documentation

The docs were deliberately split so the procedure and the concepts don't tangle:

- **[docs/deployment.md](../../deployment.md)** — the *step-by-step setup procedure*: Google Cloud OAuth client (Part A), the Cloudflare Pages project + KV + secrets (Part B), connecting in-app (Part C), local dev with `wrangler pages dev` + `.dev.vars` (Part D), and troubleshooting. Includes an extended note on choosing `APP_ORIGIN` (it equals your one canonical origin — `*.pages.dev` or the custom domain — and must match the Google redirect URI and the URL you open the app on).
- **[docs/reference/backend.md](../../reference/backend.md)** — the *conceptual "how it works"* reference: the three trust zones, the Functions table, the OAuth flow step-by-step, every variable/secret and who uses it, the KV key shapes, and the full security model.
- **[docs/synthesis.md](../../synthesis.md)** — updated §2 (routing basename `/`, root on Cloudflare), §3.1 (provider-tree note: refresh token server-side), §7 (the Google Calendar integration row + a rewritten "Hosting + minimal backend" paragraph), §11 (the `orchestrate-cf-secret` key + "the only server-side state is the refresh token in KV"), §13/§14 (hook + directory descriptions, and a repo-root deployment-files note).

`deployment.md` links to the reference for "how it works"; the reference links back to `deployment.md` for "how to set it up"; both link to synthesis §7 and the roadmap. The procedure lives in exactly one place.

## Notes / trade-offs

- **Built ahead of its consumer.** `createEvent` is still **plumbing** — no feature writes calendar events yet. v7.2 builds the durable-refresh-token foundation so the eventual unattended-write feature (engagement events on the calendar) is a small follow-up, not a re-architecture.
- **Single shared secret, by design.** The auth model is deliberately one high-entropy `APP_SHARED_SECRET` (guarding the endpoints + signing `state`), matching the roadmap's "at most one shared secret" framing for a single-user tool. Not constant-time, no rate limiting — acceptable at personal scale; rotate the secret if it leaks, Disconnect (or revoke in Google account settings) if the refresh token is suspected leaked. The richer alternative (Google ID-token / Cloudflare Access identity gating) was considered and **declined** as over-engineering for one user — see "Considered, not done."
- **Dev split.** `npm run dev` (Vite) does **not** run the Functions, so OAuth needs `wrangler pages dev` locally. Pure UI work stays on the fast Vite loop (the calendar panel just shows "enter secret / connect").
- **Testing-mode tokens.** With the Google consent screen left in *Testing*, refresh tokens can expire after ~7 days idle and first consent shows the unverified-app screen — both fine for personal use; publish the consent screen for stability.
- **No test runner** (still no vitest); verified via `npm run build` + `npm run lint` and manual flow reasoning.

## Considered, not done (follow-ups)

- **Move the Todoist token server-side.** ✅ **Done** — implemented as a v7.2 addendum (see below).
- **Identity-based endpoint guard.** Replace/augment the shared secret with a Google **ID-token** check (verify the JWT against Google's JWKS, pin `aud` = client ID, allowlist your `sub`/`email`) or front the whole app with **Cloudflare Access** (Google SSO at the edge, no app code). Both are more robust but add a second Google flow / JWT-verification machinery (or gate the static app behind a login) for marginal single-user benefit. Deferred.
- **Unattended calendar writes (the real E2 payoff).** A scheduled Worker writing engagement events with no tab open — waits on the durable engagement record (roadmap option A) existing to write *from*.

---

## Addendum — Todoist token to KV proxy

A follow-on within the v7.2 Cloudflare arc (infrastructure/security, no app-functionality change): the Todoist personal token moved off the browser into Workers KV, mirroring the Google E2 pattern. Previously the token sat in `localStorage` as AES-GCM ciphertext **with its key + IV beside it** — obfuscation, not security: anyone with browser-profile access could recover it.

### What shipped

**Backend (reuses `OAUTH_KV` + `APP_SHARED_SECRET` — no new namespace/secret):**

- [`functions/api/todoist/[[path]].ts`](../../functions/api/todoist/%5B%5Bpath%5D%5D.ts) — a **catch-all proxy**: guards on the shared secret, reads `todoist:token` from KV, and forwards `/api/todoist/*` → `https://api.todoist.com/*` with the `Authorization: Bearer` header injected server-side. The token never reaches the browser.
- [`functions/api/todoist-auth/{token,status,disconnect}.ts`](../../functions/api/todoist-auth/) — store (validates against Todoist `/projects` first), report `{ configured }`, and clear.
- [`functions/_shared.ts`](../../functions/_shared.ts) — `json` + `checkSecret` shared by the new functions (the Google `_lib.ts` keeps its own copy, untouched, to avoid disturbing the deployed OAuth path).

**Why a proxy, not a token-minting endpoint:** a Todoist personal token *is* the long-lived credential (no short-lived derivative to hand out), so the only safe shape is to keep it server-side and proxy every call — unlike Google, where the Worker mints disposable ~1-hr access tokens for the browser.

**Frontend:**

- [`src/lib/appSecret.ts`](../../src/lib/appSecret.ts) (new) — the shared `orchestrate-cf-secret` storage, now used by **both** integrations. `googleAuth.ts` re-exports it (no churn at its call sites).
- [`src/lib/todoistApi.ts`](../../src/lib/todoistApi.ts) — `API_BASE` is now the same-origin proxy (`/api/todoist/api/v1`) in dev **and** prod; added `getTodoistStatus` / `storeTodoistToken` / `disconnectTodoist`; dropped `validateTodoistToken` (validation moved server-side).
- [`src/context/TodoistContext.tsx`](../../src/context/TodoistContext.tsx) — removed all browser-token plumbing (`decryptToken`/`resolveToken`/`tokenRef`); `apiFetch` now sends `X-App-Secret` instead of a Bearer token; `isConfigured` resolves from `/status` (state + a ref for the mutation early-returns); new `refreshConnection()` action.
- [`src/components/todoist/TodoistSetup.tsx`](../../src/components/todoist/TodoistSetup.tsx) — shared-secret entry + worker-backed Test&Save / Disconnect; clears the legacy `settings.todoistToken*` fields on connect/disconnect.
- [`src/components/wizard/Step1Intentions.tsx`](../../src/components/wizard/Step1Intentions.tsx) — `todoistConfigured` now reads the provider's `isConfigured`, not the settings token.

**Removed / deprecated:** deleted [`src/lib/crypto.ts`](../../src/lib/crypto.ts) (the AES-GCM helpers are now dead — client-side token encryption is gone) and the Vite `/api/todoist` dev proxy (the Function is the proxy now). The `settings.todoistToken/IV/Key` fields are kept on the type but **deprecated** (unused; cleared on next connect/disconnect) so old persisted settings + backups still parse.

### Notes / trade-offs

- **Dev now needs `wrangler pages dev` for Todoist too** — plain `npm run dev` has no Functions, so (like Google) Todoist shows the connect prompt. Pure UI work is unaffected.
- **One-time reconnect on upgrade.** Existing users' old localStorage token is ignored; they paste it once to store it in KV (the stale local copy is then cleared). Documented in [deployment.md](../../deployment.md) Part C.
- **Minor duplication:** `json`/`checkSecret` exist in both `functions/_shared.ts` and the Google `_lib.ts`. Deliberate — the deployed Google path was left untouched; if it's refactored later, point it at `_shared.ts`.
- **Docs:** updated synthesis (§2 Crypto, §7 Todoist row + hosting paragraph, §11, §14), data-model (Todoist token + Google entries, `RESET_ALL` note), deployment.md (Part C Todoist connect), and reference/backend.md (the Todoist proxy walkthrough). Verified via `npm run build` + `npm run lint`.
