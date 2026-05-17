> **Looking for a high-level overview?** Start at [synthesis.md](./synthesis.md). This document goes deeper on architectural specifics.

# Orchestrate — Architecture Guide

This document describes the architecture of Orchestrate: how the application is structured, how data flows between components, and how external services are integrated. It is intended to be read alongside the companion [Data Model](data-model.md) document.

---

## 1. Technology Stack

| Layer | Technology |
|---|---|
| Framework | React 19 with TypeScript |
| Build tool | Vite 8 |
| Styling | Tailwind CSS v4 (CSS custom properties via `@theme`) |
| Routing | React Router v7 (`BrowserRouter`, basename `/orchestrate/`) |
| State management | React Context + `useReducer` (DayPlan), React Context + `useState` (Todoist, Music) |
| Persistence | `localStorage` (4 primary keys + 3 auxiliary keys) |
| External APIs | Todoist REST API v1, Google Calendar embed, Spotify embed |
| Crypto | Web Crypto API (AES-256-GCM for token encryption) |
| PWA | Service worker with network-first caching strategy |

---

## 2. Provider Tree

Every React component in the app sits inside a nested provider tree. The order matters — each provider may depend on providers above it.

```
StrictMode                         (main.tsx)
└── BrowserRouter (basename: /orchestrate/)   (main.tsx)
    └── App                        (App.tsx — below)
        └── ErrorBoundary
            └── DayPlanProvider          ← core app state (plan, settings, history, life)
                └── TodoistProvider      ← Todoist data + API actions
                    └── AppRoutes        ← router switch
                        ├── Welcome      (hub: when !setupComplete, at /)
                        ├── Wizard       (at /setup)
                        ├── Dashboard    (when setupComplete, at /)
                        ├── LifeView     (at /life)
                        ├── SeasonsManager (at /season)
                        ├── SeasonDetail (at /season/:id)
                        ├── HabitsLibrary (at /habits)
                        ├── RestCuesManager (at /rest-cues)
                        ├── SettingsPage (at /settings)
                        └── UserGuide    (at /guide)
```

**Why this order?**
- `StrictMode` and `BrowserRouter` live in `main.tsx`, wrapping the `<App />` root.
- `ErrorBoundary` is the outermost component in `App.tsx` so a crash in any provider or route is caught gracefully.
- `TodoistProvider` reads `settings` (encrypted token) and `plan` (linked tasks for reconciliation) from `DayPlanProvider`, so it must be nested inside it.

---

## 3. Routing

Orchestrate has nine routes, all defined in the `AppRoutes` component inside `App.tsx`:

| Path | Component | Guard |
|---|---|---|
| `/` | `Dashboard` or `Welcome` | Shows `Dashboard` when `plan.setupComplete === true`, otherwise `Welcome` (hub) |
| `/setup` | `Wizard` | Accessible when `setupComplete` is true (editing) or when navigated from Welcome (`location.state.fromWelcome`) |
| `/life` | `LifeView` | Always reachable. Hub showing active season + anchor habits + all active habits |
| `/season` | `SeasonsManager` | Always reachable. List + create + activate seasons |
| `/season/:id` | `SeasonDetail` | Always reachable. Single-season editor with member-habit list |
| `/habits` | `HabitsLibrary` | Always reachable. CRUD habits with anchor protection |
| `/rest-cues` | `RestCuesManager` | Always reachable. CRUD True Rest cues with category filter pills (All / Physical / Breath / Sensory); inline add/edit forms; Reset to defaults |
| `/settings` | `SettingsPage` | Always reachable. Vertical-tab layout: Integrations, Capacity, Data |
| `/guide` | `UserGuide` | Always reachable. In-app rendering of the v6 user guide (mental model + how-to). Linked from the About modal across Welcome / Dashboard / Wizard. |
| `*` | Redirect to `/` | Catch-all |

Life routes were previously gated on `plan.setupComplete`, but `setupComplete` is a *daily* flag while seasons and habits are *durable*. The gate caused habits to become unreachable on a fresh day until the wizard was completed; it has been removed.

Navigation between screens is done via `react-router-dom`'s `useNavigate()`. The wizard-to-dashboard transition happens when `COMPLETE_SETUP` is dispatched.

---

## 4. Application Lifecycle

A typical user session follows this flow:

```
Welcome → Wizard (4 steps) → Dashboard
             ↑                    │
             └────────────────────┘  (Edit Plan / Recontextualize)
```

### 4.1 Welcome (Home Hub)

Since v5, the landing page (`Welcome.tsx`) is a multi-purpose hub rather than a single "plan your day" CTA. It surfaces:

- **Today card** — plan status (idle / resuming / first-time), primary CTA (`Plan Your Day` / `Resume Planning`) that navigates to `/setup` with `fromWelcome: true`, and the wizard step timeline (driven by `WIZARD_STEPS` in [src/data/wizardSteps.ts](../src/data/wizardSteps.ts)).
- **Life card** — active season summary (linked to `/season/:id`), anchor habits as inline pills, and quick links to `/habits` and `/season`. Surfaces durable v5 state without forcing the user through the wizard first.

Three plan-status modes are still detected (used to choose the status copy and primary CTA label):
1. **First ever visit** — no history, no in-progress plan.
2. **Resuming** — intentions exist or `wizardStep > 1`.
3. **Returning** — history exists but today's plan is fresh.

The hub appears at `/` whenever `plan.setupComplete === false`. Once setup is complete, `/` shows the Dashboard instead. The Life surfaces remain reachable from both.

The top-right fixed controls — About (?), Settings (⚙), ThemeToggle — are rendered by the shared `HeaderControls` component across all surfaces (Welcome, Dashboard, Wizard, LifeShell, UserGuide, SettingsPage). On Welcome they float in a fixed-position container; elsewhere they sit in the header bar alongside page-specific buttons. `HeaderControls` owns the About modal (with a Settings integration hint) and an optional `aboutTriggerRef` so external elements (e.g. Welcome's "Learn what Orchestrate does" link) can programmatically open it. When the user is first-ever (no history, no in-progress plan), an inline "Coming from another browser or device? Restore your data →" hint is shown beneath the "New here?" link; it navigates to `/settings?tab=data` for the cross-browser onboarding flow. The Settings page's "Open Saved Sessions →" hint navigates to `/setup` (where the sidebar lives).

### 4.2 Wizard Flow

The wizard is a 4-step sequential flow. The current step is stored in `plan.wizardStep` (1-indexed) and persists across refreshes.

| Step | Component | Purpose |
|---|---|---|
| 1 | `Step1Intentions` | Define intentions, then sequentially map each to Todoist tasks. **v6.1:** also dispatches `INJECT_HABIT_TASKS` on mount (and re-fires when the Todoist `taskMap` size changes) so today's stabilizer habit-tasks land as orphan LinkedTasks. |
| 2 | `Step2Refine` | Categorize linked tasks as *main* or *background*, set time estimates. **v6.1:** orphan habit-tasks (no `intentionId`) are filtered out — they arrive pre-typed and pre-estimated. |
| 3 | `Step3Schedule` | Two-phase: assign tasks to sessions, then schedule times with Todoist + Calendar. **v6.1:** orphan habit-tasks render under a "🔁 Habits" group inside the selected-session detail; an "Unassigned habits" tray sits above the timeline for any habit-tasks without a resolvable session. |
| 4 | `Step4StartMusic` | Play the "Start Work" playlist and transition to dashboard |

**WizardLayout** wraps every step and provides:
- A collapsible saved sessions sidebar (drag-to-resize via `useResizablePanel`, default open), always available — including while editing.
- A header with a clickable logo (navigates to `/`, which resolves to Dashboard or Welcome based on `setupComplete`), step progress bar, clickable step navigation pills, and `HeaderControls` (About, Settings, ThemeToggle).
- Back/Next footer buttons with `canAdvance` gating.
- An "editing" mode for when the user returns to the wizard from the dashboard.

### 4.3 Dashboard

The dashboard (`Dashboard.tsx`) is the main operational view. It is organized into these sections:

1. **Header** — Logo, completion counter, Save/Edit/Saved Sessions buttons, and `HeaderControls` (About, Settings, ThemeToggle).
2. **Music row** — `PlaylistSelector` (6 work-type buttons) + `DigitalClock`.
3. **Player row** — `SpotifyPlayer` (embedded iframe) + `InsightCard` (cycles between Transition Tips and a True Rest cue every 2 min; manual `›` button resets the timer).
4. **Timeline + side rail** — `SessionTimeline` (visual bar with assigned tasks). Side rail: `SeasonContextCard` only.
5. **Between-session True Rest banner** (v6) — `TrueRestCard variant='banner'` when no session is active AND the next slot is within 60 min.
6. **Current Session** — `CurrentSession` card with drag-to-reorder tasks, completion checkboxes, plus the v6 remaining-time `SessionCapacityBadge` and (if over-capacity) `SessionCapacityBanner`. v6.1: tasks group by intention, with orphan habit-tasks falling into a synthetic "🔁 Habits" header at the top of the card.
7. **Light Pool (v6)** — collapsible `LightPoolPanel` listing today's light-coherent habits scoped to the active season; Start/Complete writes to `plan.habitLog`.
8. **Task Manager** — Collapsible `TodoistPanel` in full mode.
9. **Calendar** — Collapsible `GoogleCalendarEmbed`.

The dashboard can return to the wizard at any time:
- **Edit Plan** → goes to Step 1 with `editingStep = 1`.
- **Recontextualize** → goes to Step 3 with `editingStep = 3` (triggered from check-in modal).

---

## 5. State Management

Orchestrate has three independent state contexts. Each serves a distinct domain and is designed to minimize cross-context coupling.

### 5.1 DayPlanContext — Core Application State

**File:** `src/context/DayPlanContext.tsx`

This is the heart of the application. It manages:
- **`plan`** — today's `DayPlan` (intentions, linked tasks, task-session assignments, wizard step, check-ins).
- **`settings`** — persistent `AppSettings` (notification preference, session slots, encrypted Todoist token, Google Calendar config).
- **`editingStep`** — tracks whether the user is re-editing from the dashboard (`number | null`).
- **`history`** — array of `SavedDayPlan` entries for past sessions.
- **`life`** — persistent `LifeContext` (seasons, habits, activeSeasonId) — added in v5.

**Architecture:** `useReducer` with a ~45-action discriminated union. **v6.2:** state is initialized lazily via a single coordinated `loadInitialState()` helper that calls `peekRawPlan()` + `loadLifeContext()` + `loadHistory()` + `loadSettings()` and handles day-rollover migration in one place. Four `useEffect` hooks persist each slice back to `localStorage` on every change.

**Plan date freshness + rollover (v6.2):** `peekRawPlan()` returns the parsed/migrated plan without a date gate. If `parsed.date !== todayISO()`, `loadInitialState` runs `harvestStalePlan(plan)` to compute `BacklogEntry[]` for intentions where at least one intention-bound (non-habit) linked task is uncompleted, appending them to `life.backlog` with `reason: 'rollover'`. The returned plan is fresh. `SavedDayPlan` history is left untouched — there is no automatic EoD save; the backlog already preserves the meaningful unfinished part of yesterday, so a separate snapshot would be redundant. Manual `SAVE_DAY` remains the only way to add to history. Auto-rollover deliberately does NOT touch Todoist either — yesterday's scheduled tasks remain visibly overdue there.

**Migration chain:** Plans are stored with a `_wizardSteps` marker (legacy) and, since v5, an explicit `_schemaVersion` marker (now `6.3`, a JSON float). On load, `migratePlan()` runs the chain: v1 (tasks) → v2 (intentions) → v3 (intentionSessions) → v4 (linkedTasks + taskSessions) → v4.1 (estimatedMinutes) → v5 (no plan-shape change; `LifeContext` is loaded separately) → v6 (strips the deprecated `isHabit` flags; initializes `plan.habitLog: []` if missing; defaults each habit's `kind` to `'stabilizer'`; injects `taskCapDefaults` and `sessionBufferMinutes`) → v6.1 (drops habit-derived intentions and re-anchors their LinkedTasks as orphans with `sourceHabitId` + `type: 'background'`; `autoLinkTodoistId` → `todoistTaskId`, `maxBlockMinutes` → `targetDurationMinutes`, `windowBehavior` defaults to `'lenient'`) → v6.2 (stamps the marker; defaults `backlog` to `[]`) → **v6.3** (stabilizers leave `linkedTasks` entirely: any row with `sourceHabitId` becomes a synthetic `TodaysHabitInstance` on `plan.todaysHabits` with `status` set from `completed` / `skippedForToday`, then dropped from `linkedTasks` and pruned from `taskSessions`; every remaining LinkedTask gets a `status` mirror of `completed`; `freshPlan()` adds `todaysHabits: []`). Schema `6.3` stamps `_schemaVersion: 6.3` onto plan, settings, life, and saved-session payloads on every persist.

**Cross-slice invariants** the reducer enforces (v5 + v6 + v6.1 + v6.2 + v6.3):
- Activating a season auto-deactivates the previously active one.
- Deleting a season clears its id from any habit's `seasonIds`.
- Anchor habits cannot be deleted while active (`DELETE_HABIT` no-ops; the UI offers to deactivate first).
- Deleting a habit also drops any `TodaysHabitInstance` rows for that habit from `plan.todaysHabits` (v6.3; was: drops orphan habit-tasks from `plan.linkedTasks` in v6.1/6.2).
- `REFRESH_TODAYS_HABITS` (v6.3, replaces `INJECT_HABIT_TASKS`) is idempotent — it skips habits whose `id` is already present on a `TodaysHabitInstance`. The action's payload (`TodaysHabitInstance[]`) is precomputed by `lib/habitsTodoistSync.ts → computeTodaysHabitInstances(...)` from the live Todoist `taskMap`; only stabilizer habits with a `todoistTaskId` whose Todoist task is due today + unchecked qualify. Light-coherent habits never appear here.
- Habit instance lifecycle actions (v6.3): `START_HABIT_INSTANCE` / `STOP_HABIT_INSTANCE` accumulate engagement minutes; `COMPLETE_HABIT_INSTANCE` flips status to `completed` and the caller fires `actions.completeTask` to close the Todoist occurrence; `SKIP_HABIT_INSTANCE` flips status to `skipped` (instance kept so `REFRESH_TODAYS_HABITS` won't re-add it the same day). `RESCHEDULE_HABIT_INSTANCE` flips the predecessor to `unfinished` (if engagement exists) or `skipped` and appends a successor with `rescheduledFromId` set — **no Todoist write**, so the recurring task stays clean.
- `TOGGLE_TASK_COMPLETE` (modified v6.3) also sets `status = completed ? 'completed' : 'pending'` and closes any open engagement record. `START_TASK_ENGAGEMENT` / `STOP_TASK_ENGAGEMENT` are explicit user actions; engagement minutes accumulate across cycles.
- Light-coherent habits surface only via the Light Pool, which writes to `plan.habitLog` and never touches `intentions`/`linkedTasks`/`taskSessions`/`todaysHabits`.
- **`MOVE_INTENTION_TO_BACKLOG`** (v6.2) mirrors `REMOVE_INTENTION`'s plan-side cleanup (scrubs `plan.linkedTasks` + `plan.taskSessions`) and additionally appends a `BacklogEntry` to `life.backlog`. `buildBacklogEntry` splits the intention's linked tasks: completed ones drop from `linkedTaskIds` (their titles go into `completedTaskTitles` for context); pending ones round-trip with `titleSnapshot`s in `taskSnapshots`. **v6.3**: pending tasks with an `engagement` record additionally drop the record into `unfinishedTaskRecords`.
- **`RESTORE_FROM_BACKLOG`** (v6.2) is idempotent against re-adds. **v6.3**: rebuilt LinkedTasks for ids in `entry.unfinishedTaskRecords` are stamped with `rescheduledFromTodoistId` + `rescheduledAt` and `status: 'pending'`. The engagement record stays on the BacklogEntry as a read-only memo (the entry is consumed by restore, so engagement is visible only at the restore moment).
- **`DELETE_BACKLOG_ENTRY`** (v6.2) is pure; the caller (`useIntentionRemoval().discardFromBacklog`) is responsible for the Todoist unschedule.
- **Intention removal Todoist side-effect** (v6.2): all paths that remove an intention from today — `REMOVE_INTENTION`, `MOVE_INTENTION_TO_BACKLOG`, `DELETE_BACKLOG_ENTRY` — route through the `useIntentionRemoval()` hook, which calls `unscheduleIntentionTasks(...)` *before* dispatching. Auto-rollover into the backlog is the deliberate exception: yesterday's tasks remain scheduled in Todoist so they show up as overdue. v6.3: the prior `sourceHabitId` skip in `unscheduleIntentionTasks` is structurally unreachable since habit tasks no longer live in `linkedTasks`.

See the [Data Model](data-model.md) document for the full action catalog and type definitions.

### 5.2 TodoistContext — External Data Layer

**File:** `src/context/TodoistContext.tsx`

Manages all Todoist API data and mutations. Split into two contexts for render optimization:

- **`TodoistDataContext`** — read-only values: `tasks`, `projects`, `sections`, `taskMap`, `loading`, `error`, `isConfigured`, `authFailed` (post-v6.1; true when any API call returned HTTP 401, resets when the token changes).
- **`TodoistActionsContext`** — mutation functions: `createTask` (returns the created `TodoistTask | null`), `updateTask`, `moveTask` (v6.1; Sync API `item_move`, returns success boolean), `completeTask`, `reopenTask`, `deleteTask`, `createProject` (returns the created `TodoistProject | null`), `deleteProject`, `refreshTasks`, `refreshProjects`, `refreshSections`. v6.1: `createTask` / `updateTask` accept Todoist's native `due_string` + `due_lang` + `duration` / `duration_unit` (used by `lib/habitsTodoistSync.ts` to push recurrence to the chosen Habits project). **v6.2:** `UpdateTaskOpts`'s `due_*` and `duration*` fields are now `string | null` / `number | null` so callers can pass `null` (or the documented `due_string: 'no date'`) to clear scheduling — used by `unscheduleIntentionTasks` in the intentions-backlog flow.

**Key behaviors:**
1. **Stale-while-revalidate**: On mount, if a cached copy exists in `localStorage` (key: `orchestrate-todoist-cache`) and is less than 5 minutes old, it is used without fetching. Otherwise, a fresh fetch is triggered.
2. **Request deduplication**: In-flight requests are tracked via `inflightRef`. Concurrent calls to `refreshTasks()` return the same promise.
3. **Focus refresh**: A `window.focus` listener refreshes tasks AND projects (post-v6.1; was tasks-only). Both dedupe internally via the 30s staleness window. Sections are skipped — they're static enough to not warrant refetching on every focus.
4. **Loading UX**: The `loading` flag only activates when there is no cached data. This prevents flash-of-loading-state on subsequent fetches.
5. **Data reconciliation**: Two one-time effects run after the first fetch:
   - *Title snapshot sync* — updates `titleSnapshot` on `LinkedTask` entries when the Todoist title has changed.
   - *Stale task cleanup* — marks linked tasks as completed if they no longer appear in the Todoist API response (i.e., were completed externally).
6. **401 detection (post-v6.1)**: `apiFetch` throws a `TodoistAuthError` on `res.status === 401`. A single `handleApiError` helper inside the provider routes 401s to `setAuthFailed(true)` and a "reconnect in Settings" error message; non-auth errors fall through to each call-site's specific fallback. `authFailed` resets when the token is replaced or cleared. `TodoistSetup` renders a top banner when `authFailed && isConfigured` and flips the status badge from "Connected" to "Token rejected".

**Consumer hooks** (`src/hooks/useTodoist.ts`):
- `useTodoistData()` — for components that only read data (most wizard steps, SessionTimeline, CheckInModal).
- `useTodoistActions()` — for components that mutate data (TodoistPanel).

### 5.3 MusicContext — Playlist Selection

**File:** `src/components/dashboard/MusicPanel.tsx`

A lightweight context scoped to the `MusicProvider` wrapper inside the dashboard. Manages:
- Active playlist ID (persisted to `orchestrate-active-playlist`).
- Custom Spotify URLs per playlist (persisted to `orchestrate-custom-playlist-urls`).
- Suggested playlist ID derived from the most recent check-in's `playlistSuggested`.

This context is not used outside the dashboard.

---

## 6. Component Architecture

### 6.1 Shared UI Components

Located in `src/components/ui/`:

| Component | Purpose |
|---|---|
| `Button` | Styled button with `variant` (primary, secondary, ghost) and `size` (sm, md) props |
| `Card` | Rounded border card container |
| `Modal` | Overlay dialog with backdrop, title, and close button |
| `ProgressBar` | Step progress indicator for the wizard |
| `ErrorBoundary` | React error boundary with fallback UI |
| `EditableTaskList` | Reusable list with inline rename, drag-and-drop reorder, and remove — dispatches to `DayPlanContext` |
| `SessionTimelineBar` | Visual timeline bar rendering sessions as positioned blocks with assigned task pills. Dual mode: interactive (clickable, used in Step 3) vs display (used in dashboard) |
| `Logo` | App favicon `<img>` with overridable className. Sole owner of the `import.meta.env.BASE_URL + 'favicon.svg'` URL pattern |
| `ThemeToggle` | Self-contained light/dark toggle button (consumes `useTheme`); `size: 'sm' \| 'md'` prop |
| `formStyles` | Shared `inputClass` / `labelClass` Tailwind strings used by `HabitForm`, `SeasonForm` |

### 6.2 TodoistPanel

**File:** `src/components/todoist/TodoistPanel.tsx`

The most complex component. Used in four places with different configurations:

| Location | Mode | Features |
|---|---|---|
| Step 1 (mapping) | `full` | Linking mode active, full task tree |
| Step 2 (refine) | `full` | Linking mode, filter toggle |
| Step 3 phase 2 | `compact` | Read-only, filtered to linked tasks |
| Dashboard | `full` | Filter toggle, default filtered |

**Capabilities:**
- Renders a project → section → task tree hierarchy.
- **Linking mode** — when `linking` prop is provided, each task shows Link/Unlink buttons to associate with an intention. v6.1: rows whose `todoistId` matches an orphan habit-task's `LinkedTask.sourceHabitId` render a non-actionable "🔁 Habit" label instead, since habit-tasks aren't bound to user intentions.
- **Inline editing** — click a task title to edit, Enter to commit (calls `updateTask`).
- **Completion** — checkbox with confetti animation via `canvas-confetti`. Wraps the Todoist API call with local state updates for linked tasks.
- **Filter toggle** — switches between showing all tasks or only linked tasks.
- **Stale task handling** — delete and complete wrappers check if a task is linked and dispatch `UNLINK_TASK` or `TOGGLE_TASK_COMPLETE` as needed.
- **Estimate auto-fill** — when linking, if the Todoist task has a `duration`, auto-dispatches `SET_TASK_ESTIMATE`.

### 6.3 Hourly Check-In System

**Trigger:** `useHourlyCheckin` hook fires on each whole hour (e.g., 10:00, 11:00) if the user is within an active session and setup is complete.

**Flow:**
1. Hook sets `showCheckin = true` and optionally sends an OS notification.
2. `CheckInModal` renders with feeling selector, work type picker, and playlist suggestion.
3. On submit, dispatches `ADD_CHECKIN` with the check-in data. The suggested playlist ID feeds into `MusicContext.suggestedId`.
4. A "Reschedule Sessions" button can send the user back to Step 3 via `onRecontextualize`.
5. **v6:** when `feeling ∈ {struggling, stuck}` or `workType ∈ {low-energy, restless}`, the modal additionally surfaces 1–2 Light Pool rows (via `getLightPoolHabits`) and a single `TrueRestCard variant='inline'` between the playlist suggestion and the notes field. When `feeling === 'stuck'`, an extra one-line "What exactly are you avoiding?" input appears; its value is persisted as `CheckIn.avoidanceNote` in `buildCheckIn`.

### 6.4 Light Pool (v6)

**Files:** `src/components/dashboard/LightPoolPanel.tsx` (Dashboard surface), `src/components/life/LightPoolSection.tsx` (`/life` surface), `src/lib/habits.ts → getLightPoolHabits`.

**Data flow:**
- `getLightPoolHabits(life, dateISO)` filters `life.habits` to `{ active, kind === 'light-coherent', habitMatchesDate(today), seasonIds.length === 0 || seasonIds.includes(activeSeasonId) }`.
- `LightPoolPanel` renders the filtered list with per-row Start / Done / Delete affordances dispatching the three new reducer actions: `LOG_HABIT_START`, `LOG_HABIT_COMPLETE`, `DELETE_HABIT_LOG_ENTRY`.
- Log entries (`HabitLogEntry`) live on `plan.habitLog` and never touch `intentions` / `linkedTasks` / `taskSessions`. They are wiped daily with the rest of the plan.
- `LightPoolSection` on `/life` shows today's roster plus a weekly cadence count per habit, computed from `plan.habitLog` + the last 7 days of `history[].plan.habitLog`. The soft target is `habit.recurrence.timesPerWeek` when set.

### 6.5 True Rest (v6+)

**Files:** `src/data/restCues.ts` (built-in catalog), `src/components/dashboard/TrueRestCard.tsx` (three variants), `src/components/life/RestCuesManager.tsx` (management page at `/rest-cues`).

**Catalog:** 8 built-in cues across `physical | breath | sensory` categories, defined in `src/data/restCues.ts`. User-configurable: custom cues are stored as `life.restCues?: RestCue[]` in `LifeContext`. When `life.restCues` is `undefined`, the built-in defaults are used. On the first add/edit/delete, the reducer auto-seeds `life.restCues` from the defaults so no explicit "Customize" step is needed.

**`InsightCard` (Dashboard player row):** A consolidated side-card that alternates between the static Transition Tips cheat-sheet and a True Rest recovery cue on a 2-minute auto-cycle. State is driven by a step counter (even = tips, odd = rest cue); each `setInterval` tick or manual `›` click increments the step and resets the timer. The cue index is `Math.floor(step / 2) % cues.length`, so every rest-mode appearance shows the next cue in the catalog. The content area is wrapped in a `flex flex-col min-h-[6rem]` container so the card height stays consistent across both views.

**`TrueRestCard` variants:** The original `card` variant has been replaced by `InsightCard` (see above). Only `inline` (check-in modal, low-energy states) and `banner` (between-session prompt when next slot is within 60 min) remain in use. Both are read-only — no skip button.

**Management page (`/rest-cues`):** `RestCuesManager` uses `LifeShell` with a breadcrumb. A single `Card` hosts filter pills (All / Physical / Breath / Sensory) and a flat list of cues. Each category has a distinct left-border accent color. Edit/Delete actions are hover-revealed per row. Add form appears inline at the top of the list. "Reset to defaults" (only shown when customized) dispatches `REPLACE_REST_CUES(undefined)`.

True Rest is intentionally not a Habit: no logging, no streak, no completion. It's a gentle prompt and nothing else.

### 6.6 Session Capacity Arithmetic (v6)

**Files:** `src/lib/capacity.ts`, `src/components/dashboard/SessionCapacityBadge.tsx`, `src/components/dashboard/SessionCapacityBanner.tsx`.

**Computation:** `computeSessionCapacity(session, taskSessions, linkedTasks, settings, now?)` returns `{ totalMinutes, bufferMinutes, assignedMinutes, remainingMinutes, percentUsed, status, isCurrent }`. Status: `'ok'` at < 100%, `'tight'` at ≥ 100%, `'over'` at > 150%. Mid-session: `totalMinutes` shrinks to remaining wall-clock time and the buffer shrinks proportionally.

**Settings:** `AppSettings.sessionBufferMinutes` (default 60). Editable on the Settings page (`/settings?tab=capacity`) via `CapacitySettings.tsx`.

**Surfaces:**
- Step 3 Phase 1 (`SessionTimelineBar` with `capacities` prop): per-session `SessionCapacityBadge` inside each block. `SessionCapacityBanner` above the timeline if any session is `over`. Never blocks `canAdvance`.
- Dashboard `CurrentSession`: remaining-time `SessionCapacityBadge` pill + banner when the active session is `over`. Calculation uses `now`, so the badge ticks down as the user works.

Background tasks count once per assignment: a 20-min background task assigned to two sessions counts 20 min against each.

### 6.7 Habit-Task Sync + TodaysHabitInstance lifecycle (v6.1 + v6.3)

**Files:** `src/lib/habitsTodoistSync.ts`, `src/components/dashboard/HabitInstanceCard.tsx`, `src/components/life/HabitForm.tsx`, `src/components/life/HabitsLibrary.tsx`, `src/components/wizard/Step1Intentions.tsx`.

**Sync layer (v6.1, unchanged in v6.3):**

- **`buildDueString(habit)`** — translates `Habit.recurrence` + `Habit.targetTime` into a Todoist `due_string`. Examples: `"every day at 7:00"`, `"every weekday"`, `"every mon, wed, fri at 18:30"`.
- **`ensureHabitsProject({ actions, settings, projects, onUpdateSettings })`** — resolves `AppSettings.habitsTodoistProjectId`, falling back to a search for an existing project named `"Habits"`, otherwise lazily creates one. **Always invoke once per batch** to avoid stale-closure project creation.
- **`resolveHabitProjectId(habit, defaultProjectId, projects)`** — returns `habit.todoistProjectId` when it's set and the project still exists, otherwise the workspace default.
- **`syncHabitToTodoist({ habit, projectId, actions, taskMap })`** — for stabilizers only. Creates / updates / moves the recurring Todoist task. Returns the resulting `todoistTaskId | null`.

**Day-of layer (v6.3, replaces the old `computeHabitTasksToInject`):**

- **`computeTodaysHabitInstances({ life, plan, taskMap, now, taskCaps })`** — returns `TodaysHabitInstance[]` for the `REFRESH_TODAYS_HABITS` action. Filters: active stabilizer + recurrence matches today + season scope OK + `todoistTaskId` set + Todoist task is due today + unchecked + (if `windowBehavior === 'strict'`) current time ≤ `targetTime + duration`. Idempotent against habits already in `plan.todaysHabits`. **No session auto-assignment** — `targetTime` comes from the Todoist `due.date` time-of-day if present, else `habit.targetTime`. Each emitted instance has `id: crypto.randomUUID()`, `status: 'planned'`.
- **`cloneHabitInstanceForReschedule(predecessor, newTargetTime, nowISO)`** — pure helper returning a successor instance with `rescheduledFromId` set. Used internally by `RESCHEDULE_HABIT_INSTANCE`; exposed for callers that want to build the clone first and dispatch separately.

**Lifecycle:**
- **On habit save** (`HabitsLibrary`): `ensureHabitsProject` + `syncHabitToTodoist` push the recurring Todoist task. Same as before v6.3.
- **On Step 1 wizard mount**: dispatches `REFRESH_TODAYS_HABITS` from `computeTodaysHabitInstances`. Re-fires when `taskMap.size`, `life.habits`, `life.activeSeasonId`, or `plan.todaysHabits` change. The reducer is idempotent.
- **On dashboard**: the `HabitInstanceCard` exposes per-row Start / Stop / Complete / Skip / Reschedule controls. Complete additionally calls `actions.completeTask(todoistTaskId)` to close the recurring task's current occurrence in Todoist.
- **Reschedule semantics**: `RESCHEDULE_HABIT_INSTANCE` flips the predecessor to `unfinished` (engaged) or `skipped` (untouched) and appends a successor with the new `targetTime`. **No Todoist write** — the recurring task's `due_string` stays unchanged so Todoist's recurrence engine is unbothered.

**Lifecycle:**
- **On habit save** (`HabitsLibrary` → `handleCreate` / `handleEdit`): dispatches `ADD_HABIT` / `UPDATE_HABIT` first, then resolves the default project via `ensureHabitsProject` once, then `syncHabitToTodoist` with the per-habit-resolved project. `syncStabilizer` self-heals two stale-reference cases on success via a single follow-up `UPDATE_HABIT`: (a) if `syncHabitToTodoist` returned a new `todoistTaskId` (covers the case where the previously-tracked Todoist task was deleted out-of-band and the helper fell through to the create branch), and (b) if `habit.todoistProjectId` pointed at a project that no longer exists (the helper silently fell back to default via `resolveHabitProjectId`, so we clear the dead override here). Sync failures show a non-blocking inline message; the habit stays saved locally.
- **On `/habits` page load**: `HabitsLibrary` shows a single "needs sync" banner whose copy adapts to two underlying conditions: stabilizers that have never been synced (`!todoistTaskId`) and stabilizers whose previously-synced Todoist task has gone missing in the cache (`todoistTaskId` set but absent from `taskMap`, guarded by `taskMap.size > 0` so cold cache doesn't false-positive). Copy variants:
  - all-new → "*N stabilizers need to be synced as recurring Todoist tasks*"
  - all-missing → "*N stabilizers have a Todoist task that's gone missing — re-sync to recreate it*"
  - mixed → "*N stabilizers need syncing (X new, Y missing in Todoist)*"
  The primary button label flips between "Migrate" and "Re-sync" accordingly. The banner names the destination project inline and exposes a **Choose project** ghost button that navigates to `/settings?tab=integrations` so the user can pick a default before migrating. The primary action resolves the default project once before iterating (the v6.1 fix that prevents re-creating a duplicate project per habit) and bulk-runs `syncHabitToTodoist`. Re-sync just works because the helper's `taskMap.get(habit.todoistTaskId)` returns undefined for missing tasks and falls through to the create branch automatically.
- **Habit-save lockout during migration (post-v6.1)**: while `migrating` is true, the **New Habit** button + per-row **Pause/Activate**, **Edit**, **Delete** buttons are all disabled. Migration is user-initiated (not a background sync), so the simple lockout was preferred over a mutex; it eliminates the race where a concurrent `handleCreate` would re-invoke `ensureHabitsProject` in parallel with the loop.
- **Default project picker**: `TodoistSetup` (Settings → Integrations) renders a dropdown of the user's Todoist projects, persisted to `AppSettings.habitsTodoistProjectId`. Leaving it on "Auto-create" defers to `ensureHabitsProject`'s lazy-create flow. A **↻ Refresh projects** affordance next to the heading triggers `actions.refreshProjects({ force: true })` so users who just created a project in Todoist can pick it without reloading. When the stored `habitsTodoistProjectId` references a project that no longer exists in the loaded list, a stale-default warning banner appears with a **Clear** button; the select also shows the "Auto-create" option as the displayed value so the UI matches what the next save will actually do.
- **Per-habit project override**: `HabitForm` (stabilizer-only Schedule section) renders the same project dropdown with a "Use default" option. Persisted to `Habit.todoistProjectId`. Editing this on an already-synced habit causes the next save to move the existing Todoist task into the new project. The form receives an `onRefreshProjects` / `refreshingProjects` pair from `HabitsLibrary` and renders the same **↻ Refresh** affordance. When `initial.todoistProjectId` doesn't match any current project, a stale-override warning is rendered above the select and the displayed value falls back to "Use default" so the UI reflects the post-save state.
- **On Step 1 wizard mount**: `Step1Intentions` calls `computeHabitTasksToInject(...)` and dispatches `INJECT_HABIT_TASKS`. Re-fires when the Todoist `taskMap.size`, `life.habits`, `life.activeSeasonId`, `plan.linkedTasks`, or `settings.sessionSlots` / `settings.taskCapDefaults` change. The reducer is idempotent — redundant dispatches are harmless no-ops.

### 6.8 Intentions Backlog (v6.2)

**Files:** [src/lib/backlog.ts](../src/lib/backlog.ts), [src/lib/intentionUnschedule.ts](../src/lib/intentionUnschedule.ts) (pure helper), [src/hooks/useIntentionRemoval.ts](../src/hooks/useIntentionRemoval.ts) (hook), [src/components/dashboard/HistorySidebar.tsx](../src/components/dashboard/HistorySidebar.tsx), [src/components/dashboard/BacklogTab.tsx](../src/components/dashboard/BacklogTab.tsx), [src/components/ui/EditableTaskList.tsx](../src/components/ui/EditableTaskList.tsx), [src/components/wizard/Step3Schedule.tsx](../src/components/wizard/Step3Schedule.tsx).

**Pure helpers in `lib/backlog.ts`:**
- `hasUnfinishedWork(intention, plan)` — true iff the intention has any intention-bound (non-habit), non-completed `LinkedTask`. Empty-linked-task intentions return false.
- `buildBacklogEntry(intention, plan, reason)` — snapshots an intention into a `BacklogEntry`. **Splits tasks into pending vs completed:** pending ids stay on `intention.linkedTaskIds` (with their `titleSnapshot`s in `taskSnapshots`); completed tasks are stripped from `linkedTaskIds` and only their titles ride along in `completedTaskTitles` as read-only context. This prevents a completed Todoist task from being rebuilt as a fresh `unclassified` LinkedTask on restore — which would otherwise render as "stale" in Step 2 since completed Todoist tasks are absent from the active REST API cache.
- `harvestStalePlan(plan)` — produces `BacklogEntry[]` for all intentions with unfinished work, marked `reason: 'rollover'`.
- `rebuildLinkedTasksForBacklogEntry(entry, taskCache)` — reconstructs fresh `LinkedTask` rows on restore (`type: 'unclassified'`, no estimate, no assignment, not completed) **only for the pending ids in `entry.intention.linkedTaskIds`**. Completed tasks (captured in `completedTaskTitles`) are not rebuilt. Title resolution: `taskCache[id]` (live Todoist) → `entry.taskSnapshots?.[id]` (archived) → undefined (id is the last-resort label).

**Unschedule pure helper in `lib/intentionUnschedule.ts`:**
- `unscheduleIntentionTasks(todoistIds, linkedTasks, actions, taskMap)` — per id: skip habit-derived (`sourceHabitId` set), skip missing-from-cache, skip already-unscheduled (`!t.due`); otherwise `actions.updateTask(id, { due_string: 'no date' })`. Runs calls in parallel via `Promise.allSettled`. Errors logged but never block.

**Hook in `hooks/useIntentionRemoval.ts`:**
- `useIntentionRemoval()` — the single boundary for intention removal. Three operations: `moveToBacklog(intentionId)`, `removeIntention(intentionId)`, `discardFromBacklog(backlogId)`. Each unschedules first, then dispatches.

**Lifecycle:**

- **Day rollover** (`loadInitialState` in `DayPlanContext`): when `peekRawPlan()` returns a plan with `date !== todayISO()`, append `harvestStalePlan(plan)` to `life.backlog` and return a fresh plan. No auto-save to `history` — `SavedDayPlan` is manual-only. **Does not touch Todoist** — yesterday's due dates remain in place so the user sees their overdue items in Todoist.
- **Manual move-to-backlog** (`📥` button in `EditableTaskList` row or Step 3 overview panel): `useIntentionRemoval().moveToBacklog(intentionId)` → unschedule Todoist tasks → dispatch `MOVE_INTENTION_TO_BACKLOG`.
- **Manual delete** (`🗑` button + confirm modal): `useIntentionRemoval().removeIntention(intentionId)` → unschedule → dispatch `REMOVE_INTENTION`. **This fixes the v6.1 bug** where deleted intentions left their Todoist tasks scheduled.
- **Bring to today** ("Bring to today" button in `BacklogTab`): build a `taskCache` from live `taskMap`, dispatch `RESTORE_FROM_BACKLOG`. Reducer reconstructs fresh `LinkedTask` rows for the entry's pending ids only; user re-flows them through Step 2 + Step 3. If `plan.setupComplete === false`, the handler also navigates to `/setup`.
- **Discard from backlog** ("Discard" button + confirm modal): `useIntentionRemoval().discardFromBacklog(backlogId)` → unschedule → dispatch `DELETE_BACKLOG_ENTRY`.

**Sidebar UX:**

`HistorySidebar` (renamed from `SavedSessions.tsx`) is a controlled-tab container — parent (Dashboard or WizardLayout) holds `{ panelOpen, panelTab }` state and passes `tab` + `onTabChange` to the sidebar. Both surfaces expose a single `Work Items` header button (count suffix when `life.backlog.length > 0`) that toggles `panelOpen`. The Saved Sessions vs Backlog selection lives entirely inside the sidebar's own tab toggle — header-level surfaces were initially duplicated (one button per tab) but collapsed to one to avoid two UI affordances pointing at the same panel.

The `BacklogTab` row renders the intention title + `{N} pending · from <date> · <reason>` line, with an optional `✓ Done: {titles}` annotation below (sourced from `entry.completedTaskTitles`, truncated with a hover tooltip showing the full list).

**Step 3 overview panel:** a compact "Today's intentions (N)" list at the top of Phase 1, each row with the intention title, task count, and `📥` / `🗑` icon buttons (hover-revealed). The overcommitment-realization moment now has an in-place affordance.

---

## 7. External Integrations

### 7.1 Todoist API

- **API version:** REST API v1 (paginated).
- **Auth:** Personal API token encrypted with AES-256-GCM via Web Crypto API. The encrypted token, IV, and key are stored separately in `AppSettings`.
- **Dev proxy:** In development, requests go through Vite proxy at `/api/todoist/api/v1` to avoid CORS issues. In production, requests go directly to `https://api.todoist.com/api/v1`.
- **Operations:** Full CRUD for tasks and projects. Completion and re-opening use the Sync API endpoint (`/sync` with `item_complete`/`item_uncomplete` commands).
- **Pagination:** `fetchAllPages()` follows `next_cursor` until exhausted.

### 7.2 Google Calendar

- **Integration type:** Read-only embed via iframe.
- **Config:** Stored as `GoogleCalendarEntry[]` in settings (id, optional name, optional color).
- **View modes:** Week, Month, Agenda — persisted via `UPDATE_SETTINGS`.
- **Multi-calendar:** Multiple calendar IDs supported with individual colors.

### 7.3 Spotify

- **Integration type:** Embedded player via iframe (`open.spotify.com/embed/playlist/...`).
- **6 curated playlists** mapped to work types: Start Work, Deep Focus, Lo-Fi Beats, Brain Food, Peaceful Piano, White Noise.
- **Custom URLs:** Users can override any playlist with their own Spotify URL.

---

## 8. Persistence Layer

All persistence is via `localStorage`. No backend or database is used.

| Key | Content | Written By |
|---|---|---|
| `orchestrate-day-plan` | Current `DayPlan` + `_wizardSteps` + `_schemaVersion` markers | `DayPlanProvider` (on plan change) |
| `orchestrate-settings` | `AppSettings` + `_schemaVersion` (notification pref, session slots, encrypted token, calendar IDs) | `DayPlanProvider` (on settings change) |
| `orchestrate-history` | `SavedDayPlan[]` array | `DayPlanProvider` (on history change) |
| `orchestrate-life-context` | `LifeContext` + `_schemaVersion` (seasons, habits, activeSeasonId, backfill flag) — **added in v5** | `DayPlanProvider` (on life change) |
| `orchestrate-todoist-cache` | `TodoistCache` (tasks, projects, sections, fetchedAt timestamp) | `TodoistProvider` (on data change) |
| `orchestrate-theme` | `"light"` or `"dark"` | `useTheme` hook |
| `orchestrate-active-playlist` | Playlist ID string | `MusicProvider` |
| `orchestrate-custom-playlist-urls` | `Record<string, string>` | `MusicProvider` |

**Backup affordance (v5):** The data flow is split between two surfaces by intent — file I/O lives in the Settings page (`/settings?tab=data`), and restoring a saved session as today's plan lives in the `HistorySidebar`.

- **Settings page → "Data" tab** (rendered by `DataManagement`): Full Backup, Import Backup, Import Sessions, Export All Sessions. The Full Backup export bundles `{ settings, life, history, _backupVersion: 1 }` into a single JSON file. Import Backup dispatches `IMPORT_BACKUP`, which merges by id — existing entries are never overwritten, new entries are appended. Import Sessions dispatches `IMPORT_SESSIONS` for a sessions-only file. After a successful import that brings in sessions, the page shows a clickable "Open Saved Sessions →" hint that navigates to `/setup` (where the sidebar lives).
- **`HistorySidebar`** (Dashboard + Wizard, always available, toggleable): Sessions tab has per-row Restore / Export / Delete on each saved entry. Restore dispatches `RESTORE_DAY`, replacing the current plan and navigating to `/`. Backlog tab shows parked intentions with Bring-to-today / Discard affordances.

The Settings page (`/settings`) is reachable from the cog icon on Dashboard, Welcome, and every Wizard step. It uses a vertical tab layout with three tabs: Integrations, Capacity, and Data. The active tab highlights in the orchestrate accent green. Together with the HistorySidebar, these are the user's safety net in lieu of a backend sync server.

---

## 9. Theming

Orchestrate supports light and dark themes.

- **Mechanism:** A `.dark` CSS class is toggled on the `<html>` element.
- **Hook:** `useTheme()` uses `useSyncExternalStore` backed by `localStorage` for cross-tab sync.
- **Design tokens:** Defined as CSS custom properties in `@theme` block (`index.css`). The `.dark` class overrides all tokens. Key accent: `#3d9970` (green).
- **Meta theme-color:** Updated dynamically for mobile browser chrome.

---

## 10. PWA

- **Service worker** (`public/sw.js`): Network-first caching strategy. On fetch failure, serves from cache. Falls back to `index.html` for SPA route support.
- **Manifest** (`public/manifest.json`): Standalone display mode, 4 icon sizes including maskable.
- **Registration:** In `main.tsx`, the service worker is registered on `window.load`.

---

## 11. Custom Hooks

| Hook | File | Purpose |
|---|---|---|
| `useCurrentSession` | `hooks/useCurrentSession.ts` | Polls every 60s. Returns `currentSession`, `remainingSessions`, `nextSession`, and (v6) `nextSessionStartsWithin(minutes)` helper used to gate the True Rest between-session banner |
| `useHourlyCheckin` | `hooks/useHourlyCheckin.ts` | Fires check-in prompt on each whole hour during active sessions |
| `useNotifications` | `hooks/useNotifications.ts` | Web Notifications API wrapper (`requestPermission`, `sendNotification`) |
| `useResizablePanel` | `hooks/useResizablePanel.ts` | Drag-to-resize panel, clamped 220–480px |
| `useTheme` | `hooks/useTheme.ts` | Light/dark toggle with `useSyncExternalStore` + localStorage |
| `useDayPlan` | `hooks/useDayPlan.ts` | Consumer for `DayPlanContext` (lives in its own file so the context module can stay component-only for fast refresh) |
| `useTodoistData` | `hooks/useTodoist.ts` | Read-only Todoist context consumer |
| `useTodoistActions` | `hooks/useTodoist.ts` | Mutation Todoist context consumer |

---

## 12. Directory Structure

```
src/
├── main.tsx                    # Entry point, service worker registration
├── App.tsx                     # Provider tree + routing
├── index.css                   # Tailwind config, theme tokens, dark mode
│
├── types/
│   └── index.ts                # All TypeScript interfaces and type aliases
│
├── context/
│   ├── DayPlanContext.tsx       # Core reducer, migration, persistence
│   └── TodoistContext.tsx       # Todoist API layer, cache, reconciliation
│
├── hooks/
│   ├── useCurrentSession.ts    # Time-based session detection
│   ├── useDayPlan.ts           # DayPlanContext consumer (kept separate so the context file stays component-only)
│   ├── useHourlyCheckin.ts     # Hourly check-in trigger
│   ├── useNotifications.ts     # Web Notifications wrapper
│   ├── useResizablePanel.ts    # Drag-to-resize
│   ├── useTheme.ts             # Light/dark theme
│   ├── useTodoist.ts           # Todoist consumer hooks + types
│   ├── useIntentionRemoval.ts  # v6.2: moveToBacklog, removeIntention, discardFromBacklog
│   └── useConfirmModal.ts      # Reusable confirm-dialog state hook
│
├── lib/
│   ├── crypto.ts               # AES-256-GCM encryption/decryption
│   ├── time.ts                 # timeToMinutes, minutesToTime, addMinutesToTime, formatDuration, todayISO
│   ├── habits.ts               # v5: habitMatchesDate; v6: getLightPoolHabits, getActiveHabits, getAnchorHabits (v6.3: isHabitDerivedTask removed)
│   ├── habitsTodoistSync.ts    # v6.1: buildDueString, ensureHabitsProject, syncHabitToTodoist; v6.3: computeTodaysHabitInstances, cloneHabitInstanceForReschedule
│   ├── backlog.ts              # v6.2: hasUnfinishedWork, buildBacklogEntry, harvestStalePlan, rebuildLinkedTasksForBacklogEntry
│   ├── intentionUnschedule.ts  # v6.2: unscheduleIntentionTasks pure helper
│   ├── seasons.ts              # v5: findActiveSeason, getSeasonProgress
│   ├── tasks.ts                # getTaskTitle (Todoist content → titleSnapshot → ID; accepts array or Map), collectDescendantIds (cascade-delete BFS)
│   ├── capacity.ts             # v6: computeSessionCapacity / computeAllSessionCapacities
│   ├── spotify.ts              # spotifyPlaylistId, isValidSpotifyUrl
│   └── todoistApi.ts           # API_BASE constant (dev proxy vs prod direct), validateTodoistToken
│
├── data/
│   ├── sessions.ts             # Default session slot definitions
│   ├── playlists.ts            # Spotify playlist catalog + work-type lookup
│   └── restCues.ts             # v6: True Rest catalog
│
├── components/
│   ├── Welcome.tsx             # Landing page
│   ├── wizard/
│   │   ├── Wizard.tsx          # Step router
│   │   ├── WizardLayout.tsx    # Shared layout (sidebar, header, footer)
│   │   ├── Step1Intentions.tsx # Intentions + task mapping
│   │   ├── Step2Refine.tsx     # Categorize + estimate
│   │   ├── Step3Schedule.tsx   # Session assignment + time scheduling
│   │   └── Step4StartMusic.tsx # Spotify player + finish
│   ├── dashboard/
│   │   ├── Dashboard.tsx       # Main dashboard layout
│   │   ├── SessionTimeline.tsx # Timeline bar + current session card (v6: remaining-time capacity badge)
│   │   ├── MusicPanel.tsx      # MusicProvider, PlaylistSelector, SpotifyPlayer
│   │   ├── DigitalClock.tsx    # Live clock
│   │   ├── InsightCard.tsx     # Side-rail card cycling between Transition Tips and a True Rest cue (2-min auto-advance, manual ›)
│   │   ├── HistorySidebar.tsx  # v6.2: was SavedSessions.tsx; controlled-tab container hosting SavedSessionsTab + BacklogTab
│   │   ├── BacklogTab.tsx      # v6.2: per-row Bring-to-today / Discard for life.backlog
│   │   ├── LightPoolPanel.tsx       # v6: Light Pool surface on Dashboard
│   │   ├── HabitInstanceCard.tsx    # v6.3: today's stabilizer instances with Start/Stop/Complete/Skip/Reschedule
│   │   ├── TrueRestCard.tsx         # v6: True Rest cue (inline / banner variants; card variant replaced by InsightCard)
│   │   ├── SessionCapacityBadge.tsx # v6: per-session "n/m min" pill
│   │   └── SessionCapacityBanner.tsx# v6: advisory over-capacity banner
│   ├── checkin/
│   │   └── CheckInModal.tsx    # Hourly check-in dialog
│   ├── todoist/
│   │   ├── TodoistPanel.tsx    # Full Todoist task tree with CRUD
│   │   ├── TodoistSetup.tsx    # Token + Google Calendar config
│   │   └── GoogleCalendarEmbed.tsx # Google Calendar iframe
│   ├── settings/
│   │   ├── SettingsPage.tsx    # /settings — vertical-tab layout: Integrations, Capacity, Data
│   │   ├── CapacitySettings.tsx# v6: session buffer + per-kind taskCapDefaults inputs
│   │   └── DataManagement.tsx  # Import / Export / Full Backup / Import Backup
│   ├── guide/                  # v6: in-app user guide
│   │   └── UserGuide.tsx       # /guide — mental model + how-to (mirrors docs/user-guide.md)
│   ├── life/                   # v5: hierarchical planning surfaces
│   │   ├── LifeShell.tsx       # Shared layout for /life, /season, /habits
│   │   ├── LifeView.tsx        # /life — hub (v6: hosts LightPoolSection)
│   │   ├── SeasonsManager.tsx  # /season — list + create + activate
│   │   ├── SeasonDetail.tsx    # /season/:id — single-season editor
│   │   ├── SeasonForm.tsx      # Reusable create/edit form
│   │   ├── HabitsLibrary.tsx   # /habits — CRUD with anchor protection
│   │   ├── HabitForm.tsx       # Reusable create/edit form (v6.1: kind, targetTime, targetDurationMinutes, windowBehavior, project override)
│   │   ├── LightPoolSection.tsx# v6: /life section — today's pool + weekly cadence
│   │   ├── RestCuesManager.tsx  # /rest-cues — True Rest cue CRUD with category filter pills
│   │   └── ActiveSeasonBadge.tsx # Badge in Dashboard + Wizard headers
│   └── ui/
│       ├── Button.tsx
│       ├── Card.tsx
│       ├── Modal.tsx
│       ├── ConfirmModal.tsx    # Reusable confirm dialog (title + body + confirm/cancel buttons)
│       ├── ProgressBar.tsx
│       ├── ErrorBoundary.tsx
│       ├── EditableTaskList.tsx
│       ├── SessionTimelineBar.tsx
│       ├── AboutContent.tsx
│       ├── Logo.tsx            # favicon img with overridable className
│       ├── HeaderControls.tsx  # Shared About (?), Settings (⚙), ThemeToggle cluster + About modal
│       ├── ThemeToggle.tsx     # light/dark toggle button (uses useTheme)
│       └── formStyles.ts       # shared input/label Tailwind class strings
│
public/
├── sw.js                       # Service worker
├── manifest.json               # PWA manifest
└── 404.html                    # GitHub Pages SPA fallback
```
