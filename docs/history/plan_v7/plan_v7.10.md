# Plan v7.10 — Multi-user auth (Cloudflare Access) + holistic onboarding

Two sequenced phases: (A) replace the single shared-secret auth model with **Cloudflare Access**
identity and namespace all server-side state per user, so a handful of pre-approved Google accounts
can use the public deployment independently; (B) build the **first-run onboarding journey** on top —
the app's requirements (Todoist required, Google Calendar encouraged) surfaced at the welcome level
instead of buried in Settings.

---

## Problem

The deployment was publicly reachable but strictly single-tenant: one `X-App-Secret` guarded every
Pages Function, KV credential keys were global (`google:refresh_token`, `todoist:token`), and the D1
`slices` table had no `user_id`. Sharing the secret with a second person would have **overwritten the
owner's integration tokens and merged/leaked entire app state** through the sync sidecar (the reference
doc's §13 called this out as a redesign trigger, not a patchable gap). Separately, setup was fragmented:
two duplicate app-secret inputs in Settings, a non-persistent wizard banner offering only Todoist, and
scattered "Connect X" prompts — nothing at the welcome level said what the app needs to function.

Decisions (confirmed): one plan, two phases; Todoist **hard-gates** planning; Google Calendar is
**encouraged, skippable**; Access uses **Google SSO reusing the same Google OAuth client** as the
calendar integration (one Google Cloud project; the Access policy and the Google test-user list remain
two distinct allowlists by nature).

---

## A. Identity: Cloudflare Access + per-user backend

**Edge (dashboard, no code — [deployment.md](../../deployment.md) Parts A/C):** a Zero Trust team,
Google as IdP (same OAuth client, extra `cloudflareaccess.com` redirect URI), and a self-hosted Access
application over the production hostname with an `Allow → Emails` policy. Unauthenticated visitors get
a Google sign-in page before even the static bundle; the policy's email list *is* user management.
(The Pages "Access policy" toggle covers previews only — the production domain needs the explicit app.)

**Guard** ([`functions/_shared.ts`](../../../functions/_shared.ts)): `requireAppSecret` →
**`requireUser`**, which verifies the `Cf-Access-Jwt-Assertion` JWT via `jose` (`createRemoteJWKSet`
against `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`, cached per isolate; issuer +
`CF_ACCESS_AUD` checked) and returns the lowercased `email` claim or a ready-made 401/500 `Response`.
Env: `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`; `.dev.vars`-only `DEV_USER_EMAIL` bypasses verification
locally (`wrangler pages dev` has no Access in front) and doubles as the two-user isolation test lever.
New [`/api/me`](../../../functions/api/me.ts) returns the verified identity. `jose` is the one new
dependency.

**KV per user** ([`functions/api/auth/google/_lib.ts`](../../../functions/api/auth/google/_lib.ts),
todoist endpoints): all keys became `user:<email>:…` via `userKey()`; `storeConnection` /
`getAccessToken` / `isConnected` / `clearConnection` and the Todoist proxy/token trio take the email.
One-time cost: the owner reconnects both integrations (reconnect, not data loss).

**D1 per user** ([`db/schema.sql`](../../../db/schema.sql), [`functions/api/state/`](../../../functions/api/state/)):
`slices` gained `user_id` with PK `(user_id, key)` (non-additive per the schema posture; one-shot
rebuild+backfill in [`db/migrate_add_user_id.sql`](../../../db/migrate_add_user_id.sql)). Endpoints
scope to the caller's rows; `GET /api/state` now returns `{ user, slices }` — the identity rides the
pull instead of costing a separate `/api/me` round-trip.

**OAuth state, identity-bound** ([`login.ts`](../../../functions/api/auth/google/login.ts),
[`callback.ts`](../../../functions/api/auth/google/callback.ts)): the old `<ts>.<nonce>.<sig>` HMAC
state became `base64url(JSON{t,n,e,r}).sig` signed with the renamed server-only `OAUTH_STATE_SECRET` —
it now carries the initiating **email** (the callback, itself behind Access since the browser's cookie
rides Google's redirect, verifies `state.email === JWT email`, killing cross-user code injection; the
callback is no longer the one unauthenticated endpoint) and an allowlisted **return target**
(`settings` | `home`) so Phase B's onboarding gets the redirect back to `/`.

**Client** — the secret plumbing is gone (`appSecret.ts`, `useAppSecret`, both Settings secret inputs,
every `X-App-Secret` header); same-origin fetches carry the Access cookie natively. New
[`src/lib/identity.ts`](../../../src/lib/identity.ts):
- `orchestrate-user` localStorage stamp + **identity-switch guard** in
  [`cloudSync.ts`](../../../src/lib/cloudSync.ts): localStorage is per browser *profile*, not per
  identity, so if `GET /api/state` returns a different user than the stamp, all local app slices +
  sync meta + Todoist cache are cleared **before** the merge — accounts sharing a machine can't
  cross-pollinate.
- `SessionExpiredError` + a redirect-aware `apiFetch` (`redirect: 'manual'` — our API never redirects
  fetches, so an opaque-redirect response *is* the expired-Access-session signal). Both providers map
  it to a persistent "Your session expired — reload the page to sign in again" error (the reload
  re-runs SSO, usually silently). The service worker additionally refuses to cache **redirected**
  responses so the Access login page can never be cached as the app shell
  ([`public/sw.js`](../../../public/sw.js)).
- Dashboard greeting falls back to the identity's email local-part when `settings.userName` is unset.

`GoogleCalendarContext` lost `isConfigured`/`setAppSecret` (configuration is implicit behind Access);
`TodoistContext` gained **`statusResolved`** so gates render neutrally instead of flashing
"not connected" while `/status` is in flight.

---

## B. Onboarding: the requirements, surfaced where the user starts

**First-run flow** ([`src/components/onboarding/Onboarding.tsx`](../../../src/components/onboarding/Onboarding.tsx)),
rendered at `/` until the new additive `settings.onboardingComplete` — synced via D1, so it runs once
per **account**, not per device; the owner clicks straight through since steps auto-reflect existing
connections. Three steps: **what Orchestrate is** (reuses `AboutContent`, states Todoist-required /
Calendar-recommended plainly) → **connect Todoist** (required; Continue disabled until configured) →
**connect Google Calendar** (benefits copy, primary Connect with `return=home`, quiet "Skip for now").

**Welcome hard gate** ([`Welcome.tsx`](../../../src/components/Welcome.tsx)): the Today card carries an
**integration status strip** (Todoist / Calendar chips: ✓ or "Connect →"), and when Todoist resolves
unconfigured the primary CTA becomes **Connect Todoist →** — planning can't start without the task
source of truth. Life/Seasons/Habits/Guide stay reachable.

**Wizard nudge moved to where it pays off**: Step 2's non-persistent integrations banner (+ its
Todoist-only modal) is gone — Todoist is guaranteed by the gate. Step 1 (Sessions) gained a slim
dismissible **calendar nudge** ("connect to see your meetings here while you shape sessions"),
dismissal persisted to the new additive `settings.calendarNudgeDismissed`.

**Reusable connect pieces** (shared by Settings + onboarding):
[`TodoistConnectCard`](../../../src/components/todoist/TodoistConnectCard.tsx) and
[`GoogleConnectCard`](../../../src/components/settings/GoogleConnectCard.tsx) extracted from the two
Settings panels (which now compose them around their settings-only config), plus
[`useGcalCallback`](../../../src/hooks/useGcalCallback.ts) — the `?gcal=connected|error` handling
extracted from `GoogleCalendarSetup`, so the OAuth return is processed wherever it lands (it also
captures the error before stripping the params, fixing the old flash-and-vanish error banner).

Copy: the guide's §2 became "Getting set up & where your data lives" (login model, the two
integrations' roles, per-account cloud sync; fixed the stale "encrypted Todoist token" row); the About
modal footer states the required/recommended split.

---

## Trade-offs & notes

- Two allowlists persist by nature: the Access policy (who enters the app) and the Google test-user
  list (whose calendar the app may touch; Testing mode, cap 100) — one Google client serves bhttps://console.cloud.google.com/auth/clients/43995330160-uo7vsdnbbi4odgoj7ie4blu9p6b9a3tc.apps.googleusercontent.com?project=orchestrate-498617oth.
- The owner pays a one-time reconnect of both integrations and one click-through of onboarding.
- Preview deployments stay unconfigured/ungated by design; KV eventual consistency, whole-slice LWW,
  and the free-tier cost posture are unchanged (Zero Trust free plan: 50 seats).
- Old global KV keys are left to rot (or deleted by hand); the D1 migration is the only stateful step.

## Verification

`npm run build` + `npm run lint` + `npx tsc --noEmit -p functions/tsconfig.json` clean. Manual pass
under `wrangler pages dev` with `DEV_USER_EMAIL`: fresh-profile onboarding (Todoist step blocks until a
token validates; calendar connect round-trips back to onboarding via `return=home`; skip works),
Welcome gate + status chips, Step 1 nudge persistence, and two-user isolation (switch `DEV_USER_EMAIL`
→ local slices reset via the identity stamp, distinct `user_id` rows in D1, distinct KV keys).
Production checks: Access login on the bare domain, non-allowlisted refusal, per-account data/calendar
isolation, session-revocation banner.
