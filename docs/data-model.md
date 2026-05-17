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

**Engagement lifecycle:**
1. New / restored task: `status = 'pending'`, no engagement.
2. User presses Start: `START_TASK_ENGAGEMENT` sets `status = 'engaged'` and `engagement.startedAt`.
3. User presses Stop: `STOP_TASK_ENGAGEMENT` stamps `endedAt`, accumulates `totalMinutes`. Status stays `'engaged'` (resumable).
4. User checks complete: `TOGGLE_TASK_COMPLETE` flips to `status = 'completed'`, closes any open engagement.
5. Moved to backlog while engaged: engagement record copied into `BacklogEntry.unfinishedTaskRecords`.

**`completed` vs `status`:** `completed` mirrors `status === 'completed'`. Both are written together by the reducer. `completed` is retained for backward compat — many callers (capacity calc, completion counter, session visuals) still read it.

**Title fallback chain:** `taskMap.get(todoistId)?.content` -> `titleSnapshot` -> raw `todoistId`.

### TodaysHabitInstance

A stabilizer habit's manifestation for today. Lives on `DayPlan.todaysHabits`, independent of session assignment. Positioned on the timeline by `targetTime`; untimed instances form an "Anytime today" cluster.

**Status semantics:**
- **planned** — surfaced for today, not yet acted on.
- **engaged** — user pressed Start on the `HabitInstanceCard`.
- **completed** — done. Caller also fires `actions.completeTask(todoistTaskId)` to close Todoist's current occurrence.
- **unfinished** — terminal: was engaged, then rescheduled or abandoned. Engagement record retained.
- **skipped** — terminal: user explicitly skipped, or predecessor of a reschedule with no prior engagement.

**Reschedule (clone) primitive:** `RESCHEDULE_HABIT_INSTANCE` flips the predecessor to `unfinished` (if engaged) or `skipped` (if untouched), then appends a successor with fresh `status: 'planned'` and `rescheduledFromId`. **No Todoist write** — the recurring task is untouched. Multiple instances per habit per day can coexist (predecessor stays terminal, successor active).

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

**`isAnchor`** is orthogonal to `kind` — it controls deletion protection, not behavior. Anchor habits cannot be deleted while active (reducer no-ops; UI shows "deactivate first").

**Recurrence matching** (`src/lib/habits.ts -> habitMatchesDate`): `daily` = every day, `weekdays` = Mon-Fri, `weekly`/`custom` = only listed `daysOfWeek` (weekly without `daysOfWeek` does not match).

**Light Pool filter** (`getLightPoolHabits`): `active && kind === 'light-coherent' && habitMatchesDate(today) && (seasonIds.length === 0 || seasonIds.includes(activeSeasonId))`.

**Todoist sync** (`src/lib/habitsTodoistSync.ts`): saving a stabilizer calls `ensureHabitsProject(...)` -> `resolveHabitProjectId(...)` -> `syncHabitToTodoist(...)`. Creates or updates the recurring task with `due_string` from `buildDueString(habit)` and `duration` from `targetDurationMinutes`. Project changes trigger a Sync API `item_move`. Sync failures are non-blocking.

**Today's instances** (`computeTodaysHabitInstances`): filters to active stabilizers with `todoistTaskId` whose Todoist task is due today + unchecked; honors season scope; applies `windowBehavior === 'strict'` to drop past-window instances. The reducer is idempotent — any habit already represented in `plan.todaysHabits` is skipped.

### BacklogEntry

A parked intention stored on `LifeContext.backlog`.

**Two creation paths** (both via `lib/backlog.ts -> buildBacklogEntry`):
- **Manual** (`reason: 'manual'`): user moves an intention to the backlog during planning.
- **Rollover** (`reason: 'rollover'`): `loadInitialState` harvests unfinished intentions on date-change.

**Completed-task partitioning:** `buildBacklogEntry` splits `linkedTaskIds` by completion. Completed IDs are stripped; their `titleSnapshot` goes to `completedTaskTitles` (read-only context). This avoids rebuilding stale completed tasks that Step 2 can't render (absent from the Todoist API).

**Engagement carryover:** When an intention with engaged-but-incomplete tasks moves to backlog, the engagement records are copied into `unfinishedTaskRecords`. On restore, rebuilt LinkedTasks get `rescheduledFromTodoistId` + `rescheduledAt` stamps; the engagement record stays on the BacklogEntry as annotation.

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

All state mutations flow through the `DayPlanContext` reducer (`src/context/DayPlanContext.tsx`). The `Action` type is a discriminated union of ~45 variants.

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
| `START_TASK_ENGAGEMENT` | `todoistId, now` | Sets `status = 'engaged'`, initializes/reopens engagement |
| `STOP_TASK_ENGAGEMENT` | `todoistId, now` | Closes current engagement segment, accumulates minutes. Status stays `'engaged'`. |

### 3.3 Habit Instance Actions

| Action | Payload | Effect |
|---|---|---|
| `REFRESH_TODAYS_HABITS` | `instances` | Appends precomputed instances to `todaysHabits`. Idempotent — skips any `habitId` already present. |
| `START_HABIT_INSTANCE` | `instanceId, now` | Sets `status = 'engaged'`, initializes/reopens engagement |
| `STOP_HABIT_INSTANCE` | `instanceId, now` | Closes engagement segment, accumulates minutes. Status stays `'engaged'`. |
| `COMPLETE_HABIT_INSTANCE` | `instanceId, now` | Sets `status = 'completed'`, `completedAt = now`, closes engagement. Caller completes Todoist task. |
| `SKIP_HABIT_INSTANCE` | `instanceId` | Sets `status = 'skipped'`. Terminal. |
| `RESCHEDULE_HABIT_INSTANCE` | `instanceId, newTargetTime?, now` | Predecessor -> `unfinished`/`skipped`. Appends successor with new `targetTime`. No Todoist write. |

### 3.4 Backlog Actions

| Action | Payload | Effect |
|---|---|---|
| `MOVE_INTENTION_TO_BACKLOG` | `intentionId, reason?` | Scrubs intention + LinkedTasks from plan. Builds BacklogEntry (captures engagement records). Appends to `life.backlog`. Caller handles Todoist unschedule. |
| `RESTORE_FROM_BACKLOG` | `backlogId, taskCache, now?` | Pulls entry off backlog. Appends intention to plan. Rebuilds fresh LinkedTasks for pending IDs (unclassified, no estimate). Stamps reschedule fields on previously-engaged tasks. |
| `DELETE_BACKLOG_ENTRY` | `backlogId` | Removes entry. Caller handles Todoist unschedule. |

### 3.5 Wizard & Global Actions

| Action | Payload | Effect |
|---|---|---|
| `SET_WIZARD_STEP` | `step` | Sets `plan.wizardStep` |
| `COMPLETE_SETUP` | *(none)* | Sets `plan.setupComplete = true` |
| `ADD_CHECKIN` | `checkIn` | Appends to `plan.checkIns` |
| `RESET_DAY` | *(none)* | Replaces plan with `freshPlan()`, clears `editingStep` |
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
| `DELETE_HABIT` | `habitId` | No-ops if anchor + active. Otherwise removes; also drops matching `TodaysHabitInstance` rows. |
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