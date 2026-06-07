# Deployment — Cloudflare Pages + Google Calendar OAuth

How Orchestrate is hosted and how its Google Calendar OAuth works, end to end.

## Architecture at a glance

- **Hosting:** static Vite SPA on **Cloudflare Pages**, served at the **domain root** (`/`). (Previously GitHub Pages under `/orchestrate/`.)
- **OAuth:** a thin serverless backend — **Cloudflare Pages Functions** under `functions/api/auth/google/` — runs the Google **auth-code flow** and holds the long-lived **refresh token** in **Workers KV**. The browser never sees the client secret or the refresh token; it holds only a single **shared secret** and asks the Worker for short-lived access tokens. This is the roadmap's **option E2**.
- **Endpoint guard:** every browser→Worker request carries the `APP_SHARED_SECRET` (sent as an `X-App-Secret` header). It's a single-user personal tool, so one shared secret is the whole auth model.

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

Endpoints (all under `/api/auth/google/`): `login` (guarded → returns consent URL), `callback` (Google → stores tokens), `token` (guarded → fresh access token), `status` (guarded → connected?), `disconnect` (guarded → revoke + clear).

Why this also fixes the localStorage concern: Cloudflare Pages serves the app from its own origin (`<project>.pages.dev`, or your custom domain), so its `localStorage` is isolated from any other site — unlike GitHub Pages project sites, which all share the single `<user>.github.io` origin.

---

## Prerequisites

- A Cloudflare account (free plan is fine).
- A Google account + access to the [Google Cloud Console](https://console.cloud.google.com/).
- This repo pushed to GitHub/GitLab (for Pages' git integration) — or the Wrangler CLI for direct upload.
- Decide your final URL now: either the default `https://<project>.pages.dev` or a custom domain (e.g. `https://orchestrate.example.com`). The OAuth redirect URI must match it exactly, so picking it up front avoids re-editing Google config later.

---

## Part A — Google Cloud OAuth client

1. **Create/select a project** in the Google Cloud Console.
2. **Enable the Google Calendar API:** APIs & Services → Library → search "Google Calendar API" → **Enable**.
3. **Configure the OAuth consent screen:** APIs & Services → OAuth consent screen.
   - User type: **External**. Publishing status: leave in **Testing** (no Google verification needed for a personal tool).
   - Add your own Google account under **Test users**.
   - Scopes (added at the client level below, but list them here too if prompted):
     - `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
     - `https://www.googleapis.com/auth/calendar.events`
4. **Create the OAuth client:** APIs & Services → Credentials → **Create credentials → OAuth client ID**.
   - Application type: **Web application**.
   - **Authorized redirect URIs** — add your callback URL(s) exactly:
     - Production: `https://<your-domain>/api/auth/google/callback`
     - Local dev (optional, see Part D): `http://localhost:8788/api/auth/google/callback`
   - You do **not** need "Authorized JavaScript origins" for this flow (the redirect URI is what matters).
5. Copy the **Client ID** and **Client secret** — you'll paste them into Cloudflare in Part B.

> Note: Testing-mode refresh tokens can expire after ~7 days of non-use, and the first consent shows a "Google hasn't verified this app" screen — both expected and fine for single-user use. If you'd rather have stable long-lived tokens, publish the consent screen to **In production** (no verification is required when you keep the app's sensitive-scope usage to your own account, but Google may show extra warnings).

---

## Part B — Cloudflare Pages project

### 1. Create the KV namespace

In the Cloudflare dashboard: **Workers & Pages → KV → Create a namespace**, name it e.g. `orchestrate-oauth`. Copy its **ID**.

Or via CLI:
```bash
npx wrangler kv namespace create OAUTH_KV
```

Paste the namespace ID into [`wrangler.toml`](../wrangler.toml) (replace `REPLACE_WITH_KV_NAMESPACE_ID`), or bind it in the dashboard in step 3.

### 2. Create the Pages project

**Workers & Pages → Create → Pages → Connect to Git**, pick this repo, then set:

- **Production branch:** `main` (or your choice)
- **Build command:** `npm run build`
- **Build output directory:** `dist`
- Framework preset: **Vite** (or "None" — the explicit command/output above is what matters)

Cloudflare auto-detects the `functions/` directory and deploys it as Pages Functions; no extra config needed. The `public/_redirects` file gives the SPA its deep-link fallback.

### 3. Bind KV + set secrets

In the new project: **Settings → Functions (or Bindings)**:

- **KV namespace binding:** variable name `OAUTH_KV` → the namespace from step 1.

Then **Settings → Environment variables / Secrets** (add to the **Production** environment, and Preview if you use it):

| Name | Value | Kind |
|---|---|---|
| `GOOGLE_CLIENT_ID` | from Part A | Secret |
| `GOOGLE_CLIENT_SECRET` | from Part A | Secret |
| `APP_SHARED_SECRET` | a long random string you generate | Secret |
| `APP_ORIGIN` *(optional)* | your canonical origin (see below) | Plaintext |

Generate a strong shared secret, e.g.:
```bash
openssl rand -base64 32
```

**About `APP_ORIGIN`** — it's just your one canonical origin (scheme + host, no path, no trailing slash). That origin is whichever you actually serve the app on:

- **No custom domain:** `https://<your-project>.pages.dev`
- **Custom domain:** your custom domain, e.g. `https://orchestrate.example.com` — yes, `APP_ORIGIN` *is* the custom domain in that case.

It's optional: if unset, the Worker derives the origin from each incoming request. The reason to set it is that Pages also serves **per-deployment preview URLs** (`https://<hash>.<project>.pages.dev`), which are different hosts — pinning `APP_ORIGIN` keeps OAuth redirects on your one real domain. If you're using a custom domain, attach it first (step 4), then set `APP_ORIGIN` to it. Whatever you pick here must match both the Google redirect URI (Part A) and the domain you open the app on.

Or set secrets via CLI:
```bash
npx wrangler pages secret put GOOGLE_CLIENT_ID
npx wrangler pages secret put GOOGLE_CLIENT_SECRET
npx wrangler pages secret put APP_SHARED_SECRET
```

### 4. Deploy & (optional) custom domain

Trigger a deploy (push to the branch, or **Retry deployment**). When it's live at `https://<project>.pages.dev`:

- To use a custom domain: **Custom domains → Set up a domain**, follow the DNS steps. Once it's live, **update `APP_ORIGIN` (step 3) to the custom domain** — it's the same origin value, just now pointing at your real domain instead of `*.pages.dev`.
- **Make sure the redirect URI in Part A matches your final origin** (`https://<final-domain>/api/auth/google/callback`). If you added a custom domain after creating the OAuth client, go back and add/replace the redirect URI.

> In short: `APP_ORIGIN`, the Google redirect URI, and the URL you open the app on must all be the same origin — `*.pages.dev` if you're not using a custom domain, otherwise the custom domain.

---

## Part C — Connect inside the app

1. Open the deployed app → **Settings → Integrations → Google Calendar**.
2. Enter the **app secret** (the same value as `APP_SHARED_SECRET`) and **Save**. It's stored in this browser's `localStorage` (key `orchestrate-cf-secret`) and sent with each Worker request.
3. Click **Connect Google Calendar** → you're redirected to Google's consent screen → approve → you land back on the Settings page as **Connected**.
4. Pick which calendars to overlay. Done.

Because the refresh token lives on the server, the connection persists across devices and browser sessions — each new device just needs the app secret entered once.

---

## Part D — Local development

The frontend dev server (`npm run dev`) does **not** run the Pages Functions, so OAuth won't work there. To run the full stack locally use Wrangler:

1. Create a gitignored **`.dev.vars`** at the repo root:
   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   APP_SHARED_SECRET=...
   ```
2. Build, then run Pages locally (serves `dist/` + `functions/` together on `http://localhost:8788`):
   ```bash
   npm run build
   npx wrangler pages dev dist
   ```
   For KV locally, Wrangler uses a local KV simulation by default; add `--kv OAUTH_KV` if it doesn't auto-bind from `wrangler.toml`.
3. Add `http://localhost:8788/api/auth/google/callback` as an Authorized redirect URI in the Google OAuth client (Part A).

For pure UI work without OAuth, `npm run dev` is still the fastest loop — the calendar panel just shows the "enter app secret / connect" state.

---

## Troubleshooting

- **`redirect_uri_mismatch`** — the redirect URI in Google Cloud doesn't exactly match `https://<origin>/api/auth/google/callback`. Check scheme, host, and the path; no trailing slash.
- **Sign-in returns `?gcal=error&reason=state`** — the OAuth state failed verification (expired >10 min, or `APP_SHARED_SECRET` changed mid-flow). Just connect again.
- **"App secret was rejected"** — the value entered in Settings doesn't match `APP_SHARED_SECRET`. Re-enter it (Settings → Integrations → Change).
- **Connected, then later needs reconnecting** — the refresh token was revoked or expired (testing-mode 7-day idle limit). Reconnect; consider publishing the consent screen for stability.
- **Functions 500 / `server_not_configured`** — `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` aren't set on the environment that served the request (check Production vs Preview).
