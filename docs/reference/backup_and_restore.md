# Backup, import & restore — the scenario catalog

This is the feature-level tour of **moving Orchestrate data between installations**: what the backup/import/export/reset flows actually do today, what happens in every realistic combination of backend and integration account, and — marked honestly throughout — **where the current behaviour has gaps**. It exists because the flows themselves are simple, but their *consequences* depend entirely on which store and which external accounts are on each side of the transfer, and that matrix is easy to get wrong from memory.

Read [persistence.md](./persistence.md) first if you don't yet have the storage model (slices, the D1 sync sidecar, idempotent provisioning); this doc leans on it constantly and doesn't re-derive it. [backend.md](./backend.md) covers the identity/credential side. This doc's job is narrower: **the user-facing data-transfer features, scenario by scenario.**

A note on framing: throughout, "duplicate" means a duplicate **side-effect in an external account** (a second recurring habit task in Todoist, a second Orchestrate calendar in Google) — not duplicate rows in Orchestrate's own stores. The app-state side is whole-slice-authoritative everywhere and never merges, so it cannot duplicate *itself*; every hazard in this doc lives at the boundary with Todoist and Google Calendar.

---

## 1. The three axes that decide every scenario

Every scenario below is a point in a three-axis space. Internalize the axes and the catalog becomes predictable:

1. **Which installation (store)?** An installation = one origin + one browser profile: its own `localStorage`, its own view of a D1 database. Production (`*.pages.dev`), full-stack local dev (`wrangler pages dev` → local D1, `DEV_USER_EMAIL` identity), and UI-only dev (`npm run dev` — no Functions, sync passive, integrations disconnected) are all distinct installations.
2. **Which D1 database?** Installations that share a database (all your real devices on prod) **converge** through the sync sidecar — including the external-ID registry that prevents duplicates. Installations on separate databases (prod vs. local dev) never converge; a backup file is the only bridge.
3. **Which external accounts?** The Todoist and Google accounts the installation is *connected to*. This axis — not the database axis — is what decides whether duplicates are possible: external IDs carried in app-state only resolve against the account that minted them.

The one-sentence summary of the whole doc: **backup/import moves app-state faithfully across any of these boundaries; what it cannot move is the guarantee that the external IDs inside that state mean anything on the other side — and the reconciliation layer's response to unresolvable IDs is to create, automatically.**

---

## 2. The flows, precisely

All flows live in [`DataManagement.tsx`](../../src/components/settings/DataManagement.tsx) (Settings → Data) and are shared with the Welcome page's [`RestoreModal`](../../src/components/RestoreModal.tsx) via the [`useDataImport`](../../src/hooks/useDataImport.ts) hook. Validation lives in [`dataImport.ts`](../../src/lib/dataImport.ts); the mutations are reducer actions in [`DayPlanContext.tsx`](../../src/context/DayPlanContext.tsx).

### 2.1 Full Backup (export)

One JSON download: `{ settings, life, history, currentDay?, _backupVersion: 2, _schemaVersion }`. `currentDay` is the live working plan, included only when it has content (intentions exist or setup completed) — so a backup captures "today" even before it's saved to history.

**What's inside, by consequence:**

| Carried | Why it matters downstream |
|---|---|
| All of `settings` | Includes the integration *references*: `habitsTodoistProjectId`, `orchestrateCalendarId`, `orchestrateCalendarName`, `googleCalendarIds`, the `googleCalendarConnected` hint, plus onboarding flag and preferences. |
| All of `life` | Includes every habit's `todoistTaskId` / `todoistProjectId` — **the dedup registry** that decides create-vs-update on sync — plus backlog entries' linked-task `todoistId`s and the engagement archive. |
| `history`, `currentDay` | Saved and live plans, whose linked tasks carry `todoistId`s and whose plan may carry `sessionCalendarEventIds` (events in the origin account's calendar). |

**What's deliberately not inside:** credentials (server-side only), the identity stamp, the sync meta clock, the reset-pending markers, the Todoist cache, and device prefs (theme, music, Focus toggles). A backup is **data + references, never secrets or bookkeeping**.

> **Gap (provenance).** A backup records *nothing about where it came from* — no origin host, no Access identity, no fingerprint of the connected Todoist/Google accounts. The import side therefore cannot warn "this data was minted against a different account/environment than the one you're restoring into," which is the precondition for every duplication scenario in §4. The IDs are in the file; the context that makes them resolvable is not.

### 2.2 Export All Sessions

A bare `SavedDayPlan[]` dump of `history`. No top-level schema stamp — each entry's `plan._schemaVersion` is the per-entry gate. Re-importable through Import Day Plan (§2.4). Carries linked-task `todoistId`s like everything else, but since saved sessions are read-only records, dangling IDs here degrade to `titleSnapshot` fallbacks rather than triggering any write.

### 2.3 Import Full Backup

The pipeline, in order ([`useDataImport.ts`](../../src/hooks/useDataImport.ts) → [`IMPORT_BACKUP`](../../src/context/DayPlanContext.tsx)):

1. **Parse + gate.** JSON parse → must be an object → top-level `_schemaVersion` must sit in `[MIN_SUPPORTED_SCHEMA, SCHEMA_VERSION]` (the same numeric gate the loaders use — see [persistence.md §2.2](./persistence.md)). Below-floor or unstamped backups are refused with an explicit error, never partially applied.
2. **Validate shape.** `validateBackup` checks each carried slice structurally; every `history` entry and `currentDay` is individually schema-gated. One malformed entry rejects the whole file (all-or-nothing).
3. **Confirm if destructive.** If any local data exists (history, seasons, habits, backlog, templates, a started plan, or a set `userName`), the validated backup is parked and a modal confirms: *"This replaces your current … — a restore, not a merge."* A pristine install commits immediately.
4. **Replace.** Each slice **the backup carries** replaces the local one wholesale; absent slices are untouched (a partial backup restores only what it has). `life` is normalized (arrays defaulted, `activeSeasonId` validated against the imported seasons, engagement archive pruned to its rolling window); `history` entries are floor-filtered and migrated; `currentDay` is migrated and **re-dated to today** so it survives the rollover gate and becomes the active plan.
5. **Aftermath — the part that isn't in the modal.** See §3. The import is not done when the reducer returns.

Import semantics are deliberately **authoritative, not merge**: recovery means "make this installation look like the backup." That is the right call and this doc does not question it — the gaps are all in steps the pipeline *doesn't* have, not in the replace semantic.

### 2.4 Import Day Plan

The one merge-flavoured import: accepts a single `SavedDayPlan` or an array (i.e. an Export All Sessions file), validates each entry, and prepends into `history` **deduped by `savedAt`**. Nothing is replaced, nothing external is touched, re-import is idempotent. Benign by construction; it earns no scenario entries below.

### 2.5 Resets

- **Reset Today's Plan** (`RESET_DAY`): replaces `plan` with a fresh one (sessions re-seeded from settings/defaults). Local to the plan slice; propagates through sync like any edit. Todoist untouched.
- **Reset Everything** (`RESET_ALL`): factory-resets all four slices and clears the Todoist cache. Server-side tokens are *not* touched (disconnect lives in Settings → Integrations), and — critically — **the habit tasks in Todoist are not touched either**. The wipe pushes to the cloud and converges to every device sharing the database.

> **Gap (orphan warning).** The `RESET_ALL` confirm modal says Todoist tasks aren't modified, but not the corollary: the uuid→`todoistTaskId` registry just died, so the recurring habit tasks are now **orphans**, and re-creating those habits later mints a *second* set (§4, scenario D1). The docs know this; the UI doesn't say it.
>
> **Gap (propagation asymmetry, minor).** Reset flows and imports rely on the normal push path. That's correct, but note the ErrorBoundary's "Reset Day & Reload" is the only reset that also arms the reset-pending marker (`markLocalReset`) — Settings-initiated resets don't need it (no reload race) but the asymmetry is worth knowing when reasoning about "why did my cleared slice come back."

---

## 3. What happens *after* an import — the aftermath chain

The modal describes the reducer's replace. Two automatic machines then act on the imported state, and both matter more than the replace itself.

**3a. The sync push.** Each persist effect fires with changed content → `notifyChanged` stamps the slice `Date.now()`, marks it dirty, and pushes (~2.5s debounce). The imported state **replaces the cloud copy for this database**, and every other device sharing it adopts the imported state on its next cold-start pull.

> **Gap (restore propagates, silently and unconditionally).** The confirm modal speaks only of "your current data" on *this device*. Restoring a month-old backup on one prod device rolls back **every** prod device — by design (LWW, import stamps "now"), but nothing warns about it, and nothing compares the backup's age against the data it's about to displace. There is no "this backup appears older than what you have" check; the file doesn't even carry an export timestamp outside the filename. Recovery from a mistaken restore is D1 Time Travel or another backup file.

**3b. The reconciliation pass.** `ReconciliationProvider`'s *detection* recomputes immediately from the imported `life` against the current `taskMap`; its *repair* pass runs on the next trigger — window focus (≥5 min since the last pass) or the next app load, the first-hydration trigger having already been consumed this session. The repair auto-creates a Todoist task for every active habit flagged needs-sync, with no confirmation and no distinction between its two reasons (`never-synced` vs `missing-in-todoist`) — see [persistence.md §5.6](./persistence.md) for why the detection *cannot* distinguish "deleted upstream" from "different account." Whether this pass re-links or mass-creates is decided entirely by the account axis, which is what §4 catalogues.

> **Gap (stale cache at the mismatch moment).** Identity switches and `RESET_ALL` clear the Todoist cache; **import does not**. A backup restored within the cache's 5-minute freshness window is reconciled against the *previous* connection's task snapshot (`tasksHydrated` flips true straight from a fresh cache, no fetch). The wrong-account scenarios below are therefore reachable a few minutes *earlier* than the fetch cycle would suggest — the pass acts on a taskMap the imported data was never meant to meet.

The Google side has a softer aftermath: `reconcileCalendarSettings` ([GoogleCalendarContext.tsx](../../src/context/GoogleCalendarContext.tsx)) prunes imported `googleCalendarIds`/`orchestrateCalendarId` that don't exist in the connected account, and the auto-provision effect then adopts-by-name or creates the Orchestrate calendar. So dangling calendar references self-heal to *one* fresh container (duplicate only if the original was renamed — §4, C2); dangling `sessionCalendarEventIds` simply go inert. There is no calendar equivalent of the habit-task mass-creation problem.

---

## 4. The scenario catalog

Verdict key: ✅ behaves well · ⚠️ works with sharp edges · ❌ produces duplicates or silent data displacement.

### A. Same database, same accounts (the sanctioned paths)

**A1 — New device joins prod. ✅ No backup involved.** Sign in, cold-start pull adopts the cloud snapshot, external IDs arrive *with* their registry, reconciliation finds every `todoistTaskId` present and does nothing. This is the design working; backup is not the cross-device mechanism — sync is.

**A2 — Restore a backup onto prod after data loss (same accounts). ✅ The flagship recovery path.** The backup's habit `todoistTaskId`s resolve in the connected account's `taskMap`, so reconciliation **re-links instead of re-creating**; `habitsTodoistProjectId` and `orchestrateCalendarId` resolve likewise. This is the import-time face of idempotent provisioning, and it's the reason backups carry IDs at all.

**A3 — Restore an *old* backup onto a live prod. ⚠️ Works, silently rolls back everything.** Same mechanics as A2, but the aftermath (§3a) pushes the old snapshot over newer cloud state and every other device follows. No age check, no propagation warning (gap in §3a). The user's only signal is the modal's generic "replaces your current data."

### B. Prod ↔ local dev (separate databases)

**B1 — Seed local dev from a prod backup, connected to the same real accounts. ⚠️ The *safe* way to give dev real data — with a discipline requirement.** The import carries the ID registry, so reconciliation re-links against the real account exactly as in A2; nothing is created. The discipline: from then on, **dev must not originate habits** (or otherwise trigger create-paths) against the real account — anything dev creates gets a fresh uuid with no counterpart in prod's registry, and prod's next reconcile can't know about it (separate databases never converge). Writes from dev also hit the real calendar/tasks live — the D1s are isolated; the external accounts are not.

**B2 — Fresh local dev (empty life) on the real accounts, creating habits. ❌ The classic duplication bug, still live.** A habit created in dev has no `todoistTaskId`; first sync falls through to `createTask` → a second recurring task in real Todoist. The containers are protected (adopted by name); the contents are not. Nothing in the UI signals that this installation's registry and the account's contents have never met.

**B3 — Local dev on disposable sandbox accounts. ✅ Fully safe, recommended default.** Different accounts can't touch each other's tasks at all. Dev provisions its own containers and tasks in the sandbox; prod is untouchable. The only cost is maintaining the sandbox accounts and knowing dev's data is fake.

**B4 — Backup travels dev → prod. ⚠️→❌ depending on dev's accounts.** If dev was seeded per B1 (same accounts), the round-trip is A2-safe — but it also *replaces* prod's state with dev's (A3's rollback caveat applies, plus any WIP-schema oddities dev produced). If dev ran on sandbox accounts (B3), the imported registry points at sandbox objects: every habit's `todoistTaskId` is absent from the real account's `taskMap`, and the next repair pass **creates the full habit set in real Todoist** (C1's mechanics). The file gives no hint which of these it is (provenance gap, §2.1).

### C. Different account on either side

**C1 — A populated store meets a different Todoist account. ❌ Mass auto-creation, no user action required.** Whether by importing a backup and connecting a different account, or switching the connected account under existing data: every habit reads as `missing-in-todoist`, and the next repair pass creates a task per habit *and repoints the local registry at the new account* (the old account's tasks are now orphans). Inert if the account is a sandbox being deliberately populated — which is exactly why the behaviour exists — a real incident if it isn't. The system cannot currently tell those intents apart, and asks nobody.

**C2 — Renamed Orchestrate calendar meets a store without the synced ID. ⚠️ One duplicate container.** Name-adoption is the containers' *backstop*; the synced `orchestrateCalendarId` is the primary guard. An installation lacking it (fresh store, backup from before the rename) searches for the *configured name*, misses the renamed calendar, and creates a fresh one. Small blast radius (one calendar, no events lost), self-inflicted only via rename.

### D. Resets

**D1 — `RESET_ALL`, then re-create the same habits. ❌ Duplicates by design gap.** The wipe orphans the account's habit tasks (registry gone, tasks alive); re-created habits mint fresh uuids and fresh tasks beside the orphans. Same-account, single-store, no dev environment needed — the cheapest route to duplicates in the whole catalog. The confirm modal doesn't mention it (§2.5 gap). The wipe also propagates to all devices sharing the database (documented, but worth repeating: "just reopen the other device" is not a recovery path).

**D2 — `RESET_DAY`. ✅ Benign.** Plan slice only; habits, registry, and external accounts untouched.

### E. Day-plan / sessions import

**E1 — Any direction, any accounts. ✅ Benign.** Merge semantics, `savedAt` dedup, no external writes, dangling IDs degrade to snapshots. The contrast with Full Backup is instructive: this flow is safe *because* it neither replaces state nor feeds the reconciliation layer.

---

## 5. The gap register

Consolidated, ordered by severity. "Scenarios" reference §4.

| # | Gap | Severity | Scenarios | Current behaviour |
|---|---|---|---|---|
| G1 | **Reconciliation auto-creates on `missing-in-todoist` with no confirmation** — cannot distinguish "deleted upstream" (self-heal correct) from "different account / foreign registry" (creation is the incident); fires on load/focus; also resurrects tasks the user deliberately deleted in Todoist | **High** | B2, B4, C1, D1 | Fully automatic; only post-hoc signal is the sync chip count |
| G2 | **No provenance or account fingerprint anywhere** — backups don't record origin (host/identity/accounts), and no slice records which external accounts the registry was minted against, so neither import nor reconcile can detect a mismatch before writing | **High** (enabler of G1's worst cases) | B4, C1, and the reason B1 vs B2 is invisible | Import proceeds uniformly; mismatch is discovered only by its side-effects |
| G3 | **No name-based adoption for habit tasks** — contents dedup rests solely on the store-local `todoistTaskId`; a same-named recurring task in the Habits project is never reused, unlike the containers | Medium | B2, D1 (would convert both to convergence) | `syncHabitToTodoist` create-path is unconditional when the ID is absent/unresolved |
| G4 | **Restore's cloud propagation and age are unstated** — no "this rolls back your other devices," no backup-vs-current age comparison, no export timestamp in the payload | Medium | A3, B4 | Confirm modal describes local replacement only |
| G5 | **`RESET_ALL` orphan consequence unstated in UI** | Medium | D1 | Modal says tasks are untouched; omits that re-creation will duplicate them |
| G6 | **Todoist cache not cleared on backup import** — a fresh cache from the previous connection can satisfy `tasksHydrated` and let the repair pass run against a mismatched snapshot | Low | Sharpens C1/B4 timing | Cache cleared on identity switch and `RESET_ALL` only |
| G7 | **Renamed calendar defeats name-adoption in ID-less stores** | Low | C2 | One duplicate container; recoverable by hand |
| G8 | **Backup remains manual-only** — the sole file-level safety net for D1-external mistakes (A3 rollbacks, C1 incidents) depends on the user having recently clicked Export | Low (tracked in [roadmap §5-B](../roadmap/persistence_and_backend_migration.md)) | All recovery paths | No auto-export, no reminder |

Where a future fix would attach, for orientation (decisions deliberately not made here): G1/G3 live in [`habitsTodoistSync.ts`](../../src/lib/habitsTodoistSync.ts) + [`ReconciliationContext.tsx`](../../src/context/ReconciliationContext.tsx) (the repair pass and its create-path); G2 spans the export payload ([`DataManagement.tsx`](../../src/components/settings/DataManagement.tsx)), the import pipeline ([`useDataImport.ts`](../../src/hooks/useDataImport.ts)), and wherever an account fingerprint would be stamped at connect time; G4–G6 are contained in the import/reset flows themselves.

---

## See also

- [persistence.md](./persistence.md) — the storage model this doc stands on: slices, the sync sidecar's merge, local-vs-remote D1 (§4), idempotent provisioning and its limits (§5.6), backup/restore mechanics (§7).
- [backend.md](./backend.md) — identity, the credential vault, and why tokens are never in a backup.
- [../data-model.md](../data-model.md) — entity semantics and the schema/migration rules the import gate enforces.
- [../roadmap/persistence_and_backend_migration.md](../roadmap/persistence_and_backend_migration.md) — the decision record behind the sync sidecar; option B (file-sync) is the standing answer to G8.
