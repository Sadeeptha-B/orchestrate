# Orchestrate — Data Model Reference

> For a high-level overview, start at [synthesis.md](./synthesis.md). This document covers semantics, invariants, lifecycle rules, relationships, and the migration chain. **For exact type shapes, read the source**: [`src/types/index.ts`](../src/types/index.ts). Todoist API mirror types live in [`src/hooks/useTodoist.ts`](../src/hooks/useTodoist.ts).

---

## 1. Entity Semantics & Invariants

### Intention

A high-level goal for today. Top-level organizational unit.

- Owns zero or more `LinkedTask` entries (via `intentionId` back-reference; `linkedTaskIds` maintains display order).
- Toggling completion cascades to all linked tasks.
- `brokenDown` tracks whether the user finished mapping tasks in Step 1.

### LinkedTask

A Todoist task surfaced inside the plan, always bound to an intention via `intentionId`.

**Task types:**
- **main** — Primary work thread. Exclusive to one session (assigning removes from any previous session).
- **background** — Small nudge task. Can be assigned to multiple sessions. Cap: `taskCapDefaults.manualBackground` (default 30 min).
- **unclassified** — Default after linking. Must be categorized before advancing past Step 2.

**Engagement model (v6.4 — segment list):** engagement is a list of `EngagementSegment` (`{ startedAt, endedAt? }`) on `LinkedTask.segments` / `TodaysHabitInstance.segments`. Each Start→Stop is **one individual segment** — not a cumulative accumulator. Named "segment" (not "session") to avoid clashing with the first-class work `Session`/`SessionSlot`. Duration is always *derived* (`endedAt − startedAt`, or `now − startedAt` while open); no stored minute/second totals.

Lifecycle:
1. New / restored task: `status = 'pending'`, no segments.
2. Start (`START_TASK_ENGAGEMENT`): `status = 'engaged'`, push a new open segment `{ startedAt: now }` (no-op if one is already open).
3. Stop (`STOP_TASK_ENGAGEMENT`): close the open segment (`endedAt = now`), return `status` to `pending` so the ▶/■ button flips back. A subsequent Start pushes a **fresh** segment — the timer counts from 0:00 again, and each Start/Stop is a distinct log entry.
4. Complete (`TOGGLE_TASK_COMPLETE`): close any open segment, `status = 'completed'`.
5. Moved to backlog while engaged: the `segments` array is copied into `BacklogEntry.unfinishedTaskRecords`.

**Display — [`<EngagementTimer>`](../src/components/dashboard/EngagementTimer.tsx) + [`lib/engagement.ts`](../src/lib/engagement.ts):** the timer renders one segment as `M:SS` (or `H:MM:SS` past an hour), ticking once per second while the segment is open (no `endedAt`). Card rows (`HabitInstanceCard` / `SessionTimeline`) show only the **open** segment while engaged — counting from 0:00, gone when stopped. The engagement-log view renders **one row per segment** (`segmentSeconds`). Glance surfaces that want a rounded total (timeline-lane badge, backlog memo) derive it via `totalEngagedSeconds(segments)`.

**`completed` vs `status`:** `completed` mirrors `status === 'completed'`. Both are written together by the reducer. `completed` is retained for backward compat — many callers (capacity calc, completion counter, session visuals) still read it.

**Title fallback chain:** `taskMap.get(todoistId)?.content` -> `titleSnapshot` -> raw `todoistId`.

### TodaysHabitInstance

A stabilizer habit's manifestation for today. Lives on `DayPlan.todaysHabits`, independent of session assignment. Positioned on the timeline by `targetTime`; untimed instances form an "Anytime today" cluster.

**Status semantics:**
- **planned** — surfaced for today, not yet acted on.
- **engaged** — user pressed Start on the `HabitInstanceCard`.
- **completed** — done. Caller also fires `actions.completeTask(todoistTaskId)` to close Todoist's current occurrence.
- **skipped** — terminal: user explicitly skipped today (✕ button).

(v6.4 removed the old `'unfinished'` status — the v6.3 clone-on-reschedule predecessor. Reschedules are in-place now and segments survive them, so no clone is produced. `migratePlan` coerces any persisted `'unfinished'` instance to `'skipped'`.)

**Reschedule — always in-place (v6.4):** `RESCHEDULE_HABIT_INSTANCE` updates `targetTime` on the existing instance, stamps `rescheduledAt`, and appends a `RescheduleEventEntry` (`{ at, fromTime?, toTime? }`) to `rescheduleHistory`. The instance keeps its `id`, `status`, and `segments` — if it was engaged, the open segment keeps running at the new target time. **Every reschedule is recorded**, whether or not the instance was engaged. The recurring Todoist task is **never** touched. The `rescheduledAt` stamp doubles as a "user-chose-this-time" sentinel that `REFRESH_TODAYS_HABITS` honors.

**In-day surface — [`lib/engagementLog.ts`](../src/lib/engagementLog.ts).** A read-only helper flattens today's activity into a sortable `EngagementLogRow[]` union, ordered by time:
- **engagement rows** — **one per `EngagementSegment`** across all habit instances + tasks (individual, not cumulative — a Start/Stop/Start produces two rows). Each carries the `segment`; the row renders the ticking `<EngagementTimer>` (live while the segment is open).
- **reschedule rows** — one per `rescheduleHistory` entry, rendered as "⤴ {title} · {from} → {to} · Rescheduled" at the clock time it happened.

The dashboard renders this in a dedicated **`EngagementLogCard`** (a self-headed sibling of `HabitInstanceCard` on the right rail — the two are independent surfaces, each hidden when empty; both exported from `HabitInstanceCard.tsx`). It is the in-day record of "what actually happened today", and the read interface a future durable `life.engagementHistory` would feed (see [roadmap/engagement_record_strategy.md](roadmap/engagement_record_strategy.md)) — a flat list of segments harvested across days; the helper signature stays stable so the upgrade swaps the input source, not the consumer. The `HabitInstanceCard` ("Today's Habits") shows no "rescheduled" tag — reschedules live in the log. Closed (non-live) rows are individually deletable from the card via `DELETE_TASK_ENGAGEMENT_SEGMENT` / `DELETE_HABIT_ENGAGEMENT_SEGMENT` / `DELETE_HABIT_RESCHEDULE_ENTRY`.

**Refresh merge (`REFRESH_TODAYS_HABITS`):** Called on Step 1 mount and whenever habits / Todoist cache change. For each habit:
- If no existing instance → append the computed one.
- If existing is `planned` and `rescheduledAt` is unset → update `targetTime`, `durationMinutes`, and `titleSnapshot` from the helper (this is how habit-form edits propagate to today's instance).
- If existing is `planned` and `rescheduledAt` is set → only update `durationMinutes` and `titleSnapshot`; preserve the user's chosen time.
- If existing is in any other status → leave alone.

**Capacity exclusion:** Habits do not consume session capacity. The timeline visualization makes overlap obvious without folding habit duration into capacity arithmetic.

### DayPlan

The central document for a single day. Stored in localStorage and auto-reset daily.

**Key invariants:**
- `linkedTasks` is the flat, denormalized list of intention-bound tasks. Each task's `intentionId` back-references its parent.
- `todaysHabits` is a parallel list for stabilizer habit instances. Independent of `linkedTasks` / `taskSessions`.
- `taskSessions` is a map from session IDs to ordered arrays of Todoist task IDs. **Habits never appear here.**
- `intentions[i].linkedTaskIds` is the ordered list of task IDs belonging to that intention. Kept in sync with `linkedTasks` by the reducer.
- `habitLog` records Light Pool (light-coherent) activity only.

### SessionSlot

A configurable time block. Defaults: early-morning (06:00-08:00), morning (09:00-13:00), afternoon (14:30-18:30), night (20:30-23:00). Defined in `src/data/sessions.ts`.

### AppSettings

Persistent user preferences. Survives daily plan resets.

**Token encryption:** The Todoist token is AES-256-GCM encrypted client-side. `encryptToken()` generates a random key + IV, encrypts, returns all three as base64. Key + IV + ciphertext all live in localStorage — protects against casual inspection, not determined browser-profile access.

**`habitsTodoistProjectId`:** Lazily created on first stabilizer save. Resolved by `ensureHabitsProject(...)`.

### Season

A medium-horizon focus period (4-12 weeks).

**Invariants:**
- Exactly one season can be `active` at a time. Activating one auto-deactivates the previous.
- Deleting a season clears its id from any habit's `seasonIds`.

### Habit

A first-class recurring entity. Discriminated by `kind`:

- **stabilizer** — synced to Todoist as a recurring task. On Step 1 mount, `REFRESH_TODAYS_HABITS` adds today's eligible stabilizers to `plan.todaysHabits`. Rendered in the timeline's habit lane and the dashboard's `HabitInstanceCard`.
- **light-coherent** — micro-gap filler. Surfaces in the Light Pool. Start/Complete writes a `HabitLogEntry`. Never enters the task plan.

**`isAnchor`** is orthogonal to `kind` — a pure importance tag marking a habit as load-bearing (sleep, meditation, gym, shutdown, weekly review). It does **not** alter behavior or block deletion at the reducer level; the only current effect is UI affordances — anchors sort to the front of habit lists and deleting an *active* anchor prompts a confirm dialog (cancellable, but deletion is permitted once confirmed). The protection axis is forward-looking scaffolding for recovery-mode / Minimum Viable Day, where anchors are the non-negotiables preserved when the plan is narrowed.

**Recurrence matching** (`src/lib/habits.ts -> habitMatchesDate`): `daily` = every day, `weekdays` = Mon-Fri, `weekly`/`custom` = only listed `daysOfWeek` (weekly without `daysOfWeek` does not match).

**Light Pool filter** (`getLightPoolHabits`): `active && kind === 'light-coherent' && habitMatchesDate(today) && (seasonIds.length === 0 || seasonIds.includes(activeSeasonId))`.

**Todoist sync** (`src/lib/habitsTodoistSync.ts`): saving a stabilizer calls `ensureHabitsProject(...)` -> `resolveHabitProjectId(...)` -> `syncHabitToTodoist(...)`. Creates or updates the recurring task with `due_string` from `buildDueString(habit)` and `duration` from `targetDurationMinutes`. Project changes trigger a Sync API `item_move`. Sync failures are non-blocking.

**Today's instances** (`computeTodaysHabitInstances`): filters to active stabilizers with `todoistTaskId` whose Todoist task is due today + unchecked; honors season scope; applies `windowBehavior === 'strict'` to drop past-window instances. The reducer is idempotent — any habit already represented in `plan.todaysHabits` is skipped.

**Overdue reconcile** (v6.4 helpers, v6.5 driver — `findOverdueStabilizers` + `reconcileOverdueStabilizers`): Todoist's recurrence engine only advances on completion, so a habit missed yesterday sits at yesterday's due date and never surfaces. Overdue stabilizers whose recurrence + season still match today get their Todoist `due_datetime` (or `due_date`) bumped forward to today; `due_string` is preserved so the rule continues to drive future occurrences. The helper returns an optimistic patch map so `computeTodaysHabitInstances` runs against the bumped state in the same tick. **As of v6.5 this is no longer fired from Step 1** — the central `ReconciliationProvider` runs it (preceded by a needs-sync repair) on first hydration and on window focus; see [synthesis.md](./synthesis.md) "Habit-Task Sync → Central reconciliation". Skip is handled in the UI by also calling Todoist `completeTask` so the recurrence engine advances cleanly without needing the next-day bump — see `SKIP_HABIT_INSTANCE`.

### BacklogEntry

A parked intention stored on `LifeContext.backlog`.

**Two creation paths** (both via `lib/backlog.ts -> buildBacklogEntry`):
- **Manual** (`reason: 'manual'`): user moves an intention to the backlog during planning.
- **Rollover** (`reason: 'rollover'`): `loadInitialState` harvests unfinished intentions on date-change.

**Completed-task partitioning:** `buildBacklogEntry` splits `linkedTaskIds` by completion. Completed IDs are stripped; their `titleSnapshot` goes to `completedTaskTitles` (read-only context). This avoids rebuilding stale completed tasks that Step 2 can't render (absent from the Todoist API).

**Engagement carryover:** When an intention with engaged tasks moves to backlog, each task's `segments` are copied into `unfinishedTaskRecords` (`Record<todoistId, EngagementSegment[]>`). On restore, rebuilt LinkedTasks get `rescheduledFromTodoistId` + `rescheduledAt` stamps; the segments stay on the BacklogEntry as annotation.

### RestCue

Non-task recovery prompts. 8 built-in cues in `src/data/restCues.ts`. User customizations stored in `LifeContext.restCues`. When `undefined`, falls back to built-ins. First add/update/delete auto-seeds from defaults.

Not a Habit — no completion semantics, no logging, no streak. Pure prompt data.

### LifeContext

Persistent state slice holding multi-day entities: `seasons`, `habits`, `activeSeasonId`, `restCues`, `backlog`. Persisted to `orchestrate-life-context` localStorage key.

---

## 2. Entity Relationships

```
Intention  1 --> N  LinkedTask       (via intentionId / linkedTaskIds)
LinkedTask N --> M  SessionSlot      (via taskSessions / assignedSessions; main=1:1, bg=1:N)
LinkedTask       -->  TodoistTask    (via todoistId; TodoistTask is ephemeral API data)
Habit      1 --> N  TodaysHabitInstance per day  (via habitId; N>1 when rescheduled)
TodaysHabitInstance  -->  TodoistTask  (via todoistTaskId; stable recurring task)
Habit      N --> M  Season           (via seasonIds; [] = always-on)
BacklogEntry     -->  Intention      (snapshot, pending-only linkedTaskIds)
DayPlan          -->  SessionSlot[]  (via AppSettings.sessionSlots)
```

`DayPlan.taskSessions` is the source of truth for session assignments. `LinkedTask.assignedSessions` is a derived convenience kept in sync by the reducer.

---

## 3. Reducer Action Catalog

All state mutations flow through the `DayPlanContext` reducer (`src/context/DayPlanContext.tsx`). The `Action` type is a discriminated union of ~57 variants.

### 3.1 Intention Actions

| Action | Payload | Effect |
|---|---|---|
| `ADD_INTENTION` | `title` | Creates a new Intention, appends to list |
| `REMOVE_INTENTION` | `intentionId` | Removes intention + its LinkedTasks + session assignments. Call sites route through `useIntentionRemoval()` to unschedule Todoist tasks first. |
| `UPDATE_INTENTION` | `intention` | Replaces in-place |
| `REORDER_INTENTIONS` | `intentionIds` | Reorders to match the provided ID sequence |
| `TOGGLE_INTENTION_COMPLETE` | `intentionId` | Toggles completed. Cascades to all linked tasks. |
| `MARK_BROKEN_DOWN` | `intentionId, brokenDown` | Sets the `brokenDown` flag (Step 1 mapping progress) |

### 3.2 Task Actions

| Action | Payload | Effect |
|---|---|---|
| `LINK_TASK` | `intentionId, todoistId` | Creates a new LinkedTask (or moves existing to a different intention). Updates `linkedTasks` and `intentions[].linkedTaskIds`. |
| `UNLINK_TASK` | `todoistId` | Removes the LinkedTask, cleans up `linkedTaskIds` and `taskSessions` |
| `CATEGORIZE_TASK` | `todoistId, taskType` | Sets `type` to main / background / unclassified |
| `SET_TASK_ESTIMATE` | `todoistId, minutes` | Sets `estimatedMinutes` |
| `ASSIGN_TASK` | `todoistId, sessionId` | Main: exclusive (removes from other sessions first). Background: additive. Updates both `taskSessions` and `assignedSessions`. |
| `UNASSIGN_TASK` | `todoistId, sessionId` | Removes task from the specified session |
| `TOGGLE_TASK_COMPLETE` | `todoistId, titleSnapshot?` | Toggles `completed` + `status`. Optionally stores title snapshot. Closes any open engagement. |
| `SYNC_TASK_SNAPSHOTS` | `snapshots` | Batch-updates `titleSnapshot` when Todoist titles change |
| `REORDER_SESSION_TASKS` | `sessionId, taskIds` | Replaces task order within a session |
| `START_TASK_ENGAGEMENT` | `todoistId, now` | Sets `status = 'engaged'`. Pushes a new open segment `{ startedAt: now }` to `segments` (no-op if one is open). |
| `STOP_TASK_ENGAGEMENT` | `todoistId, now` | Closes the open segment (`endedAt = now`), returns `status` to `'pending'`. A subsequent Start pushes a fresh segment (timer from 0:00; distinct log row). |
| `DELETE_TASK_ENGAGEMENT_SEGMENT` | `todoistId, segmentStartedAt` | Removes the matching segment from a LinkedTask (deletes one Engagement Log row). If it was the open segment and none remain open, returns `status` to `'pending'`. |

### 3.3 Habit Instance Actions

| Action | Payload | Effect |
|---|---|---|
| `REFRESH_TODAYS_HABITS` | `instances` | Appends precomputed instances to `todaysHabits`. Idempotent — skips any `habitId` already present. |
| `START_HABIT_INSTANCE` | `instanceId, now` | Sets `status = 'engaged'`. Pushes a new open segment `{ startedAt: now }` (no-op if one is open). |
| `STOP_HABIT_INSTANCE` | `instanceId, now` | Closes the open segment, returns `status` to `'planned'`. A subsequent Start pushes a fresh segment (timer from 0:00; distinct log row). |
| `COMPLETE_HABIT_INSTANCE` | `instanceId, now` | Sets `status = 'completed'`, `completedAt = now`, closes any open segment. Caller completes Todoist task. |
| `SKIP_HABIT_INSTANCE` | `instanceId, now` | Sets `status = 'skipped'`. Terminal. Closes any open segment so an in-flight engagement (Start then ✕ Skip) is recorded. Caller (v6.4) posts a `"Skipped via Orchestrate on <date>"` comment on the Todoist task, then fires `completeTask` so the recurrence engine advances. |
| `RESCHEDULE_HABIT_INSTANCE` | `instanceId, newTargetTime?, now` | **v6.4: always in-place.** Updates `targetTime`, stamps `rescheduledAt`, appends a `RescheduleEventEntry` to `rescheduleHistory`. Keeps `id`/`status`/`segments` (engaged instances keep their open segment running). Logged regardless of engagement. No clone, no Todoist write. |
| `DELETE_HABIT_ENGAGEMENT_SEGMENT` | `instanceId, segmentStartedAt` | Removes the matching segment from a `TodaysHabitInstance` (deletes one Engagement Log row). If it was the open segment and none remain open, returns `status` to `'planned'`. |
| `DELETE_HABIT_RESCHEDULE_ENTRY` | `instanceId, rescheduleAt` | Removes the matching `RescheduleEventEntry` from `rescheduleHistory` (deletes one reschedule row from the Engagement Log). Does not restore `targetTime`. |

### 3.4 Backlog Actions

| Action | Payload | Effect |
|---|---|---|
| `MOVE_INTENTION_TO_BACKLOG` | `intentionId, reason?` | Scrubs intention + LinkedTasks from plan. Builds BacklogEntry (captures each engaged task's `segments`). Appends to `life.backlog`. Caller handles Todoist unschedule. |
| `RESTORE_FROM_BACKLOG` | `backlogId, taskCache, now?` | Pulls entry off backlog. Appends intention to plan. Rebuilds fresh LinkedTasks for pending IDs (unclassified, no estimate). Stamps reschedule fields on previously-engaged tasks. |
| `DELETE_BACKLOG_ENTRY` | `backlogId` | Removes entry. Caller handles Todoist unschedule. |

### 3.5 Wizard & Global Actions

| Action | Payload | Effect |
|---|---|---|
| `SET_WIZARD_STEP` | `step` | Sets `plan.wizardStep` |
| `COMPLETE_SETUP` | *(none)* | Sets `plan.setupComplete = true` |
| `ADD_CHECKIN` | `checkIn` | Appends to `plan.checkIns` |
| `RESET_DAY` | *(none)* | Replaces plan with `freshPlan()`, clears `editingStep`. Other slices (settings, history, life) untouched. Surfaced from Settings → Data → Reset Today's Plan. |
| `RESET_ALL` | *(none)* | Factory reset: replaces every reducer-managed slice with defaults — `plan = freshPlan()`, `history = []`, `life = emptyLifeContext()`, `settings` back to defaults (Todoist token cleared). Caller is responsible for clearing aux localStorage keys outside the reducer (`orchestrate-todoist-cache`). Surfaced from Settings → Data → Reset Everything. |
| `UPDATE_SETTINGS` | `settings` | Shallow-merges into settings |
| `SET_EDITING_STEP` | `step` | Tracks which wizard step the user is re-editing from the dashboard |

### 3.6 History Actions

| Action | Payload | Effect |
|---|---|---|
| `SAVE_DAY` | `label` | Creates a SavedDayPlan snapshot. Replaces any existing entry for same date. Only writer to `history` (rollover uses backlog instead). |
| `RESTORE_DAY` | `savedAt` | Finds saved plan, runs through `migratePlan()`, sets date to today |
| `DELETE_SAVED_DAY` | `savedAt` | Removes entry from history |
| `IMPORT_SESSIONS` | `sessions` | Merges imported sessions, deduplicating by `savedAt` |
| `IMPORT_BACKUP` | `settings?, life?, history?` | Merge-by-id import. Imported habits run through `migrateHabit`. |

### 3.7 Life Scaffolding Actions

| Action | Payload | Effect |
|---|---|---|
| `ADD_SEASON` | `season` | Appends; if `active: true`, deactivates others |
| `UPDATE_SEASON` | `season` | Replaces in-place. Enforces single-active invariant. |
| `DELETE_SEASON` | `seasonId` | Removes; clears `activeSeasonId` if active; clears id from habit `seasonIds` |
| `ACTIVATE_SEASON` | `seasonId | null` | Sets exactly one active (or none) |
| `ADD_HABIT` | `habit` | Appends (caller generates id + createdAt so it can sync to Todoist with the same id) |
| `UPDATE_HABIT` | `habit` | Replaces in-place |
| `DELETE_HABIT` | `habitId` | Removes the habit; also drops matching `TodaysHabitInstance` rows. (No anchor guard — `isAnchor` is a UI-only confirm prompt now.) |
| `TOGGLE_HABIT_ACTIVE` | `habitId` | Flips `active` flag |

### 3.8 Light Pool Actions

| Action | Payload | Effect |
|---|---|---|
| `LOG_HABIT_START` | `habitId, sessionId?` | Appends HabitLogEntry with `startedAt = now` |
| `LOG_HABIT_COMPLETE` | `entryId, durationMinutes?` | Sets `completedAt = now` on the entry |
| `DELETE_HABIT_LOG_ENTRY` | `entryId` | Removes entry |

### 3.9 True Rest Cue Actions

| Action | Payload | Effect |
|---|---|---|
| `ADD_REST_CUE` | `cue` | Appends new cue. Auto-seeds from defaults if `restCues` is undefined. |
| `UPDATE_REST_CUE` | `cue` | Replaces in-place. Auto-seeds if undefined. |
| `DELETE_REST_CUE` | `cueId` | Removes cue. Auto-seeds if undefined. |
| `REPLACE_REST_CUES` | `cues | undefined` | Bulk-replaces. Pass `undefined` to reset to built-in defaults. |

---

## 4. Migration Chain

Plans in localStorage include `_wizardSteps` and `_schemaVersion` markers. On load, `migratePlan()` applies transformations. Current schema: **6.3**.

### v1 -> v2: Tasks to Intentions
- **Trigger:** Plan has `tasks` array instead of `intentions`.
- Each v1 task becomes an Intention with empty `linkedTaskIds`.

### v2/v3 -> v4: Intentions to LinkedTasks
- **Trigger:** No `linkedTasks`/`taskSessions` on plan.
- Initializes both to empty. Discards old `intentionSessions`.

### v4 -> v4.1: estimatedMinutes
- Adds `estimatedMinutes: null` to any LinkedTask missing it.

### v4.1 -> v5: LifeContext
- Introduces `orchestrate-life-context` localStorage key. Plan shape unchanged.
- `loadLifeContext()` returns `{ seasons: [], habits: [], activeSeasonId: null }` when absent.

### v5 -> v6: Micro-gap refinement + capacity
- Strips deprecated `isHabit` from intentions and LinkedTasks.
- Initializes `plan.habitLog` to `[]`.
- Defaults habit `kind` to `'stabilizer'` if missing.
- Injects `taskCapDefaults` and `sessionBufferMinutes` into settings.

### v6 -> v6.1: Habit-as-task decoupling
- Drops habit-derived intentions; re-anchors their LinkedTasks as orphans with `sourceHabitId`.
- Migrates deprecated `autoLinkTodoistId` -> `todoistTaskId`, `maxBlockMinutes` -> `targetDurationMinutes`.
- Defaults `windowBehavior` to `'lenient'`.
- Strips deprecated fields from persisted shape (old fields remain on type for `IMPORT_BACKUP` compat).

### v6.1 -> v6.2: Intentions backlog
- Defaults `LifeContext.backlog` to `[]`.
- Provider init consolidated into `loadInitialState()` with date-stale harvest.
- No automatic SAVE_DAY at rollover — backlog covers unfinished work.

### v6.2 -> v6.3: Habit/session decoupling + task engagement
- For every LinkedTask with `sourceHabitId`: emits a synthetic `TodaysHabitInstance`, drops the LinkedTask, prunes from `taskSessions`.
- For remaining LinkedTasks: stamps `status` based on `completed` flag. Drops `sourceHabitId`/`skippedForToday`.
- Initializes `plan.todaysHabits: []` when missing.

### v6.4: Engagement segments (no schema-marker bump — additive optionals)
- Engagement moved from a single cumulative `EngagementRecord` to an `EngagementSegment[]` (`segments`) on both `LinkedTask` and `TodaysHabitInstance`. `migratePlan` converts any legacy `engagement` record into a single segment (`legacyEngagementToSegments`); the old `totalSeconds`/`totalMinutes` accumulators are dropped (duration is derived).
- Drops `HabitInstanceStatus` `'unfinished'` — `migratePlan` coerces persisted `'unfinished'` instances to `'skipped'`, and `'unfinished'` LinkedTask status to `'pending'`.
- `BacklogEntry.unfinishedTaskRecords` becomes `Record<todoistId, EngagementSegment[]>`.
- These are optional fields defaulted on read, so the `_schemaVersion` marker **stays at `6.3`** (no breaking shape change; plans reset daily).

### Wizard step migration
- 6-step -> 5-step: steps 2+ shift down by 1.
- 5-step -> 4-step: old step 4 (nudges) merges into step 3.
- All clamped to `max: 4`.

### Settings migration
- Single `googleCalendarId` string -> `GoogleCalendarEntry[]`.
- String array `googleCalendarIds` -> `GoogleCalendarEntry[]` objects.

---

## 5. localStorage Schema

| Key | Content | Notes |
|---|---|---|
| `orchestrate-day-plan` | Serialized `DayPlan` + `_wizardSteps` + `_schemaVersion` markers | `_wizardSteps` injected during serialization, read during migration only |
| `orchestrate-settings` | Serialized `AppSettings` | Token fields are base64-encoded ciphertext/IV/key |
| `orchestrate-history` | `SavedDayPlan[]` | Each entry contains a full plan snapshot |
| `orchestrate-life-context` | Serialized `LifeContext` + `_schemaVersion` | Seasons, habits, backlog, rest cues |
| `orchestrate-todoist-cache` | `{ tasks, projects, sections, fetchedAt }` | Stale-while-revalidate (5min hydration / 30s focus) |
| `orchestrate-theme` | `"light"` or `"dark"` | Written by `useTheme` |
| `orchestrate-active-playlist` | Playlist ID string | Written by `MusicProvider` |
| `orchestrate-custom-playlist-urls` | `Record<playlistId, spotifyUrl>` | Written by `MusicProvider` |

---

## 6. Todoist Data Lifecycle

### Fetch cycle
1. On window focus / initial mount, `TodoistProvider` checks cache age.
2. If cache < 5 min: use cached data, skip fetch.
3. Otherwise: `resolveToken()` -> `decryptToken()` -> paginated fetch of tasks, projects, sections -> save to cache.

### Deduplication
- Inflight requests tracked via `inflightRef`. Duplicate calls return the existing promise.
- Requests within 30s of last fetch are skipped (unless `force: true`).

### Reconciliation (one-time after first fetch)
- **Title sync:** updates `titleSnapshot` on any LinkedTask whose Todoist title has changed.
- **Stale task cleanup:** any LinkedTask not in the Todoist response and not already completed is marked complete (assumption: completed externally). Not unlinked — session tracking preserved.

### Mutations
All mutations are optimistic — local state updates immediately. API failures set an error flag but don't roll back (known trade-off for simplicity).

| Mutation | Local effect |
|---|---|
| `createTask` | Appends API response to `tasks` |
| `completeTask` | Filters task from `tasks` (Sync API `item_complete`) |
| `reopenTask` | Full `refreshTasks({ force: true })` after Sync API call |
| `updateTask` | Replaces task with API response |
| `deleteTask` | Recursively removes task and descendants |
| `createProject` | Appends API response |
| `deleteProject` | Recursively removes project, its tasks, and sections |