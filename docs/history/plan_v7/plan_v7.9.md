# Plan v7.9 — D1 sync sidecar + calendar rename refinement

Two threads: (A) a small fix to the Google-calendar rename semantics from v7.8, and (B) the main
work — a **D1 sync sidecar** that mirrors the app's data slices to a Cloudflare D1 database so the
production deployment and local dev (and future devices) share one logical store instead of diverging
into separate localStorage installations.

---

## A. Calendar rename: always rename in place

The v7.8 `renameOrchestrateCalendar` ([`src/context/GoogleCalendarContext.tsx`](../../../src/context/GoogleCalendarContext.tsx))
preferred *relinking* to an existing same-named writable calendar over renaming the linked one. That's
the wrong call for a rename: the linked calendar is authoritative, and switching to another one on a
name collision is surprising. Removed the `sameNamed` relink block — a rename now **always** `patchCalendar`s
the linked calendar in place. Same-named *reuse* remains a **creation-time** behavior only
(`provisionOrchestrateCalendar`, unchanged).

---

## B. D1 sync sidecar

### Problem

localStorage is per-origin, so `orchestrate.pages.dev` and `localhost` were two independent installations
pointing at the same Google/Todoist account. Each provisioned its own Orchestrate calendar and its own
Todoist habit tasks — duplicated data. Root fix: one shared server-side store keyed by the existing app
secret. Chosen shape: a **sync-only layer** ([roadmap option E](../../roadmap/persistence_and_backend_migration.md))
over **Cloudflare D1** — strong consistency (read-your-writes, unlike KV), maps 1:1 onto the four slices,
stays in the Pages ecosystem (no new credential/host/egress), and leaves a SQL escape hatch for v8 reviews.

### Design

localStorage stays the offline-first **working store**; the sidecar layers push/pull on top. Conflict
model is coarse **whole-slice last-write-wins** by a device-local `updatedAt` (ms) — sufficient for one
user across a couple of devices; no field-level merge.

**Server** ([`functions/api/state/`](../../../functions/api/state/), [`db/schema.sql`](../../../db/schema.sql)):
- One D1 table `slices(key, value, schema_version, updated_at)`; `value` is the exact JSON string the
  client persists. Bound as `SYNC_DB` in [`wrangler.toml`](../../../wrangler.toml).
- `GET /api/state` returns all slices; `PUT /api/state/:key` upserts one with the LWW guard **inside**
  the statement (`ON CONFLICT ... WHERE excluded.updated_at >= slices.updated_at`, race-safe without a
  transaction) — a losing write gets `409` + the current row. Guarded by the shared `X-App-Secret` via
  the existing `requireAppSecret` ([`functions/_shared.ts`](../../../functions/_shared.ts), which gained
  `StateEnv` + `SYNC_SLICE_KEYS`). Error vocab reuses `unauthorized`/`storage_unavailable`, adds
  `unknown_slice`/`invalid_body`/`conflict`.

**Client** ([`src/lib/cloudSync.ts`](../../../src/lib/cloudSync.ts) — the first framework-free sync module;
also the codebase's first debounce):
- **Meta**: per-slice `updatedAt` in a device-local `orchestrate-sync-meta` key (stamp-on-write /
  read discipline like `_schemaVersion`; never in a backup).
- **Pull (cold start)**: `pullAndMerge` (memoized → StrictMode-safe) fetches the snapshot (≤2s cap;
  no-ops offline / no secret / on failure) and, per slice, writes the winner into localStorage so the
  existing loaders migrate/validate/roll it over. Remote newer than this build's `SCHEMA_VERSION` →
  neither adopt nor overwrite (stale-client safety); below `MIN_SUPPORTED_SCHEMA` → ignore, local wins.
- **Push (mutation)**: each persist effect calls `notifyChanged(slice, serialized)` after its
  `localStorage.setItem`. The **first mount fire is skipped** (baseline only) unless an init event
  marked the slice — the skip-first-fire mechanism that stops a device that merely *opened* the app from
  claiming "newest" and clobbering another device. Real changes bump the clock, mark dirty, and
  debounce-push (~2.5 s). Dirty slices retry on `online` / tab-visible and flush on `pagehide` /
  tab-hidden with `keepalive`. `409` clears dirty (next cold-start pull reconciles) rather than looping.

**Gate** ([`src/components/SyncGate.tsx`](../../../src/components/SyncGate.tsx)): wraps `DayPlanProvider`
in [`src/App.tsx`](../../../src/App.tsx) (`ErrorBoundary > SyncGate > DayPlanProvider`); blocks the first
render until `pullAndMerge` resolves so the merge lands before the loader runs.

**DayPlanContext touches** ([`src/context/DayPlanContext.tsx`](../../../src/context/DayPlanContext.tsx)):
one `notifyChanged` line per persist effect; `markInitChange('plan')` (+ `'life'` when it harvested) in
the stale-plan rollover branch of `loadInitialState` so a rolled-over day propagates instead of being
re-harvested on a second device. The reducer is untouched — `RESET_ALL` / `IMPORT_BACKUP` push like any
mutation.

**Edge fixes:**
- [`src/components/ui/ErrorBoundary.tsx`](../../../src/components/ui/ErrorBoundary.tsx) — "Reset Day &
  Reload" now calls `markLocalReset('plan')` so the cleared plan wins the next merge (else the crashing
  plan would be re-adopted from the cloud on reload).
- [`public/sw.js`](../../../public/sw.js) — the service worker now **excludes `/api/`** from its
  network-first cache (dynamic, secret-guarded, `no-store`) and bumps `CACHE_NAME` to `v4` to purge any
  previously-cached API responses.

### Recovery & scope

The cloud mirrors the working store, so a reset propagates; recovery paths are D1 Time Travel (7 days on
the free tier) and the manual Full Backup file. Not synced: the Todoist cache, the shared secret
(per-device by design), theme/music prefs, and `orchestrate-sync-meta`.

### Not a schema bump

Purely additive — no persisted-shape change to the slices, so `SCHEMA_VERSION` stays `7.6`. The
`schema_version` column just records the stamp a slice was pushed at.

### Deployment

One-time setup: `wrangler d1 create orchestrate-sync`, paste the id into `wrangler.toml`, apply
`db/schema.sql` to `--remote` and `--local`. The git-integration deploy picks up the binding like the
existing `OAUTH_KV`. See [deployment.md](../../deployment.md) Part B step 1b. **Open the authoritative
device first** to seed D1; other origins then adopt.
