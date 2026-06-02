> **Start here.** This is the canonical context document for Orchestrate. Deeper references: [vision.md](./vision.md) (durable "why"), [data-model.md](./data-model.md) (entity semantics, invariants, reducer actions, migrations), [backlog.md](./backlog.md) (forward-looking proposals). The in-app user guide lives in [`src/components/guide/UserGuide.tsx`](../src/components/guide/UserGuide.tsx). For current type definitions, read [`src/types/index.ts`](../src/types/index.ts) directly. Frozen historical artifacts live in [history/](./history/) — do not treat them as current state.

# Orchestrate — Synthesis

What Orchestrate is, what it does, how it's structured, and how the pieces fit together. Intended as handoff context for another agent.

---

## 1. Purpose

Orchestrate is a **single-user, browser-based daily contextualization companion**. It does *not* replace the user's todolist or calendar — it sits alongside them and walks the user through a structured, friction-reducing morning ritual that turns a vague "what am I doing today?" into a concrete, scheduled, music-cued plan.

The core problem it targets:
- **Task and time blindness.** Generic todo lists store epics; they don't help on a fresh day when the relevant unit is *intent for today*, not *open work in general*.
- **Contextualization friction.** The mental work of comparing today's goals against an existing todo list, breaking work into actionable tasks, fitting them into available time, and locking into a working state is high-effort and skipped by most apps.
- **Sustained focus.** Once the day starts, drift, fatigue, and context loss erode follow-through. Orchestrate nudges hour-by-hour and ties working state to a music protocol.

The app is **opinionated and personal** to the author's workflow: fixed default session slots (early morning, morning, afternoon, night), a curated 6-playlist Spotify protocol, and integrations with the specific tools the author already uses (Todoist + Google Calendar).

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Framework | React 19 with TypeScript |
| Build tool | Vite 8 |
| Styling | Tailwind CSS v4 (CSS custom properties via `@theme`); light/dark via `.dark` on `<html>` |
| Routing | React Router v7 (`BrowserRouter`, basename `/orchestrate/`) |
| State management | React Context + `useReducer` (DayPlan), React Context + `useState` (Todoist, Music) |
| Persistence | `localStorage` only — 4 primary keys + 3 auxiliary keys |
| External APIs | Todoist REST API v1, Google Calendar embed, Spotify embed |
| Crypto | Web Crypto API (AES-256-GCM for token encryption) |
| PWA | Service worker (network-first, falls back to cache then `index.html`), manifest with maskable icons |
| Dependencies of note | `canvas-confetti` (task completion), `date-fns`, `react-router-dom` |

---

## 3. Provider Tree & Routing

### 3.1 Provider Tree

```
StrictMode                         (main.tsx)
`-- BrowserRouter (basename: /orchestrate/)   (main.tsx)
    `-- App                        (App.tsx)
        `-- ErrorBoundary
            `-- DayPlanProvider              <-- core app state (plan, settings, history, life)
                `-- TodoistProvider          <-- Todoist data + API actions
                    `-- ReconciliationProvider  <-- v6.5: central habit reconcile
                        `-- AppRoutes        <-- router switch
```

- `ErrorBoundary` is the outermost component in `App.tsx` so a crash in any provider or route is caught gracefully.
- `TodoistProvider` reads `settings` (encrypted token) and `plan` (linked tasks for reconciliation) from `DayPlanProvider`, so it must be nested inside it.
- `ReconciliationProvider` reads both — habits + active season + plan-date from `DayPlanProvider`, taskMap + actions from `TodoistProvider` — so it sits below both. See [`src/context/ReconciliationContext.tsx`](../src/context/ReconciliationContext.tsx).

### 3.2 Routing

Nine routes, all defined in `AppRoutes` inside `App.tsx`:

| Path | Component | Guard |
|---|---|---|
| `/` | `Dashboard` or `Welcome` | Shows `Dashboard` when `plan.setupComplete === true`, otherwise `Welcome` (hub) |
| `/setup` | `Wizard` | Accessible when `setupComplete` is true (editing) or navigated from Welcome |
| `/life` | `LifeView` | Always reachable. Hub: active season + all active habits grouped by scope (always-on, then per-season with collapsible headers) and split by kind (stabilizer / light-coherent), plus an inline compact True Rest editor |
| `/season` | `SeasonsManager` | Always reachable. List + create + activate seasons |
| `/season/:id` | `SeasonDetail` | Always reachable. Single-season editor with member-habit list |
| `/habits` | `HabitsLibrary` | Always reachable. CRUD habits; deleting an active anchor prompts a confirm |
| `/settings` | `SettingsPage` | Always reachable. Vertical-tab layout: Integrations, Capacity, Data |
| `/guide` | `UserGuide` | Always reachable. In-app user guide. Linked from the About modal. |
| `*` | Redirect to `/` | Catch-all |

Life routes are always reachable (no `setupComplete` gate) — `setupComplete` is a daily flag while seasons/habits are durable.

---

## 4. Vocabulary

| Term | Meaning |
|---|---|
| **Intention** | A high-level goal for *today* (e.g. "Finish assignment 3"). Today-scoped, user-created. Can be parked in the **Backlog** instead of deleted. |
| **LinkedTask** | A Todoist task surfaced inside Orchestrate's plan, bound to an intention via `intentionId`. Carries `status` + an `EngagementSegment[]` (`segments`). |
| **Backlog** | Persistent pool of parked intentions at `life.backlog`. Populated via manual archive or day-rollover harvest. Surfaces in the `HistorySidebar`'s Backlog tab. Entries also preserve engagement records from previously-engaged tasks. |
| **Engagement** | Explicit Start/Stop tracking on a LinkedTask or `TodaysHabitInstance`, stored as an `EngagementSegment[]` (each Start→Stop is one segment). Captured via play/stop buttons on the dashboard; durations are derived, not accumulated. |
| **Main task** | A primary work thread. Exclusive to one session. |
| **Background task** | A small/recurring task. Can be assigned to multiple sessions. Cap: `taskCapDefaults.manualBackground` (default 30 min). |
| **Season** | A medium-horizon focus period (4-12 weeks) with theme, goals, non-goals, success criteria, optional capacity budget. Exactly one active at a time. |
| **Habit** | A first-class recurring entity. v6.6: both kinds sync to Todoist, produce `TodaysHabitInstance`s, and share the engagement lifecycle; `kind` discriminates **scheduling only**. Owns recurrence rule, minimum-viable form, trigger cue, anchor flag, season scope. |
| **Stabilizer** | `kind: 'stabilizer'` habit. Scheduled ritual — **requires** a `targetTime`. Synced to Todoist as a recurring task; surfaces as a `TodaysHabitInstance` positioned on the timeline by `targetTime`, independent of session assignment. Start/Stop/Complete/Skip/**Reschedule** lifecycle. |
| **Light-coherent** | `kind: 'light-coherent'` habit. "Anytime" filler — never has a `targetTime`. Synced to Todoist and tracked exactly like a stabilizer, but surfaces as an untimed ("Anytime today") `TodaysHabitInstance` pulled opportunistically. Start/Stop/Complete/Skip — **no reschedule**. |
| **TodaysHabitInstance** | A habit's manifestation for today (either kind). Lives on `DayPlan.todaysHabits[]`. Owns `status` (planned/engaged/completed/skipped), `segments` (engagement), and (stabilizers only) `rescheduledAt` + `rescheduleHistory`. Stabilizer reschedules are always in-place. Never enters session capacity. |
| **True Rest** | Catalog of non-task recovery cues. 8 built-in; user-customizable via the `/life` page True Rest card. Surfaced on Dashboard `InsightCard`, in the check-in modal for low-energy states, and as a between-session banner. |
| **Anchor habit** | `isAnchor: true` -- a load-bearing habit (sleep, meditation, gym, shutdown, review). Pure importance tag, orthogonal to `kind`: sorts first in habit lists and prompts a confirm before deleting an active one. Reserved for recovery-mode / Minimum Viable Day. |
| **Session** | A configurable time block (default: early-morning, morning, afternoon, night). Tasks are assigned to sessions. |
| **Session capacity** | Advisory arithmetic: `(session length - buffer) - total estimatedMinutes`. Status `over` at >150% -- non-blocking banner, wizard always advances. |
| **Check-in** | Hourly prompt during active sessions: feeling + work type -> playlist suggestion. Low-resource states surface a couple of anytime (light-coherent) habit rows + True Rest cue. `stuck` adds avoidance-note capture. |

---

## 5. Application Lifecycle

```
Welcome (hub) --> Wizard (4 steps) --> Dashboard
                       ^                   |
                       +-------------------+  (Edit Plan / Recontextualize)
```

### 5.1 Welcome (Home Hub)

The landing page (`Welcome.tsx`) is a multi-purpose hub:

- **Today card** -- plan status (idle / resuming / first-time), primary CTA (`Plan Your Day` / `Resume Planning`) that navigates to `/setup`, and the wizard step timeline.
- **Life card** -- active season summary, anchor habits as inline pills, and quick links to `/habits` and `/season`.

Three plan-status modes determine the CTA label:
1. **First ever visit** -- no history, no in-progress plan.
2. **Resuming** -- intentions exist or `wizardStep > 1`.
3. **Returning** -- history exists but today's plan is fresh.

Appears at `/` whenever `plan.setupComplete === false`. Once complete, `/` shows the Dashboard. When first-ever, an inline "Restore your data" hint navigates to `/settings?tab=data`.

The top-right fixed controls -- About, Settings, ThemeToggle -- are rendered by the shared `HeaderControls` component across all surfaces.

### 5.2 Wizard (4 Steps)

A sequential flow captured in `plan.wizardStep` (1-indexed, persists across refreshes). `WizardLayout` wraps every step with a collapsible saved-sessions sidebar, header with step progress pills, and Back/Next footer. An "editing" mode supports returning from the dashboard.

1. **Step 1 -- Intentions** (`Step1Intentions`). Two phases: (a) write down intentions, (b) sequentially map each to Todoist tasks via the embedded `TodoistPanel` (Link/Unlink buttons). Mapped intentions become collapsible panels showing their linked tasks. The step also fires `REFRESH_TODAYS_HABITS` to populate today's habits (both kinds) as `TodaysHabitInstance` rows, showing a chip count. The `TodoistPanel` renders a non-actionable "Habit" label on rows backing a `TodaysHabitInstance`. Each intention row has archive-to-backlog and delete buttons (both unschedule linked Todoist tasks via `useIntentionRemoval`). A **season focus banner** at the top surfaces the active season's supporting goals as clickable chips that add intentions.

2. **Step 2 -- Refine** (`Step2Refine`). Per-intention sequential flow: categorize each linked task as **main** or **background**, set an **estimate** (preset pills or custom). Background tasks clamp to `taskCapDefaults.manualBackground`. Tasks > 60 min trigger a nudge to break down via the TodoistPanel.

3. **Step 3 -- Schedule** (`Step3Schedule`). Two phases:
   - **Phase 1 (Assign):** Proportional `SessionTimelineBar` shows sessions as blocks plus a dedicated **habit lane** above where `TodaysHabitInstance` rows render at their `targetTime` (untimed ones cluster as "Anytime today"). User clicks sessions to assign tasks. A "Today's intentions" overview panel lists every active intention with archive/delete buttons. Cannot advance until at least one task is assigned.
   - **Phase 2 (Time):** Side-by-side TodoistPanel + Google Calendar for time-blocking, plus a "Today's habits" panel above. Lenient stabilizers past their target window get an inline reschedule affordance.

4. **Step 4 -- Start Music** (`Step4StartMusic`). Plays the "Start Work" Spotify playlist as a ramp-in trigger, then transitions to the Dashboard.

The user can return from the Dashboard: "Edit Plan" -> Step 1, "Recontextualize" -> Step 3.

### 5.3 Dashboard

The operational view for the rest of the day (`Dashboard.tsx`):

**Top region (full width):**
1. **Header** -- completion counter, Save/Edit/Saved Sessions buttons, `HeaderControls`.
2. **Music row** -- `PlaylistSelector` (6 work-type buttons) + live `DigitalClock`.
3. **Player row** -- `SpotifyPlayer` iframe + `InsightCard` (alternates Transition Tips and True Rest cues every 2 min; manual advance).
4. **Timeline** -- `SessionTimelineBar` (read-only) with active-session pulse and habit lane rendering `TodaysHabitInstance`s. Side rail: `SeasonContextCard`.
5. **Between-session True Rest banner** -- when no session is active and the next slot is within 60 min.

**Two-column lower region** (stacks on small screens):
- **Left column:**
  6. **Current Session** -- active session's tasks: drag-to-reorder, completion checkboxes (with confetti), engagement Start/Stop buttons + live m:s timer on engaged rows, nudge banners for background tasks. `SessionCapacityBadge` + `SessionCapacityBanner` when over-capacity.
  7. **Task Manager** -- collapsible `TodoistPanel`, defaulting to "Linked Tasks" filter.
  8. **Calendar** -- collapsible Google Calendar embed.
- **Right rail** (`HabitInstanceCard.tsx` exports both): two independent, self-headed cards, each hidden when empty:
  - **Today's Habits** (`HabitInstanceCard`) -- today's habit instances (both kinds): timed stabilizers + untimed "Anytime" light-coherent, with per-row Start/Stop/Complete/Skip (Reschedule is stabilizer-only). Engaged rows show a live **m:s timer** (`<EngagementTimer>`, ticks once/sec, counts the current open segment from 0:00).
  - **Engagement Log** (`EngagementLogCard`) -- a scrollable, time-ordered record: one row per engagement segment (individual Start→Stop, across habits + tasks) plus reschedule events; see [`lib/engagementLog.ts`](../src/lib/engagementLog.ts).

**Season context card**: active season name (links to `/season/:id`), theme, date range with "Week N of M" pill, first 3 goals with expand, "Manage" button. Empty-state prompts "Create a season".

Throughout the day:
- **Hourly check-in** modal fires on each whole hour during an active session. Captures feeling + work type -> playlist suggestion. `stuck` adds avoidance-note capture. Low-resource states reveal a couple of anytime (light-coherent) habit rows + True Rest cue.
- **`useCurrentSession`** polls every 60s to determine the active session.

---

## 6. State Management

Three independent state contexts, each serving a distinct domain.

### 6.1 DayPlanContext -- Core Application State

**File:** `src/context/DayPlanContext.tsx`

Manages:
- **`plan`** -- today's `DayPlan` (intentions, linked tasks, task-session assignments, today's habit instances, wizard step, check-ins, habit log).
- **`settings`** -- persistent `AppSettings` (notification preference, session slots, encrypted Todoist token, Google Calendar config).
- **`editingStep`** -- tracks whether the user is re-editing from the dashboard (`number | null`).
- **`history`** -- array of `SavedDayPlan` entries for past sessions.
- **`life`** -- persistent `LifeContext` (seasons, habits, activeSeasonId, backlog, rest cues).

**Architecture:** `useReducer` with a ~57-action discriminated union. State is initialized lazily via `loadInitialState()` which calls `peekRawPlan()` + `loadLifeContext()` + `loadHistory()` + `loadSettings()` and handles day-rollover migration in one place. Four `useEffect` hooks persist each slice back to `localStorage` on every change.

**Plan date freshness + rollover:** `peekRawPlan()` returns the parsed/migrated plan without a date gate. If the date is stale, `loadInitialState` runs `harvestStalePlan(plan)` to compute `BacklogEntry[]` for unfinished intentions, appending them to `life.backlog` with `reason: 'rollover'`. No automatic save to `SavedDayPlan` history at rollover -- the backlog preserves the meaningful unfinished part. Manual `SAVE_DAY` is the only writer to history. Auto-rollover does NOT touch Todoist -- yesterday's tasks remain visibly overdue.

**Migration chain:** Plans include `_wizardSteps` (legacy) and `_schemaVersion` (currently `6.3`, a JSON float) markers. On load, `migratePlan()` runs transformations from v1 through v6.4. The v6.4 step (engagement segments + `'unfinished'`-status coercion) is additive-optional, so the `_schemaVersion` marker deliberately stays at `6.3`. See [data-model.md](./data-model.md) for the full migration chain.

**Cross-slice invariants the reducer enforces:**
- Activating a season auto-deactivates the previously active one.
- Deleting a season clears its id from any habit's `seasonIds`.
- Anchor habits have no reducer-level deletion guard (`isAnchor` is a UI-only confirm prompt; `DELETE_HABIT` always removes once dispatched).
- Deleting a habit also drops any `TodaysHabitInstance` rows for it from `plan.todaysHabits`.
- `REFRESH_TODAYS_HABITS` is idempotent -- skips habits already represented. Payload precomputed by `lib/habitsTodoistSync.ts -> computeTodaysHabitInstances(...)`. Active habits of **either kind** with a `todoistTaskId` whose Todoist task is due today + unchecked qualify (stabilizers timed, light-coherent untimed).
- Habit instance lifecycle: `START_HABIT_INSTANCE` pushes a new open `EngagementSegment`; `STOP_HABIT_INSTANCE` closes it (→ `planned`); `COMPLETE_HABIT_INSTANCE` closes + sets status, caller closes the Todoist occurrence; `SKIP_HABIT_INSTANCE` keeps the instance (prevents re-add); `RESCHEDULE_HABIT_INSTANCE` is always in-place (moves `targetTime`, stamps `rescheduledAt`, appends to `rescheduleHistory`; segments/status preserved). **No Todoist write** for start/stop/reschedule. `REFRESH_TODAYS_HABITS` merges habit-form edits into existing planned instances (refreshes `targetTime`/`durationMinutes`/`titleSnapshot`), but preserves the user-chosen time when `rescheduledAt` is set.
- `TOGGLE_TASK_COMPLETE` also sets `status` and closes any open engagement segment. `START_TASK_ENGAGEMENT` pushes a new open `EngagementSegment`; `STOP_TASK_ENGAGEMENT` closes it (→ `pending`). Each Start→Stop is an individual segment (durations derived, not accumulated).
- Closed Engagement Log rows are individually deletable: `DELETE_TASK_ENGAGEMENT_SEGMENT` / `DELETE_HABIT_ENGAGEMENT_SEGMENT` drop one segment (reverting status to `pending`/`planned` if it was the last open one), and `DELETE_HABIT_RESCHEDULE_ENTRY` drops one `rescheduleHistory` entry.
- Habits (either kind) live on `plan.todaysHabits`, never touching intentions/linkedTasks/taskSessions. Light-coherent instances are simply the untimed ones.
- `MOVE_INTENTION_TO_BACKLOG` scrubs plan-side state and appends a `BacklogEntry` (splits pending vs completed tasks; captures engagement records). `RESTORE_FROM_BACKLOG` is idempotent; stamps reschedule fields on previously-engaged tasks.
- All intention-removal paths route through `useIntentionRemoval()` which unschedules Todoist tasks before dispatching. Auto-rollover is the deliberate exception (tasks stay overdue in Todoist).

Full action catalog: [data-model.md](./data-model.md).

### 6.2 TodoistContext -- External Data Layer

**File:** `src/context/TodoistContext.tsx`

Split into two contexts for render optimization:

- **`TodoistDataContext`** -- read-only: `tasks`, `projects`, `sections`, `taskMap`, `tasksHydrated` (true once tasks have loaded from a fresh cache hit or a successful fetch), `loading`, `error`, `isConfigured`, `authFailed`.
- **`TodoistActionsContext`** -- mutations: `createTask`, `updateTask` (returns `TodoistTask | null`; null = failure, already logged + surfaced), `moveTask` (Sync API `item_move`), `completeTask` (preserves recurring tasks in cache + forces a refresh), `reopenTask`, `deleteTask`, `createTaskComment`, `createProject`, `deleteProject`, `refreshTasks`, `refreshProjects`, `refreshSections`.

**Key behaviors:**
1. **Stale-while-revalidate**: cached data < 5 min old is used without fetching.
2. **Request deduplication**: in-flight requests tracked via `inflightRef`; concurrent calls return the same promise.
3. **Focus refresh**: `window.focus` refreshes tasks AND projects, deduped via a 30s staleness window.
4. **Loading UX**: `loading` only activates when there's no cached data (no flash-of-loading).
5. **Reconciliation** (one-time after first fetch): title snapshot sync + stale task cleanup (marks externally-completed tasks as complete, not unlinked -- preserves session tracking).
6. **401 detection**: `apiFetch` throws on HTTP 401; provider routes to `authFailed` flag + "reconnect in Settings" message. Resets when token changes.
7. **Error logging discipline** (v6.4): every Todoist API failure is `console.error`-ed via the central `handleApiError` funnel *in addition to* the UI error state, so debugging is visible without inspecting React state. Habit lifecycle callers (`HabitInstanceCard`, `reconcileOverdueHabits`) also `console.error` their per-call failures with a `[habits]` prefix.

**Consumer hooks** (`src/hooks/useTodoist.ts`):
- `useTodoistData()` -- read-only consumers.
- `useTodoistActions()` -- mutation consumers.

### 6.3 MusicContext -- Playlist Selection

**File:** `src/components/dashboard/MusicPanel.tsx`

Lightweight context scoped to the dashboard. Manages active playlist ID, custom Spotify URLs per playlist, and suggested playlist from the last check-in. Not used outside the dashboard.

---

## 7. External Integrations

| System | Integration | Purpose |
|---|---|---|
| **Todoist** | REST API v1 with personal API token (AES-256-GCM encrypted in localStorage). Full CRUD on tasks/projects, completion via Sync API. Stale-while-revalidate cache (5min hydration / 30s focus on both tasks and projects). HTTP 401 -> `authFailed` flag + reconnect banner. | Source of truth for tasks. Orchestrate stores only Todoist task IDs + a `titleSnapshot` fallback. |
| **Google Calendar** | Read-only embed iframe. Multi-calendar with per-calendar colors. Week / month / agenda view. | Time context. The user's existing Todoist<->Google Calendar sync makes scheduled tasks appear automatically. |
| **Spotify** | Embedded player iframe. 6 curated playlists, custom URL override per playlist. | Music protocol. |

**No backend (current implementation).** All persistence is `localStorage`. Todoist API calls are direct from the browser (via Vite dev proxy in dev to dodge CORS). The Todoist token is encrypted client-side; key + IV + ciphertext all live in localStorage -- protects against casual inspection, not against an attacker with browser-profile access. This is the current implementation, not a permanent design stance: infrastructure is subordinate to the vision, and a backend (notably self-hosted) is on the table if it serves the vision better -- see [vision.md](./vision.md) "Infrastructure is subordinate to the vision" and [roadmap/persistence_and_backend_migration.md](./roadmap/persistence_and_backend_migration.md).

---

## 8. Music Protocol

Music is treated as a deliberate state machine, not background ambience. Six curated Spotify playlists:

| Work type | Playlist | Use |
|---|---|---|
| *(start of day)* | Start Work | Ramp-in trigger; 5-10 min then switch |
| Coding / problem solving | Deep Focus | Sustained focus |
| Lectures / passive input | Lo-Fi Beats | Light work |
| Restless / high energy | Brain Food | Stimulating but controlled |
| Low energy / foggy | Peaceful Piano | Gentle re-entry |
| Reading / deep cognition | White Noise | Or silence -- language-heavy work |

Users can override any playlist with a custom Spotify URL. Check-in suggests a playlist based on declared work type. Full protocol in [music_routine.md](./roadmap/music_routine.md).

---

## 9. Key Component Architecture

### TodoistPanel

**File:** `src/components/todoist/TodoistPanel.tsx`

Used in four places: Step 1 (linking mode, full tree), Step 2 (linking mode, filter toggle), Step 3 Phase 2 (compact, filtered), Dashboard (full, default filtered). Renders a project -> section -> task tree. Features: Link/Unlink buttons in linking mode (with "Habit" label for stabilizer-backed rows), inline title editing, completion with confetti, All/Linked filter toggle, estimate auto-fill from Todoist `duration`.

### SessionTimelineBar

**File:** `src/components/ui/SessionTimelineBar.tsx`

Visual timeline rendering sessions as proportionally-positioned blocks with assigned task pills. Dual mode: interactive (clickable, Step 3) vs display (dashboard). Includes a habit lane above session blocks for `TodaysHabitInstance` positioning. Each habit pill carries a **state-specific icon** (`🔁` planned, `⏵` engaged with pulse, `🎉` completed, `⤼` skipped) plus distinct border styles (solid/dashed) and bg fills; engaged pills additionally show an inline `Nm` engagement-minutes badge (derived from segments) that survives title truncation.

### Check-in System

`useHourlyCheckin` fires on each whole hour during an active session. `CheckInModal` captures feeling (great/okay/struggling/stuck) + work type -> playlist suggestion. `stuck` triggers an avoidance-note capture. Low-resource states reveal a couple of anytime (light-coherent) habit rows + True Rest cue.

### Light-coherent ("anytime") habits

v6.6 retired the standalone Light Pool. Light-coherent habits are now ordinary habit instances that happen to be untimed — synced to Todoist, surfaced in **Today's Habits** as "Anytime today" rows with the full Start/Stop/Complete/Skip lifecycle (no reschedule), and recorded in the **Engagement Log** like everything else. `computeTodaysHabitInstances` emits them with `targetTime: undefined`.

### True Rest

8 built-in cues across physical/breath/sensory categories. Editing lives in `RestCuesEditor` (auto-seeds from defaults on first edit), embedded in the `/life` True Rest card. "Manage →" links in `InsightCard` and `TrueRestCard` navigate to `/life`. `InsightCard` cycles between Transition Tips and a cue every 2 min. `TrueRestCard` variants: `inline` (check-in modal) and `banner` (between-session). Not a Habit -- no logging, no streak, no completion.

### Session Capacity

`computeSessionCapacity()` in `src/lib/capacity.ts`. Returns status: `ok` (<100%), `tight` (>=100%), `over` (>150%). Mid-session calc uses remaining wall-clock time. `SessionCapacityBadge` per-session pill, `SessionCapacityBanner` advisory warning. Background tasks count once per assignment. Never blocks wizard advance.

### Habit-Task Sync

**File:** `src/lib/habitsTodoistSync.ts`

**Sync layer** (on habit save, v6.6 — both kinds): `buildDueString(habit)` -> `ensureHabitsProject(...)` -> `resolveHabitProjectId(...)` -> `syncHabitToTodoist(...)`. Creates/updates/moves the recurring Todoist task (timed for stabilizers, untimed for light-coherent). Self-heals stale project references and recreates deleted tasks. Sync failures are non-blocking.

**Day-of layer** (on Step 1 mount): `computeTodaysHabitInstances(...)` filters to eligible habits (either kind) and returns `TodaysHabitInstance[]` for `REFRESH_TODAYS_HABITS`. Honors season scope; stabilizers get `targetTime` + the `windowBehavior === 'strict'` gate, light-coherent are untimed. No session auto-assignment -- `targetTime` drives timeline positioning only.

**Central reconciliation** (v6.5, v6.6 both kinds, [`ReconciliationProvider`](../src/context/ReconciliationContext.tsx)): both the overdue bump (v6.4) and the needs-sync repair (v6.1, previously manual-only on `/habits`) are now driven from a single provider mounted between `TodoistProvider` and `AppRoutes`. Detection uses `findOverdueHabits(...)` and `findNeedsSyncHabits(...)`; the action is `triggerReconcile()` which runs needs-sync first (creating/recreating Todoist tasks for habits without a live link — this is what auto-syncs pre-v6.6 light-coherent habits) then overdue bump. The provider auto-fires on first hydration (when Todoist is configured + `tasksHydrated` — so a legitimately empty task list still triggers needs-sync) and on window focus (gated by 5-min staleness); `useHabitReconciliation()` exposes the status + manual trigger to consumers. Surfaces:

  - **Step 1** no longer fires reconcile directly — the provider handles it.
  - **HabitsLibrary** "Migrate / Re-sync" button now delegates to `triggerReconcile()`.
  - **`HabitSyncChip`** mounted in the shared `HeaderControls` surfaces needs-sync count, error state, and in-flight pulse across the whole app; click navigates to `/habits`.

**Overdue bump details** (v6.4): `reconcileOverdueHabits(...)` bumps each overdue habit's Todoist task via `updateTask({ due_string, due_lang, due_datetime | due_date })` — re-passing the existing recurrence rule so Todoist's engine has unambiguous "rule unchanged, next occurrence is this date" semantics — and returns a patch map populated from Todoist's authoritative server responses so `computeTodaysHabitInstances` can run against the bumped state without waiting for React to re-render. Date comparisons in both helpers go through `dueDateLocal(...)` which handles Todoist's floating vs fixed-timezone semantics so late-evening habits in non-UTC zones aren't misclassified. **Skip-as-completion** (v6.4): `SKIP_HABIT_INSTANCE` in the UI posts a `"Skipped via Orchestrate on <date>"` comment on the Todoist task (so the skip is traceable in Todoist's own history — Todoist has no native skip semantic), then fires `completeTask` so the recurrence engine advances cleanly. The Orchestrate-side `'skipped'` status preserves the user-facing distinction.

**Reschedule semantics** (v6.4; stabilizer-only since v6.6): `RESCHEDULE_HABIT_INSTANCE` is **always in-place** — it updates `targetTime`, stamps `rescheduledAt`, and appends a `RescheduleEventEntry` (`{ at, fromTime?, toTime? }`) to the instance's `rescheduleHistory`. The instance keeps its `id`, `status`, and `segments` (an engaged instance keeps its open segment running at the new time). Every reschedule is recorded regardless of engagement, and surfaces as a "⤴ … {from} → {to} · Rescheduled" row in the dashboard engagement log — *not* as a tag in the Today view. The recurring Todoist task's `due_string` stays unchanged. (This replaced an earlier v6.3 clone-on-engagement mechanic; the `'unfinished'` status it produced is gone, and `migratePlan` coerces any persisted `'unfinished'` to `'skipped'`.)

**Habits Library** (`/habits`): shows a "needs sync" banner for habits (either kind) that are either unsynced or whose Todoist task is missing, plus a `NEEDS TIME` badge on active stabilizers lacking a `targetTime` (v6.6 — the form now requires one, but legacy habits may predate it). Bulk sync resolves the default project once to avoid duplicate creation. Habit-save is locked out during migration to prevent races.

### Intentions Backlog

**Pure helpers** in `lib/backlog.ts`: `hasUnfinishedWork`, `buildBacklogEntry` (splits pending vs completed tasks; captures engagement records), `harvestStalePlan`, `rebuildLinkedTasksForBacklogEntry`.

**Hook** `useIntentionRemoval()`: single boundary for intention removal. Three operations: `moveToBacklog`, `removeIntention`, `discardFromBacklog`. Each unschedules Todoist tasks first, then dispatches.

**Lifecycle**: Day rollover harvests automatically. Manual archive via intention row buttons. "Bring to today" reconstructs fresh LinkedTasks for pending IDs only. Discard unschedules + removes.

**Sidebar**: `HistorySidebar` (Dashboard + Wizard) with Sessions and Backlog tabs. "Work Items" button toggles it (with backlog count badge).

---

## 10. Data Model Essentials

Three interlocking ideas:

**Intentions own LinkedTasks.** An intention has `linkedTaskIds` (ordered Todoist IDs). Every `LinkedTask` has an `intentionId` back-reference. Habits do not live here.

**Habits live separately on `DayPlan.todaysHabits`.** `TodaysHabitInstance` is the day-of carrier for both kinds. Timed (stabilizer) instances sit on the timeline by `targetTime`; untimed (light-coherent) instances cluster as "Anytime today". Independent of session assignment and excluded from capacity arithmetic.

**Tasks (not intentions) are scheduled.** `DayPlan.taskSessions: Record<sessionId, todoistId[]>` is the source of truth. `LinkedTask.assignedSessions` is a derived mirror. Habits never participate.

**LifeContext sits above the day.** Persistent state (`life: LifeContext`, persisted to `orchestrate-life-context`) holds `seasons[]`, `habits[]`, `activeSeasonId`, `backlog[]`, and `restCues`. Habits carry `todoistTaskId` + `targetDurationMinutes`; stabilizers additionally carry `targetTime` + `windowBehavior` (light-coherent have neither). The `REFRESH_TODAYS_HABITS` action (fired on Step 1 mount) consumes `computeTodaysHabitInstances(...)` to populate `plan.todaysHabits`.

The plan auto-resets daily. Stale task handling: completed tasks stay visible via `titleSnapshot`; deleted tasks auto-unlink; externally-completed tasks are detected and marked complete (not unlinked).

Full entity semantics, reducer actions, and migration chain: [data-model.md](./data-model.md).

---

## 11. Persistence

All via `localStorage`. No backend — this is the current implementation, not a fixed constraint; the persistence direction is analysed in [roadmap/persistence_and_backend_migration.md](./roadmap/persistence_and_backend_migration.md).

| Key | Content | Written By |
|---|---|---|
| `orchestrate-day-plan` | Current `DayPlan` + schema markers | `DayPlanProvider` |
| `orchestrate-settings` | `AppSettings` + schema marker | `DayPlanProvider` |
| `orchestrate-history` | `SavedDayPlan[]` | `DayPlanProvider` |
| `orchestrate-life-context` | `LifeContext` + schema marker | `DayPlanProvider` |
| `orchestrate-todoist-cache` | Tasks, projects, sections, fetchedAt | `TodoistProvider` |
| `orchestrate-theme` | `"light"` or `"dark"` | `useTheme` |
| `orchestrate-active-playlist` | Playlist ID | `MusicProvider` |
| `orchestrate-custom-playlist-urls` | `Record<playlistId, spotifyUrl>` | `MusicProvider` |

**Backup**: Settings page Data tab has Full Backup (bundles settings + life + history), Import Backup (merge-by-id), Import/Export Sessions. `HistorySidebar` has per-session Restore/Export/Delete.

**Reset**: Settings → Data → Reset section has two destructive actions, each gated by a `ConfirmModal`:
- **Reset Today's Plan** dispatches `RESET_DAY` — replaces `plan` with `freshPlan()` and clears `editingStep`. Settings, history, life (seasons / habits / backlog / rest cues), and Todoist auth are untouched. Useful for cleaning up after a `RESTORE_DAY` that imported an unwanted session.
- **Reset Everything** dispatches `RESET_ALL` and manually clears `orchestrate-todoist-cache` — a factory reset of all four reducer-managed slices (plan + settings + history + life). Todoist token is wiped; tasks/projects in Todoist itself are not modified. Theme and music prefs (separate localStorage keys outside the reducer) survive.

---

## 12. Theming & PWA

**Theming:** `.dark` class on `<html>`. `useTheme()` uses `useSyncExternalStore` backed by localStorage for cross-tab sync. Accent: `#3d9970` (green). Meta theme-color updated dynamically.

**PWA:** Network-first service worker (`public/sw.js`). Manifest with standalone display and maskable icons. Registered in `main.tsx` on `window.load`.

---

## 13. Custom Hooks

| Hook | File | Purpose |
|---|---|---|
| `useCurrentSession` | `hooks/useCurrentSession.ts` | Polls every 60s. Returns `currentSession`, `remainingSessions`, `nextSession`, `nextSessionStartsWithin(min)` |
| `useHourlyCheckin` | `hooks/useHourlyCheckin.ts` | Fires check-in prompt on each whole hour during active sessions |
| `useNotifications` | `hooks/useNotifications.ts` | Web Notifications API wrapper |
| `useResizablePanel` | `hooks/useResizablePanel.ts` | Drag-to-resize panel, clamped 220-480px |
| `useTheme` | `hooks/useTheme.ts` | Light/dark toggle with localStorage sync |
| `useDayPlan` | `hooks/useDayPlan.ts` | Consumer for `DayPlanContext` |
| `useTodoistData` | `hooks/useTodoist.ts` | Read-only Todoist context consumer |
| `useTodoistActions` | `hooks/useTodoist.ts` | Mutation Todoist context consumer |
| `useIntentionRemoval` | `hooks/useIntentionRemoval.ts` | moveToBacklog, removeIntention, discardFromBacklog |
| `useConfirmModal` | `hooks/useConfirmModal.ts` | Reusable confirm-dialog state |
| `useHabitReconciliation` | `hooks/useHabitReconciliation.ts` | v6.5: read central reconcile status (counts, error, in-flight) + manual trigger |
| `useSyncHabit` | `hooks/useSyncHabit.ts` | Per-habit (either kind) →Todoist sync + habit-patch write-back. Shared by HabitsLibrary save flow and `ReconciliationProvider`. |
| `useHabitReschedule` | `hooks/useHabitReschedule.ts` | Shared inline-reschedule state for `TodaysHabitInstance` rows (HabitInstanceCard + Step3HabitsPanel); pairs with `HabitTimeEditor`. |

---

## 14. Directory Structure

```
src/
+-- main.tsx                    # Entry point, service worker registration
+-- App.tsx                     # Provider tree + routing
+-- index.css                   # Tailwind config, theme tokens, dark mode
|
+-- types/
|   `-- index.ts                # All TypeScript interfaces and type aliases
|
+-- context/
|   +-- DayPlanContext.tsx          # Core reducer, migration, persistence
|   +-- TodoistContext.tsx          # Todoist API layer, cache, reconciliation
|   `-- ReconciliationContext.tsx   # v6.5: central habit reconcile (overdue + needs-sync)
|
+-- hooks/
|   +-- useCurrentSession.ts
|   +-- useDayPlan.ts
|   +-- useHourlyCheckin.ts
|   +-- useNotifications.ts
|   +-- useResizablePanel.ts
|   +-- useTheme.ts
|   +-- useTodoist.ts
|   +-- useIntentionRemoval.ts
|   `-- useConfirmModal.ts
|
+-- lib/
|   +-- crypto.ts               # AES-256-GCM encryption/decryption
|   +-- time.ts                 # Time utilities (timeToMinutes, todayISO, etc.)
|   +-- habits.ts               # habitMatchesDate, compareHabitInstancesByTime, getActiveHabits, getAnchorHabits
|   +-- habitsTodoistSync.ts    # buildDueString, ensureHabitsProject, syncHabitToTodoist, computeTodaysHabitInstances, findOverdueHabits, reconcileOverdueHabits, findNeedsSyncHabits
|   +-- backlog.ts              # hasUnfinishedWork, buildBacklogEntry, harvestStalePlan, rebuildLinkedTasksForBacklogEntry
|   +-- intentionUnschedule.ts  # unscheduleIntentionTasks pure helper
|   +-- seasons.ts              # findActiveSeason, getSeasonProgress
|   +-- tasks.ts                # getTaskTitle, collectDescendantIds
|   +-- capacity.ts             # computeSessionCapacity / computeAllSessionCapacities
|   +-- spotify.ts              # spotifyPlaylistId, isValidSpotifyUrl
|   `-- todoistApi.ts           # API_BASE, validateTodoistToken
|
+-- data/
|   +-- sessions.ts             # Default session slot definitions
|   +-- playlists.ts            # Spotify playlist catalog
|   +-- restCues.ts             # Built-in True Rest catalog
|   `-- wizardSteps.ts          # Wizard step metadata
|
+-- components/
    +-- Welcome.tsx
    +-- wizard/
    |   +-- Wizard.tsx, WizardLayout.tsx
    |   +-- Step1Intentions.tsx, Step2Refine.tsx, Step3Schedule.tsx, Step4StartMusic.tsx
    +-- dashboard/
    |   +-- Dashboard.tsx, SessionTimeline.tsx, MusicPanel.tsx, DigitalClock.tsx
    |   +-- InsightCard.tsx, HistorySidebar.tsx, BacklogTab.tsx
    |   +-- HabitInstanceCard.tsx, TrueRestCard.tsx
    |   +-- SessionCapacityBadge.tsx, SessionCapacityBanner.tsx
    +-- checkin/
    |   `-- CheckInModal.tsx
    +-- todoist/
    |   +-- TodoistPanel.tsx, TodoistSetup.tsx, GoogleCalendarEmbed.tsx
    +-- settings/
    |   +-- SettingsPage.tsx, CapacitySettings.tsx, DataManagement.tsx
    +-- guide/
    |   `-- UserGuide.tsx       # Single source for user guide content
    +-- life/
    |   +-- LifeShell.tsx, LifeView.tsx, SeasonsManager.tsx, SeasonDetail.tsx, SeasonForm.tsx
    |   +-- HabitsLibrary.tsx, HabitForm.tsx, RestCuesManager.tsx, RestCuesEditor.tsx
    |   `-- ActiveSeasonBadge.tsx
    `-- ui/
        +-- Button.tsx, Card.tsx, Modal.tsx, ConfirmModal.tsx, ProgressBar.tsx
        +-- ErrorBoundary.tsx, EditableTaskList.tsx, SessionTimelineBar.tsx
        +-- AboutContent.tsx, Logo.tsx, HeaderControls.tsx, ThemeToggle.tsx
        `-- formStyles.ts
```

---

## 15. What's NOT Built Yet

The remaining proposals in [backlog.md](./backlog.md) are NOT implemented. Key items:

- **Modes, rituals, recovery mode.** No `DayPlan.mode`, no ritual templates / `RitualPlayer`, no Minimum Viable Day. (Targeted for v7.)
- **Reviews and drift detection.** No `/review` route, no weekly/seasonal review flows, no drift-signal aggregation. (Targeted for v8.)

Treat these as future work, not current behavior.