# Deployment — Cloudflare Pages + Access + Google OAuth

The **step-by-step setup** to host Orchestrate on Cloudflare Pages, gate it behind Cloudflare Access (Google sign-in for pre-approved accounts), and wire up the Google Calendar OAuth.

> **How it all works** — the Functions, the Access identity model, the OAuth flow, every variable/secret and how each is used, the KV/D1 storage, and the security model — lives in the reference: [reference/cloudflare_workers.md](./reference/cloudflare_workers.md). This page is just the procedure.

**In one paragraph:** the app is a static Vite SPA on Cloudflare Pages (served at the domain root), plus serverless **Pages Functions** that run Google's auth-code flow (`functions/api/auth/google/`), proxy Todoist (`functions/api/todoist*`), and mirror app state to D1 (`functions/api/state/`). The whole origin sits behind a **Cloudflare Access** application: users sign in with a pre-approved Google account at the edge, and every Function resolves the caller's identity from the Access JWT — credentials in KV and sync rows in D1 are namespaced per user. To deploy you'll: create a Google OAuth client (Part A), create the Cloudflare Pages project with KV + D1 + secrets (Part B), set up Zero Trust/Access (Part C), then connect Todoist and Google Calendar inside the app (Part D).

---

## Prerequisites

- A Cloudflare account (free plan is fine — including Zero Trust up to 50 users).
- A Google account + access to the [Google Cloud Console](https://console.cloud.google.com/).
- This repo pushed to GitHub/GitLab (for Pages' git integration) — or the Wrangler CLI for direct upload.
- Decide your final URL now: either the default `https://<project>.pages.dev` or a custom domain. The OAuth redirect URI must match it exactly, so picking it up front avoids re-editing Google config later.

---

## Part A — Google Cloud OAuth client

One Google OAuth client serves **both** purposes: the Access login (Part C) and the in-app calendar connection.

1. **Create/select a project** in the Google Cloud Console.
2. **Enable the Google Calendar API:** APIs & Services → Library → search "Google Calendar API" → **Enable**.
3. **Configure the OAuth consent screen:** APIs & Services → OAuth consent screen.
   - User type: **External**. Publishing status: leave in **Testing** (no Google verification needed).
   - Add **every account that will use the app** under **Test users** — yours and each friend's (cap 100). Someone not on this list can still *enter* the app (that's the Access policy, Part C) but will be refused when they try to connect their calendar.
4. **Create the OAuth client:** APIs & Services → Credentials → **Create credentials → OAuth client ID**.
   - Application type: **Web application**.
   - **Authorized redirect URIs** — add exactly:
     - Production calendar callback: `https://<your-domain>/api/auth/google/callback`
     - Access login callback (Part C): `https://<your-team>.cloudflareaccess.com/cdn-cgi/access/callback`
     - Local dev (optional, see Part E): `http://localhost:8788/api/auth/google/callback`
5. Copy the **Client ID** and **Client secret** — you'll paste them into Cloudflare in Parts B and C.

> Note: Testing-mode refresh tokens can expire after ~7 days of non-use, and the first consent shows a "Google hasn't verified this app" screen — both expected and fine at this scale. If you'd rather have stable long-lived tokens, publish the consent screen to **In production** (Google may show extra warnings for sensitive scopes).

---

## Part B — Cloudflare Pages project

### 1. Create the KV namespace

In the Cloudflare dashboard: **Workers & Pages → KV → Create a namespace**, name it e.g. `orchestrate-oauth`. Copy its **ID** into [`wrangler.toml`](../wrangler.toml), or via CLI:

```bash
npx wrangler kv namespace create OAUTH_KV
```

### 1b. Create the D1 database (state sync)

```bash
npx wrangler d1 create orchestrate-sync
```

Paste the printed `database_id` into [`wrangler.toml`](../wrangler.toml), then apply the schema to **both** the remote and local databases:

```bash
npx wrangler d1 execute orchestrate-sync --remote --file db/schema.sql
npx wrangler d1 execute orchestrate-sync --local  --file db/schema.sql
```

> **Upgrading a pre-multi-user database** (rows without `user_id`): run [`db/migrate_add_user_id.sql`](../db/migrate_add_user_id.sql) instead, after replacing `__OWNER_EMAIL__` with your Google account email (lowercase) — it rebuilds the table with the `(user_id, key)` primary key and backfills your existing rows.

### 2. Create the Pages project

**Workers & Pages → Create → Pages → Connect to Git**, pick this repo, then set:

- **Production branch:** `main` · **Build command:** `npm run build` · **Build output directory:** `dist`

Cloudflare auto-detects the `functions/` directory and deploys it as Pages Functions. The `public/_redirects` file gives the SPA its deep-link fallback.

### 3. Bind storage + set secrets

In the new project, confirm the bindings (**Settings → Bindings**; they're picked up from `wrangler.toml` on git-integration deploys): `OAUTH_KV` (KV) and `SYNC_DB` (D1).

Then **Settings → Environment variables / Secrets** (Production environment):

| Name | Value | Kind |
|---|---|---|
| `GOOGLE_CLIENT_ID` | from Part A | Secret |
| `GOOGLE_CLIENT_SECRET` | from Part A | Secret |
| `OAUTH_STATE_SECRET` | a long random string you generate (`openssl rand -base64 32`) | Secret |
| `CF_ACCESS_TEAM_DOMAIN` | from Part C, e.g. `myteam.cloudflareaccess.com` | Plaintext |
| `CF_ACCESS_AUD` | the Access application's AUD tag (Part C) | Secret |
| `APP_ORIGIN` *(optional)* | your canonical origin (see below) | Plaintext |

(You'll come back to fill the two `CF_ACCESS_*` values after Part C.)

**About `APP_ORIGIN`** — your one canonical origin (scheme + host, no path): `https://<project>.pages.dev`, or the custom domain if you attach one. It's optional (the Worker derives the origin from the request), but Pages also serves per-deployment preview URLs — pinning `APP_ORIGIN` keeps OAuth redirects on your one real domain. Whatever you pick must match the Google redirect URI (Part A) and the domain you open the app on.

### 4. Deploy & (optional) custom domain

Trigger a deploy. To use a custom domain: **Custom domains → Set up a domain**, then update `APP_ORIGIN` and the Part A redirect URI to match.

---

## Part C — Cloudflare Access (Zero Trust)

This is what makes the app private and multi-user: sign-in happens at the edge, before anything is served.

1. **Create a Zero Trust team** (Cloudflare dashboard → Zero Trust; first-time setup asks you to pick a **team name** — `<team>.cloudflareaccess.com` is your team domain). The free plan covers 50 users.
2. **Add Google as an identity provider:** Zero Trust → **Settings → Authentication → Login methods → Add new → Google**. Paste the **same Client ID + secret from Part A**. (This is why Part A registered the `https://<team>.cloudflareaccess.com/cdn-cgi/access/callback` redirect URI.) Optionally delete the default One-time PIN method so Google is the only login.
3. **Create the Access application:** Zero Trust → **Access → Applications → Add an application → Self-hosted**.
   - **Public hostname:** your production domain (`<project>.pages.dev` or the custom domain). Add both if you use both. *(Note: the Pages project's own "Access policy" toggle only covers preview deployments — the production domain needs this explicit application.)*
   - **Session duration:** e.g. 1 week (how often users re-authenticate).
   - **Policy:** Action **Allow**, include → **Emails** → list your account and each friend's Google email. This list *is* the app's user management.
4. **Record the values for the Worker:** the application's **AUD tag** (application overview page) → `CF_ACCESS_AUD`, and your team domain → `CF_ACCESS_TEAM_DOMAIN`. Set both on the Pages project (Part B step 3) and redeploy.

Adding a user later = add their email to the Access policy **and** to the Google test-user list (Part A step 3). Removing one = remove from the policy (their KV credentials can be deleted with `wrangler kv key delete`, and their D1 rows with a `DELETE FROM slices WHERE user_id = '…'`).

---

## Part D — First run inside the app

Open the deployed app: you'll hit the Access Google sign-in first, then Orchestrate's **onboarding flow** walks through everything:

1. **What Orchestrate is** — and its two integrations (Todoist required, Google Calendar recommended).
2. **Connect Todoist** — paste your personal API token (Todoist → Settings → Integrations → Developer). The Worker validates it and stores it under *your* identity in KV — never in the browser. Required to continue.
3. **Connect Google Calendar** — the OAuth consent (Part A's client). Skippable; a nudge remains in the wizard until connected.

Both connections are per-account and server-held, so they follow you across devices — signing in on a new machine needs nothing but the Access login. Each user (you and each friend) goes through the same flow with their own Todoist/Google accounts. Integrations can be managed anytime in **Settings → Integrations**.

> **Upgrading from the shared-secret era (pre-v7.10):** the app secret is gone — there's nothing to enter in Settings anymore. You'll need to reconnect both integrations once (the KV keys moved to per-user names), and run the D1 migration from Part B 1b so your synced data lands under your identity.

---

## Part E — Local development

The frontend dev server (`npm run dev`) does **not** run the Pages Functions, so integrations won't work there. To run the full stack locally use Wrangler:

1. Create a gitignored **`.dev.vars`** at the repo root:
   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   OAUTH_STATE_SECRET=any-dev-string
   DEV_USER_EMAIL=you@example.com
   ```
   `DEV_USER_EMAIL` is the local stand-in for Cloudflare Access (which doesn't exist in front of `wrangler pages dev`): every request is treated as that identity. **Change it to a second address to simulate another user** — separate KV keys, separate D1 rows — which is how multi-user isolation is tested locally. Never set it in production.
2. Run the full stack locally with auto-reload — one command, served on `http://localhost:8788`:
   ```bash
   npm run dev:full
   ```
   This runs `vite build --watch` alongside `wrangler pages dev dist --live-reload`. Wrangler auto-provisions local KV and a **local D1** for `SYNC_DB` (persisted under `.wrangler/state`) — apply the schema to it once (Part B 1b, `--local`) so `/api/state` works.
3. Add `http://localhost:8788/api/auth/google/callback` as an Authorized redirect URI in the Google OAuth client (Part A).

For pure UI work without the backend, `npm run dev` is still the fastest loop — the integration panels just show their connect prompts.

---

## Troubleshooting

- **Access login loop / "That account does not have access"** — the Google account isn't in the Access policy's email list (Part C step 3), or you signed into the wrong Google account.
- **`redirect_uri_mismatch` at Google** — for the *calendar* connect: the Part A redirect URI doesn't exactly match `https://<origin>/api/auth/google/callback`. For the *Access login*: the `cloudflareaccess.com` callback URI is missing from the client.
- **Calendar consent refused ("app not verified" hard block)** — the signing-in account isn't on the consent screen's **Test users** list (Part A step 3).
- **Sign-in returns `?gcal=error&reason=state`** — the OAuth state failed verification (expired >10 min, `OAUTH_STATE_SECRET` changed mid-flow, or the callback was completed by a different account than started it). Connect again.
- **"Your session expired — reload the page"** — the Access session lapsed mid-use; a reload re-runs the SSO (usually silent).
- **Functions 500 / `server_not_configured`** — a required variable isn't set on the serving environment: `CF_ACCESS_TEAM_DOMAIN`/`CF_ACCESS_AUD` for any guarded endpoint, or `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`OAUTH_STATE_SECRET` for the Google flow specifically.
- **Functions 401 / `unauthorized` on every call in production** — the Worker can't verify the Access JWT: check `CF_ACCESS_AUD` matches the application's AUD tag and the team domain is exact.
- **Connected, then later needs reconnecting** — the Google refresh token was revoked or expired (testing-mode 7-day idle limit). Reconnect; consider publishing the consent screen for stability.
- **`storage_unavailable` (503) / `todoist_unreachable` · `google_unreachable` (502)** — transient: KV/D1 or the upstream API was momentarily unreachable. Retry; if it persists, check the Cloudflare status page and the bindings.
