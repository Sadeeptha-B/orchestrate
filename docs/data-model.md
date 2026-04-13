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
    isHabit: boolean;
}
```

**Relationships:** An intention owns zero or more `LinkedTask` entries. The `linkedTaskIds` array maintains the display order. Toggling an intention's completion cascades to all its linked tasks.

### 1.2 LinkedTask

A Todoist task that has been linked to an intention within Orchestrate's planning model.

```ts
interface LinkedTask {
    todoistId: string;                                    // Todoist task ID (primary key)
    intentionId: string;                                  // parent intention ID
    type: 'main' | 'background' | 'unclassified';        // set in Step 2
    assignedSessions: string[];                           // session slot IDs this task is assigned to
    completed: boolean;
    isHabit: boolean;
    estimatedMinutes: number | null;                      // null = not yet estimated
    titleSnapshot?: string;                               // cached title for display when task is no longer in Todoist
}
```

**Task types:**
- **main** — Primary work thread. Exclusive to one session (assigning removes it from any previous session).
- **background** — Habit or nudge task. Can be assigned to multiple sessions simultaneously. Capped at 30 minutes estimated.
- **unclassified** — Default state after linking. Must be categorized before the user can proceed past Step 2.

**Title fallback chain:** When displaying a task title, components use: `taskMap.get(todoistId)?.content` → `linkedTask.titleSnapshot` → `todoistId` (raw ID as last resort).

### 1.3 DayPlan

The central document representing a single day's plan. Stored in localStorage and reset daily.

```ts
interface DayPlan {
    date: string;                                   // "YYYY-MM-DD" — auto-reset when stale
    intentions: Intention[];                        // ordered list
    linkedTasks: LinkedTask[];                      // all tasks across all intentions
    taskSessions: Record<string, string[]>;         // sessionId → todoistId[] (ordered)
    wizardStep: number;                             // 1–4 (current wizard position)
    setupComplete: boolean;                         // true after Step 4 finish
    checkIns: CheckIn[];                            // hourly check-in records
}
```

**Key invariants:**
- `linkedTasks` is the flat, denormalized list of all linked tasks. Each task's `intentionId` back-references its parent.
- `taskSessions` is a map from session IDs to ordered arrays of Todoist task IDs. This determines what shows in each session card and the task order within it.
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

All state mutations flow through the `DayPlanContext` reducer. The `Action` type is a discriminated union of ~25 variants.

### 3.1 Intention Actions

| Action | Payload | Effect |
|---|---|---|
| `ADD_INTENTION` | `title: string` | Creates a new `Intention` with `crypto.randomUUID()`, appends to list |
| `REMOVE_INTENTION` | `intentionId: string` | Removes intention, all its `LinkedTask` entries, and their session assignments |
| `UPDATE_INTENTION` | `intention: Intention` | Replaces the matching intention in-place |
| `REORDER_INTENTIONS` | `intentionIds: string[]` | Reorders intentions to match the provided ID sequence |
| `TOGGLE_INTENTION_COMPLETE` | `intentionId: string` | Toggles completed flag. **Cascades** to all linked tasks |
| `MARK_BROKEN_DOWN` | `intentionId, brokenDown` | Sets the `brokenDown` flag (Step 1 mapping progress) |

### 3.2 Task Actions

| Action | Payload | Effect |
|---|---|---|
| `LINK_TASK` | `intentionId, todoistId` | Creates a new `LinkedTask` (or moves an existing one to a different intention). Updates both `linkedTasks` and `intentions[].linkedTaskIds` |
| `UNLINK_TASK` | `todoistId` | Removes the `LinkedTask`, cleans up `linkedTaskIds` and `taskSessions` |
| `CATEGORIZE_TASK` | `todoistId, taskType` | Sets `type` to `'main'`, `'background'`, or `'unclassified'` |
| `SET_TASK_ESTIMATE` | `todoistId, minutes` | Sets `estimatedMinutes` |
| `TOGGLE_TASK_HABIT` | `todoistId` | Toggles `isHabit` flag |
| `ASSIGN_TASK` | `todoistId, sessionId` | **Main tasks:** exclusive — removes from all other sessions first. **Background tasks:** additive — just appends to the target session. Updates both `taskSessions` and `linkedTask.assignedSessions` |
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
| `SAVE_DAY` | `label: string` | Creates a `SavedDayPlan` snapshot with `_wizardSteps: 4` marker. Replaces any existing entry for the same date |
| `RESTORE_DAY` | `savedAt: string` | Finds the saved plan by `savedAt`, runs it through `migratePlan()`, sets date to today |
| `DELETE_SAVED_DAY` | `savedAt: string` | Removes the entry from history |
| `IMPORT_SESSIONS` | `sessions: SavedDayPlan[]` | Merges imported sessions, deduplicating by `savedAt` |

---

## 4. Migration Chain

Plans stored in `localStorage` include a `_wizardSteps` marker that records the wizard layout version at save time. On load, `migratePlan()` applies transformations:

### v1 → v2: Tasks to Intentions
- **Trigger:** Plan has `tasks` array instead of `intentions`.
- **Transform:** Each v1 `task` becomes an `Intention` with empty `linkedTaskIds`, `brokenDown: false`, `isHabit: false`.

### v2/v3 → v4: Intentions to LinkedTasks
- **Trigger:** Plan has `intentions` but no `linkedTasks`/`taskSessions`.
- **Transform:** `linkedTasks` initialized to `[]`, `taskSessions` to `{}`. Old `intentionSessions` are discarded (they referenced intentions, not Todoist tasks).

### v4 → v4.1: estimatedMinutes
- **Trigger:** Plan has `linkedTasks` with missing `estimatedMinutes`.
- **Transform:** Adds `estimatedMinutes: null` to any entry that lacks it.

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
    "linkedTasks": [ { "todoistId": "...", "intentionId": "...", ... } ],
    "taskSessions": { "morning": ["task-1", "task-2"], "afternoon": ["task-3"] },
    "wizardStep": 3,
    "setupComplete": false,
    "checkIns": [],
    "_wizardSteps": 4
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

### 5.5 Auxiliary Keys

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
- `Intention` 1→N `LinkedTask` (via `intentionId` back-reference, `linkedTaskIds` forward reference)
- `LinkedTask` N↔M `SessionSlot` (via `taskSessions` map and `assignedSessions` array). Constraint: main tasks are 1:1, background tasks are 1:N.
- `LinkedTask.todoistId` references `TodoistTask.id` — but `TodoistTask` is ephemeral API data, not persisted in the plan. Only `titleSnapshot` captures a durable copy.
- `DayPlan.taskSessions` is the source of truth for session assignments. `LinkedTask.assignedSessions` is a derived convenience kept in sync by the reducer.
