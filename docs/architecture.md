> **Looking for a high-level overview?** Start at [synthesis.md](./synthesis.md). This document goes deeper on architectural specifics.

# Orchestrate — Architecture Guide

This document describes the architecture of Orchestrate: how the application is structured, how data flows between components, and how external services are integrated. It is intended to be read alongside the companion [Data Model](data-model.md) document.

---

## 1. Technology Stack

| Layer | Technology |
|---|---|
| Framework | React 18+ with TypeScript |
| Build tool | Vite |
| Styling | Tailwind CSS v4 (CSS custom properties via `@theme`) |
| Routing | React Router v6 (`BrowserRouter`, basename `/orchestrate/`) |
| State management | React Context + `useReducer` (DayPlan), React Context + `useState` (Todoist, Music) |
| Persistence | `localStorage` (4 primary keys + 3 auxiliary keys) |
| External APIs | Todoist REST API v1, Google Calendar embed, Spotify embed |
| Crypto | Web Crypto API (AES-256-GCM for token encryption) |
| PWA | Service worker with network-first caching strategy |

---

## 2. Provider Tree

Every React component in the app sits inside a nested provider tree. The order matters — each provider may depend on providers above it.

```
StrictMode
└── BrowserRouter (basename: /orchestrate/)
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
                    └── UserGuide    (at /guide)
```

**Why this order?**
- `TodoistProvider` reads `settings` (encrypted token) and `plan` (linked tasks for reconciliation) from `DayPlanProvider`, so it must be nested inside it.
- `ErrorBoundary` wraps everything so a crash in any provider or route is caught gracefully.

---

## 3. Routing

Orchestrate has three routes, all defined in the `AppRoutes` component inside `App.tsx`:

| Path | Component | Guard |
|---|---|---|
| `/` | `Dashboard` or `Welcome` | Shows `Dashboard` when `plan.setupComplete === true`, otherwise `Welcome` (hub) |
| `/setup` | `Wizard` | Accessible when `setupComplete` is true (editing) or when navigated from Welcome (`location.state.fromWelcome`) |
| `/life` | `LifeView` | Always reachable. Hub showing active season + anchor habits + all active habits |
| `/season` | `SeasonsManager` | Always reachable. List + create + activate seasons |
| `/season/:id` | `SeasonDetail` | Always reachable. Single-season editor with member-habit list |
| `/habits` | `HabitsLibrary` | Always reachable. CRUD habits with anchor protection |
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

The top-right fixed controls expose an about button, a settings gear (opens `SettingsModal`), and the theme toggle. When the user is first-ever (no history, no in-progress plan), an inline "Coming from another browser or device? Restore your data →" hint is shown beneath the "New here?" link; it opens `SettingsModal` directly for the cross-browser onboarding flow. The modal's "Open Saved Sessions →" hint, when shown on Welcome, navigates to `/setup` (where the sidebar lives) since Welcome itself has no sidebar.

### 4.2 Wizard Flow

The wizard is a 4-step sequential flow. The current step is stored in `plan.wizardStep` (1-indexed) and persists across refreshes.

| Step | Component | Purpose |
|---|---|---|
| 1 | `Step1Intentions` | Define intentions, then sequentially map each to Todoist tasks |
| 2 | `Step2Refine` | Categorize linked tasks as *main* or *background*, set time estimates |
| 3 | `Step3Schedule` | Two-phase: assign tasks to sessions, then schedule times with Todoist + Calendar |
| 4 | `Step4StartMusic` | Play the "Start Work" playlist and transition to dashboard |

**WizardLayout** wraps every step and provides:
- A collapsible saved sessions sidebar (drag-to-resize via `useResizablePanel`, default open), always available — including while editing.
- A header with a clickable logo (navigates to `/`, which resolves to Dashboard or Welcome based on `setupComplete`), step progress bar, clickable step navigation pills, theme toggle, settings gear (opens `SettingsModal`), and about modal.
- Back/Next footer buttons with `canAdvance` gating.
- An "editing" mode for when the user returns to the wizard from the dashboard.

### 4.3 Dashboard

The dashboard (`Dashboard.tsx`) is the main operational view. It is organized into these sections:

1. **Header** — Logo, completion counter, Save/Edit/New Day/Saved Sessions/Settings buttons, theme toggle.
2. **Music row** — `PlaylistSelector` (6 work-type buttons) + `DigitalClock`.
3. **Player row** — `SpotifyPlayer` (embedded iframe) + `TransitionTips` (static music protocol card).
4. **Timeline + side rail** — `SessionTimeline` (visual bar with assigned tasks). Side rail: `SeasonContextCard` + `TrueRestCard` (v6).
5. **Between-session True Rest banner** (v6) — `TrueRestCard variant='banner'` when no session is active AND the next slot is within 60 min.
6. **Current Session** — `CurrentSession` card with drag-to-reorder tasks, completion checkboxes, plus the v6 remaining-time `SessionCapacityBadge` and (if over-capacity) `SessionCapacityBanner`.
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

**Architecture:** `useReducer` with a ~35-action discriminated union. State is initialized lazily from `localStorage` via `loadPlan()`, `loadSettings()`, `loadHistory()`, and `loadLifeContext()`. Four `useEffect` hooks persist each slice back to `localStorage` on every change.

**Plan date freshness:** `loadPlan()` checks `parsed.date !== todayISO()`. If the stored plan is from a previous day, a fresh plan is returned. This means the plan auto-resets daily.

**Migration chain:** Plans are stored with a `_wizardSteps` marker (legacy) and, since v5, an explicit `_schemaVersion` marker (now `6`). On load, `migratePlan()` runs the chain: v1 (tasks) → v2 (intentions) → v3 (intentionSessions) → v4 (linkedTasks + taskSessions) → v4.1 (estimatedMinutes) → v5 (no plan-shape change; `LifeContext` is loaded separately) → **v6** (strips the deprecated `Intention.isHabit` / `LinkedTask.isHabit` flags on read; initializes `plan.habitLog: []` if missing; `loadLifeContext` defaults each habit's `kind` to `'stabilizer'` when missing; `loadSettings` injects `taskCapDefaults` and `sessionBufferMinutes` when absent). Schema v6 stamps `_schemaVersion: 6` onto plan, settings, life, and saved-session payloads on every persist. The v5 one-time `backfillHabitsFromLegacy` and the `LifeContext.backfilledFromIsHabit` flag were removed in v6.

**Cross-slice invariants** the reducer enforces (v5 + v6):
- Activating a season auto-deactivates the previously active one.
- Deleting a season clears its id from any habit's `seasonIds`.
- Anchor habits cannot be deleted while active (`DELETE_HABIT` no-ops; the UI offers to deactivate first).
- Deleting a habit clears `sourceHabitId` from any intentions still referencing it.
- `INJECT_HABIT_INTENTIONS` is idempotent — it skips habits that already have an intention with the matching `sourceHabitId` for today. **v6:** the action also filters to `kind === 'stabilizer'`; light-coherent habits never auto-inject.
- Light-coherent habits surface only via the Light Pool, which writes to `plan.habitLog` and never touches `intentions`/`linkedTasks`/`taskSessions`.

See the [Data Model](data-model.md) document for the full action catalog and type definitions.

### 5.2 TodoistContext — External Data Layer

**File:** `src/context/TodoistContext.tsx`

Manages all Todoist API data and mutations. Split into two contexts for render optimization:

- **`TodoistDataContext`** — read-only values: `tasks`, `projects`, `sections`, `taskMap`, `loading`, `error`, `isConfigured`.
- **`TodoistActionsContext`** — mutation functions: `createTask`, `updateTask`, `completeTask`, `reopenTask`, `deleteTask`, `createProject`, `deleteProject`, `refreshTasks`, `refreshProjects`, `refreshSections`.

**Key behaviors:**
1. **Stale-while-revalidate**: On mount, if a cached copy exists in `localStorage` (key: `orchestrate-todoist-cache`) and is less than 5 minutes old, it is used without fetching. Otherwise, a fresh fetch is triggered.
2. **Request deduplication**: In-flight requests are tracked via `inflightRef`. Concurrent calls to `refreshTasks()` return the same promise.
3. **Focus refresh**: A `window.focus` listener refreshes tasks (not projects/sections) but only if the last fetch was more than 30 seconds ago.
4. **Loading UX**: The `loading` flag only activates when there is no cached data. This prevents flash-of-loading-state on subsequent fetches.
5. **Data reconciliation**: Two one-time effects run after the first fetch:
   - *Title snapshot sync* — updates `titleSnapshot` on `LinkedTask` entries when the Todoist title has changed.
   - *Stale task cleanup* — marks linked tasks as completed if they no longer appear in the Todoist API response (i.e., were completed externally).

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
- **Linking mode** — when `linking` prop is provided, each task shows Link/Unlink buttons to associate with an intention.
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

### 6.5 True Rest (v6)

**Files:** `src/data/restCues.ts` (static catalog + `pickRestCue`), `src/components/dashboard/TrueRestCard.tsx` (three variants).

**Catalog:** ~8 cues across `physical | breath | sensory` categories. Pure data, no completion semantics.

**Three surfaces:**
- `variant='card'` — Dashboard side rail, rotates every 5 min. Always visible.
- `variant='inline'` — embedded inside `CheckInModal` when the user signals a low-resource state.
- `variant='banner'` — between-session prompt on the Dashboard. Gated by `useCurrentSession().nextSessionStartsWithin(60)` (extended in v6 to expose this helper).

True Rest is intentionally not a Habit: no logging, no streak, no completion. It's a gentle prompt and nothing else.

### 6.6 Session Capacity Arithmetic (v6)

**Files:** `src/lib/capacity.ts`, `src/components/dashboard/SessionCapacityBadge.tsx`, `src/components/dashboard/SessionCapacityBanner.tsx`.

**Computation:** `computeSessionCapacity(session, taskSessions, linkedTasks, settings, now?)` returns `{ totalMinutes, bufferMinutes, assignedMinutes, remainingMinutes, percentUsed, status, isCurrent }`. Status: `'ok'` at < 100%, `'tight'` at ≥ 100%, `'over'` at > 150%. Mid-session: `totalMinutes` shrinks to remaining wall-clock time and the buffer shrinks proportionally.

**Settings:** `AppSettings.sessionBufferMinutes` (default 60). Editable in `SettingsModal` via `CapacitySettings.tsx`.

**Surfaces:**
- Step 3 Phase 1 (`SessionTimelineBar` with `capacities` prop): per-session `SessionCapacityBadge` inside each block. `SessionCapacityBanner` above the timeline if any session is `over`. Never blocks `canAdvance`.
- Dashboard `CurrentSession`: remaining-time `SessionCapacityBadge` pill + banner when the active session is `over`. Calculation uses `now`, so the badge ticks down as the user works.

Background tasks count once per assignment: a 20-min background task assigned to two sessions counts 20 min against each.

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

**Backup affordance (v5):** The data flow is split between two surfaces by intent — file I/O lives in `SettingsModal`, and restoring a saved session as today's plan lives in the `SavedSessions` sidebar.

- **`SettingsModal` → "Data" section** (rendered by `DataManagement`): Full Backup, Import Backup, Import Sessions, Export All Sessions. The Full Backup export bundles `{ settings, life, history, _backupVersion: 1 }` into a single JSON file. Import Backup dispatches `IMPORT_BACKUP`, which merges by id — existing entries are never overwritten, new entries are appended. Import Sessions dispatches `IMPORT_SESSIONS` for a sessions-only file. After a successful import that brings in sessions, the modal shows a clickable "Open Saved Sessions →" hint that closes the modal and reveals the sidebar (or on Welcome, navigates to `/setup` where the sidebar lives).
- **`SavedSessions` sidebar** (Dashboard + Wizard, always available, toggleable): per-row Restore / Export / Delete on each saved entry. Restore dispatches `RESTORE_DAY`, replacing the current plan and navigating to `/`.

`SettingsModal` is reachable from the cog icon on Dashboard, Welcome, and every Wizard step. Together these are the user's safety net in lieu of a backend sync server.

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
│   └── useTodoist.ts           # Todoist consumer hooks + types
│
├── lib/
│   ├── crypto.ts               # AES-256-GCM encryption/decryption
│   ├── time.ts                 # timeToMinutes, minutesToTime, addMinutesToTime, formatDuration, todayISO
│   ├── habits.ts               # v5: habitMatchesDate; v6: getLightPoolHabits, getActiveHabits, getAnchorHabits
│   ├── seasons.ts              # v5: findActiveSeason, getSeasonProgress
│   ├── tasks.ts                # getTaskTitle (Todoist content → titleSnapshot → ID), collectDescendantIds (cascade-delete BFS)
│   ├── capacity.ts             # v6: computeSessionCapacity / computeAllSessionCapacities
│   ├── spotify.ts              # spotifyPlaylistId, isValidSpotifyUrl
│   └── todoistApi.ts           # API_BASE constant (dev proxy vs prod direct)
│
├── data/
│   ├── sessions.ts             # Default session slot definitions
│   ├── playlists.ts            # Spotify playlist catalog + work-type lookup
│   └── restCues.ts             # v6: True Rest catalog + pickRestCue
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
│   │   ├── TransitionTips.tsx  # Static music tips card
│   │   ├── SavedSessions.tsx   # Session history management
│   │   ├── LightPoolPanel.tsx       # v6: Light Pool surface on Dashboard
│   │   ├── TrueRestCard.tsx         # v6: True Rest cue (card / inline / banner variants)
│   │   ├── SessionCapacityBadge.tsx # v6: per-session "n/m min" pill
│   │   └── SessionCapacityBanner.tsx# v6: advisory over-capacity banner
│   ├── checkin/
│   │   └── CheckInModal.tsx    # Hourly check-in dialog
│   ├── todoist/
│   │   ├── TodoistPanel.tsx    # Full Todoist task tree with CRUD
│   │   ├── TodoistSetup.tsx    # Token + Google Calendar config
│   │   └── GoogleCalendarEmbed.tsx # Google Calendar iframe
│   ├── settings/
│   │   ├── SettingsModal.tsx   # Unified modal: Integrations + Capacity + Data sections
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
│   │   ├── HabitForm.tsx       # Reusable create/edit form (v6: kind + maxBlockMinutes inputs)
│   │   ├── LightPoolSection.tsx# v6: /life section — today's pool + weekly cadence
│   │   └── ActiveSeasonBadge.tsx # Badge in Dashboard + Wizard headers
│   └── ui/
│       ├── Button.tsx
│       ├── Card.tsx
│       ├── Modal.tsx
│       ├── ProgressBar.tsx
│       ├── ErrorBoundary.tsx
│       ├── EditableTaskList.tsx
│       ├── SessionTimelineBar.tsx
│       ├── AboutContent.tsx
│       ├── Logo.tsx            # favicon img with overridable className
│       ├── ThemeToggle.tsx     # light/dark toggle button (uses useTheme)
│       └── formStyles.ts       # shared input/label Tailwind class strings
│
public/
├── sw.js                       # Service worker
├── manifest.json               # PWA manifest
└── 404.html                    # GitHub Pages SPA fallback
```
