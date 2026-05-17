> **Looking for a high-level overview?** Start at [synthesis.md](./synthesis.md). This document goes deeper on data-model specifics.

# Orchestrate — Data Model Reference

This document describes every data type, the reducer action catalog, the migration chain, localStorage schemas, and the Todoist data lifecycle. It is the companion to the [Architecture Guide](architecture.md).

---

## 1. Core Types

All types are defined in `src/types/index.ts`.

### 1.1 Intention

An intention is a high-level goal for the day. It is the top-level organizational unit.

```ts
interface Intention {
    id: string;              // crypto.randomUUID()
    title: string;           // e.g. "Finish assignment 3"
    linkedTaskIds: string[]; // ordered list of Todoist task IDs linked to this intention
    completed: boolean;
    brokenDown: boolean;     // true once the user finishes mapping tasks to this intention (Step 1)
}
```

**v6.3:** stabilizer habits no longer surface as orphan LinkedTasks at all. They live on `DayPlan.todaysHabits` as `TodaysHabitInstance` entries (see §1.4). `sourceHabitId` and `skippedForToday` are removed from `LinkedTask`. The v6.2→v6.3 migration moves any legacy `sourceHabitId`-bearing LinkedTask into a synthetic `TodaysHabitInstance` and drops it from `linkedTasks`.

**v6.1 (historical):** `sourceHabitId` and `skippedForToday` were added to `LinkedTask` after habit-derived intentions were dropped — that step is now redundant given v6.3.

**v6:** the deprecated `isHabit: boolean` was removed from this interface (and from `LinkedTask`). Old saved-session payloads with `isHabit` survive: `migratePlan` strips the field on read.

**Relationships:** An intention owns zero or more `LinkedTask` entries (those whose `intentionId` matches). The `linkedTaskIds` array maintains the display order. Toggling an intention's completion cascades to all its linked tasks.

### 1.2 LinkedTask

A Todoist task surfaced inside Orchestrate's planning model, bound to an intention via `intentionId`. v6.3: always intention-bound (no more orphans).

```ts
type LinkedTaskStatus = 'pending' | 'engaged' | 'completed' | 'unfinished';

interface EngagementRecord {                              // v6.3
    startedAt: string;                                    // ISO — first Start press
    endedAt?: string;                                     // ISO — last Stop press
    totalMinutes?: number;                                // accumulated across cycles
}

interface LinkedTask {
    todoistId: string;                                    // Todoist task ID (primary key)
    intentionId?: string;                                 // parent intention (always set in v6.3)
    type: 'main' | 'background' | 'unclassified';        // set in Step 2
    assignedSessions: string[];                           // session slot IDs this task is assigned to
    completed: boolean;                                   // mirrors status === 'completed'
    estimatedMinutes: number | null;                      // null = not yet estimated
    titleSnapshot?: string;                               // cached title for display when task is no longer in Todoist
    status?: LinkedTaskStatus;                            // v6.3: absent = 'pending'
    engagement?: EngagementRecord;                        // v6.3: explicit Start/Stop record
    rescheduledFromTodoistId?: string;                    // v6.3: predecessor todoistId when restored from a backlog entry with engagement
    rescheduledAt?: string;                               // v6.3: ISO timestamp of the restore
}
```

**Task types:**
- **main** — Primary work thread. Exclusive to one session (assigning removes it from any previous session).
- **background** — Small nudge task. Can be assigned to multiple sessions simultaneously. Cap: `taskCapDefaults.manualBackground` (default 30 min).
- **unclassified** — Default state after linking. Must be categorized before the user can proceed past Step 2.

**Engagement lifecycle:**
- New / restored task: `status = 'pending'`, no engagement.
- User presses ▶ Start: `START_TASK_ENGAGEMENT` sets `status = 'engaged'` and `engagement.startedAt`.
- User presses ■ Stop: `STOP_TASK_ENGAGEMENT` stamps `engagement.endedAt` and adds elapsed minutes to `engagement.totalMinutes`. Status stays `'engaged'` (resumable).
- User checks complete: `TOGGLE_TASK_COMPLETE` flips to `status = 'completed'`, closes any open engagement.
- User moves engaged-but-incomplete intention to backlog: the engagement record is copied into `BacklogEntry.unfinishedTaskRecords` for the read-only annotation.

**Title fallback chain:** When displaying a task title, components use: `taskMap.get(todoistId)?.content` → `linkedTask.titleSnapshot` → `todoistId` (raw ID as last resort).

### 1.3 TodaysHabitInstance (v6.3)

A stabilizer habit's manifestation for today. Independent of session assignment; positioned on the timeline by `targetTime`. Successor instances (clones) accumulate in `plan.todaysHabits` alongside their predecessors.

```ts
type HabitInstanceStatus = 'planned' | 'engaged' | 'completed' | 'unfinished' | 'skipped';

interface TodaysHabitInstance {
    id: string;                            // uuid (primary key — distinct from todoistTaskId)
    habitId: string;                       // → life.habits[i].id
    todoistTaskId: string;                 // recurring Todoist task id (stable across reschedule chain)
    titleSnapshot: string;
    durationMinutes: number;
    targetTime?: string;                   // "HH:mm" — drives timeline position; absent = "anytime today"
    status: HabitInstanceStatus;
    completedAt?: string;                  // ISO
    engagement?: EngagementRecord;
    rescheduledFromId?: string;            // predecessor instance id (clone chain)
    rescheduledAt?: string;                // ISO
}
```

**Status semantics:**
- **planned**    — surfaced for today, not yet acted on.
- **engaged**    — user pressed Start on the dashboard `HabitInstanceCard`.
- **completed**  — done; the reducer dispatches plus the caller fires `actions.completeTask(todoistTaskId)` to close Todoist's current occurrence.
- **unfinished** — terminal: was engaged, then rescheduled or abandoned. Engagement record retained.
- **skipped**   — terminal: user explicitly skipped, or was the predecessor of a reschedule with no prior engagement.

**Reschedule (clone) primitive:** `RESCHEDULE_HABIT_INSTANCE` flips the predecessor to `'unfinished'` (if engagement exists) or `'skipped'` (untouched), then appends a successor with fresh `status: 'planned'` and `rescheduledFromId` set. **No Todoist write** — the recurring task is untouched.

### 1.4 DayPlan

The central document representing a single day's plan. Stored in localStorage and reset daily.

```ts
interface DayPlan {
    date: string;                                   // "YYYY-MM-DD" — auto-reset when stale
    intentions: Intention[];                        // ordered list
    linkedTasks: LinkedTask[];                      // user-task LinkedTasks only (v6.3)
    todaysHabits: TodaysHabitInstance[];            // v6.3: stabilizer instances for today
    taskSessions: Record<string, string[]>;         // sessionId → todoistId[] (ordered)
    wizardStep: number;                             // 1–4 (current wizard position)
    setupComplete: boolean;                         // true after Step 4 finish
    checkIns: CheckIn[];                            // hourly check-in records
    habitLog: HabitLogEntry[];                      // v6: Light Pool log entries (today)
}

interface HabitLogEntry {                           // v6
    id: string;
    habitId: string;                                // references LifeContext.habits[].id
    startedAt: string;                              // ISO
    completedAt?: string;                           // ISO; absent while in-progress
    durationMinutes?: number;                       // derived on complete or user-entered
    sessionId?: string;                             // active session id when started, if any
}
```

**Key invariants:**
- `linkedTasks` is the flat, denormalized list of intention-bound tasks. Each task's `intentionId` back-references its parent.
- `todaysHabits` is the parallel list for stabilizer habit instances. Independent of `linkedTasks` / `taskSessions`.
- `taskSessions` is a map from session IDs to ordered arrays of Todoist task IDs. Habits never appear here.
- `intentions[i].linkedTaskIds` is the ordered list of task IDs belonging to that intention. This is kept in sync with `linkedTasks` by the reducer.

### 1.4 SessionSlot

A time-bounded block in the day. Configurable in settings; defaults provided by `src/data/sessions.ts`.

```ts
interface SessionSlot {
    id: string;          // e.g. "early-morning", "morning", "afternoon", "night"
    name: string;        // display name
    startTime: string;   // "HH:mm"
    endTime: string;     // "HH:mm"
}
```

**Default sessions:**

| ID | Name | Time |
|---|---|---|
| `early-morning` | Early Morning | 06:00–08:00 |
| `morning` | Morning | 09:00–13:00 |
| `afternoon` | Afternoon | 14:30–18:30 |
| `night` | Night | 20:30–23:00 |

### 1.5 CheckIn

Recorded during hourly check-in prompts.

```ts
interface CheckIn {
    id: string;                  // crypto.randomUUID()
    timestamp: string;           // ISO string
    feeling: 'great' | 'okay' | 'struggling' | 'stuck';
    currentWorkType: WorkType;
    playlistSuggested: string;   // playlist ID derived from work type
    notes: string;
    avoidanceNote?: string;      // v6: captured when feeling === 'stuck' ("What exactly are you avoiding?")
}
```

### 1.6 WorkType

The type of work the user is currently doing. Maps to playlist suggestions.

```ts
type WorkType = 'coding' | 'lecture' | 'reading' | 'restless' | 'low-energy';
```

**Work type → Playlist mapping** (defined in `src/data/playlists.ts`):

| Work Type | Playlist | Emoji |
|---|---|---|
| `coding` | Deep Focus | 🧠 |
| `lecture` | Lo-Fi Beats | 🌊 |
| `restless` | Brain Food | 🔥 |
| `low-energy` | Peaceful Piano | 🧱 |
| `reading` | White Noise | 🔇 |
| *(start of day)* | Start Work | 🚀 |

### 1.7 AppSettings

Persistent user preferences. Survives daily plan resets.

```ts
interface AppSettings {
    notificationPreference: NotificationPreference;   // 'in-app' | 'browser' | 'both'
    sessionSlots: SessionSlot[];                      // customizable time blocks
    todoistToken?: string;                            // AES-256-GCM encrypted
    todoistTokenIV?: string;                          // base64 IV
    todoistTokenKey?: string;                         // base64 exported CryptoKey
    googleCalendarIds?: GoogleCalendarEntry[];
    calendarViewMode?: CalendarViewMode;              // 'week' | 'month' | 'agenda'
    taskCapDefaults?: TaskCapDefaults;                // v6: per-kind default duration caps
    sessionBufferMinutes?: number;                    // v6: subtracted from session length for capacity (default 60)
    habitsTodoistProjectId?: string;                  // v6.1: project where stabilizer habit-tasks live; lazily created on first sync
}

interface TaskCapDefaults {                           // v6
    stabilizer: number;                               // default 30
    lightCoherent: number;                            // default 20
    manualBackground: number;                         // default 30
}
```

**Token encryption:** The Todoist personal API token is never stored in plaintext. `encryptToken()` generates a random AES-256-GCM key and IV, encrypts the token, and returns all three as base64 strings. `decryptToken()` reverses the process. The key stays in localStorage — this protects against casual inspection but not against a determined attacker with access to the same browser profile.

### 1.8 GoogleCalendarEntry

```ts
interface GoogleCalendarEntry {
    id: string;          // Google Calendar ID (email-like string)
    name?: string;       // user label, e.g. "Work"
    color?: string;      // hex color for the embed
}
```

### 1.9 SavedDayPlan

A historical snapshot of a completed day's plan.

```ts
interface SavedDayPlan {
    plan: DayPlan;        // full plan snapshot (includes _wizardSteps marker)
    savedAt: string;      // ISO timestamp (used as unique key)
    label: string;        // user-provided name, e.g. "Thursday, Apr 10"
}
```

### 1.10 Playlist

```ts
interface Playlist {
    id: string;
    name: string;         // e.g. "Deep Focus"
    workLabel: string;    // e.g. "Coding & Problem Solving"
    description: string;
    emoji: string;
    spotifyUrl: string;   // full Spotify URL
    workTypes: WorkType[];
}
```

### 1.11 Season (v5)

A medium-horizon focus period.

```ts
interface Season {
    id: string;
    name: string;                        // e.g. "Stabilization", "Degree Push 2026"
    startDate: string;                   // YYYY-MM-DD
    endDate: string | null;              // null = open-ended
    primaryTheme: string;                // one-line "what this season is about"
    supportingGoals: string[];
    nonGoals: string[];                  // explicit "not this season"
    successCriteria: string;
    capacityBudget: SeasonCapacity | null;
    active: boolean;                     // exactly one season can be active at a time
    archivedAt?: string;                 // ISO timestamp once retired
}

interface SeasonCapacity {
    weeklyGrowthHours: number | null;    // soft cap on non-anchor growth blocks per week
    maxConcurrentHabits: number | null;
    notes: string;
}
```

**Invariants:** activating a season auto-deactivates the previously active one. Deleting a season clears its id from any habit's `seasonIds`.

### 1.12 Habit (v5)

A first-class recurring entity. v6 introduced the `kind` discriminator: `stabilizer` (auto-injected anchor-style rituals) vs `light-coherent` (logged-only micro-gap fillers).

```ts
type HabitRecurrenceKind = 'daily' | 'weekdays' | 'weekly' | 'custom';

interface HabitRecurrence {
    kind: HabitRecurrenceKind;
    daysOfWeek?: number[];               // 0=Sun..6=Sat — used for 'weekly' and 'custom'
    timesPerWeek?: number;               // soft target for 'weekly' when daysOfWeek is not set
}

type HabitCompletionRule = 'binary' | 'count' | 'duration';
type HabitKind = 'stabilizer' | 'light-coherent';  // v6
type HabitWindowBehavior = 'strict' | 'lenient';   // v6.1

interface Habit {
    id: string;
    name: string;
    kind: HabitKind;                     // v6: required. Migration backfills 'stabilizer' for pre-v6 habits.
    recurrence: HabitRecurrence;
    minimumViable: string;               // e.g. "5 min sit, no app required"
    triggerCue: string;                  // e.g. "After waking, before phone"
    completionRule: HabitCompletionRule;
    failureTolerance: number;            // # of misses per week before nudge
    isAnchor: boolean;                   // anchor habits are protected from accidental deletion
    seasonIds: string[];                 // [] = always-on
    active: boolean;
    todoistTaskId?: string;              // v6.1: persistent recurring Todoist task ID (stabilizers only)
    todoistProjectId?: string;           // v6.1: per-habit project override; falls back to AppSettings.habitsTodoistProjectId
    targetTime?: string;                 // v6.1: "HH:mm" — pushed to Todoist; drives session auto-assignment
    targetDurationMinutes?: number;      // v6.1: pushed to Todoist `duration`; used as LinkedTask estimate + cap
    windowBehavior?: HabitWindowBehavior;// v6.1: 'strict' hides past-window habit-tasks; default 'lenient'
    /** @deprecated v6.1: replaced by todoistTaskId. Retained for migration only. */
    autoLinkTodoistId?: string;
    /** @deprecated v6.1: replaced by targetDurationMinutes. Retained for migration only. */
    maxBlockMinutes?: number;
    createdAt: string;
}
```

**Kinds (v6 + v6.1 + v6.3):**
- **stabilizer** — anchor-style ritual. Synced to Todoist as a recurring task in the dedicated Habits project (lazily created via `AppSettings.habitsTodoistProjectId`). **v6.3:** on Step 1 mount, `REFRESH_TODAYS_HABITS` adds today's eligible stabilizers to `plan.todaysHabits` as `TodaysHabitInstance` rows. They are rendered in the SessionTimelineBar's habit lane (positioned by `targetTime` or clustered as "Anytime today") and in the dashboard's `HabitInstanceCard`, independent of session assignment.
- **light-coherent** — micro-gap filler. Never auto-injects. Surfaces in the `LightPoolPanel` (Dashboard) and `LightPoolSection` (`/life`); Start/Complete writes a `HabitLogEntry` to `plan.habitLog`.

**Recurrence matching** (`src/lib/habits.ts → habitMatchesDate`):
- `daily` → every day
- `weekdays` → Mon–Fri
- `weekly` / `custom` → only the listed `daysOfWeek` (`weekly` without `daysOfWeek` does not match)

**Light Pool filter** (v6, `src/lib/habits.ts → getLightPoolHabits`): `active && kind === 'light-coherent' && habitMatchesDate(today) && (seasonIds.length === 0 || seasonIds.includes(activeSeasonId))`.

**Anchor protection:** anchor habits cannot be deleted while active — the reducer no-ops on `DELETE_HABIT` and the UI surfaces a "deactivate first" modal.

**Today's habit instances (v6.3, stabilizer only):** on Step 1 entry, `Step1Intentions` calls `computeTodaysHabitInstances(...)` from `lib/habitsTodoistSync.ts` and dispatches `REFRESH_TODAYS_HABITS` with the resulting `TodaysHabitInstance[]`. The helper filters to active stabilizers with `todoistTaskId` whose Todoist task is due today + unchecked; honors season scope; applies `windowBehavior === 'strict'` to drop past-window instances. The reducer is idempotent against any habit already represented in `plan.todaysHabits`. Light-coherent habits never appear here.

**Habit ↔ Todoist sync (v6.1):** when a stabilizer is created or edited via `HabitForm`, `HabitsLibrary` (a) calls `ensureHabitsProject(...)` once to resolve / lazily-create the workspace default project (`AppSettings.habitsTodoistProjectId`; falls back to a project literally named `"Habits"`), then (b) calls `resolveHabitProjectId(habit, defaultProjectId, projects)` to honor the per-habit `todoistProjectId` override, then (c) calls `syncHabitToTodoist(...)` which creates or updates the recurring task with `due_string` from `buildDueString(habit)` (e.g. `"every weekday at 7:00"`) and `duration` from `targetDurationMinutes`. If the existing task lives in a different project, it is moved via the Sync API (`item_move`). The bulk Migrate path in `HabitsLibrary` resolves the default project once before iterating to avoid a stale-closure bug that previously re-created a duplicate project per habit. Sync failures are non-blocking — the habit remains saved locally.

### 1.13 RestCue (v6)

Defined in `src/types/index.ts`. Surfaced by `TrueRestCard` in three forms (card / inline / banner) and managed via the `/rest-cues` page.

```ts
interface RestCue {
    id: string;
    label: string;                       // e.g. "Walk 5 minutes — outside if possible"
    durationHint: string;                // e.g. "5 min", "90 sec"
    category: 'physical' | 'breath' | 'sensory';
}
```

8 built-in cues live in `src/data/restCues.ts`. When the user customizes, their cues are stored in `LifeContext.restCues`. Not a Habit: no completion semantics, no logging, no streak. Pure prompt data.

### 1.14 LifeContext (v5)

The new top-level persistent state slice that holds multi-day entities.

```ts
interface LifeContext {
    seasons: Season[];
    habits: Habit[];
    activeSeasonId: string | null;       // denormalized for fast lookup; mirrors seasons[].active
    restCues?: RestCue[];                // user-customized cue list; undefined = use built-in defaults
    backlog?: BacklogEntry[];            // v6.2: parked intentions; undefined treated as []
}
```

Persisted to `orchestrate-life-context` localStorage key with `_schemaVersion: 6.2` (a JSON float; was `6.1`/`6`/`5` previously).

**`restCues` semantics:** when `undefined`, `TrueRestCard` falls back to the 8 built-in cues in `src/data/restCues.ts`. On the first `ADD_REST_CUE`, `UPDATE_REST_CUE`, or `DELETE_REST_CUE` dispatch, the reducer auto-seeds the array from the built-in defaults before applying the change, so no explicit "Customize" action is required by the UI.

### 1.15 BacklogEntry (v6.2)

A parked intention, stored on `LifeContext.backlog`.

```ts
interface BacklogEntry {
    id: string;                              // uuid for the entry itself (distinct from intention.id)
    intention: Intention;                    // preserved — but linkedTaskIds is pending-only (completed ids stripped)
    archivedAt: string;                      // ISO timestamp
    archivedFromDate: string;                // YYYY-MM-DD — plan.date the intention came from
    reason: 'manual' | 'rollover';
    taskSnapshots?: Record<string, string>;  // todoistId → titleSnapshot for pending tasks
    completedTaskTitles?: string[];          // titles of tasks already completed at archive time (context-only)
}
```

Two creation paths, both via `lib/backlog.ts → buildBacklogEntry(intention, plan, reason)`:
- **Manual** (`reason: 'manual'`): `MOVE_INTENTION_TO_BACKLOG` reducer case, fired by `useIntentionRemoval().moveToBacklog`.
- **Rollover** (`reason: 'rollover'`): `loadInitialState` calls `harvestStalePlan(plan)` on cold start when `plan.date !== todayISO()`.

**Completed-task handling:** `buildBacklogEntry` walks `intention.linkedTaskIds` and partitions them by the matching `LinkedTask.completed` flag. Completed ids never enter `intention.linkedTaskIds` on the resulting entry; instead their `titleSnapshot` (always populated by `TOGGLE_TASK_COMPLETE`) is appended to `completedTaskTitles`. This avoids restoring a "stale" completed-but-rebuilt-as-fresh task that Step 2 cannot render correctly (completed Todoist tasks are absent from the active REST API response, so they'd be rebuilt as `{ completed: false, type: 'unclassified' }` and trip Step 2's stale-task fallback).

`RESTORE_FROM_BACKLOG` only rebuilds `LinkedTask` rows for the pending ids; `completedTaskTitles` is read-only context surfaced inline in the `BacklogTab` row (`✓ Done: title1, title2 …`, truncated with a hover tooltip).

---

## 2. Todoist Data Types

Defined in `src/hooks/useTodoist.ts`. These mirror the Todoist REST API v1 response shapes.

### 2.1 TodoistTask

```ts
interface TodoistTask {
    id: string;
    content: string;
    description: string;
    checked: boolean;
    due: {
        date: string;
        timezone: string | null;
        is_recurring: boolean;
        string: string;
        lang: string;
    } | null;
    duration: {
        amount: number;
        unit: string;
    } | null;
    priority: number;
    project_id: string;
    section_id: string | null;
    parent_id: string | null;
    labels: string[];
    child_order: number;
}
```

### 2.2 TodoistProject

```ts
interface TodoistProject {
    id: string;
    name: string;
    color: string;
    parent_id: string | null;
    child_order: number;
    is_collapsed: boolean;
}
```

### 2.3 TodoistSection

```ts
interface TodoistSection {
    id: string;
    name: string;
    project_id: string;
    section_order: number;
}
```

---

## 3. Reducer Action Catalog

All state mutations flow through the `DayPlanContext` reducer. The `Action` type is a discriminated union of ~45 variants.

### 3.1 Intention Actions

| Action | Payload | Effect |
|---|---|---|
| `ADD_INTENTION` | `title: string` | Creates a new `Intention` with `crypto.randomUUID()`, appends to list |
| `REMOVE_INTENTION` | `intentionId: string` | Removes intention, all its `LinkedTask` entries, and their session assignments. **v6.2:** call sites route through `useIntentionRemoval().removeIntention(id)` so linked Todoist tasks are unscheduled (`due_string: 'no date'`) before dispatch. Habit-derived orphan tasks are skipped. |
| `UPDATE_INTENTION` | `intention: Intention` | Replaces the matching intention in-place |
| `REORDER_INTENTIONS` | `intentionIds: string[]` | Reorders intentions to match the provided ID sequence |
| `TOGGLE_INTENTION_COMPLETE` | `intentionId: string` | Toggles completed flag. **Cascades** to all linked tasks |
| `MARK_BROKEN_DOWN` | `intentionId, brokenDown` | Sets the `brokenDown` flag (Step 1 mapping progress) |

### 3.2 Task Actions

| Action | Payload | Effect |
|---|---|---|
| `LINK_TASK` | `intentionId, todoistId` | Creates a new `LinkedTask` (or moves an existing one to a different intention). Updates both `linkedTasks` and `intentions[].linkedTaskIds`. **v6.1:** the previous "lock-to-background-when-target-intention-came-from-a-habit" branch was removed since stabilizer habits no longer become intentions. New tasks default to `type: 'unclassified'`. |
| `UNLINK_TASK` | `todoistId` | Removes the `LinkedTask`, cleans up `linkedTaskIds` and `taskSessions` |
| `CATEGORIZE_TASK` | `todoistId, taskType` | Sets `type` to `'main'`, `'background'`, or `'unclassified'` |
| `SET_TASK_ESTIMATE` | `todoistId, minutes` | Sets `estimatedMinutes` |
| `ASSIGN_TASK` | `todoistId, sessionId` | **Main tasks:** exclusive — removes from all other sessions first. **Background tasks** (incl. habit-tasks): additive — just appends to the target session. Updates both `taskSessions` and `linkedTask.assignedSessions` |
| `UNASSIGN_TASK` | `todoistId, sessionId` | Removes task from the specified session |
| `TOGGLE_TASK_COMPLETE` | `todoistId, titleSnapshot?` | Toggles `completed`. Optionally stores a title snapshot for display after the task leaves Todoist |
| `SYNC_TASK_SNAPSHOTS` | `snapshots: Record<string, string>` | Batch-updates `titleSnapshot` on linked tasks when Todoist titles change |
| `REORDER_SESSION_TASKS` | `sessionId, taskIds` | Replaces the task order within a session |

### 3.3 Wizard & Global Actions

| Action | Payload | Effect |
|---|---|---|
| `SET_WIZARD_STEP` | `step: number` | Sets `plan.wizardStep` |
| `COMPLETE_SETUP` | *(none)* | Sets `plan.setupComplete = true` |
| `ADD_CHECKIN` | `checkIn: CheckIn` | Appends to `plan.checkIns` |
| `RESET_DAY` | *(none)* | Replaces plan with `freshPlan()`, clears `editingStep` |
| `UPDATE_SETTINGS` | `settings: Partial<AppSettings>` | Shallow-merges into settings |
| `SET_EDITING_STEP` | `step: number \| null` | Tracks which wizard step the user is re-editing from the dashboard |

### 3.4 History Actions

| Action | Payload | Effect |
|---|---|---|
| `SAVE_DAY` | `label: string` | Creates a `SavedDayPlan` snapshot with `_wizardSteps: 4` and `_schemaVersion: 6.2` markers (current schema). Replaces any existing entry for the same date. **v6.2:** `SAVE_DAY` is the *only* writer to `history`; rollover no longer auto-saves (the backlog covers the meaningful unfinished portion of yesterday). |
| `RESTORE_DAY` | `savedAt: string` | Finds the saved plan by `savedAt`, runs it through `migratePlan()`, sets date to today |
| `DELETE_SAVED_DAY` | `savedAt: string` | Removes the entry from history |
| `IMPORT_SESSIONS` | `sessions: SavedDayPlan[]` | Merges imported sessions, deduplicating by `savedAt` |

### 3.4a Intentions Backlog Actions (v6.2)

| Action | Payload | Effect |
|---|---|---|
| `MOVE_INTENTION_TO_BACKLOG` | `intentionId: string; reason?: 'manual' \| 'rollover'` | Scrubs the intention + its intention-bound `LinkedTask`s from the plan (same plan-side cleanup as `REMOVE_INTENTION`), and appends a `BacklogEntry` (built by `buildBacklogEntry`) to `life.backlog`. **v6.3:** engagement records from any engaged-but-incomplete LinkedTask are copied into `BacklogEntry.unfinishedTaskRecords`. Default reason `'manual'`. Caller is responsible for unscheduling Todoist tasks via `useIntentionRemoval().moveToBacklog`. |
| `RESTORE_FROM_BACKLOG` | `backlogId: string; taskCache: Record<string,string>; now?: string` | Pulls the entry off `life.backlog`, appends `entry.intention` to `plan.intentions`, and reconstructs fresh `LinkedTask` rows (`type: 'unclassified'`, `status: 'pending'`, no estimate/assignment, not completed) for each *pending* id. **v6.3:** rows whose id appears in `entry.unfinishedTaskRecords` are stamped with `rescheduledFromTodoistId` + `rescheduledAt` (the engagement record stays on the BacklogEntry until the entry is consumed). Idempotent against re-add: if the intention id already exists in `plan.intentions`, just removes the entry. Skips any `todoistId` already present in `plan.linkedTasks`. |
| `DELETE_BACKLOG_ENTRY` | `backlogId: string` | Removes the entry from `life.backlog`. Pure — caller (`useIntentionRemoval().discardFromBacklog`) handles Todoist unschedule. |

### 3.5 Life Scaffolding Actions (v5)

| Action | Payload | Effect |
|---|---|---|
| `ADD_SEASON` | `season: Omit<Season,'id'>` | Appends a new season; if `active: true`, deactivates any other active season |
| `UPDATE_SEASON` | `season: Season` | Replaces the matching season in-place. **Enforces the single-active-season invariant**: if the incoming season has `active: true`, all other seasons are deactivated and `activeSeasonId` is set to the incoming id; if it now has `active: false` and was the active one, `activeSeasonId` is cleared |
| `DELETE_SEASON` | `seasonId: string` | Removes the season; clears `activeSeasonId` if it was active; clears the id from any habit's `seasonIds` |
| `ACTIVATE_SEASON` | `seasonId: string \| null` | Sets exactly one season active (or none). Updates `activeSeasonId` |
| `ADD_HABIT` | `habit: Habit` | Appends a fully-formed habit (caller generates `id` + `createdAt` so it can run `syncHabitToTodoist` against the same id afterward) |
| `UPDATE_HABIT` | `habit: Habit` | Replaces the matching habit in-place |
| `DELETE_HABIT` | `habitId: string` | No-ops if the habit is anchor + active. Otherwise removes; **v6.3:** also drops any `TodaysHabitInstance` rows (`habitId`) from `plan.todaysHabits`. |
| `TOGGLE_HABIT_ACTIVE` | `habitId: string` | Flips the habit's `active` flag |
| `REFRESH_TODAYS_HABITS` | `instances: TodaysHabitInstance[]` | **v6.3** (replaces `INJECT_HABIT_TASKS`). Appends precomputed instances to `plan.todaysHabits`. Idempotent: any instance whose `habitId` is already present is skipped (existing engaged/completed/unfinished/skipped state is preserved). |
| `START_HABIT_INSTANCE` | `instanceId: string; now: string` | **v6.3** Sets `status = 'engaged'` and initializes/reopens `engagement` (clears `endedAt`). |
| `STOP_HABIT_INSTANCE` | `instanceId: string; now: string` | **v6.3** Closes the current engagement segment: stamps `endedAt`, adds elapsed minutes to `totalMinutes`. Status stays `'engaged'` (resumable). |
| `COMPLETE_HABIT_INSTANCE` | `instanceId: string; now: string` | **v6.3** Sets `status = 'completed'`, `completedAt = now`; closes any open engagement. Caller is responsible for `actions.completeTask(todoistTaskId)`. |
| `SKIP_HABIT_INSTANCE` | `instanceId: string` | **v6.3** Sets `status = 'skipped'`. Terminal. |
| `RESCHEDULE_HABIT_INSTANCE` | `instanceId: string; newTargetTime?: string; now: string` | **v6.3** Predecessor flips to `'unfinished'` (if engaged) or `'skipped'`. Appends a successor instance with fresh `status: 'planned'`, `rescheduledFromId`, `rescheduledAt`, new `targetTime`. **No Todoist write.** |
| `START_TASK_ENGAGEMENT` | `todoistId: string; now: string` | **v6.3** Sets `LinkedTask.status = 'engaged'` and initializes/reopens `engagement`. |
| `STOP_TASK_ENGAGEMENT` | `todoistId: string; now: string` | **v6.3** Closes the current engagement segment. Status stays `'engaged'`. |
| `IMPORT_BACKUP` | `settings?, life?, history?` | Merge-by-id import: existing entries are never overwritten, new entries are appended. Imported habits run through the same `migrateHabit` helper as `loadLifeContext`. Honors the no-backend safety net. |

### 3.6 Light Pool Actions (v6)

| Action | Payload | Effect |
|---|---|---|
| `LOG_HABIT_START` | `habitId: string; sessionId?: string` | Appends a `HabitLogEntry` to `plan.habitLog` with `startedAt = now`. `sessionId` defaults to the active session id. |
| `LOG_HABIT_COMPLETE` | `entryId: string; durationMinutes?: number` | Sets `completedAt = now` on the matching entry. `durationMinutes` is supplied by the caller, or derived from `(now − startedAt)`. |
| `DELETE_HABIT_LOG_ENTRY` | `entryId: string` | Removes the entry from `plan.habitLog`. |

### 3.7 True Rest Cue Actions

| Action | Payload | Effect |
|---|---|---|
| `ADD_REST_CUE` | `cue: Omit<RestCue, 'id'>` | Appends a new cue with a generated UUID. If `life.restCues` is `undefined`, auto-seeds from built-in defaults first. |
| `UPDATE_REST_CUE` | `cue: RestCue` | Replaces the matching cue in-place. Auto-seeds if `restCues` is `undefined`. |
| `DELETE_REST_CUE` | `cueId: string` | Removes the matching cue. Auto-seeds if `restCues` is `undefined`. |
| `REPLACE_REST_CUES` | `cues: RestCue[] \| undefined` | Bulk-replaces the cue list. Pass `undefined` to reset to built-in defaults. |

### 3.8 Removed in v6

- `TOGGLE_TASK_HABIT` — toggled the deprecated `LinkedTask.isHabit`. Removed alongside the flag.
- `backfillHabitsFromLegacy` function (not an action, but invoked from the provider initializer). Removed; v5 backfill has already run for existing users.

(The `TOGGLE_TASK_HABIT` reference in §3.7 of older docs was renumbered to §3.8 when §3.7 was added for True Rest cue actions.)

---

## 4. Migration Chain

Plans stored in `localStorage` include a `_wizardSteps` marker that records the wizard layout version at save time. On load, `migratePlan()` applies transformations:

### v1 → v2: Tasks to Intentions
- **Trigger:** Plan has `tasks` array instead of `intentions`.
- **Transform:** Each v1 `task` becomes an `Intention` with empty `linkedTaskIds`, `brokenDown: false`. (Pre-v6 the migration also wrote `isHabit: false`; that field no longer exists in v6 and is dropped on read.)

### v2/v3 → v4: Intentions to LinkedTasks
- **Trigger:** Plan has `intentions` but no `linkedTasks`/`taskSessions`.
- **Transform:** `linkedTasks` initialized to `[]`, `taskSessions` to `{}`. Old `intentionSessions` are discarded (they referenced intentions, not Todoist tasks).

### v4 → v4.1: estimatedMinutes
- **Trigger:** Plan has `linkedTasks` with missing `estimatedMinutes`.
- **Transform:** Adds `estimatedMinutes: null` to any entry that lacks it.

### v4.1 → v5: schema marker + LifeContext
- **Trigger:** Saved payload missing `_schemaVersion: 5`.
- **Transforms:**
  - The plan shape itself is unchanged; existing `Intention.isHabit` and `LinkedTask.isHabit` flags are kept readable for backwards-compat (deprecated in v5, **removed in v6**).
  - On provider startup, `loadLifeContext()` returns `{ seasons: [], habits: [], activeSeasonId: null }` if the new `orchestrate-life-context` localStorage key is absent.
  - `backfillHabitsFromLegacy()` ran **once** (gated by `LifeContext.backfilledFromIsHabit`) on existing users: it scanned the current plan's intentions and all `history[].plan.intentions` for entries with `isHabit: true` and surfaced them as inactive `Habit` candidates. **Removed in v6.**
  - Persistence stamps `_schemaVersion: 5` onto plan, settings, life-context, and saved-session payloads on every write.
- **Note:** the existing `_wizardSteps` marker is unchanged; v5 introduces `_schemaVersion` as an explicit, additive marker that supersedes the implicit role `_wizardSteps` had been playing.

### v5 → v6: micro-gap refinement + capacity intelligence
- **Trigger:** Saved payload missing `_schemaVersion: 6`.
- **Plan transforms** (`migratePlan`):
  - Strip the deprecated `isHabit` field from every entry in `intentions` and `linkedTasks` on read.
  - Initialize `plan.habitLog` to `[]` if missing.
- **LifeContext transforms** (`loadLifeContext`):
  - For every habit, default `kind` to `'stabilizer'` if missing. This matches pre-v6 behavior (every habit auto-injected; none were light-coherent).
  - Drop `backfilledFromIsHabit` — no longer a field.
- **AppSettings transforms** (`loadSettings`):
  - Inject `taskCapDefaults = { stabilizer: 30, lightCoherent: 20, manualBackground: 30 }` if missing.
  - Inject `sessionBufferMinutes = 60` if missing.
- **Removed**: `Intention.isHabit`, `LinkedTask.isHabit`, `LifeContext.backfilledFromIsHabit`, the `TOGGLE_TASK_HABIT` reducer action, the `backfillHabitsFromLegacy` function (and its call in the provider initializer).
- **Persistence** stamps `_schemaVersion: 6` onto plan, settings, life-context, and saved-session payloads on every write.

### v6 → v6.1: habit-as-task decoupling
- **Trigger:** Saved payload `_schemaVersion < 6.1` (the version is now a JSON float so the comparison is direct).
- **Plan transforms** (`migratePlan`):
  - Build a map `intentionId → sourceHabitId` from any incoming intentions that carry `sourceHabitId`.
  - **Drop habit-derived intentions entirely** from the resulting `intentions` array. Strip `sourceHabitId` and `skippedForToday` fields from any remaining intentions (defensive — they're no longer in the type).
  - **Re-anchor LinkedTasks** whose `intentionId` referenced a dropped habit-derived intention: clear `intentionId`, set `sourceHabitId = <habit id>`, force `type: 'background'`. Existing `assignedSessions` and `taskSessions` references are preserved (the `todoistId` keys haven't changed).
- **LifeContext transforms** (`migrateHabit`, called from `loadLifeContext` AND `IMPORT_BACKUP`, stabilizers only):
  - If `autoLinkTodoistId` is set and `todoistTaskId` is not, copy across.
  - If `maxBlockMinutes` is set and `targetDurationMinutes` is not, copy across.
  - If `windowBehavior` is unset, default to `'lenient'`.
  - The deprecated `autoLinkTodoistId` / `maxBlockMinutes` fields are **stripped from the persisted shape** after copy — storage doesn't accumulate cruft. The fields remain on the `Habit` type as `@deprecated` only so old payloads coming through `IMPORT_BACKUP` still parse.
- **AppSettings:** `habitsTodoistProjectId` is left undefined; created lazily when the user first saves a stabilizer (or hits "Migrate" on the `/habits` page banner).
- **Removed**: `Intention.sourceHabitId`, `Intention.skippedForToday`, the `INJECT_HABIT_INTENTIONS` and `SKIP_HABIT_INTENTION` actions, the `getHabitDerivedIntentionIds` helper. **Renamed**: `INJECT_HABIT_INTENTIONS` → `INJECT_HABIT_TASKS` (new payload), `SKIP_HABIT_INTENTION` → `SKIP_HABIT_TASK`. **Added**: `HabitTaskInjection` type, `LinkedTask.sourceHabitId` / `LinkedTask.skippedForToday`, `Habit.todoistTaskId` / `todoistProjectId` / `targetTime` / `targetDurationMinutes` / `windowBehavior`, `AppSettings.habitsTodoistProjectId`, `TodoistActionsValue.moveTask` (Sync API `item_move`), `lib/habitsTodoistSync.ts` (`buildDueString`, `ensureHabitsProject`, `resolveHabitProjectId`, `syncHabitToTodoist`, `computeHabitTasksToInject`).
- **Persistence** stamps `_schemaVersion: 6.1` onto plan, settings, life-context, and saved-session payloads on every write.

### v6.1 → v6.2: intentions backlog + Todoist unschedule-on-discard
- **Trigger:** Saved payload `_schemaVersion < 6.2`.
- **Plan transforms** (`migratePlan`): none. The plan shape is unchanged.
- **LifeContext transforms** (`loadLifeContext`): default `backlog` to `[]` when missing. (Old entries persisted under v6.2 with completed-task ids mixed into `intention.linkedTaskIds` are not retroactively split; only entries created via `buildBacklogEntry` after this commit have the partition applied.)
- **AppSettings:** no changes.
- **TodoistContext:** `UpdateTaskOpts.due_*` / `duration*` fields widened to `string | null` / `number | null` so the new `unscheduleIntentionTasks` helper can clear scheduling via `{ due_string: 'no date' }`. `JSON.stringify` already round-trips `null` correctly, so no `apiFetch` change is needed.
- **Provider init:** `loadPlan` is removed; `useReducer` initializes from a single coordinated `loadInitialState()` that calls `peekRawPlan()` (parse + migrate without the date gate) and, when the plan's date is stale, calls `harvestStalePlan(plan)` to append rollover `BacklogEntry`s to `life.backlog` and returns a fresh plan. **No automatic `SAVE_DAY`** runs at rollover — `SavedDayPlan` history is manual-only.
- **Added**: `BacklogEntry` type, `LifeContext.backlog`, the three reducer actions (`MOVE_INTENTION_TO_BACKLOG` / `RESTORE_FROM_BACKLOG` / `DELETE_BACKLOG_ENTRY`), `lib/backlog.ts` (`hasUnfinishedWork`, `buildBacklogEntry`, `harvestStalePlan`, `rebuildLinkedTasksForBacklogEntry`), `lib/intentionUnschedule.ts` (`unscheduleIntentionTasks`), `hooks/useIntentionRemoval.ts` (`useIntentionRemoval` hook), `components/ui/ConfirmModal.tsx`, `hooks/useConfirmModal.ts`, `src/components/dashboard/HistorySidebar.tsx` (renamed from `SavedSessions.tsx`), `src/components/dashboard/BacklogTab.tsx`. **Removed**: `loadPlan` helper (folded into `loadInitialState`), `TransitionTips.tsx` (dead code), `getHabitTasksForDay` (dead code). **Moved**: `validateTodoistToken` from `hooks/useTodoist.ts` to `lib/todoistApi.ts`.
- **Persistence** stamps `_schemaVersion: 6.2` onto plan, settings, life-context, and saved-session payloads on every write.

### v6.2 → v6.3: habit/session decoupling + task engagement
- **Trigger:** Saved payload `_schemaVersion < 6.3`.
- **Plan transforms** (`migratePlan`):
  - For every `LinkedTask` with `sourceHabitId`: emit a synthetic `TodaysHabitInstance` into `plan.todaysHabits` with `id: crypto.randomUUID()`, `habitId: sourceHabitId`, `todoistTaskId: lt.todoistId`, `titleSnapshot: lt.titleSnapshot ?? todoistId`, `durationMinutes: lt.estimatedMinutes ?? 30`, `targetTime: undefined`, `status: completed ? 'completed' : skippedForToday ? 'skipped' : 'planned'`.
  - Drop those rows from `plan.linkedTasks`. Prune their ids from every `plan.taskSessions[sessionId]`.
  - For every remaining `LinkedTask`: stamp `status: completed ? 'completed' : 'pending'`. Drop the deprecated `sourceHabitId` / `skippedForToday` fields (no-op if already absent).
  - Initialize `plan.todaysHabits: []` when missing on a non-legacy payload.
- **LifeContext transforms**: none.
- **AppSettings:** no changes.
- **BacklogEntry:** existing entries get `unfinishedTaskRecords: undefined`; the field is populated only by future `MOVE_INTENTION_TO_BACKLOG` dispatches.
- **Removed**: `HabitTaskInjection` type, `INJECT_HABIT_TASKS` / `SKIP_HABIT_TASK` actions, `LinkedTask.sourceHabitId`, `LinkedTask.skippedForToday`, `isHabitDerivedTask` helper, the `HABIT_GROUP_KEY` synthetic grouping in `SessionTimeline`.
- **Added**: `TodaysHabitInstance` / `HabitInstanceStatus` / `EngagementRecord` / `LinkedTaskStatus` types, `DayPlan.todaysHabits`, `LinkedTask.status` / `engagement` / `rescheduledFromTodoistId` / `rescheduledAt`, `BacklogEntry.unfinishedTaskRecords`, the six habit-instance reducer actions (`REFRESH_TODAYS_HABITS`, `START_HABIT_INSTANCE`, `STOP_HABIT_INSTANCE`, `COMPLETE_HABIT_INSTANCE`, `SKIP_HABIT_INSTANCE`, `RESCHEDULE_HABIT_INSTANCE`) and the two task-engagement actions (`START_TASK_ENGAGEMENT`, `STOP_TASK_ENGAGEMENT`), `computeTodaysHabitInstances` and `cloneHabitInstanceForReschedule` in `lib/habitsTodoistSync.ts`, the habit lane in `SessionTimelineBar`, the new `HabitInstanceCard` component, the Phase 2 "Today's habits" panel in `Step3Schedule`, the `✱ Engaged` annotation in `BacklogTab`, the `LinkingProps.habitTodoistIds` field on `TodoistPanel`.
- **Persistence** stamps `_schemaVersion: 6.3` onto plan, settings, life-context, and saved-session payloads on every write.

### Wizard step migration
- **6-step → 5-step** (`_wizardSteps !== 5 && _wizardSteps !== 4`): Steps 2+ shift down by 1.
- **5-step → 4-step** (`_wizardSteps === 5`): Old step 4 (nudges) merges into step 3, old step 5 becomes step 4.
- All steps are clamped to `max: 4`.

### Settings migration
- **Single `googleCalendarId` string** → `googleCalendarIds: GoogleCalendarEntry[]`.
- **String array `googleCalendarIds`** → `GoogleCalendarEntry[]` with `{ id: string }` objects.

---

## 5. localStorage Schema

### 5.1 `orchestrate-day-plan`

```json
{
    "date": "2025-01-15",
    "intentions": [ { "id": "...", "title": "...", "linkedTaskIds": [...], ... } ],
    "linkedTasks": [ { "todoistId": "...", "intentionId": "...", "status": "pending", ... } ],
    "todaysHabits": [ { "id": "...", "habitId": "...", "todoistTaskId": "...", "status": "planned", "targetTime": "07:00", "durationMinutes": 15, ... } ],
    "taskSessions": { "morning": ["task-1", "task-2"], "afternoon": ["task-3"] },
    "wizardStep": 3,
    "setupComplete": false,
    "checkIns": [],
    "habitLog": [],
    "_wizardSteps": 4,
    "_schemaVersion": 6.3
}
```

The `_wizardSteps` field is not part of the `DayPlan` type — it is injected during serialization and read during migration only.

### 5.2 `orchestrate-settings`

```json
{
    "notificationPreference": "both",
    "sessionSlots": [ { "id": "morning", "name": "Morning", "startTime": "09:00", "endTime": "13:00" } ],
    "todoistToken": "<base64 ciphertext>",
    "todoistTokenIV": "<base64 IV>",
    "todoistTokenKey": "<base64 CryptoKey>",
    "googleCalendarIds": [ { "id": "user@gmail.com", "name": "Personal", "color": "#009688" } ],
    "calendarViewMode": "week"
}
```

### 5.3 `orchestrate-history`

```json
[
    {
        "plan": { /* full DayPlan snapshot + _wizardSteps */ },
        "savedAt": "2025-01-15T18:30:00.000Z",
        "label": "Wednesday, Jan 15"
    }
]
```

### 5.4 `orchestrate-todoist-cache`

```json
{
    "tasks": [ { "id": "...", "content": "...", "project_id": "...", ... } ],
    "projects": [ { "id": "...", "name": "...", ... } ],
    "sections": [ { "id": "...", "name": "...", ... } ],
    "fetchedAt": 1705344600000
}
```

### 5.5 `orchestrate-life-context` (v5)

```json
{
    "seasons": [
        {
            "id": "...",
            "name": "Stabilization",
            "startDate": "2026-05-01",
            "endDate": null,
            "primaryTheme": "Sleep, anchor habits, planning consistency",
            "supportingGoals": ["..."],
            "nonGoals": ["..."],
            "successCriteria": "...",
            "capacityBudget": null,
            "active": true
        }
    ],
    "habits": [
        {
            "id": "...",
            "name": "Morning meditation",
            "kind": "stabilizer",
            "recurrence": { "kind": "daily" },
            "minimumViable": "5 min sit",
            "triggerCue": "After waking, before phone",
            "completionRule": "binary",
            "failureTolerance": 1,
            "isAnchor": true,
            "seasonIds": [],
            "active": true,
            "todoistTaskId": "9123456789",
            "todoistProjectId": "2304567890",
            "targetTime": "07:00",
            "targetDurationMinutes": 10,
            "windowBehavior": "lenient",
            "createdAt": "2026-05-07T08:00:00.000Z"
        }
    ],
    "activeSeasonId": "...",
    "restCues": [
        { "id": "walk-5", "label": "Walk 5 minutes — outside if possible", "durationHint": "5 min", "category": "physical" }
    ],
    "backlog": [
        {
            "id": "...",
            "intention": { "id": "...", "title": "Finish assignment 3", "linkedTaskIds": ["..."], "completed": false, "brokenDown": true },
            "archivedAt": "2026-05-16T18:00:00Z",
            "archivedFromDate": "2026-05-15",
            "reason": "rollover",
            "taskSnapshots": { "...": "Edit section 2" },
            "completedTaskTitles": ["Write outline", "Draft section 1"]
        }
    ],
    "_schemaVersion": 6.2
}
```

### 5.6 Auxiliary Keys

| Key | Shape | Written by |
|---|---|---|
| `orchestrate-theme` | `"light"` \| `"dark"` | `useTheme` |
| `orchestrate-active-playlist` | Playlist ID string (e.g. `"deep-focus"`) | `MusicProvider` |
| `orchestrate-custom-playlist-urls` | `Record<string, string>` (playlistId → Spotify URL) | `MusicProvider` |

---

## 6. Todoist Data Lifecycle

This section describes how Todoist data moves through the system from API to UI.

### 6.1 Fetch Cycle

```
Window focus / Initial mount
        │
        ▼
  TodoistProvider
        │
        ├─ Is cache < 5min old?  ──YES──▶  Use cached data, skip fetch
        │
        NO
        │
        ▼
  resolveToken() ──▶ decryptToken(encrypted, iv, key)
        │
        ▼
  fetchAllPages('/tasks')  ──▶  setPaginated tasks
  fetchAllPages('/projects')
  fetchAllPages('/sections')
        │
        ▼
  saveCache(tasks, projects, sections) ──▶ localStorage
```

### 6.2 Deduplication

```
refreshTasks() called
        │
        ├─ inflightRef.tasks !== null?  ──YES──▶  Return existing promise
        │
        ├─ Last fetch < 30s ago?  ──YES──▶  Skip (unless force: true)
        │
        NO
        │
        ▼
  Create promise, store in inflightRef.tasks
  On settle: inflightRef.tasks = null
```

### 6.3 Reconciliation

After the first successful task fetch, two one-time effects run:

**Title snapshot sync:**
```
For each linked task in plan.linkedTasks:
    If Todoist task exists AND title differs from titleSnapshot:
        → dispatch SYNC_TASK_SNAPSHOTS { todoistId: newTitle }
```

**Stale task cleanup:**
```
For each linked task in plan.linkedTasks:
    If task NOT in Todoist response AND NOT marked completed:
        → dispatch TOGGLE_TASK_COMPLETE { todoistId, titleSnapshot }
        (Assumption: task was completed externally in Todoist)
```

### 6.4 Mutation Optimistic Updates

All CRUD mutations update local state immediately (optimistic), then rely on the API call. If the API call fails, an error is set but the local state is not rolled back (this is a known trade-off for simplicity).

| Mutation | Local State Update |
|---|---|
| `createTask` | Appends API response to `tasks` |
| `completeTask` | Filters task from `tasks` (via Sync API `item_complete`) |
| `reopenTask` | Full `refreshTasks({ force: true })` after Sync API call |
| `updateTask` | Replaces task in `tasks` with API response |
| `deleteTask` | Recursively removes task and all descendants from `tasks` |
| `createProject` | Appends API response to `projects` |
| `deleteProject` | Recursively removes project, its tasks, and its sections |

---

## 7. Entity Relationship Diagram

```
                    ┌──────────────┐
                    │  AppSettings │
                    │              │
                    │ sessionSlots─┼──────────────────┐
                    │ todoistToken │                   │
                    │ calendarIds  │                   │
                    └──────────────┘                   │
                                                      │
    ┌─────────────┐       ┌──────────────┐      ┌─────▼──────┐
    │  DayPlan    │       │  Intention   │      │ SessionSlot│
    │             │has-──▶│             │      │            │
    │ date        │  1:N  │ id           │      │ id         │
    │ wizardStep  │       │ title        │      │ startTime  │
    │ setupCompl. │       │ linkedTaskIds│      │ endTime    │
    │ taskSessions├───────│ brokenDown   │      └────────────┘
    │             │       └──────┬───────┘            ▲
    │ checkIns────│──has──┐      │ 1:N                │
    └─────────────┘       │      ▼                    │
                    ┌─────▼──┐  ┌────────────┐        │
                    │CheckIn │  │ LinkedTask │        │
                    │        │  │            │        │
                    │feeling │  │ todoistId  │        │
                    │workType│  │ intentionId│        │
                    │notes   │  │ type       │        │
                    └────────┘  │ assigned ──┼────────┘
                                │  Sessions  │  N:M (main=1:1, bg=1:N)
                                │ completed  │
                                │ estimate   │
                                │ titleSnap. │
                                └──────┬─────┘
                                       │ references
                                       ▼
                                ┌──────────────┐
                                │ TodoistTask  │  (external, from API)
                                │              │
                                │ id           │
                                │ content      │
                                │ project_id───┼──▶ TodoistProject
                                │ section_id───┼──▶ TodoistSection
                                │ parent_id    │
                                │ duration     │
                                └──────────────┘
```

**Key relationships:**
- `Intention` 1→N `LinkedTask` (via `intentionId` back-reference, `linkedTaskIds` forward reference). v6.3: every LinkedTask is intention-bound.
- `Habit` (stabilizer) 1→N `TodaysHabitInstance` per day (v6.3) — via `habitId` back-reference + `todoistTaskId` referencing the shared recurring Todoist task. Multiple instances per habit per day can exist when the user reschedules (predecessor stays in `unfinished`/`skipped`, successor in `planned`).
- `LinkedTask` N↔M `SessionSlot` (via `taskSessions` map and `assignedSessions` array). Constraint: main tasks are 1:1, background tasks (incl. habit-tasks) are 1:N.
- `LinkedTask.todoistId` references `TodoistTask.id` — but `TodoistTask` is ephemeral API data, not persisted in the plan. Only `titleSnapshot` captures a durable copy.
- `DayPlan.taskSessions` is the source of truth for session assignments. `LinkedTask.assignedSessions` is a derived convenience kept in sync by the reducer.
