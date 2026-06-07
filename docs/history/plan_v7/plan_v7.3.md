# Drop backward-compat: support schema 7.1 onward + document backup/integration scope

## Context

Orchestrate has accreted a deep migration chain (v1 → v7.1) plus deprecated fields kept only so
old persisted data and old backups still parse. The author is the **sole user** and is willing to
re-export fresh **7.1** artifacts (one session + one full backup) once this lands, so none of that
backward-compat surface needs to be carried forward.

Goal: **delete the migration/legacy surface**, and make the app **support 7.1 only** — on load and on
import, anything that isn't 7.1 is rejected (hard guard) rather than migrated. We keep a single
`_schemaVersion` stamp on persisted artifacts as a forward-looking anchor (drop the now-dead
`_wizardSteps`). Plus: write a precise explanation of **what a Full Backup carries for the Todoist and
Google Calendar integrations** into the docs.

Decisions (confirmed with user):
- **Old-data posture: hard guard / reject.** Loading localStorage with `_schemaVersion !== 7.1` → treat
  as absent (fresh start). Importing a backup/session that isn't 7.1 → refuse with an error.
- **Version marker: keep `_schemaVersion` only.** Drop `_wizardSteps`.

This is safe against the user's *current* data: the live code already persists every slice in 7.1 shape
with `_schemaVersion: 7.1`, so a direct parse loads it unchanged.

---

## Part A — Backup scope & integrations (deliverable: the explanation, also added to docs)

A **Full Backup** (`Settings → Data → Full Backup`) is the JSON `{ settings, life, history, _backupVersion }`
built in [DataManagement.tsx](src/components/settings/DataManagement.tsx#L66-L75) from the three reducer
slices. It is **data + integration references/preferences, never credentials.**

**Todoist**
- **NOT in the backup:** the personal API token — it lives **server-side in Workers KV** (`todoist:token`),
  injected by the `/api/todoist/*` proxy; the browser never holds it. (Legacy `todoistToken/IV/Key`
  settings fields are being removed in this change — they were already unused.)
- **In the backup:** `settings.habitsTodoistProjectId` (which Todoist project habits sync into); and every
  **Todoist task reference** embedded in data — `LinkedTask.todoistId` + `titleSnapshot` inside
  `history[].plan`, and `todoistTaskId` on habits (`life.habits[]`) and habit instances. These are IDs/labels,
  not auth.
- **After restoring on a fresh device/deployment:** re-enter the **app secret** and **reconnect Todoist**
  (paste token) in Settings → Integrations. The imported task IDs re-link automatically once the token is
  reconnected (assuming the same Todoist account).

**Google Calendar**
- **NOT in the backup:** the OAuth refresh token (Workers KV `google:refresh_token`) and access tokens
  (KV cache / in-memory) — all server-side.
- **In the backup:** `settings.googleCalendarConnected` (boolean flag), `settings.googleCalendarIds`
  (the selected `GoogleCalendarEntry[]` to overlay), `settings.calendarViewMode`.
- **Caveat to document:** `googleCalendarConnected: true` is imported as-is, but on load
  `GoogleCalendarProvider` re-checks `/api/auth/google/status`, so a device whose KV has no token
  self-corrects to disconnected. After restore, **re-authorize Google** if the status shows disconnected.

**Shared secret** (`orchestrate-cf-secret`, localStorage) is **NOT** in any backup — it's installation-specific
and must be re-entered per device.

**Not in the full backup by design:** today's `plan` (only saved sessions in `history`), the
`orchestrate-todoist-cache`, theme/music/pomodoro prefs. Sessions export/per-session export contain only
`SavedDayPlan` objects (plan + label + savedAt).

---

## Part B — Code changes (remove backward-compat, add 7.1 guard)

### 1. [src/context/DayPlanContext.tsx](src/context/DayPlanContext.tsx) — the bulk of the work
- Keep `SCHEMA_VERSION = 7.1`; **export** it (so DataManagement can import it). **Remove** `WIZARD_STEPS_COUNT`.
- **Delete** `legacyEngagementToSegments` (L87-94), `migratePlan` (L96-290, incl. the inner `migrateStep`),
  `migrateHabit` (L362-385), `seedSessionTemplates` (L405-418).
- **Replace** `peekRawPlan` (L424-433) with a `loadPlan()` that: `JSON.parse`; if
  `_schemaVersion !== SCHEMA_VERSION` → return `null`; else strip the `_schemaVersion` marker and return the
  object as `DayPlan`.
- **Simplify** `migrateTaskCaps` → a plain default-filler (drop the `stabilizer`/`lightCoherent` legacy keys);
  rename `withV6SettingsDefaults` → `withSettingsDefaults` (keep filling `taskCapDefaults` + `sessionBufferMinutes`,
  these are optional-field defaults, not backcompat).
- **`loadSettings`** (L314-333): parse; guard `_schemaVersion === SCHEMA_VERSION` (else return defaults);
  strip marker; `withSettingsDefaults`. **Remove** the `googleCalendarId`/`string[]` migration blocks (L319-328).
- **`loadHistory`** (L335-343): parse, then **filter** to entries whose `plan._schemaVersion === SCHEMA_VERSION`
  (drop foreign/old saved plans).
- **`loadLifeContext`** (L387-403): parse; guard marker (else `emptyLifeContext()`); map habits **directly**
  (no `migrateHabit`); default `backlog`/`sessionTemplates` to `[]`.
- **`loadInitialState`** (L441-474): use `loadPlan()`; `baseLife = loadLifeContext()` (no `seedSessionTemplates`).
- **`SAVE_DAY`** (L931-939): stamp only `_schemaVersion` (drop `_wizardSteps`).
- **`RESTORE_DAY`** (L941-946): use `saved.plan` directly with markers stripped + `date: todayISO()` — **no**
  `migratePlan`. (History is already guarded to 7.1 on load/import.)
- **`IMPORT_BACKUP`** (L1316-1320): append imported habits as-is — **remove** `.map(migrateHabit)`.
- **`RESET_ALL`** (L910-923): keep; update the in-code comment (no "legacy Todoist token fields").
- **Plan persistence effect** (L1420-1425): drop `_wizardSteps`, keep `_schemaVersion`.
- Clean up now-unused type imports (e.g. `HabitKind`, possibly `EngagementSegment`/`HabitInstanceStatus`/
  `SessionTemplate` if no longer referenced) — let `tsc` flag them.

### 2. [src/types/index.ts](src/types/index.ts)
- Remove `Habit.autoLinkTodoistId` (L268-269) and `Habit.maxBlockMinutes` (L270-271).
- Remove `AppSettings.todoistToken` / `todoistTokenIV` / `todoistTokenKey` (L176-181) and their comment block.
- Tidy adjacent legacy comments (optional, low priority).

### 3. [src/components/todoist/TodoistSetup.tsx](src/components/todoist/TodoistSetup.tsx)
- Delete `clearLegacyToken()` (L61-69) and its two call sites (in `handleSaveToken` L94, `handleDisconnect` L104).

### 4. [src/components/life/HabitForm.tsx](src/components/life/HabitForm.tsx)
- Remove the `maxBlockMinutes` fallback in the `targetDurationMinutes` initializer (L54-60) →
  `initial?.targetDurationMinutes !== undefined ? String(initial.targetDurationMinutes) : ''`.

### 5. [src/components/settings/DataManagement.tsx](src/components/settings/DataManagement.tsx)
- `exportFullBackup` (L66-75): add `_schemaVersion: SCHEMA_VERSION` (import from DayPlanContext) to the payload.
- `handleBackupImport` (L107-143): reject when `data._schemaVersion !== SCHEMA_VERSION` with a clear error
  ("Backup is from an unsupported version").
- `validateSessions` (L16-33): require `plan.intentions` to be an array **and** `plan._schemaVersion === SCHEMA_VERSION`;
  drop the v1 `tasks` fallback (L25-28).

---

## Part C — Documentation updates (same commit)

### [docs/synthesis.md](docs/synthesis.md)
- §6.1 — replace the **"Migration chain"** paragraph with a **"Schema guard"** note (7.1 only; load/import
  reject non-7.1; `_schemaVersion` stamp kept, `_wizardSteps` removed). Fix the §6.1 settings bullet that
  says "encrypted Todoist token" (token is server-side; legacy fields removed).
- §7 / §11 — add the **Backup scope & integrations** explanation (Part A). Update the §11 Reset bullet
  (RESET_ALL no longer "clears legacy Todoist token fields").
- §2 Crypto row — already says HMAC is server-side; trim any "encrypted in browser" remnant.

### [docs/data-model.md](docs/data-model.md)
- **§4 Migration Chain** — the big one: replace the entire v1→v7.1 chain with a short **"Schema version &
  compatibility"** section (current 7.1; no in-app migration; hard guard rejects older localStorage →
  fresh start, and older imports → error; `git log`/history for the historical chain).
- **AppSettings** — remove the deprecated-token paragraph; restate token as server-side only. Drop
  "(renamed from `stabilizer`/`lightCoherent`)" from `taskCapDefaults`; drop the `googleCalendarId`
  migration mention.
- **Habit** — remove the `autoLinkTodoistId`/`maxBlockMinutes` and "Historical pre-v6.7 / `migrateHabit`"
  notes.
- **§3.5 RESET_ALL** + **§3.6 IMPORT_BACKUP** — update (no "legacy Todoist token fields"; habits appended
  as-is, not run through `migrateHabit`).
- **§5 localStorage Schema** — fix notes: settings is `AppSettings + _schemaVersion` (no "base64 token
  ciphertext"); plan no longer carries `_wizardSteps`.
- Add a **"Backup scope & integrations"** subsection mirroring Part A.

---

## Verification

1. `npm run build` — TypeScript must pass; this flags every dangling reference to the deleted
   functions/fields and any now-unused imports.
2. `npm run lint`.
3. Manual (`npm run dev`) with existing localStorage:
   - App loads current 7.1 data unchanged (plan, settings, seasons/habits, history all intact).
   - **Full Backup** export → open the file, confirm `_schemaVersion: 7.1` is present.
   - **Import Backup** of that fresh file → accepted (merge-by-id, no errors).
   - **Export/Import Sessions** round-trips.
   - Todoist + Google Calendar panels still connect/disconnect correctly (no `clearLegacyToken`).
4. Guard check: hand-craft a JSON with `_schemaVersion: 6.3` (or omitted) and confirm Import Backup
   **rejects** it with the error message, and a tampered localStorage plan marker → app starts fresh
   rather than crashing.
5. Then the user takes the canonical fresh **session export + full backup** for future dev use.
