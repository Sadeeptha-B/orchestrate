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
        └── DayPlanProvider          ← core app state (plan, settings, history)
            └── TodoistProvider      ← Todoist data + API actions
                └── AppRoutes        ← router switch
                    ├── Welcome      (when !setupComplete)
                    ├── Wizard       (at /setup)
                    └── Dashboard    (when setupComplete, at /)
```

**Why this order?**
- `TodoistProvider` reads `settings` (encrypted token) and `plan` (linked tasks for reconciliation) from `DayPlanProvider`, so it must be nested inside it.
- `ErrorBoundary` wraps everything so a crash in any provider or route is caught gracefully.

---

## 3. Routing

Orchestrate has three routes, all defined in the `AppRoutes` component inside `App.tsx`:

| Path | Component | Guard |
|---|---|---|
| `/` | `Dashboard` or `Welcome` | Shows `Dashboard` when `plan.setupComplete === true`, otherwise `Welcome` |
| `/setup` | `Wizard` | Accessible when `setupComplete` is true (editing) or when navigated from Welcome (`location.state.fromWelcome`) |
| `*` | Redirect to `/` | Catch-all |

Navigation between screens is done via `react-router-dom`'s `useNavigate()`. The wizard-to-dashboard transition happens when `COMPLETE_SETUP` is dispatched.

---

## 4. Application Lifecycle

A typical user session follows this flow:

```
Welcome → Wizard (4 steps) → Dashboard
             ↑                    │
             └────────────────────┘  (Edit Plan / Recontextualize)
```

### 4.1 Welcome Screen

The landing page (`Welcome.tsx`) detects three states:
1. **First ever visit** — no history, no in-progress plan.
2. **Resuming** — intentions exist or `wizardStep > 1`.
3. **Returning** — history exists but today's plan is fresh.

It renders a CTA that navigates to `/setup` with `fromWelcome: true` in router state.

### 4.2 Wizard Flow

The wizard is a 4-step sequential flow. The current step is stored in `plan.wizardStep` (1-indexed) and persists across refreshes.

| Step | Component | Purpose |
|---|---|---|
| 1 | `Step1Intentions` | Define intentions, then sequentially map each to Todoist tasks |
| 2 | `Step2Refine` | Categorize linked tasks as *main* or *background*, set time estimates |
| 3 | `Step3Schedule` | Two-phase: assign tasks to sessions, then schedule times with Todoist + Calendar |
| 4 | `Step4StartMusic` | Play the "Start Work" playlist and transition to dashboard |

**WizardLayout** wraps every step and provides:
- A collapsible saved sessions sidebar (with drag-to-resize via `useResizablePanel`).
- A header with logo, step progress bar, clickable step navigation pills, theme toggle, settings gear (opens `TodoistSetup` modal), and about modal.
- Back/Next footer buttons with `canAdvance` gating.
- An "editing" mode for when the user returns to the wizard from the dashboard.

### 4.3 Dashboard

The dashboard (`Dashboard.tsx`) is the main operational view. It is organized into these sections:

1. **Header** — Logo, completion counter, Save/Edit/New Day/Saved Sessions/Settings buttons, theme toggle.
2. **Music row** — `PlaylistSelector` (6 work-type buttons) + `DigitalClock`.
3. **Player row** — `SpotifyPlayer` (embedded iframe) + `TransitionTips` (static music protocol card).
4. **Timeline** — `SessionTimeline` (visual bar of all sessions with assigned tasks).
5. **Current Session** — `CurrentSession` card with drag-to-reorder tasks, completion checkboxes.
6. **Task Manager** — Collapsible `TodoistPanel` in full mode.
7. **Calendar** — Collapsible `GoogleCalendarEmbed`.

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

**Architecture:** `useReducer` with a ~25-action discriminated union. State is initialized lazily from `localStorage` via `loadPlan()`, `loadSettings()`, and `loadHistory()`. Three `useEffect` hooks persist each slice back to `localStorage` on every change.

**Plan date freshness:** `loadPlan()` checks `parsed.date !== todayISO()`. If the stored plan is from a previous day, a fresh plan is returned. This means the plan auto-resets daily.

**Migration chain:** Plans are stored with a `_wizardSteps` marker. On load, `migratePlan()` runs the chain: v1 (tasks) → v2 (intentions) → v3 (intentionSessions) → v4 (linkedTasks + taskSessions). This ensures backwards compatibility when the data shape evolves.

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
- `useTodoist()` — convenience combo for components that need both.

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
| `orchestrate-day-plan` | Current `DayPlan` + `_wizardSteps` marker | `DayPlanProvider` (on plan change) |
| `orchestrate-settings` | `AppSettings` (notification pref, session slots, encrypted token, calendar IDs) | `DayPlanProvider` (on settings change) |
| `orchestrate-history` | `SavedDayPlan[]` array | `DayPlanProvider` (on history change) |
| `orchestrate-todoist-cache` | `TodoistCache` (tasks, projects, sections, fetchedAt timestamp) | `TodoistProvider` (on data change) |
| `orchestrate-theme` | `"light"` or `"dark"` | `useTheme` hook |
| `orchestrate-active-playlist` | Playlist ID string | `MusicProvider` |
| `orchestrate-custom-playlist-urls` | `Record<string, string>` | `MusicProvider` |

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
| `useCurrentSession` | `hooks/useCurrentSession.ts` | Polls every 60s. Returns `currentSession`, `remainingSessions`, `today` based on current time vs session slot times |
| `useHourlyCheckin` | `hooks/useHourlyCheckin.ts` | Fires check-in prompt on each whole hour during active sessions |
| `useNotifications` | `hooks/useNotifications.ts` | Web Notifications API wrapper (`requestPermission`, `sendNotification`) |
| `useResizablePanel` | `hooks/useResizablePanel.ts` | Drag-to-resize panel, clamped 220–480px |
| `useTheme` | `hooks/useTheme.ts` | Light/dark toggle with `useSyncExternalStore` + localStorage |
| `useTodoistData` | `hooks/useTodoist.ts` | Read-only Todoist context consumer |
| `useTodoistActions` | `hooks/useTodoist.ts` | Mutation Todoist context consumer |
| `useTodoist` | `hooks/useTodoist.ts` | Convenience combo of data + actions |

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
│   ├── useHourlyCheckin.ts     # Hourly check-in trigger
│   ├── useNotifications.ts     # Web Notifications wrapper
│   ├── useResizablePanel.ts    # Drag-to-resize
│   ├── useTheme.ts             # Light/dark theme
│   └── useTodoist.ts           # Todoist consumer hooks + types
│
├── lib/
│   ├── crypto.ts               # AES-256-GCM encryption/decryption
│   └── time.ts                 # timeToMinutes utility
│
├── data/
│   ├── sessions.ts             # Default session slot definitions
│   └── playlists.ts            # Spotify playlist catalog + work-type lookup
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
│   │   ├── SessionTimeline.tsx # Timeline bar + current session card
│   │   ├── MusicPanel.tsx      # MusicProvider, PlaylistSelector, SpotifyPlayer
│   │   ├── DigitalClock.tsx    # Live clock
│   │   ├── TransitionTips.tsx  # Static music tips card
│   │   └── SavedSessions.tsx   # Session history management
│   ├── checkin/
│   │   └── CheckInModal.tsx    # Hourly check-in dialog
│   ├── todoist/
│   │   ├── TodoistPanel.tsx    # Full Todoist task tree with CRUD
│   │   ├── TodoistSetup.tsx    # Token + Google Calendar config
│   │   └── GoogleCalendarEmbed.tsx # Google Calendar iframe
│   └── ui/
│       ├── Button.tsx
│       ├── Card.tsx
│       ├── Modal.tsx
│       ├── ProgressBar.tsx
│       ├── ErrorBoundary.tsx
│       ├── EditableTaskList.tsx
│       ├── SessionTimelineBar.tsx
│       └── AboutContent.tsx
│
public/
├── sw.js                       # Service worker
├── manifest.json               # PWA manifest
└── 404.html                    # GitHub Pages SPA fallback
```
