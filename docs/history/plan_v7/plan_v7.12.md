# Plan — Integration gating, Sign out, Reset Everything defaults

## Context

Orchestrate conflates three separable concerns at its entry layer, producing surprising behavior (documented in [docs/reference/onboarding-and-gating.md](../../source/repos/orchestrate/docs/reference/onboarding-and-gating.md)):

- **Setup completion** (`settings.onboardingComplete`) — sticky, once-per-account.
- **Connection health** (`statusResolved && !isConfigured`) — a live signal enforced today *only* by a single CTA swap on the Welcome hub, so any surface that renders the Dashboard or opens the wizard by another path (existing `plan.setupComplete`, Quick start, deep link) reaches planning/execution with Todoist unconfigured.
- **Session vs. data ownership** — there is no in-app **Sign out**, and Reset Everything's boundaries (what it touches vs. leaves) are implicit.

This change makes the Todoist requirement a **consistent, app-wide connection-health layer**, adds a non-destructive **Sign out**, adds a deliberate **Restart walkthrough** re-entry, and ratifies **Reset Everything**'s boundaries. Outcome: onboarding stays purely "first-run + deliberate restart"; the requirement is enforced uniformly regardless of surface; Sign out and Reset Everything touch **disjoint** resources.

### Locked decisions
- **Onboarding flag**: keep sticky; reset only by Reset Everything (already true). Add explicit "Restart setup walkthrough".
- **Gate banner**: dedicated **persistent top bar**, non-dismissable, shown on every surface while `statusResolved && (!isConfigured || authFailed)`.
- **Dashboard + /focus**: **soft** — viewable behind the banner; Todoist-*writing* controls disabled; engagement/timers (local) stay enabled.
- **Planning entry (/setup, Quick start, Welcome CTA)**: **hard-blocked** when `statusResolved && !isConfigured`.
- **Status timing**: unresolved `/status` reads as "checking", never "allowed" (already the semantics of `statusResolved`).
- **Sign out**: Settings → Data tab; non-destructive to server (D1/KV untouched); clears local slices + Todoist cache; flush pending sync first; redirect to Access logout.
- **Reset Everything**: no functional change — already keeps you signed in, keeps integrations, re-runs onboarding, syncs the wipe, backup-first ON, delete-tasks opt-in OFF. Copy clarification only.

---

## Changes

### 1. Shared gate signal — new `src/hooks/useTodoistGate.ts`
Single source of truth so the banner, the route guard, and disabled controls agree. Reads `useTodoistData()` (`src/hooks/useTodoist.ts`, `src/context/TodoistContext.tsx`):
```
planningBlocked = statusResolved && !isConfigured          // hard-block planning entry
writesBlocked   = statusResolved && (!isConfigured || authFailed)  // banner + disable Todoist writes
```
Return `{ planningBlocked, writesBlocked, isConfigured, authFailed, statusResolved }`.

### 2. Persistent gate banner — new `src/components/ui/TodoistGateBanner.tsx`
- Renders when `writesBlocked`. Two messages: never-connected (`!isConfigured`) → "Connect Todoist to plan your day"; revoked (`authFailed`) → "Todoist disconnected — reconnect to keep syncing". Action → `/settings?tab=integrations` (React Router `Link`/`navigate`).
- Style: full-width top bar, amber/warning, left-aligned text with right padding to clear the fixed top-right `HeaderControls` cluster. Non-dismissable. Use `Button`/`Link` primitives.
- **Mount** as a sibling of `AppRoutes` inside `ReconciliationProvider` in [src/App.tsx](../../source/repos/orchestrate/src/App.tsx) (~L113–116, beside `NotificationBridge`/`AsciiBuddy`) — that node is inside `TodoistProvider`, so it can read the gate and renders across Welcome, Dashboard, and the wizard.
- **Layout note**: routes use `min-h-screen`. Render the banner + `AppRoutes` inside a wrapper so the bar reserves space (in-flow top strip) rather than overlaying the Dashboard header; simplest is a flex-column wrapper with the banner first. Keep the existing `NotificationViewport` (bottom-right toasts) for transient sync *errors* — unchanged.

### 3. Route guard — [src/App.tsx](../../source/repos/orchestrate/src/App.tsx) `AppRoutes`
- Call `useTodoistGate()` in `AppRoutes`.
- **`/setup`**: change guard to also redirect when `planningBlocked`:
  `(plan.setupComplete || fromWelcome) && !planningBlocked ? <Wizard/> : <Navigate to="/" replace/>`.
  Because `AppRoutes` re-renders on Todoist context change, this also auto-redirects if the token drops mid-wizard — **no changes needed inside `WizardLayout`/`Step5Launch`** (the route guard is the gate).
- **`/focus`**: unchanged (soft — stays `plan.setupComplete`-gated).
- **`/`**: unchanged (flag-driven). Welcome's existing CTA/Quick-start gating already covers the hub entry.

### 4. Disable Todoist-writing controls (soft surfaces)
When `writesBlocked`, disable the **completion** controls that write to Todoist (the mutations already no-op via `isConfiguredRef`, so this is UX honesty, not correctness). Leave engagement Start/Stop enabled (local-only). Targeted call sites:
- `src/components/dashboard/SessionTimeline.tsx` `TaskRow` — completion checkbox (`handleToggle` → `completeTask`/`reopenTask`).
- `src/components/dashboard/HabitInstanceCard.tsx` — Complete (`completeTask`, ~L62).
- `src/components/focus/FocusMode.tsx` — completion button (~L903).
- `TodoistPanel` already has `isConfigured`/`onSetup` awareness — verify, no change expected.
Each: `disabled={writesBlocked}` + a `title` explaining why. Reuse `useTodoistGate()`.

### 5. Sign out
- **cloudSync** ([src/lib/cloudSync.ts](../../source/repos/orchestrate/src/lib/cloudSync.ts)):
  - Export `clearLocalStores()` — removes the 4 `SLICE_STORAGE_KEYS` + `META_KEY` + `RESET_PENDING_KEY` + `TODOIST_CACHE_KEY`. Extract from the existing `guardIdentitySwitch` body (L119–123) and have that function call it (dedupe).
  - Export `flushPendingAndWait(): Promise<void>` — awaitable variant of `flushPending()`: `await Promise.all([...dirty].map(s => doPush(s, true)))` (reuse the existing private `doPush`). So Sign out can push real edits up **before** clearing local.
- **Handler** (in DataManagement, see §7): confirm → `await flushPendingAndWait()` (best-effort/try-catch) → `clearLocalStores()` → `setStoredUser('')` ([src/lib/identity.ts](../../source/repos/orchestrate/src/lib/identity.ts)) → `window.location.href = '/cdn-cgi/access/logout'`. The full-page redirect prevents any React re-persist, so **no wipe is pushed** — server D1/KV survive. Device cosmetics (theme/music/buddy) are intentionally left (own-machine convenience).
- **Logout URL**: same-origin `/cdn-cgi/access/logout` — Access serves it on the app origin; the team domain is server-only (`wrangler.toml`) and not client-exposed, so no new endpoint/env needed.

### 6. Restart setup walkthrough
- Handler: `dispatch({ type: 'UPDATE_SETTINGS', settings: { onboardingComplete: false } })` then `navigate('/')` → re-enters `Onboarding` (verified: [src/App.tsx](../../source/repos/orchestrate/src/App.tsx) L70, reducer shallow-merges). Non-destructive; no confirm needed (or a light one).

### 7. Settings → Data tab: new "Account" section — [src/components/settings/DataManagement.tsx](../../source/repos/orchestrate/src/components/settings/DataManagement.tsx)
- Add a new section (after Reset) with **Restart setup walkthrough** and **Sign out** buttons.
- Add `useNavigate` import (component currently lacks it) for both handlers; it already has `dispatch`, `Button`, `ConfirmModal`, `useConfirmModal`.
- **Sign out** uses a `ConfirmModal` ("Sign out? Your data stays synced to your account — you'll sign in again to return."). **Restart walkthrough** can be a direct action or a light confirm.

### 8. Reset Everything — copy only ([src/components/settings/DataManagement.tsx](../../source/repos/orchestrate/src/components/settings/DataManagement.tsx))
No logic change (already correct). Add one clarifying line to the confirm modal body: "You'll be taken through the quick setup again, and stay signed in." Everything else (backup-first ON, delete-tasks OFF, "wipe syncs to your other devices", "Todoist and Google stay connected") stays.

### 9. Docs (same commit)
- [docs/reference/onboarding-and-gating.md](../../source/repos/orchestrate/docs/reference/onboarding-and-gating.md): rewrite §4 (gate now app-wide via the persistent banner + `useTodoistGate`), §5 (route-guard table: `/setup` integration-aware; `/focus` soft), §6 (soft Dashboard/Focus with disabled writes; planning entry hard-blocked), and the §7 flow diagram. Add a short "Restart walkthrough / Sign out / Reset Everything" subsection covering the three account actions and what each touches (session / local / server).
- [docs/reference/backup_and_restore.md](../../source/repos/orchestrate/docs/reference/backup_and_restore.md) §3.5: add **Sign out** as a new non-destructive flow beside the resets (clears local, leaves D1/KV, ends session); make Reset Everything's "keeps session + integrations, re-runs onboarding" boundary explicit. Optionally a catalog row.
- [docs/synthesis.md](../../source/repos/orchestrate/docs/synthesis.md): light touch — the §5.0 pointer already exists; add a one-liner that the Todoist requirement is an app-wide connection-health banner (defers to the reference doc).

---

## Files touched
- **New**: `src/hooks/useTodoistGate.ts`, `src/components/ui/TodoistGateBanner.tsx`.
- **Edit**: `src/App.tsx` (mount banner, `/setup` guard), `src/lib/cloudSync.ts` (`clearLocalStores`, `flushPendingAndWait`), `src/components/settings/DataManagement.tsx` (Account section, Reset copy), `src/components/dashboard/SessionTimeline.tsx`, `src/components/dashboard/HabitInstanceCard.tsx`, `src/components/focus/FocusMode.tsx` (disable completion when `writesBlocked`).
- **Docs**: `docs/reference/onboarding-and-gating.md`, `docs/reference/backup_and_restore.md`, `docs/synthesis.md`.
- **No change needed**: `Welcome.tsx`, `QuickStart.tsx` (already gated), `WizardLayout.tsx`, `Step5Launch.tsx` (covered by the `/setup` route guard), `RESET_ALL` reducer.

## Reuse
- `useTodoistData()` (`isConfigured`/`statusResolved`/`authFailed`) — the canonical signals; do not add new status plumbing.
- `ConfirmModal` + `useConfirmModal` (`src/components/ui/ConfirmModal.tsx`, `src/hooks/useConfirmModal.ts`) — for the Sign-out confirm, matching the Reset pattern.
- `guardIdentitySwitch` (`cloudSync.ts`) — the existing "clear all local state" template `clearLocalStores()` is extracted from.
- `setStoredUser('')` (`identity.ts`) — forget the last-synced identity on sign out.
- `Button`/`Card` primitives; destructive style precedent `variant="ghost" size="sm"` + `text-red-500` (DataManagement Reset buttons).

---

## Verification
1. **Build/lint**: `npm run build` && `npm run lint`.
2. **Gate (UI-only dev is ideal — `npm run dev` runs with integrations disconnected)**:
   - Banner shows on Welcome, Dashboard, and (if reachable) wizard while unconfigured; disappears once Todoist is configured.
   - Deep-link/reload `/setup` (with `setupComplete` true) → redirects to `/`; Welcome CTA shows "Connect Todoist →"; Quick start shows its needs-Todoist panel.
   - Dashboard renders; completion checkboxes/Complete disabled with a title; engagement Start/Stop still work; `/focus` reachable with completion disabled.
3. **Restart walkthrough**: click → `/` renders `Onboarding`; completing it returns to normal.
4. **Reset Everything**: run it → after reset, `/` renders `Onboarding` (settings cleared), still signed in.
5. **Sign out** (needs Functions — `wrangler pages dev` or prod; `/cdn-cgi/access/logout` 404s under plain `npm run dev`): confirm modal → verify local slice keys + Todoist cache removed and `orchestrate-user` cleared before redirect; on prod, redirect lands on the Access login. Verify D1 rows survive (sign back in → data returns via cold-start pull).
6. **Drive it** via the `run` skill (or `npm run dev`) to confirm the banner/gate end-to-end, not just types.
