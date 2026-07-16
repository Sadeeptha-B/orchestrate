# Orchestrate's data persistence — a walkthrough

This is the conceptual tour of **where Orchestrate's data lives and how the copies stay consistent**. The app has grown several storage layers — the browser's `localStorage` working store, a cloud mirror in Cloudflare D1 (with *separate* local-dev and production databases), and two independent caches for the external services (Todoist, Google Calendar). Each was added for a specific reason, and they interact in ways worth understanding before you touch any of them.

It's written to be read top-to-bottom: each layer introduces the concepts it needs (offline-first, slices, schema stamping, logical clocks, last-write-wins, stale-while-revalidate, read-your-writes) right where they first matter. For the *server/auth* side of the backend — Cloudflare Access, the KV credential vault, the OAuth flows — see the companion [backend.md](./backend.md); this doc assumes that identity model and focuses on data.

---

## 1. The shape of the problem

Orchestrate is a **static single-page app** with no traditional application server. That shaped one foundational decision: **the browser's `localStorage` is the working store.** Your plan, habits, settings, and history live in the browser, are read synchronously on startup, and are written on every change. The app works fully offline, and there is no network round-trip in the hot path of using it.

That's great for latency and simplicity, but `localStorage` has two limits that everything below exists to address:

- **It's per-origin and per-device.** `orchestrate.pages.dev` and `localhost:8788` are different origins with different `localStorage`; your laptop and your phone are different devices. When two such installations point at the *same* Todoist/Google account but hold *separate* app-state, neither knows what the other has already created — so each re-provisions, which is the bug that once had two installations making their own duplicate "Orchestrate" calendar. Two distinct mechanisms address this, and keeping them separate in your head is the key to the whole design: the **D1 sync sidecar** (§3) converges installations that *share a database* — all your real devices on production — while **idempotent provisioning** (§5.6) keeps the auto-provisioned *containers* (the Orchestrate calendar, the "Habits" project) duplicate-free even across installations that don't share one. That second guard has real limits — individual habit *tasks* fall outside it — which §5.6 is careful to spell out.
- **It can't hold external data efficiently or securely.** Your Todoist tasks live in Todoist; your calendar in Google. The app needs fast local access to them without hammering those APIs, and their credentials must never sit in the browser. → solved by the **two integration caches** (§6), backed by the server-side credential vault.

So the full cast of storage:

| Layer | Holds | Lifetime | Where |
|---|---|---|---|
| **`localStorage` working store** | the four app-data slices + prefs + bookkeeping | durable, offline-first | browser (per origin/device) |
| **D1 sync sidecar** | a cloud mirror of the four slices, per user | durable, cross-device | Cloudflare (prod) / `.wrangler/state` (dev) |
| **Workers KV** | integration credentials (refresh/personal tokens) | durable | Cloudflare (server-only) — see [backend.md §4](./backend.md) |
| **Todoist cache** | tasks/projects/sections snapshot | ephemeral (revalidated) | browser `localStorage` |
| **Google Calendar token caches** | short-lived access tokens | ≤1 hr | browser memory + KV |

The rest of this doc walks each one and, crucially, **how they stay consistent** (§5).

---

## 2. The working store: `localStorage`

### 2.1 Four slices

The reducer in [`DayPlanContext.tsx`](../../src/context/DayPlanContext.tsx) manages the app's state as four independent **slices**, each persisted under its own key by its own `useEffect`:

| Slice | Key | Contents |
|---|---|---|
| `plan` | `orchestrate-day-plan` | Today's `DayPlan` — intentions, linked tasks, the day's sessions, assignments, today's habit instances, wizard step, check-ins. Resets daily. |
| `settings` | `orchestrate-settings` | `AppSettings` — preferences, calendar config, onboarding flag. Durable. |
| `history` | `orchestrate-history` | `SavedDayPlan[]` — past sessions the user chose to save. Durable. |
| `life` | `orchestrate-life-context` | `LifeContext` — seasons, habits, backlog, rest cues, session templates, the durable engagement archive. Durable. |

"Slice" is the unit of everything downstream: the sync sidecar mirrors one D1 row per slice, and the conflict model is whole-slice. They're independent — a change to `settings` never touches `plan`'s row.

### 2.2 Schema stamping and forward migration

Persisted data outlives the code that wrote it, so each slice (except `history`, which is a bare array whose *entries* each carry their own stamp) is written wrapped with a `_schemaVersion` marker:

```ts
localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state.plan, _schemaVersion: SCHEMA_VERSION }));
```

The versioning policy — a **supported floor**, not exact match — lives in [`schema.ts`](../../src/lib/schema.ts):

- `SCHEMA_VERSION` (currently **7.7**) is stamped on write.
- `MIN_SUPPORTED_SCHEMA` (currently **7.1**) is the oldest version still understood.
- On load, an artifact stamped in `[7.1, 7.7]` is **accepted and migrated forward** to the current shape at the `migrateToCurrent` seam (a single-step chain — e.g. 7.1→7.4 folded the old breadcrumb scalars into `contextTrail`; 7.5→7.6 remapped `wizardStep` after the wizard reorder). Anything **below the floor**, or unstamped, is **rejected** — the slice becomes fresh defaults, out-of-range `history` entries are dropped, and backup imports are refused.

This is a single-user-scale posture: non-additive changes are fine (bump `SCHEMA_VERSION`, add one forward step); the floor is raised and dead steps deleted when carrying an old version forward gets expensive. `isSupportedSchemaVersion` is the shared numeric gate used by both the loaders and the import path. Full rules: [data-model.md §4](../data-model.md).

The schema version does double duty as a **cross-device safety gate** in the sync merge (§3.3) — a client can never adopt or overwrite a slice stamped newer than it understands.

### 2.3 Loading and daily rollover

`loadInitialState()` runs once, synchronously, before first render: it loads all four slices, migrates each, and handles **day rollover**. `loadPlan()` returns the persisted plan without a date gate; if its date is stale, `loadInitialState` runs `harvestStalePlan(plan)` to move unfinished intentions into `life.backlog` (reason `rollover`) and starts a fresh plan. Rollover deliberately does **not** touch Todoist (yesterday's tasks stay visibly overdue) and does **not** auto-save to `history` (the backlog preserves the meaningful part). When rollover happens, the affected slices are marked so the sync layer propagates them (§3.4).

### 2.4 The full `localStorage` catalog

Not everything in `localStorage` is a synced slice. The complete inventory:

| Key | Role | Synced to cloud? | In a backup? |
|---|---|---|---|
| `orchestrate-day-plan` | `plan` slice | ✅ | ✅ (as `currentDay`) |
| `orchestrate-settings` | `settings` slice | ✅ | ✅ |
| `orchestrate-history` | `history` slice | ✅ | ✅ |
| `orchestrate-life-context` | `life` slice | ✅ | ✅ |
| `orchestrate-sync-meta` | per-slice logical clock (§3.2) | — (device-local) | ❌ |
| `orchestrate-sync-reset-pending` | deliberate-clear markers (§3.5) | — (device-local) | ❌ |
| `orchestrate-user` | Access identity this browser last synced as (§5.4) | — (device-local) | ❌ |
| `orchestrate-todoist-cache` | Todoist snapshot (§6.1) | ❌ (rebuilt from API) | ❌ |
| `orchestrate-theme` | light/dark | ❌ | ❌ |
| `orchestrate-active-playlist` / `orchestrate-custom-playlist-urls` | music prefs | ❌ | ❌ |
| `orchestrate-focus-pomodoro` / `orchestrate-focus-ramp-min` | Focus Mode toggles | ❌ | ❌ |
| `orchestrate-chunk-reload-at` (`sessionStorage`) | stale-chunk reload guard | — | ❌ |

The distinction that matters: **the four slices are the durable app data; everything else is either device-local bookkeeping, a rebuildable cache, or a per-device preference.** Only the slices sync and back up.

---

## 3. The cloud mirror: the D1 sync sidecar

### 3.1 Why a mirror, and why D1

To stop origins/devices from diverging, the four slices are mirrored to a **Cloudflare D1** database (D1 is Cloudflare's managed SQLite). `localStorage` remains the offline-first working store; the sidecar is a **push/pull layer on top**, not a replacement — the app never blocks on it.

Why D1 rather than the KV store that holds credentials? Different consistency needs. This is data the user edits and immediately reloads, so it needs **read-your-writes**: change a setting, reload, see the change. KV is *eventually* consistent (a write can take up to ~60s to propagate) — wrong for this. D1 is strongly consistent — right for this. (The credentials in KV have the opposite profile: tiny, rarely written, read on every request — see [backend.md §4](./backend.md).)

The table is one row per user per slice:

```sql
slices(user_id, key, value, schema_version, updated_at)   PRIMARY KEY (user_id, key)
```

`value` is the *exact JSON string* the client persisted to `localStorage`, so the client's existing loaders migrate/validate it on the way back in with no special-casing. `user_id` is the verified Cloudflare Access email (see [backend.md §5](./backend.md)); the endpoints (`GET /api/state`, `PUT /api/state/:key`) are identity-guarded and scoped to the caller's rows. The client half is [`cloudSync.ts`](../../src/lib/cloudSync.ts), gated at startup by `SyncGate`.

### 3.2 The logical clock

The whole conflict model rests on one device-local structure: `orchestrate-sync-meta`, a `{ [slice]: updatedAtMs }` map. It records, per slice, the wall-clock millisecond of the **last change this device knows about** — whether that change was a local mutation (stamped `Date.now()`) or a remote value this device adopted (stamped with the *remote's* timestamp, so it isn't mistaken for a new local edit and re-pushed).

Two honest caveats: it's **wall-clock**, not a Lamport/vector clock, so it's vulnerable to cross-device clock skew (acceptable at single-user scale — you don't edit two devices in the same second); and it's **device-local** (never synced, never backed up) — it's this device's memory of where it stands, not shared truth.

### 3.3 Cold-start pull & merge

`SyncGate` wraps `DayPlanProvider` and blocks first render until `pullAndMerge()` resolves. Because the merge writes winning values *into `localStorage` before the provider's loader runs*, the loader migrates/validates/rolls-over the reconciled state like any persisted data — the sync layer needs no hook inside the reducer. `pullAndMerge` is memoized (StrictMode double-mount → one fetch) and capped at ~2s, so startup is never blocked for long.

`doPullAndMerge` fetches `GET /api/state` (`{ user, slices }`). It resolves **silently to passive** on offline / timeout / any non-OK / non-JSON response (including an expired Access session, which redirects rather than returning JSON) — the session then does no pulling, but genuine local mutations still push. On a successful pull it first runs the **identity-switch guard** (§5.4), then decides each slice by this table:

| Remote state vs local | Decision |
|---|---|
| No remote row, but local data (or a pending reset) exists | Keep local; **bootstrap** it up on first change |
| `remote.schemaVersion > SCHEMA_VERSION` | **Neither adopt nor overwrite** — this build can't parse it (stale-client safety) |
| `remote.schemaVersion` below the floor / unsupported | Ignore remote; local will overwrite it |
| `remote.updatedAt > localMeta` | **Remote wins** — write remote value into `localStorage`, stamp meta with the remote time |
| `localMeta > remote.updatedAt`, and local data exists | **Local wins** — mark to push on first change (self-heals a push that failed last session) |
| `localMeta > remote.updatedAt`, but local slice is *missing* | Adopt remote — a stale meta with no data isn't real local state (guards against a partial clear clobbering a good remote snapshot) |
| Equal timestamps | No-op |

### 3.4 Push

Each of the four persist effects calls `notifyChanged(slice, serialized)` right after its `localStorage.setItem`. This is where the sidecar decides whether a write is worth pushing:

- **Skip-first-fire.** The first time a slice's effect fires this session (on mount, re-persisting unchanged state) is recorded as a *baseline only* — it does **not** push. This is the invariant that stops a device that merely *opened* the app from stamping "now" and clobbering another device's newer edit. The exception: an init-time event (`markInitChange`) — day rollover, a bootstrap of a slice the server lacks, or a "local won the merge" — marks the slice so its first fire *does* push.
- **String-equal no-op.** If the serialized value equals the last one acted on, it's ignored (covers StrictMode's double effect and redundant re-persists).
- A genuine change bumps the meta clock to `Date.now()`, marks the slice **dirty**, and schedules a **debounced push** (~2.5s) via `PUT /api/state/:key` with `{ value, schemaVersion, updatedAt }`.

Dirtiness is durable across failures. `doPush` clears dirty only on `2xx` **or `409`** (409 = the server already holds a newer snapshot; don't retry-loop, the next cold-start merge reconciles). On `401`/`5xx`/network error the slice **stays dirty** and is retried by the lifecycle hooks: `online`, tab-becomes-visible, and the next mutation. On `pagehide`/tab-hidden, `flushPending` fires all dirty slices immediately with `keepalive` so an in-flight edit isn't lost when the tab closes.

### 3.5 Deliberate clears vs. missing data

There's a subtle correctness problem: on the next cold-start merge, how does the client tell "the user intentionally reset this slice" from "this slice just happens to be missing"? If it guessed wrong, an intentional reset could be undone by re-adopting the cloud copy. The `orchestrate-sync-reset-pending` marker disambiguates: an explicit local clear sets it, so the merge treats the (now-empty) slice as *intentionally* local-winning rather than accidentally absent. `markLocalReset('plan')` (the ErrorBoundary "Reset Day & Reload" path) uses this so a crashing plan you reset isn't re-pulled from the cloud on reload.

---

## 4. Local vs. remote D1 — two separate databases

This trips people up, so it's worth stating plainly: **the D1 you develop against and the D1 in production are entirely separate databases that never exchange data.**

| | Local (`--local`) | Production (`--remote`) |
|---|---|---|
| What it is | a SQLite file Miniflare creates under `.wrangler/state/v3/d1/…` | the real `orchestrate-sync` D1 on Cloudflare |
| Used by | `wrangler pages dev` only | the deployed app |
| Identity | `DEV_USER_EMAIL` from `.dev.vars` (Access is bypassed locally) | the verified Access JWT email |
| Starts | **empty** — you apply `db/schema.sql` to it once | holds your real synced data |

Consequences to internalize:

- The **first time** you run `npm run dev:full` after setting this up, local D1 is empty, so the app cold-starts with no cloud data and treats `localStorage` as the source. That's expected, not data loss — your production data is untouched.
- Running the migration against `--remote` does nothing to `--local`, and vice-versa. Apply schema/migrations to whichever you mean, explicitly.
- Switching `DEV_USER_EMAIL` to a second address locally gives you a *second* `user_id` in the same local D1 — this is how per-user isolation is tested (§5.4).

**Doesn't a separate local database re-introduce the old duplication bug?** For app-state *convergence*, yes — local dev and production don't share a store, so a local-dev instance won't learn what production already provisioned. But convergence was never what protected your real Todoist/Google accounts from duplicates; **idempotent provisioning** (§5.6) is, and it holds no matter how many separate stores exist. A local-dev instance connected to your real account *adopts* the existing "Orchestrate" calendar and "Habits" project (by id, name, or durable marker), and since v7.11 the *habit tasks inside* are protected too — a habit adopts the existing task by its description's uuid token (stores seeded from the same backup share habit uuids, so even renamed habits pair exactly) or, failing that, by the `orchestrate-habit` label + same name (§5.6). The residual care: pairs with no shared uuid (hand-recreated habits) renamed in only one store still create fresh tasks, and the markers must have been backfilled by a post-v7.11 pass on the origin store. A UI-only session under `npm run dev` (no Functions at all) or a disposable account still sidesteps the question entirely.

**If you actually want local dev to share production's data**, point `wrangler pages dev` at your *remote* D1/KV bindings instead of the local simulations (the exact flag is wrangler-version-specific — check `wrangler pages dev --help`). Three things to weigh before you do:

- **Access doesn't reach localhost.** Cloudflare Access is edge infrastructure bound to your *hostname*; `localhost:8788` has none. So you still authenticate via `DEV_USER_EMAIL` — and it must be set to your **exact production email**, or you'll read/write a *different* `user_id` partition in the real D1 (a fresh, empty one) and the identity-switch guard (§5.4) will wipe your local slices.
- **No isolation, no safety net.** With remote bindings + a matching email, local dev reads and writes your **real** synced data *and* acts with your **real** Google/Todoist tokens (they're in remote KV). A bug in a work-in-progress branch now edits production — real calendar events, real Todoist tasks. Time Travel can recover D1, but not the external accounts.
- **A safer middle ground** is a *snapshot*, not a live share — dump the remote store and load it into local, exactly as you'd guess. Two granularities exist: a raw **D1 export** (`wrangler d1 export orchestrate-sync --remote --output snap.sql`, then apply to local) copies *all* rows for *all* `user_id`s, so `DEV_USER_EMAIL` must still match a real one to see that data; or an in-app **Full Backup** (§7) exports one user's four slices as JSON. Either way writes stay local and production is untouchable — but the external *references* in the snapshot (calendar id, habit `todoistTaskId`s) still point at the account the data came from, so integrations only behave sanely if you reconnect that same account (see §7).

**Viewing either** — same command, swap the flag (select `length(value)` so you don't dump big JSON blobs):

```bash
npx wrangler d1 execute orchestrate-sync --remote --command "SELECT user_id, key, length(value) AS bytes, updated_at FROM slices"
npx wrangler d1 execute orchestrate-sync --local  --command "SELECT user_id, key, length(value) AS bytes, updated_at FROM slices"
```

Confirm the schema (e.g. that a migration landed): `SELECT sql FROM sqlite_master WHERE name='slices'`. The remote DB also has a **Console** in the Cloudflare dashboard (Workers & Pages → D1 → `orchestrate-sync`); the local file is a plain SQLite database any GUI can open. D1's **Time Travel** covers the remote DB for point-in-time restore (the local file is just a file — back it up by copying if you care).

---

## 5. Consistency & invalidation — how the copies agree

This section pulls the threads together, because "which copy wins, and when" is the part that's easy to get subtly wrong — ending (§5.6) with the one kind of consistency that isn't about the slice copies at all: keeping the shared *external* accounts free of duplicate side-effects.

### 5.1 `localStorage` is authoritative; sync is best-effort

The mental model: **the working store is `localStorage`; the cloud is a convergence layer.** Every read the app does is local and synchronous. The sidecar only ever (a) seeds `localStorage` at cold start from a *newer* remote snapshot, and (b) pushes local changes up. If the network is down, the cloud is unreachable, or the Access session expired, the app is fully functional on local data and simply queues its pushes. Nothing about using the app depends on the sidecar succeeding.

### 5.2 Last-write-wins, and its honest failure mode

Consistency between devices is **whole-slice last-write-wins by wall-clock time** (§3.2–3.3). This is deliberately coarse — there is **no field-level merge**. The failure mode is real and accepted: if you edit the same slice on two devices while offline, the later-stamped write wins the whole slice and the earlier one's changes to that slice are lost on the next merge. For one person across a couple of devices this essentially never bites; a multi-writer design would need CRDTs or per-field merge, which is out of scope ([roadmap §4](../roadmap/persistence_and_backend_migration.md)).

Two structural safeguards keep LWW from doing damage in the *common* cases, both already described: **skip-first-fire** (§3.4) means merely opening a device never claims "newest," and the **reset-pending marker** (§3.5) keeps a deliberate clear from being resurrected.

### 5.3 Schema version as a consistency gate

The `schema_version` on each row is not just for migration — it prevents a **version-skew** hazard. If you deploy a new build to one device and an old build is still running elsewhere, the old build must not adopt data it can't parse, nor overwrite the newer data with a downgrade. The merge enforces exactly that: remote `schemaVersion` above this build's `SCHEMA_VERSION` is left strictly alone (never adopted, never clobbered), and the client always pushes its own `SCHEMA_VERSION`. So a stale client degrades to passive on the ahead-of-it slices instead of corrupting them.

### 5.4 Identity-switch invalidation

`localStorage` is per **browser profile**, but data is per **Access identity**. If you sign out and someone else signs in on the same machine (or you switch `DEV_USER_EMAIL`), the previous user's local slices must not merge into the new user's cloud data. `guardIdentitySwitch` handles this on every pull: `GET /api/state` returns the caller's `user`, compared against the `orchestrate-user` stamp. On a **mismatch** it clears the four slices, the sync meta, the reset-pending markers, and the Todoist cache **before** merging — so the new user's snapshot is adopted clean and the previous user's data (including their onboarding flag, which lives in `settings`) is gone. Device-level prefs (theme, music, Focus toggles) are intentionally left — they're not user data. First sync ever (no prior stamp) just records the identity.

One sharp edge: the guard runs *only on a successful pull*. If a switch happens while offline, the app keeps showing the previous user's local data until the next successful pull corrects it.

### 5.5 Offline and recovery, in one place

- **Reads**: always work (local).
- **Writes**: land in `localStorage` immediately; the cloud push queues as dirty and retries on `online` / visible / next mutation / `pagehide` flush.
- **Cold start offline**: passive session, no merge; local data is used as-is.
- **Expired Access session**: `/api/*` stops returning JSON → pulls go passive, pushes stay dirty, and the UI raises a "reload to sign in again" banner (see [backend.md §5](./backend.md)); a reload re-auths and the queued pushes flush.

### 5.6 Idempotent provisioning — consistency in the external accounts

Everything above is about keeping the app-state *copies* (localStorage ↔ D1) in agreement. There's a second consistency problem that's easy to conflate with it: not creating duplicate **side-effects** in the shared Todoist/Google accounts. These are provisioned lazily — the first time an installation needs them — and the installation doing it might be a fresh device, a *separate* local-dev store, or a restored backup, none of which necessarily share app-state with wherever it first happened. So any safeguard has to be idempotent *at the point of provisioning*. Whether it *can* be depends entirely on **what identity the thing being created is keyed by**, and that splits the side-effects into two classes with very different guarantees.

**Containers — keyed by a well-known name, so idempotent across any store.** There's exactly one Orchestrate calendar and one "Habits" project per account, each with a fixed name, so the provisioning code looks them up in the account before creating:

- **Google Calendar** — `provisionOrchestrateCalendar` ([`GoogleCalendarContext.tsx`](../../src/context/GoogleCalendarContext.tsx)): with no `orchestrateCalendarId` in its own settings, it searches the account for a same-named writable "Orchestrate" calendar and *reuses* it; it creates only when none exists.
- **Todoist** — `ensureHabitsProject` ([`habitsTodoistSync.ts`](../../src/lib/habitsTodoistSync.ts)): reuses a same-named "Habits" project before creating one.

**Contents — keyed by a local id, with durable-marker fallbacks (v7.11).** The individual **habit tasks** inside that project used to be the case that bites: a habit is app-state (`life.habits[]`) with a **local uuid**, and `syncHabitToTodoist` ([`habitsTodoistSync.ts`](../../src/lib/habitsTodoistSync.ts)) dedupes primarily on the `todoistTaskId` stored *on that habit* — a key that lives in the store's own `life` slice and so means nothing to a separate store. v7.11 adds the account-carried half, two markers per task: the **`orchestrate-habit` label** (the *class* marker — "this task is ours"; one shared label) and the **`[orchestrate:habit:<uuid>]` description token** (the *instance* marker — naming the exact habit), both stamped at creation and backfilled by the reconcile pass. A link-less habit **adopts** before ever creating: first the task whose token names its uuid (exact — backups carry habit uuids, so backup-seeded stores share them, and the pairing survives renames and project moves), else a label-carrying, unclaimed, exactly-same-named task in its target project. The ladder is **id → uuid token → marker + name → create**. The residuals: a pair with no shared uuid (hand-recreated habit) renamed in one store won't pair (fresh task — only wrong if it was meant to be the same habit), and other create-task paths (e.g. QuickStart's free-typed lines) remain unguarded.

And this isn't only a manual hazard. `ReconciliationProvider` ([`ReconciliationContext.tsx`](../../src/context/ReconciliationContext.tsx)) runs automatically on every cold start (and on focus), and `findNeedsSyncHabits` flags any active habit whose `todoistTaskId` isn't in the **connected account's** `taskMap`. A dangling id is ambiguous three ways — "deleted upstream on this same account, deliberately" (recreating is wrong), "lost by accident" (recreating is the heal), "different account that never had it" (recreating is a duplicate) — and all three read as `!taskMap.has(id)`. v7.11 splits the remedies: the account case is gated by the fingerprint (next paragraph), and within the same account the automatic pass runs the **benign rungs only** (id re-link, marker adoption — nothing is ever minted); re-*creating* a previously-linked task requires an explicit action on the Habits page — the bulk Re-sync button, or the per-habit recreate on each missing habit's chip — so a deliberate deletion in Todoist stays deleted. Only `never-synced` habits (no id ever) auto-create — that's the feature.

**v7.11 resolves that ambiguity one level up, at the *account* level.** `settings.todoistAccount` records which account the registry was minted against (stamped when absent, from `GET /user` via the proxy); before any write pass — and inside `useSyncHabit`, so manual habit saves are covered too — it's compared against the live account. (The stamp/compare/adopt cycle is one shared hook, [`useAccountFingerprint`](../../src/hooks/useAccountFingerprint.ts), for both integrations; its `fingerprintVerdict` — ok / wait / blocked — is the single gate predicate.) A **match** lets the same-account self-heal run exactly as before; a **mismatch** pauses all habit-task writes (both the reconcile pass and manual saves wait for the identity fetch rather than racing it) and surfaces an "account changed" chip/banner whose only write path is an explicit *adopt this account* action. So pointing a populated store at the wrong account no longer auto-provisions anything — populating a fresh (sandbox) account is still possible, but as a deliberate adoption instead of a silent side-effect. The gate degrades honestly: no stored fingerprint (pre-7.7 data) or an unresolvable identity → the old ungated behavior, once. (`RESET_ALL` is the mirror image: it wipes the local `life` slice, and unless the user opts into the reset modal's habit-task deletion, the Todoist tasks survive as orphans — but they keep the `orchestrate-habit` marker, so re-created same-named habits *adopt* them instead of duplicating; only renamed habits create fresh tasks.)

Why the remaining asymmetry? A container is a singleton — its marker (or well-known name) alone identifies it, no pairing needed. A habit task is one of many: the label can say "this is *ours*" but not "this is habit X's," so pairing needs a per-habit key — the description's uuid token wherever stores share a backup lineage (backups carry habit uuids), the exact name for the rest. The full registry of "which habit → which task" *is* the synced `life` slice; the markers are the account-carried approximation of it for stores that lack it.

So the guarantee, stated honestly:

- **Shared database, same account** (your real devices on production): safe. The habit and its `todoistTaskId` converge, so the next device *updates* the task rather than creating one.
- **Import / restore onto the *same* account** (§7): safe. The backup carries each habit's `todoistTaskId`, which *is* in that account's `taskMap`, so reconciliation re-links instead of re-creating.
- **A separate store creating habits on the *same real* account** (e.g. local dev pointed at your real Todoist): **converges via marker adoption (v7.11).** The fingerprint can't intervene (same account, everything matches), but the habit adopts the existing task — by uuid token when the stores share a backup lineage (rename-proof), else by label + same name — instead of creating a second one. Residuals: the markers must exist (one post-v7.11 reconcile pass on the origin store backfills them), and a pair with no shared uuid renamed in only one store pairs with nothing and creates fresh.
- **A populated store pointed at a *different* account** (import prod data, then connect a different account): **gated since v7.11.** The fingerprint mismatch pauses habit sync and surfaces a banner; re-creation happens only after the user explicitly adopts the connected account (the sandbox-populating flow, now opt-in). Pre-7.7 stores without a fingerprint keep the old behavior — re-creation on first load.

The **containers close their rename gap the same way** (v7.11): the Orchestrate calendar carries a durable `orchestrate:managed-calendar` token in its *description* (stamped at creation, backfilled on rename and on the linked calendar each session), and provisioning walks id → **marker** → same-name → create — the marker outranks a name match, so a renamed Orchestrate calendar wins over a coincidentally "Orchestrate"-named calendar the app never managed. A store with neither the id nor the current name still adopts the renamed calendar — and takes over its live name, since the rename was the user's latest intent. The marker patch is best-effort (it can be denied on a user-created calendar under the narrow `calendar.app.created` scope, where name-only matching remains the last rung).

The principle to carry out of all this: **the sync sidecar converges devices that share a database; account fingerprints (v7.11) gate writes across *accounts*; and durable markers written into the external objects themselves (the `orchestrate-habit` task label + `[orchestrate:habit:<uuid>]` description token, the managed-calendar description token) let same-account stores that never shared a database recognize and adopt each other's provisioned objects.** The resolution ladder everywhere is id → marker adoption → create. What remains outside all three mechanisms: cross-store *renames* between stores with no shared uuid (the name pairing misses), pre-v7.11 objects that haven't been backfilled yet, and non-habit create-paths.

---

## 6. The integration caches

These are a *different kind* of persistence: caches of **external** data (Todoist tasks, Google tokens) that are invalidated on their own schedules, not by the sync clock. They are never backed up and never synced — they're rebuildable from their source of truth.

### 6.1 Todoist — a stale-while-revalidate cache

Todoist is the source of truth for tasks; Orchestrate keeps only IDs plus a `titleSnapshot` fallback, and caches a working copy in `orchestrate-todoist-cache` (`{ tasks, projects, sections, fetchedAt }`). The strategy in [`TodoistContext.tsx`](../../src/context/TodoistContext.tsx) is **stale-while-revalidate** — render the cache instantly, refetch in the background when it's stale:

- **Hydration TTL**: cached data younger than **5 minutes** is used without a fetch (no flash of loading — `loading` only trips when there's *no* cached data).
- **Focus revalidation**: on window focus, tasks *and* projects refetch, deduped by a **30-second** staleness window so a rapid tab-switch loop is cheap.
- **Request dedup**: concurrent calls for the same resource share one in-flight promise.
- **Reconciliation** (once, after the first fetch): title-snapshot sync (update cached titles that changed in Todoist) and stale-task cleanup (a linked task absent from Todoist and not already complete is marked complete — assumed completed externally — *not* unlinked, so session tracking survives).
- **Invalidation on auth/identity**: a 401 sets `authFailed` (token revoked/expired → reconnect banner); a user switch clears the cache (§5.4); `RESET_ALL` clears it explicitly.

All Todoist traffic flows through the same-origin Worker proxy, which injects the server-held token — the cache holds task *data*, never the credential.

### 6.2 Google Calendar — layered short-lived token caches

The calendar has **no persisted event cache** — events are fetched live and rendered — but its *access tokens* are cached at two levels so the app doesn't re-mint on every call (see the flow in [backend.md §7](./backend.md)):

- **In-memory (browser)**: [`GoogleCalendarContext.tsx`](../../src/context/GoogleCalendarContext.tsx) holds the current access token in a ref and reuses it until ~60s before expiry (`EXPIRY_SKEW_MS`), deduping concurrent refreshes. Memory-only — gone on reload, which is fine.
- **KV (server)**: the Worker caches the minted access token (~1hr TTL) so repeated `/token` calls don't hammer Google; the long-lived **refresh token is server-only** and never cached in the browser.
- **The connected hint**: `settings.googleCalendarConnected` is a *cached boolean hint* in the synced `settings` slice — not authoritative. On load the provider calls `/status` and self-corrects it (a device whose server-side token was revoked flips to disconnected). Because it rides the `settings` slice, it *is* synced and backed up — but it's only ever a hint the server confirms.

The asymmetry is deliberate: Todoist's blunt personal token has no short-lived derivative, so its *data* is cached client-side behind a proxy; Google's OAuth gives short-lived access tokens, so only those (useless in an hour) are cached, at the edge of the browser.

---

## 7. Backup, restore, and reset

These operations (in [`DataManagement.tsx`](../../src/components/settings/DataManagement.tsx)) act on the working store, and their effects propagate through sync like any other mutation.

- **Full Backup** exports `{ settings, life, history, currentDay }` (stamped `_schemaVersion` — the only version stamp; built by [`backup.ts`](../../src/lib/backup.ts)) as a JSON download. It is **data + integration references/preferences, never credentials** — no Todoist token, no OAuth tokens, no identity stamp, no caches. Task/calendar *IDs* are included (they re-link automatically for the same account after reconnecting).
- **Import Backup** is **authoritative**: each slice the backup carries *replaces* the local one, and `currentDay` replaces today's plan (re-dated to today). Because that's destructive, a validated backup is always parked and confirmed before dispatching — and the confirm offers a default-on **download of the current data first**, the same escape hatch the reset modal has. The Todoist cache is cleared at commit. After the reducer mutates, the persist effects push the new slices up like any change.
- **Reset Today's Plan** (`RESET_DAY`) replaces only `plan`. **Reset Everything** (`RESET_ALL`) factory-resets all four slices and clears the Todoist cache; it does **not** clear the server-side tokens (disconnect those in Settings → Integrations). Its confirm modal offers two opt-ins: a **Full Backup download first** (default on), and **deleting the habit tasks Orchestrate created in Todoist** (default off; ids snapshotted before the wipe, deleted best-effort after) — otherwise those tasks become orphans, which keep the `orchestrate-habit` marker and are re-adopted by same-named habits later (§5.6). Both resets propagate to the cloud via the normal push path; recovery is D1 Time Travel or the backup file.

Because import/reset flow through the same slice→push machinery, there's nothing special to reconcile — the cloud mirror simply follows the working store. Two consequences are worth making explicit, because backup is doing more work than it looks:

- **Backup is the sanctioned bridge between stores — in practice, between prod and local.** The backend exposes no server-side data API; it stores opaque per-user blobs. So a Full Backup file is the clean way to move a whole dataset across the boundaries this doc has been drawing (prod ↔ local dev, old device → new, one account → another). And because a backup carries the stable *external* IDs (`todoistId` on linked tasks, `todoistTaskId` on habits, `orchestrateCalendarId`, `googleCalendarIds`) but **never credentials**, importing into a store connected to the **same account** *re-links* to those existing objects rather than re-creating them — the import-time equivalent of §5.6's idempotency. Import into a store on a **different** account and those IDs are dangling: the calendar and tasks don't exist there, so the next sync provisions fresh ones (populating a throwaway account, and replacing the imported IDs). This is the crux for a local environment: an import only stays duplicate-free if the connected account matches the data's origin. On a *different* account the imported habit `todoistTaskId`s are absent from that account's `taskMap` — but since v7.11 the backup also carries the origin's **account fingerprints** (in `settings`), so the import confirm warns about the mismatch and the reconcile gate pauses habit sync instead of re-creating (§5.6); populating the other account happens only via explicit adoption. Backups also stamp `_exportedAt` / `_originHost`, which the confirm modal surfaces (e.g. "exported from localhost").
- **Reset propagates.** `RESET_ALL` isn't local-only — it pushes empty slices, so the wipe converges to your other devices on the next pull. Recovery is D1 Time Travel or the backup file, not "just reopen the other device."

---

## 8. Failure modes & sharp edges (quick reference)

- **Two devices edited the same slice offline** → later wall-clock write wins the whole slice; the other's changes to that slice are lost (§5.2). No field merge by design.
- **Stale client after a partial deploy** → it goes passive on any slice stamped newer than it understands, rather than corrupting it (§5.3). Finish rolling out the new build.
- **Old code against a migrated table** → the pre-`user_id` `PUT /api/state` upsert (`ON CONFLICT(key)`) no longer matches the composite key and throws → sync degrades to passive (503). Harmless (localStorage authoritative) but a reason to keep migrate↔deploy tight.
- **Identity switch while offline** → previous user's local data shows until the next successful pull runs the guard (§5.4).
- **Private mode / quota exceeded** → all `localStorage` writes are wrapped in try/catch and fail silently; the app runs from in-memory React state for the session, just without persistence.
- **Local vs remote D1 confusion** → they're separate; the first local dev run looking "empty" is expected (§4).
- **A second store on your *real* integration account** → containers adopted by name/marker, and habit tasks **adopt by uuid token or marker + exact name** (v7.11) instead of duplicating — provided the markers were backfilled by a post-v7.11 pass; only a renamed habit with no shared uuid (hand-recreated, not backup-seeded) still creates a fresh task (§5.6). Stores on *different* accounts are paused by the fingerprint mismatch (explicit adoption required); pre-7.7 unstamped data keeps the old re-create behavior.
- **`localStorage` cleared manually** → the reset-pending marker is gone too, so the next merge treats missing-slice-with-stale-meta as "adopt remote" rather than "push defaults" (§3.3, last row) — you get your cloud data back rather than wiping it.

---

## 9. When to outgrow this — signs you'd need a real backend

The whole architecture — browser as source of truth, server as a credential vault + opaque-blob sync + proxy — is optimal under one condition: **all logic can live in the client, and the server never needs to read, compute over, schedule against, or arbitrate the data.** Be clear-eyed that the trigger to move off it is almost never **cost or scale** (the free tiers are enormous; Access covers 50 users) — it's crossing a **capability** threshold the design structurally can't reach. Any *one* of these flipping from "no" to "yes" warrants a real application server:

1. **The data outgrows the browser, or a query must span data the client can't see.** For a single user whose whole dataset lives in the browser, *querying is not a server concern* — search, aggregation, cross-day analytics, a computed review all run fine client-side over `localStorage`, and D1 storing opaque blobs costs nothing. Server-side query becomes a genuine necessity only when (a) the dataset **outgrows** what the browser can hold/load (you can't query what isn't there), (b) the query must span **other users'** data (a leaderboard, benchmarking) which per-user isolation structurally hides from the client, or (c) it must run with **no client present** — which is really trigger #2. So "the server needs a real schema" is downstream of size or of the other triggers, not an independent reason on its own.
2. **Work must happen with no browser open.** Functions run only in response to a request. Anything unattended — a server-side midnight rollover, reminders/push when the tab is closed, scheduled calendar writes, background Todoist sync, an email digest — needs a scheduler *and* server-owned state to act on. Today rollover only happens when you next open the app; moving it server-side needs both.
3. **Genuine concurrent or collaborative writes.** Whole-slice last-write-wins silently drops one side of a simultaneous edit (§5.2). Fine for one person; the day you want reliable multi-device concurrency or sharing between users, you need field-level merge (CRDTs) or a server that mediates writes transactionally — the server owning mutations, not the client.
4. **Server-enforced authority.** All business logic runs in the browser; the server is a dumb vault. Fine when you can only hurt yourself. Once data is shared between users (one mustn't corrupt another's), or you need validation/invariants/anti-abuse the client can't be trusted with, the server must own the logic.
5. **Real accounts at scale.** Identity is a hand-maintained email allowlist (Access, 50 free) plus a Google test-user list (100). Self-serve public signup needs a real account system, which brings a real backend with it.

Until one of those crosses over, adding an app server would be strictly more cost and complexity for no capability gain — which is exactly why the current design holds the browser as the source of truth and keeps the server opinion-free. The migration path and the alternatives weighed are in [../roadmap/persistence_and_backend_migration.md](../roadmap/persistence_and_backend_migration.md).

---

## See also

- [backup_and_restore.md](./backup_and_restore.md) — the feature-level scenario catalog for backup/import/export/reset across backends and accounts, including the guard mechanisms (account fingerprints, durable markers) and their residuals.
- [backend.md](./backend.md) — the server/auth side: Cloudflare Access identity, the KV credential vault, the OAuth flows, deployment config.
- [../data-model.md](../data-model.md) — entity semantics, reducer actions, the migration chain, and the `localStorage`/D1 shapes as a rules reference (§4 schema, §5 storage, §7 sync).
- [../synthesis.md](../synthesis.md) §6 (state management), §11 (persistence) — where this fits in the app.
- [../deployment.md](../deployment.md) — the step-by-step setup, including the D1 create/migrate commands and `.dev.vars`.
- [../roadmap/persistence_and_backend_migration.md](../roadmap/persistence_and_backend_migration.md) — the design history and the alternatives weighed.
