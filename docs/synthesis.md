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

The app is **opinionated and personal** to the author's workflow: per-day work sessions (v7.1 — defined on a drag-calendar each morning, seeded from the prior day, with reusable templates; built-in defaults are early morning, morning, afternoon, night), a curated 6-playlist Spotify protocol, and integrations with the specific tools the author already uses (Todoist + Google Calendar).

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
| External APIs | Todoist REST API v1, Google Calendar (REST v3 via GIS OAuth + read-only embed), Spotify embed |
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
                `-- GoogleCalendarProvider   <-- v7.2: GIS OAuth (calendar list + write plumbing)
                    `-- TodoistProvider          <-- Todoist data + API actions
                        `-- ReconciliationProvider  <-- v6.5: central habit reconcile
                            `-- AppRoutes        <-- router switch
```

- `ErrorBoundary` is the outermost component in `App.tsx` so a crash in any provider or route is caught gracefully.
- `GoogleCalendarProvider` reads `settings` (the `googleCalendarConnected` flag) + `dispatch` from `DayPlanProvider`; it is independent of Todoist/Reconciliation (its order relative to them does not matter). The access token it holds lives **in memory only** — never persisted.
- `TodoistProvider` reads `settings` (encrypted token) and `plan` (linked tasks for reconciliation) from `DayPlanProvider`, so it must be nested inside it.
- `ReconciliationProvider` reads both — habits + active season + plan-date from `DayPlanProvider`, taskMap + actions from `TodoistProvider` — so it sits below both. See [`src/context/ReconciliationContext.tsx`](../src/context/ReconciliationContext.tsx).

### 3.2 Routing

Eleven routes, all defined in `AppRoutes` inside `App.tsx`:

| Path | Component | Guard |
|---|---|---|
| `/` | `Dashboard` or `Welcome` | Shows `Dashboard` when `plan.setupComplete === true`, otherwise `Welcome` (hub) |
| `/setup` | `Wizard` | Accessible when `setupComplete` is true (editing) or navigated from Welcome |
| `/focus` | `FocusMode` | Gated on `setupComplete` (else redirect to `/`). v7 distraction-free focus page (see §3.3 Focus Mode) |
| `/life` | `LifeView` | Always reachable. Hub: active season + all active habits grouped by scope (always-on, then per-season with collapsible headers) and split by kind (habits / micro-gaps), plus an inline compact True Rest editor. Habit pills carry inline edit/pause/delete; an "Add habit" button opens the same `HabitForm` modal as the library (Todoist sync banners stay in the library) |
| `/season` | `SeasonsManager` | Always reachable. List + create + activate seasons |
| `/season/:id` | `SeasonDetail` | Always reachable. Single-season editor with member-habit list |
| `/habits` | `HabitsLibrary` | Always reachable. CRUD habits; deleting an active anchor prompts a confirm |
| `/session-templates` | `SessionTemplatesManager` | Always reachable (v7.1). CRUD reusable session-slot templates; "Apply to today" replaces `plan.sessionSlots` |
| `/settings` | `SettingsPage` | Always reachable. Vertical-tab layout: Integrations, Capacity, Data |
| `/guide` | `UserGuide` | Always reachable. In-app user guide. Linked from the About modal. |
| `*` | Redirect to `/` | Catch-all |

Life routes are always reachable (no `setupComplete` gate) — `setupComplete` is a daily flag while seasons/habits are durable.

### 3.3 Focus Mode (v7)

Pressing **▶ Start** on a task in the Current Session card opens an engagement segment *and* navigates
to `/focus` — a distraction-free page showing only the day timeline (reused `SessionTimeline`), the one
engaged task, and a large count-up timer. The page derives its target via `findActiveFocusTask(plan)`
(the engaged `LinkedTask` with an open segment), so it reflects Stop/Complete instantly and survives a
reload. **Stop** closes the segment; **Complete** ticks the task in Todoist and returns to `/`.

An optional **Pomodoro** engine (toggle persisted in `localStorage`) turns the task's estimate into a
slot schedule via `computeFocusPlan(estimate)`: ≥45 min → 20-min work blocks with 5-min breaks; 30–44
min → 10-min blocks; <30 min or unestimated → a single session. The blocks render as a vertical
`FocusSlotPlan`, and when the engine runs (`resolveBlockAt`) it highlights the live block, counts it
down, and fires a chime (`lib/sound.ts`) + notification at each work↔break boundary.

Focus Mode is the app's **execution surface**, so the **music protocol** lives here: a collapsible
"Music & Tips" panel (`FocusMusicPanel`, starts collapsed) wraps the shared `MusicProvider` and renders
the `PlaylistSelector`, `SpotifyPlayer`, and the static `InsightCard` transition tips. The dashboard no
longer carries the Spotify embed.

A separate **focus nudge** (`useFocusNudge`, wired in the Dashboard) notifies the user — browser
notification + in-app banner — if they've been in an active session ≥10 min without engaging anything
(and the session still has incomplete work), repeating every 30 min while idle. No new entities,
reducer actions, or schema migration — Focus Mode is a view over the existing engagement-segment model.

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
| **Habit** | A first-class recurring entity. v6.7: `kind` discriminates by **lifecycle** — `habit` (Todoist-backed, terminal once/day) vs `micro-gap` (no Todoist, repeatable). Owns recurrence rule, minimum-viable form, trigger cue, anchor flag, season scope. |
| **Habit (kind: 'habit')** | The normal recurring thing. Synced to Todoist as a recurring task; terminal once/day (Complete advances the recurrence). `targetTime` **optional** — timed → timeline lane; untimed → "anytime today". Start/Stop/Complete/Skip/**Reschedule**. Rendered in `HabitInstanceCard`. |
| **Micro-gap** (`kind: 'micro-gap'`) | A light, **repeatable** filler (flashcards, a quick drill). **No Todoist**, always untimed, never terminal — Start/Stop logs a rep and it stays available all day. Rendered in its own **`MicroGapCard`**; segments still feed the Engagement Log. Native streaks are a planned follow-up. |
| **TodaysHabitInstance** | A habit's manifestation for today (either kind). Lives on `DayPlan.todaysHabits[]`. Resolve kind via `habitKindOf(life, instance)`. 'habit' instances carry `todoistTaskId` (terminal, reschedulable); 'micro-gap' instances have none and cycle planned↔engaged repeatably. Never enters session capacity. |
| **Recurring focus** | v6.7: a season-scoped recurring *work-thread* (e.g. "Learn redis") on `Season.recurringFocuses[]`. Not a habit — on matching days the Step 1 banner offers a "+ Add" chip that seeds an Intention (then broken down via the normal pipeline). Manual-only; deduped via `plan.seededFocusIds`. |
| **True Rest** | Catalog of non-task recovery cues. 8 built-in; user-customizable via the `/life` page True Rest card. Surfaced as a collapsible card in the Dashboard habits rail, in the check-in modal for low-energy states, and as a between-session banner. |
| **Anchor habit** | `isAnchor: true` -- a load-bearing habit (sleep, meditation, gym, shutdown, review). Pure importance tag, orthogonal to `kind`: sorts first in habit lists and prompts a confirm before deleting an active one. Reserved for recovery-mode / Minimum Viable Day. |
| **Session** | A per-day work time block on `DayPlan.sessionSlots` (v7.1), defined on the wizard's drag-calendar and seeded from the last-used day. Tasks are assigned to sessions. |
| **Session template** | A named, reusable set of session slots on `LifeContext.sessionTemplates` (v7.1). Managed at `/session-templates`; quick-applied during the wizard's Sessions step. |
| **Session capacity** | Advisory arithmetic: `(session length - buffer) - total estimatedMinutes`. Status `over` at >150% -- non-blocking banner, wizard always advances. |
| **Check-in** | Hourly prompt during active sessions: feeling + work type -> playlist suggestion. Low-resource states surface a couple of micro-gap rows + True Rest cue. `stuck` adds avoidance-note capture. |

---

## 5. Application Lifecycle

```
Welcome (hub) --> Wizard (5 steps) --> Dashboard
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

### 5.2 Wizard (5 Steps)

A sequential flow captured in `plan.wizardStep` (1-indexed, persists across refreshes). `WizardLayout` wraps every step with a collapsible saved-sessions sidebar, header with step progress pills, and Back/Next footer. An "editing" mode supports returning from the dashboard.

1. **Step 1 -- Intentions** (`Step1Intentions`). Two phases: (a) write down intentions, (b) sequentially map each to Todoist tasks via the embedded `TodoistPanel` (Link/Unlink buttons). The current intention's linked tasks render in `linkedTaskIds` order and are **drag-reorderable** (`REORDER_INTENTION_TASKS`); linking more than 5 tasks to one intention surfaces a scope-creep nudge ("this is probably an epic — split it"). The focused "Current" card can be **collapsed** to fold all not-yet-mapped intentions (the current one included) into a single drag-reorderable list (`REORDER_INTENTIONS`); picking "Map →" re-focuses one. Mapped intentions become collapsible panels showing their linked tasks. The step also fires `REFRESH_TODAYS_HABITS` to populate today's habits (both kinds) as `TodaysHabitInstance` rows, showing a chip count; each season-banner habit chip has a ✓ to mark it done for today (`useCompleteHabitInstance`). The `TodoistPanel` renders a non-actionable "Habit" label on rows backing a `TodaysHabitInstance`, and its task rows support **drag-reorder within a sibling group** (writes Todoist `child_order` via `item_reorder`). Each intention row has archive-to-backlog and delete buttons (both unschedule linked Todoist tasks via `useIntentionRemoval`). A **season focus banner** at the top surfaces the active season's supporting goals as clickable chips that add intentions.

2. **Step 2 -- Refine** (`Step2Refine`). Per-intention sequential flow: categorize each linked task as **main** or **background**, set an **estimate** (preset pills or custom). Background tasks clamp to `taskCapDefaults.manualBackground`. Tasks > 60 min trigger a nudge to break down via the TodoistPanel.

3. **Step 3 -- Sessions** (`Step3Sessions`, v7.1). Define the day's work sessions on a **drag-calendar** (`SessionEditorTimeline`): drag an empty area to add a block, drag a block to move, drag its edges to resize, click to rename/delete (15-min snapping, advisory overlap tint). The day's sessions live on `DayPlan.sessionSlots` (seeded from the last-used day) and drive every surface thereafter. **Session Templates** (from the Life section) appear as quick-apply chips — applying one replaces the day's sessions (and clears assignments, with a confirm if any exist). A "Save as template" affordance persists the current layout to `LifeContext.sessionTemplates`. Granular reducer actions (`ADD_/UPDATE_/REMOVE_DAY_SESSION`, `APPLY_SESSION_TEMPLATE`) keep session ids stable so assignments survive a Back-edit.

4. **Step 4 -- Schedule** (`Step3Schedule`). Two phases:
   - **Phase 1 (Assign):** Proportional `SessionTimelineBar` shows **all of the day's sessions** as blocks (past ones sit left of the now-line) plus a dedicated **habit lane** above where `TodaysHabitInstance` rows render at their `targetTime` (untimed ones cluster as "Anytime today"). A built-in **view toggle** (top-right) cycles the bar between the full configured day and just the remaining part of the day; the remaining view anchors its left edge to the in-progress session's start so the current session stays fully visible even though it began before now. Clicking a session opens its detail panel: current/upcoming sessions allow assigning tasks; a **past session is read-only for new assignments** but its tasks can be moved forward to a current/upcoming session via a "Move to…" dropdown. Task placement honours Step 1's sequencing (intentions in plan order, tasks in `linkedTaskIds` order) consistently — inside the timeline session blocks (via the bar's `taskOrder` prop) and in the selected-session detail panel (assigned groups, assigned background, and the Add-task lists). A "Today's intentions" overview panel lists every active intention with archive/delete buttons. The "Today's habits" panel exposes ✓ Done (mark complete) alongside Reschedule. Cannot advance until at least one task is assigned.
   - **Phase 2 (Time):** Side-by-side TodoistPanel + Google Calendar for time-blocking, plus a "Today's habits" panel above (habit-kind only; micro-gaps are off-timeline). Habits past their target window get an inline reschedule affordance; v6.8 strict ones are tagged "missed" (greyed) but still listed and reschedulable.

5. **Step 5 -- Start Music** (`Step4StartMusic`). Plays the "Start Work" Spotify playlist as a ramp-in trigger, then transitions to the Dashboard.

The user can return from the Dashboard: "Edit Plan" -> Step 1, "Recontextualize" -> Step 4 (Schedule).

### 5.3 Dashboard

The operational view for the rest of the day (`Dashboard.tsx`):

**Top region (full width):**
1. **Header** -- completion counter, Save/Edit/Saved Sessions buttons, `HeaderControls`.
2. **Greeting panel** -- a time-of-day greeting ("Good morning/afternoon/evening, {settings.userName}." + a day-of-week closer) beside the large live `DigitalClock`. The optional `userName` is set in Settings; the greeting omits the name when unset.
3. **Season panel** -- `SeasonContextCard variant="inline"`: one quiet panel with the context bar (name, "Week N of M" pill, date range, theme, **success criteria**, **supporting goals** as wrapping ◆ chips mirroring the Step 1 `SeasonFocusBanner`) alongside a **Recurring Focuses** column (active focuses with a cadence pill + an "+ Add focus" link that deep-links to `SeasonDetail` in edit mode via router `state.openEdit`). The music protocol (Spotify) moved to Focus Mode (§3.3).
4. **Between-session True Rest banner** -- inside the "Today" section, when no session is active and the next slot is within 60 min.

**"Today" section** -- a borderless tinted working area (header "Today") that leads with the full-width `SessionTimelineBar` (read-only; active-session pulse + habit lane rendering `TodaysHabitInstance`s) — **hidden below the `md` breakpoint**, since the proportional non-reflowing bar is cramped on narrow screens, so the current session leads on mobile — then a two-column region below (stacks on small screens):
- **Left column:**
  5. **Current Session** -- active session's tasks: drag-to-reorder, completion checkboxes (with confetti), engagement Start/Stop buttons + live m:s timer on engaged rows, nudge banners for background tasks. `SessionCapacityBadge` + `SessionCapacityBanner` when over-capacity.
  6. **Task Manager** -- collapsible `TodoistPanel`, defaulting to "Linked Tasks" filter.
  7. **Calendar** -- collapsible Google Calendar embed.
  8. **Engagement Log** (`EngagementLogCard`) -- a scrollable, time-ordered record: one row per engagement segment (individual Start→Stop, across habits + micro-gaps + tasks) plus reschedule events; see [`lib/engagementLog.ts`](../src/lib/engagementLog.ts).
- **Right rail** (`HabitInstanceCard.tsx` exports both): independent, self-headed cards, each hidden when empty:
  - **Today's Habits** (`HabitInstanceCard`) -- today's **'habit'-kind** instances: timed (Scheduled) + untimed (Anytime), with per-row Start/Stop/Complete/Skip/Reschedule. Engaged rows show a live **m:s timer** (`<EngagementTimer>`, ticks once/sec, counts the current open segment from 0:00).
  - **Micro-gaps** (`MicroGapCard`, v6.7) -- today's **'micro-gap'-kind** instances: ▶ Start / ■ Stop only (repeatable), with a rep-count + total-time badge. No Todoist, no terminal complete.
  - **True Rest** (`TrueRestCard`, `variant="card" collapsible`) -- a collapsible recovery-cue card (starts collapsed) sitting with the habit surfaces; rotates a cue every 5 min while open, manual prev/next, "Manage →" to `/life`.

**Season context card**: active season name (links to `/season/:id`), theme, date range with "Week N of M" pill, first 3 goals with expand, "Manage" button. Empty-state prompts "Create a season".

Throughout the day:
- **Hourly check-in** modal fires on each whole hour during an active session. Captures feeling + work type -> playlist suggestion. `stuck` adds avoidance-note capture. Low-resource states reveal a couple of micro-gap rows + True Rest cue.
- **`useCurrentSession`** polls every 60s to determine the active session.

---

## 6. State Management

Three independent state contexts, each serving a distinct domain.

### 6.1 DayPlanContext -- Core Application State

**File:** `src/context/DayPlanContext.tsx`

Manages:
- **`plan`** -- today's `DayPlan` (intentions, linked tasks, the day's `sessionSlots` (v7.1), task-session assignments, today's habit instances, wizard step, check-ins).
- **`settings`** -- persistent `AppSettings` (notification preference, legacy session-slot fallback, encrypted Todoist token, Google Calendar config). Note (v7.1): the live per-day sessions are `plan.sessionSlots`; `settings.sessionSlots` is only a seed/reset fallback now.
- **`editingStep`** -- tracks whether the user is re-editing from the dashboard (`number | null`).
- **`history`** -- array of `SavedDayPlan` entries for past sessions.
- **`life`** -- persistent `LifeContext` (seasons, habits, activeSeasonId, backlog, rest cues, session templates (v7.1)).

**Architecture:** `useReducer` with a ~57-action discriminated union. State is initialized lazily via `loadInitialState()` which calls `peekRawPlan()` + `loadLifeContext()` + `loadHistory()` + `loadSettings()` and handles day-rollover migration in one place. Four `useEffect` hooks persist each slice back to `localStorage` on every change.

**Plan date freshness + rollover:** `peekRawPlan()` returns the parsed/migrated plan without a date gate. If the date is stale, `loadInitialState` runs `harvestStalePlan(plan)` to compute `BacklogEntry[]` for unfinished intentions, appending them to `life.backlog` with `reason: 'rollover'`. No automatic save to `SavedDayPlan` history at rollover -- the backlog preserves the meaningful unfinished part. Manual `SAVE_DAY` is the only writer to history. Auto-rollover does NOT touch Todoist -- yesterday's tasks remain visibly overdue.

**Migration chain:** Plans include `_wizardSteps` and `_schemaVersion` (currently `7.1`, a JSON float) markers. On load, `migratePlan()` runs transformations from v1 through v7.1. The v7.1 step backfills `DayPlan.sessionSlots` (per-day sessions), bumps the wizard step for the inserted Sessions step (4-step → 5-step, schema-gated so current plans are untouched), and seeds `LifeContext.sessionTemplates`. See [data-model.md](./data-model.md) for the full migration chain.

**Cross-slice invariants the reducer enforces:**
- Activating a season auto-deactivates the previously active one.
- Deleting a season clears its id from any habit's `seasonIds`.
- Anchor habits have no reducer-level deletion guard (`isAnchor` is a UI-only confirm prompt; `DELETE_HABIT` always removes once dispatched).
- Deleting a habit also drops any `TodaysHabitInstance` rows for it from `plan.todaysHabits`.
- `REFRESH_TODAYS_HABITS` is idempotent via a **value-stable merge** -- the compute paths re-emit every matching habit, the reducer dedupes by `habitId`, refreshes a `planned` instance's time/duration/title (so habit-form edits propagate same-day), and returns the same state when nothing changed (no render loop). Two precompute paths feed it: `computeTodaysHabitInstances(...)` ('habit' kind — Todoist task due today + unchecked) and `computeTodaysMicroGapInstances(...)` ('micro-gap' kind — no Todoist, recurrence + season match). Step 1 + the dashboard dispatch both.
- Habit instance lifecycle: `START_HABIT_INSTANCE` pushes a new open `EngagementSegment`; `STOP_HABIT_INSTANCE` closes it (→ `planned`); `COMPLETE_HABIT_INSTANCE` closes + sets status, caller closes the Todoist occurrence; `SKIP_HABIT_INSTANCE` keeps the instance (prevents re-add); `RESCHEDULE_HABIT_INSTANCE` is always in-place (moves `targetTime`, stamps `rescheduledAt`, appends to `rescheduleHistory`; segments/status preserved). **No Todoist write** for start/stop/reschedule. `REFRESH_TODAYS_HABITS` merges habit-form edits into existing planned instances (refreshes `targetTime`/`durationMinutes`/`titleSnapshot`), but preserves the user-chosen time when `rescheduledAt` is set.
- `TOGGLE_TASK_COMPLETE` also sets `status` and closes any open engagement segment. `START_TASK_ENGAGEMENT` pushes a new open `EngagementSegment`; `STOP_TASK_ENGAGEMENT` closes it (→ `pending`). Each Start→Stop is an individual segment (durations derived, not accumulated).
- Closed Engagement Log rows are individually deletable: `DELETE_TASK_ENGAGEMENT_SEGMENT` / `DELETE_HABIT_ENGAGEMENT_SEGMENT` drop one segment (reverting status to `pending`/`planned` if it was the last open one), and `DELETE_HABIT_RESCHEDULE_ENTRY` drops one `rescheduleHistory` entry.
- Habits (either kind) live on `plan.todaysHabits`, never touching intentions/linkedTasks/taskSessions. 'micro-gap' instances are repeatable (planned↔engaged, no terminal) and carry no `todoistTaskId`; lifecycle Complete/Skip/Reschedule + Todoist writes are 'habit'-kind only.
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
| **Google Calendar** | **Display:** read-only embed iframe (multi-calendar, per-calendar colors, week / month / agenda view). **Auth (v7.2):** browser-only OAuth via Google Identity Services (GIS) token client — build-time `VITE_GOOGLE_CLIENT_ID`, no backend. Used to auto-list the user's calendars (the setup picker; replaces manual calendar-ID entry) and as **write plumbing** (`createEvent`; scope `calendar.events`, not yet wired to a feature). Access token (~1 hr) is in-memory only and silently re-acquired (`prompt: 'none'`); only a `googleCalendarConnected` flag persists. | Time context. The user's existing Todoist<->Google Calendar sync makes scheduled tasks appear automatically. Future: server-held refresh token for unattended writes (see roadmap). |
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

Used in four places: Step 1 (linking mode, full tree), Step 2 (linking mode, filter toggle), Step 3 Phase 2 (compact, filtered), Dashboard (full, default filtered). Renders a project -> section -> task tree. Features: Link/Unlink buttons in linking mode, inline title editing, completion with confetti, All/Linked filter toggle, estimate auto-fill from Todoist `duration`. Habit-backed rows (Todoist tasks behind a `TodaysHabitInstance`) carry a non-actionable "🔁 Habit" label on **every** mount — the panel computes the backing-id set itself from `plan.todaysHabits`, so the cue is no longer linking-only. Their Delete (✕) action is hidden (deleting would dangle the habit's sync link), and completing one from the panel also dispatches `COMPLETE_HABIT_INSTANCE` so the dashboard Habits card stays in sync (Skip/Reschedule remain Habits-card-only).

### SessionTimelineBar

**File:** `src/components/ui/SessionTimelineBar.tsx`

Visual timeline rendering sessions as proportionally-positioned blocks with assigned task pills. Dual mode: interactive (clickable, Step 3) vs display (dashboard). Includes a habit lane above session blocks for `TodaysHabitInstance` positioning. Each habit pill carries a **state-specific icon** (`🔁` planned, `⏵` engaged with pulse, `🎉` completed, `⤼` skipped, `⏰` missed) plus distinct border styles (solid/dashed) and bg fills; engaged pills additionally show an inline `Nm` engagement-minutes badge (derived from segments) that survives title truncation. v6.8: callers pass a `missedInstanceIds` set (computed via `getMissedInstanceIds`) so a `strict` habit past its window renders greyed as "missed".

### Check-in System

`useHourlyCheckin` fires on each whole hour during an active session. `CheckInModal` captures feeling (great/okay/struggling/stuck) + work type -> playlist suggestion. `stuck` triggers an avoidance-note capture. Low-resource states reveal a couple of micro-gap rows + True Rest cue.

### Micro-gaps

v6.7: **`kind: 'micro-gap'`** habits are light, repeatable fillers — **no Todoist**, always untimed, never terminal. They surface in their own **`MicroGapCard`** on the dashboard (▶ Start / ■ Stop only; each Start→Stop logs a rep that stays available all day) and feed the **Engagement Log** via segments. Computed by `computeTodaysMicroGapInstances(...)` (pure, no Todoist). Excluded from the timeline, Step 3 habits panel, sync, and reconcile. The low-energy check-in surfaces a couple of micro-gap rows as the "smaller move". Native streaks are the planned next step (the durable `life.engagementHistory` per `roadmap/engagement_record_strategy.md`).

### Recurring focus (v6.7)

Season-scoped recurring *work-threads* on `Season.recurringFocuses[]` (`{ id, title, recurrence, active }`) — e.g. "Learn redis" — that decompose into tasks rather than being atomic habits. Edited in `SeasonForm`/`SeasonDetail`. On days the cadence matches (`recurrenceMatchesDate`), the Step 1 `SeasonFocusBanner` renders a clickable **"+ Add" chip**; clicking dispatches `ADD_INTENTION` (seeding a normal intention you break down via Steps 1–3) + `MARK_FOCUS_SEEDED` (records the id in `plan.seededFocusIds` so the chip drops out). Manual-only — no auto-seed.

### True Rest

8 built-in cues across physical/breath/sensory categories. Editing lives in `RestCuesEditor` (auto-seeds from defaults on first edit), embedded in the `/life` True Rest card. "Manage →" links in `TrueRestCard` navigate to `/life`. `TrueRestCard` variants: `card` (Dashboard habits rail, `collapsible` + starts collapsed, rotates a cue every 5 min while open), `inline` (check-in modal), and `banner` (between-session). `InsightCard` is now music Transition Tips only (no True Rest cycling). Not a Habit -- no logging, no streak, no completion.

### Session Capacity

`computeSessionCapacity()` in `src/lib/capacity.ts`. Returns status: `ok` (<100%), `tight` (>=100%), `over` (>150%). Mid-session calc uses remaining wall-clock time. `SessionCapacityBadge` per-session pill, `SessionCapacityBanner` advisory warning. Background tasks count once per assignment. Never blocks wizard advance.

### Habit-Task Sync

**File:** `src/lib/habitsTodoistSync.ts`

**Sync layer** (on 'habit'-kind save — v6.7): `buildDueString(habit)` -> `ensureHabitsProject(...)` -> `resolveHabitProjectId(...)` -> `syncHabitToTodoist(...)`. Creates/updates/moves the recurring Todoist task (timed → "every day at HH:mm", untimed → "every day"). Self-heals stale project references and recreates deleted tasks. Sync failures are non-blocking. **Micro-gaps never sync** — `syncHabitToTodoist`/`findNeedsSyncHabits`/`findOverdueHabits` early-skip them.

**Delete propagation** (`useHabitMutations`, not the reducer — shared by HabitsLibrary + LifeView): deleting a habit also removes its backing recurring Todoist task (`todoistActions.deleteTask`), and editing a habit's kind from `habit` → `micro-gap` deletes the now-orphaned task (HabitForm drops `todoistTaskId` for non-habit kinds). Both are best-effort / non-blocking — a failure leaves an orphan task (logged), never blocking the local change. Pausing a habit (`TOGGLE_HABIT_ACTIVE`) deliberately leaves the Todoist task intact, since deactivation is reversible.

**Day-of layer** (`useTodaysHabitsSync`, on Step 1 + dashboard mount): `computeTodaysHabitInstances(...)` ('habit' kind, Todoist-gated) + `computeTodaysMicroGapInstances(...)` ('micro-gap' kind, no Todoist) both feed `REFRESH_TODAYS_HABITS`. Honors season scope; timed habits get `targetTime`. **v6.8: a due-today habit is always surfaced regardless of `windowBehavior`** — `strict` no longer hides a past-window row; instead it stays a `planned`, actionable instance that surfaces *present* as "missed" (greyed) via the derived `isHabitInstanceMissed(...)` helper (so the day's record is kept and a habit done before planning is still completable). v6.8 also *rescues* a timed **lenient** ("surface anyway") habit whose time has passed but whose recurring task Todoist rolled forward to tomorrow (today's slot is gone) — so a habit created/edited after its target time still surfaces today (unless already completed/skipped). No session auto-assignment -- `targetTime` drives timeline positioning only. Because `REFRESH_TODAYS_HABITS` only appends/refreshes (never removes), the hook also runs `findStaleTodaysHabitInstances(...)` → `PRUNE_STALE_HABIT_INSTANCES` (gated on `tasksHydrated`) to drop `planned` instances whose Todoist task was completed / moved off today out-of-band — sharing the `isLenientPastWindow` predicate with the compute path so a rescued row isn't pruned right back out.

**Central reconciliation** (v6.5; **'habit' kind only** since v6.7 — micro-gaps never sync, [`ReconciliationProvider`](../src/context/ReconciliationContext.tsx)): both the overdue bump (v6.4) and the needs-sync repair (v6.1, previously manual-only on `/habits`) are now driven from a single provider mounted between `TodoistProvider` and `AppRoutes`. Detection uses `findOverdueHabits(...)` and `findNeedsSyncHabits(...)`; the action is `triggerReconcile()` which runs needs-sync first (creating/recreating Todoist tasks for 'habit'-kind entries without a live link) then overdue bump. The provider auto-fires on first hydration (when Todoist is configured + `tasksHydrated` — so a legitimately empty task list still triggers needs-sync) and on window focus (gated by 5-min staleness); `useHabitReconciliation()` exposes the status + manual trigger to consumers. Surfaces:

  - **Step 1** no longer fires reconcile directly — the provider handles it.
  - **HabitsLibrary** "Migrate / Re-sync" button now delegates to `triggerReconcile()`.
  - **`HabitSyncChip`** mounted in the shared `HeaderControls` surfaces needs-sync count, error state, and in-flight pulse across the whole app; click navigates to `/habits`.

**Overdue bump details** (v6.4): `reconcileOverdueHabits(...)` bumps each overdue habit's Todoist task via `updateTask({ due_string, due_lang, due_datetime | due_date })` — re-passing the existing recurrence rule so Todoist's engine has unambiguous "rule unchanged, next occurrence is this date" semantics — and returns a patch map populated from Todoist's authoritative server responses so `computeTodaysHabitInstances` can run against the bumped state without waiting for React to re-render. Date comparisons in both helpers go through `dueDateLocal(...)` which handles Todoist's floating vs fixed-timezone semantics so late-evening habits in non-UTC zones aren't misclassified. **Skip-as-completion** (v6.4): `SKIP_HABIT_INSTANCE` in the UI posts a `"Skipped via Orchestrate on <date>"` comment on the Todoist task (so the skip is traceable in Todoist's own history — Todoist has no native skip semantic), then fires `completeTask` so the recurrence engine advances cleanly. The Orchestrate-side `'skipped'` status preserves the user-facing distinction.

**Reschedule semantics** (v6.4; **'habit'-kind only** — micro-gaps are untimed and not reschedulable): `RESCHEDULE_HABIT_INSTANCE` is **always in-place** — it updates `targetTime`, stamps `rescheduledAt`, and appends a `RescheduleEventEntry` (`{ at, fromTime?, toTime? }`) to the instance's `rescheduleHistory`. The instance keeps its `id`, `status`, and `segments` (an engaged instance keeps its open segment running at the new time). Every reschedule is recorded regardless of engagement, and surfaces as a "⤴ … {from} → {to} · Rescheduled" row in the dashboard engagement log — *not* as a tag in the Today view. The recurring Todoist task's `due_string` stays unchanged. (This replaced an earlier v6.3 clone-on-engagement mechanic; the `'unfinished'` status it produced is gone, and `migratePlan` coerces any persisted `'unfinished'` to `'skipped'`.)

**Habits Library** (`/habits`): groups active habits into **Habits** and **Micro-gaps** sections (+ collapsible Inactive). Shows a "needs sync" banner for **'habit'-kind** entries that are unsynced or whose Todoist task is missing (micro-gaps never sync, so they're excluded); the banner **names each affected habit** as a chip (a ⚠ marks a task that's gone missing in Todoist) and offers — alongside Migrate / Re-sync — a confirm-gated **bulk "Delete habits"** escape hatch for habits the user would rather drop than push to Todoist. Bulk sync resolves the default project once to avoid duplicate creation. Habit-save is locked out during migration to prevent races. CRUD (create / edit / pause / delete) and the create/edit/anchor-delete **modal stack** run through the shared `useHabitForms` hook (over `useHabitMutations`), also used by `LifeView`, so the two surfaces share one mutation + form path; the needs-sync banner and bulk-delete modal stay library-only.

### Intentions Backlog

**Pure helpers** in `lib/backlog.ts`: `hasUnfinishedWork`, `buildBacklogEntry` (splits pending vs completed tasks; captures engagement records), `harvestStalePlan`, `rebuildLinkedTasksForBacklogEntry`.

**Hook** `useIntentionRemoval()`: single boundary for intention removal. Three operations: `moveToBacklog`, `removeIntention`, `discardFromBacklog`. Each unschedules Todoist tasks first, then dispatches.

**Lifecycle**: Day rollover harvests automatically. Manual archive via intention row buttons. "Bring to today" reconstructs fresh LinkedTasks for pending IDs only. Discard unschedules + removes.

**Sidebar**: `HistorySidebar` (Dashboard + Wizard) with Sessions and Backlog tabs. "Work Items" button toggles it (with backlog count badge).

---

## 10. Data Model Essentials

Three interlocking ideas:

**Intentions own LinkedTasks.** An intention has `linkedTaskIds` (ordered Todoist IDs). Every `LinkedTask` has an `intentionId` back-reference. Habits do not live here.

**Habits live separately on `DayPlan.todaysHabits`.** `TodaysHabitInstance` is the day-of carrier for both kinds (resolve via `habitKindOf`). 'habit'-kind: timed → timeline lane, untimed → "Anytime today" (both in `HabitInstanceCard`). 'micro-gap'-kind: repeatable rows in `MicroGapCard`. Independent of session assignment and excluded from capacity arithmetic.

**Tasks (not intentions) are scheduled.** `DayPlan.taskSessions: Record<sessionId, todoistId[]>` is the source of truth. `LinkedTask.assignedSessions` is a derived mirror. Habits never participate.

**LifeContext sits above the day.** Persistent state (`life: LifeContext`, persisted to `orchestrate-life-context`) holds `seasons[]` (each with optional `recurringFocuses[]`), `habits[]`, `activeSeasonId`, `backlog[]`, and `restCues`. 'habit'-kind carry `todoistTaskId` + optional `targetTime`/`windowBehavior`; 'micro-gap'-kind carry none of those. `REFRESH_TODAYS_HABITS` (Step 1 mount) consumes both compute paths to populate `plan.todaysHabits`.

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
- **Reset Today's Plan** dispatches `RESET_DAY` — replaces `plan` with a fresh plan (sessions re-seeded from settings/defaults) and clears `editingStep`. Settings, history, life (seasons / habits / backlog / rest cues / session templates), and Todoist auth are untouched. Useful for cleaning up after a `RESTORE_DAY` that imported an unwanted session.
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
| `useGoogleCalendarData` | `hooks/useGoogleCalendar.ts` | v7.2: read-only Google Calendar OAuth state (isConfigured/isConnected/authFailed, available calendars) |
| `useGoogleCalendarActions` | `hooks/useGoogleCalendar.ts` | v7.2: connect/disconnect, refreshCalendars, createEvent (GIS token client) |
| `useIntentionRemoval` | `hooks/useIntentionRemoval.ts` | moveToBacklog, removeIntention, discardFromBacklog |
| `useConfirmModal` | `hooks/useConfirmModal.ts` | Reusable confirm-dialog state |
| `useHabitReconciliation` | `hooks/useHabitReconciliation.ts` | v6.5: read central reconcile status — counts, the **named needs-sync habit list**, error, in-flight — + manual trigger |
| `useSyncHabit` | `hooks/useSyncHabit.ts` | Per-habit →Todoist sync + habit-patch write-back (**'habit' kind only** — micro-gaps early-return). Shared by HabitsLibrary save flow and `ReconciliationProvider`. |
| `useHabitMutations` | `hooks/useHabitMutations.ts` | Shared habit create/edit/delete with best-effort Todoist sync (project resolution + `useSyncHabit`), plus the `HabitForm` Todoist props and `syncError`. Used (via `useHabitForms`) by `HabitsLibrary` and `LifeView` so both surfaces share one CRUD path. |
| `useHabitForms` | `hooks/useHabitForms.tsx` | Wraps `useHabitMutations` and owns the shared create/edit/anchor-delete **modal stack** + open/edit/`requestDelete` triggers. Returns a ready-to-render `modals` node so `HabitsLibrary` and `LifeView` render the same form/confirm plumbing instead of duplicating the JSX. |
| `useHabitReschedule` | `hooks/useHabitReschedule.ts` | Shared inline-reschedule state for `TodaysHabitInstance` rows (HabitInstanceCard + Step3HabitsPanel); pairs with `HabitTimeEditor`. |
| `useToggleHabitInstance` | `hooks/useToggleHabitInstance.ts` | Start/Stop a `TodaysHabitInstance` (both kinds): dispatches `START_/STOP_HABIT_INSTANCE`. Shared by `HabitInstanceCard` + `MicroGapCard`. |
| `useTodaysHabitsSync` | `hooks/useTodaysHabitsSync.ts` | Day-of sync effect: feeds `computeTodaysHabitInstances` + `computeTodaysMicroGapInstances` into `REFRESH_TODAYS_HABITS`, then prunes deleted-habit and stale instances. Mounted by Step 1 + dashboard. |

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
|   +-- GoogleCalendarContext.tsx   # v7.2: GIS OAuth state + calendar list + createEvent plumbing
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
|   +-- useConfirmModal.ts
|   +-- useHabitReconciliation.ts, useSyncHabit.ts, useHabitMutations.ts, useHabitForms.tsx
|   `-- useHabitReschedule.ts, useToggleHabitInstance.ts, useTodaysHabitsSync.ts
|
+-- lib/
|   +-- crypto.ts               # AES-256-GCM encryption/decryption
|   +-- googleAuth.ts           # v7.2: GIS token-client wrapper (loadGis, requestToken, revokeToken)
|   +-- googleCalendarApi.ts    # v7.2: Calendar REST v3 client (listCalendars, createCalendarEvent)
|   +-- time.ts                 # Time utilities (timeToMinutes, todayISO, etc.)
|   +-- habits.ts               # habitMatchesDate/recurrenceMatchesDate, habitKindOf, partitionByKind, computeTodaysMicroGapInstances, getActiveHabits, getAnchorHabits
|   +-- habitsTodoistSync.ts    # buildDueString, ensureHabitsProject, syncHabitToTodoist, computeTodaysHabitInstances, findStaleTodaysHabitInstances, findOverdueHabits, reconcileOverdueHabits, findNeedsSyncHabits
|   +-- backlog.ts              # hasUnfinishedWork, buildBacklogEntry, harvestStalePlan, rebuildLinkedTasksForBacklogEntry
|   +-- intentionUnschedule.ts  # unscheduleIntentionTasks pure helper
|   +-- seasons.ts              # findActiveSeason, getSeasonProgress
|   +-- tasks.ts                # getTaskTitle, collectDescendantIds
|   +-- capacity.ts             # computeSessionCapacity / computeAllSessionCapacities
|   +-- timeline.ts             # time<->position geometry (formatHour, minutesToPct/pctToMinutes)
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
    |   +-- Step1Intentions.tsx, Step2Refine.tsx, Step3Sessions.tsx, Step3Schedule.tsx, Step4StartMusic.tsx
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
    |   +-- SettingsPage.tsx, CapacitySettings.tsx, DataManagement.tsx, GoogleCalendarSetup.tsx
    +-- guide/
    |   `-- UserGuide.tsx       # Single source for user guide content
    +-- life/
    |   +-- LifeShell.tsx, LifeView.tsx, SeasonsManager.tsx, SeasonDetail.tsx, SeasonForm.tsx
    |   +-- HabitsLibrary.tsx, HabitForm.tsx, RestCuesEditor.tsx, SessionTemplatesManager.tsx
    |   +-- SeasonFocusBanner.tsx, SeasonContextCard.tsx
    |   `-- ActiveSeasonBadge.tsx
    `-- ui/
        +-- Button.tsx, Card.tsx, Modal.tsx, ConfirmModal.tsx, ProgressBar.tsx
        +-- ErrorBoundary.tsx, EditableTaskList.tsx, SessionTimelineBar.tsx, SessionEditorTimeline.tsx
        +-- AboutContent.tsx, Logo.tsx, HeaderControls.tsx, ThemeToggle.tsx
        `-- formStyles.ts
```

---

## 15. What's NOT Built Yet

The remaining proposals in [backlog.md](./backlog.md) are NOT implemented. Key items:

- **Modes, rituals, recovery mode.** No `DayPlan.mode`, no ritual templates / `RitualPlayer`, no Minimum Viable Day. (Targeted for v7.)
- **Reviews and drift detection.** No `/review` route, no weekly/seasonal review flows, no drift-signal aggregation. (Targeted for v8.)

Treat these as future work, not current behavior.