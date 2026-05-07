## Plan: Orchestrate v3 — Intentions & Todoist Integration

This document is the consolidated reference for the Orchestrate v3 codebase. It describes the app's architecture, data model, component structure, integration approach, and all features as currently implemented.

Orchestrate is a daily contextualization companion app. It walks the user through setting intentions for the day, mapping them to tasks in Todoist, scheduling them into session slots, and staying on track with music and hourly check-ins. It integrates with **Todoist** (REST API + personal token) and **Google Calendar** (embeddable iframe). No backend — all data in localStorage.

---

### Tech Stack

- **React 19 + TypeScript + Vite** — SPA with type safety, fast builds
- **Tailwind CSS v4** — green-accented muted palette via `@theme` custom properties, class-based dark mode
- **React Router** — wizard ↔ dashboard navigation (non-linear, always accessible)
- **date-fns** — lightweight time/date utils
- **localStorage** — persistence (no backend, no auth)
- **Web Notifications API** — optional browser notifications for check-ins
- **Web Crypto API** — AES-GCM encryption for Todoist API token storage
- **PWA** — installable via web manifest + service worker (network-first caching, offline fallback)
- **Deployed at `/orchestrate/`** — Vite `base` and BrowserRouter `basename` both set to `/orchestrate/`

State managed via React Context + `useReducer`.

---

### Conceptual Model

| Concept | Description |
|---------|-------------|
| **Intentions** | Specific goals for today (not epics). Entered in Step 1, mapped to Todoist tasks. |
| **Main intentions** | Primary work threads for the day (exclusive session assignment). |
| **Background intentions** | Recurring habits or nudge tasks (multi-session assignment). |
| **Sessions** | 4 configurable time slots (default: Early Morning, Morning, Afternoon, Night). |
| **Todoist** | External task manager. Orchestrate integrates via API for CRUD and hierarchy browsing. |
| **Google Calendar** | Read-only embedded iframe for time-context alongside session planning. |

---

### Integration Architecture

#### Todoist API (v1)
- **Auth**: Personal API token (user pastes from Todoist Settings → Integrations → Developer). No OAuth, no backend.
- **Token storage**: Encrypted in localStorage via AES-GCM with a Web Crypto API-derived key.
- **API base**: `https://api.todoist.com/api/v1/` (unified API — REST v2 was sunset and returns `410 Gone`)
- **Responses**: Paginated — `GET` endpoints return `{ results: [...], next_cursor: string | null }`. All pages fetched via `fetchAllPages<T>()` helper.
- **Mutations**: Create via `POST /api/v1/tasks`. Complete/reopen via Sync endpoint (`POST /api/v1/sync` with `item_complete`/`item_uncomplete`). Update via `POST /api/v1/tasks/{id}`. Delete via `DELETE /api/v1/tasks/{id}`.
- **Projects**: List/create/delete via `/api/v1/projects`. Supports `parent_id` for nesting.
- **Sections**: List via `/api/v1/sections` for within-project grouping.
- **CORS**: Supported. Vite dev proxy (`/api/todoist → api.todoist.com`) used during development for reliability.
- **Rate limits**: 450 requests/min.

#### Google Calendar Embed
- **Method**: Official embeddable iframe URL with multiple `src=` and `color=` params.
- **Auth**: None needed — works if user is logged into Google. Read-only.
- **Multiple calendars**: Overlaid in different colors within a single embed.
- **View mode**: `week` | `month` | `agenda`, configurable via tab bar above the embed. Persisted in settings.
- **Privacy note**: Private/imported calendars may be blocked by third-party cookie policies. "Open in Google Calendar ↗" fallback link provided.
- **Per-calendar colors**: 15-color Google palette (Blue, Lavender, Sage, Grape, Flamingo, Banana, Tangerine, Teal, Basil, Blueberry, Tomato, Citron, Cocoa, Graphite, Birch).

#### Data Flow
```
Orchestrate (intentions, session assignments)  ←→  localStorage
                    ↕ (API calls)
              Todoist API (v1)  →  Todoist tasks (CRUD)
                    ↕ (existing Todoist↔GCal sync)
        Google Calendar embed  →  Visual schedule (read-only)
```

Orchestrate owns the **intention-level** view. Todoist owns the **task-level** view. Google Calendar provides **time-context**.

---

### Security: API Token Storage

#### Approach: AES-GCM encryption via Web Crypto API

1. **Key generation**: Random 256-bit key via `crypto.subtle.generateKey()`. Exported key stored in a separate localStorage entry.
2. **Encryption**: `crypto.subtle.encrypt()` with AES-GCM. Encrypted token + IV stored as base64.
3. **Decryption**: On app load, token decrypted in memory. Plaintext only held in a JS variable, never persisted unencrypted.
4. **Token validation**: On save, `GET /api/v1/projects` verifies validity before storing.
5. **Token removal**: "Disconnect Todoist" wipes both the encrypted token and the key.

#### Threat Model

| Threat | Mitigation | Residual risk |
|--------|-----------|---------------|
| XSS | React's XSS protection, no `dangerouslySetInnerHTML` | If XSS occurs, attacker can call decrypt |
| Physical device access | Encryption raises the bar vs plaintext | Key in adjacent localStorage entry |
| Network sniffing | All API calls HTTPS | None |
| Token scope | Personal tokens have full Todoist access | No mitigation without OAuth |

Acceptable for a personal-use app.

---

### Data Model

```ts
export interface Intention {
    id: string;
    title: string;
    type: 'main' | 'background' | 'unclassified';
    assignedSessions: string[];     // multi-session for background, exclusive for main
    completed: boolean;
    brokenDown: boolean;            // marked in Step 1 mapping phase
    isHabit: boolean;               // optional flag for background intentions
}

export interface DayPlan {
    date: string;                   // YYYY-MM-DD (local time)
    intentions: Intention[];
    intentionSessions: Record<string, string[]>;  // sessionId → intentionId[]
    wizardStep: number;             // 1–5
    setupComplete: boolean;
    checkIns: CheckIn[];
}

export interface AppSettings {
    notificationPreference: NotificationPreference;  // 'in-app' | 'browser' | 'both'
    sessionSlots: SessionSlot[];
    todoistToken?: string;          // encrypted (base64)
    todoistTokenIV?: string;        // AES-GCM IV (base64)
    todoistTokenKey?: string;       // AES key (exported, base64)
    googleCalendarIds?: GoogleCalendarEntry[];
    calendarViewMode?: CalendarViewMode;  // 'week' | 'month' | 'agenda'
}

export interface GoogleCalendarEntry {
    id: string;
    name?: string;   // user-friendly display name
    color?: string;  // hex color from Google's accepted palette
}
```

**Persistence**: `_wizardSteps: 5` marker is stored alongside the plan in localStorage and in saved history entries to differentiate from the old 6-step layout during migration.

**Migration** (`DayPlanContext.tsx`):
- v1 plans with `tasks`/`taskSessions` → v2 `intentions`/`intentionSessions` shape
- `assignedSession: string` → `assignedSessions: string[]`
- Old 6-step wizard numbers remapped to 5-step equivalents
- Legacy `googleCalendarId: string` / `googleCalendarIds: string[]` → `GoogleCalendarEntry[]`

---

### Reducer Actions

| Action | Description |
|--------|-------------|
| `ADD_INTENTION` | Add a new unclassified intention |
| `REMOVE_INTENTION` | Remove an intention (and unassign from all sessions) |
| `UPDATE_INTENTION` | Replace an intention by id |
| `CATEGORIZE_INTENTION` | Set intention type to main or background |
| `REORDER_INTENTIONS` | Reorder all intentions by a new ID list (drag-and-drop) |
| `REORDER_SESSION_INTENTIONS` | Reorder intentions within a session slot |
| `ASSIGN_INTENTION` | Assign to a session (exclusive for main, additive for background) |
| `UNASSIGN_INTENTION` | Remove from a session |
| `TOGGLE_INTENTION_COMPLETE` | Toggle completion flag |
| `MARK_BROKEN_DOWN` | Toggle the breakdown flag (Step 1 mapping) |
| `TOGGLE_HABIT` | Toggle `isHabit` on a background intention |
| `SET_WIZARD_STEP` | Navigate to a specific wizard step |
| `COMPLETE_SETUP` | Mark setup as done |
| `ADD_CHECKIN` | Log an hourly check-in |
| `RESET_DAY` | Clear plan and start fresh |
| `UPDATE_SETTINGS` | Partial-update app settings |
| `SET_EDITING_STEP` | Enter/exit wizard edit mode from dashboard |
| `SAVE_DAY` | Save current plan as a named snapshot (deduplicates by date, includes `_wizardSteps` marker) |
| `RESTORE_DAY` | Replace current plan with a saved snapshot (runs `migratePlan`, stamps today's date) |
| `DELETE_SAVED_DAY` | Remove a saved snapshot from history |
| `IMPORT_SESSIONS` | Merge imported saved sessions into history (deduplicates by `savedAt`) |

---

### Project Structure

```
src/
  types/index.ts              — all TypeScript interfaces
  data/playlists.ts           — 6 Spotify playlists with URLs + work-type mappings
  data/sessions.ts            — 4 default session slot definitions
  context/DayPlanContext.tsx   — React context + useReducer, localStorage sync, migration logic
  lib/
    crypto.ts                 — AES-GCM encrypt/decrypt via Web Crypto API
    time.ts                   — shared timeToMinutes utility
  hooks/
    useCurrentSession.ts      — time-aware current/remaining session computation (updates every 60s)
    useHourlyCheckin.ts       — hourly timer within session boundaries
    useNotifications.ts       — Web Notifications API wrapper
    useTheme.ts               — dark/light mode toggle with localStorage persistence, cross-tab sync
    useTodoist.ts             — Todoist API hook (paginated fetch, CRUD, token decrypt)
    useResizablePanel.ts      — shared drag-to-resize panel logic (used by wizard sidebar + dashboard sidebar)
  components/
    Welcome.tsx               — Welcome screen with greeting, step timeline, About modal, first-time nudge
    ui/
      AboutContent.tsx        — shared About Orchestrate text (used by Welcome and WizardLayout modals)
      Button.tsx              — variant/size button
      Card.tsx                — bordered card wrapper
      EditableTaskList.tsx    — inline-editable list with native HTML drag-and-drop reordering
      ErrorBoundary.tsx       — React error boundary with "Try Again" / "Reset & Reload" recovery
      Modal.tsx               — overlay modal with ✕ close button and Escape key handling
      ProgressBar.tsx         — step progress indicator
    wizard/
      Wizard.tsx              — step router (renders current step component)
      WizardLayout.tsx        — shared layout: progress bar, step pills, resizable sidebar, back/next/done nav, integrations + about modals
      Step1Intentions.tsx     — two-phase intention entry + sequential mapping (split view with TodoistPanel)
      Step2Categorize.tsx     — main/background classification with habit toggle
      Step3ScheduleMain.tsx   — assign main intentions to sessions (split view: schedule + Todoist + GCal)
      Step4ScheduleBackground.tsx — assign background intentions to sessions (multi-session, same layout)
      Step5StartMusic.tsx     — recap + embedded Spotify player for Start Work playlist
    dashboard/
      Dashboard.tsx           — main dashboard with music, Todoist, calendar, timeline, check-ins, save/restore
      SessionTimeline.tsx     — vertical session timeline with completion toggles, inline editing, drag reorder; exports CurrentSession + SessionTimeline
      DigitalClock.tsx        — large time display + date (updates every second)
      MusicPanel.tsx          — exports MusicProvider (shared context), PlaylistSelector (button bar), SpotifyPlayer (embed with custom URL editing)
      SavedSessions.tsx       — saved day history with restore/delete/export/import; compact mode for wizard sidebar
      TransitionTips.tsx      — static music-protocol transition tips
    checkin/
      CheckInModal.tsx        — hourly check-in with feeling + work type + playlist suggestion + recontextualize option
    todoist/
      TodoistPanel.tsx        — collapsible nested project tree (projects → sections → tasks → sub-tasks)
      TodoistSetup.tsx        — Todoist token setup + Google Calendar entries with per-calendar color/name
      GoogleCalendarEmbed.tsx — configurable multi-calendar embed with view mode tabs
  App.tsx                     — router + context provider + error boundary
  main.tsx                    — entry point with BrowserRouter (basename=/orchestrate/)
  index.css                   — Tailwind import + @theme color definitions + dark mode overrides
```

---

### Routing

| Route | Condition | Renders |
|-------|-----------|---------|
| `/` | `setupComplete` | `<Dashboard />` |
| `/` | `!setupComplete` | `<Welcome />` |
| `/setup` | `setupComplete` OR `fromWelcome` state | `<Wizard />` |
| `/setup` | otherwise | `<Navigate to="/" />` |
| `*` | any | `<Navigate to="/" />` |

The `fromWelcome` pattern: Welcome and "Start New Day" navigate to `/setup` with `{ state: { fromWelcome: true } }`. This state is ephemeral — reloading `/setup` mid-wizard returns to Welcome, re-grounding the user.

---

### Wizard Flow (5 steps)

#### Step 1: Set & Map Intentions
**Layout**: Split view — left (two-phase intention flow) + right (TodoistPanel full mode). Wide layout.

- **Phase 1 — Set intentions**: Input + `EditableTaskList` (drag-reorder, edit, remove). "Start mapping →" button appears once at least one intention exists. Footer "Continue" is disabled until mapping starts.
- **Phase 2 — Sequential mapping**: Intentions presented one at a time. Current intention highlighted in a bordered card with "Done — next/finish". Progress bar shows `brokenDown / total`. Current intention title is click-to-edit inline. New intentions can be added during mapping. Auto-enters Phase 2 if returning with already-broken-down or categorized intentions.
- **Right panel**: `TodoistPanel` full mode, constrained to `min-h-[400px] max-h-[70vh]`. Shows setup prompt if Todoist not configured.
- **Onboarding banner**: Shown when Todoist or Google Calendar not configured. Dismissible.
- **Advance condition**: at least one intention added AND mapping started.
- Pill label: **"Intentions"**

#### Step 2: Categorize
- Main / Background pills per intention. Habit toggle (🔄) appears for background intentions.
- Advance condition: all intentions categorized.
- Pill label: **"Categorize"**

#### Step 3: Schedule Main Intentions
**Layout**: Top row split (schedule left + Todoist compact right), bottom row full-width calendar. Wide layout.
- Session cards show assigned main intentions (click to unassign) + unassigned pills (click to assign). Main intentions are exclusive to one session.
- Only remaining sessions (by current time) are shown.
- Pill label: **"Main Schedule"**

#### Step 4: Schedule Background / Nudges
**Layout**: Same as Step 3.
- Background intentions can be assigned to **multiple sessions**. Session cards show main intentions (read-only context) + assigned background (click to remove) + available background (click to add).
- Habit badge (🔄) shown on habit intentions.
- Pill label: **"Nudges"**

#### Step 5: Start Music
- Recap with embedded Spotify player for the Start Work playlist. "Go to Dashboard" button completes setup.
- "Skip and go to dashboard" / "Back to dashboard" link below.
- Music protocol tips.
- Pill label: **"Music"**

#### Step Navigation
- **During setup**: Pills for visited steps are clickable (backward). Next step pill clickable when `canAdvance` is true. Cannot skip ahead.
- **After setup (edit mode)**: All pills freely clickable. "Done" / "Back to Dashboard" button returns to dashboard.

---

### Dashboard

**Header**: Logo, completion counter, Save Day / Edit Plan / Start New Day / Saved Sessions / Settings / theme toggle.

**Layout** (top to bottom):
1. **Music**: Row 1 — `PlaylistSelector` (horizontal buttons) + `DigitalClock`. Row 2 — `SpotifyPlayer` (embed with custom URL support) + `TransitionTips`.
2. **Task Manager** (collapsible): `TodoistPanel` full mode, 400px height.
3. **Calendar** (collapsible): `GoogleCalendarEmbed` with view mode tabs.
4. **Current Session**: Active session card with intention completion toggles, inline editing, drag reorder, background nudge banner.
5. **Timeline**: All session cards with past sessions dimmed.

**Saved Sessions sidebar**: Resizable left panel (via `useResizablePanel`). Import/export JSON. Restore with confirmation.

**Music panel**: `MusicProvider` shares state. Per-playlist custom URL overrides persisted in localStorage. Last selection persisted. Check-in playlist suggestions surface as "Suggested" badge.

---

### Hourly Check-In

- Fires on next whole hour, then every 60 minutes, while within a session and setup is complete.
- Modal: feeling (great/okay/struggling/stuck) + work type + playlist suggestion + optional notes.
- Background nudge reminder for the current session.
- **Recontextualize option**: "Reschedule Sessions" logs check-in, then navigates to Step 3 in edit mode.

---

### Save/Restore

- **Save Day**: Prompts for name (defaults to formatted date). Replaces existing snapshot for same date. Includes `_wizardSteps: 5` marker for migration safety.
- **Restore**: Replaces current plan. Runs `migratePlan()` on the saved data. Stamps today's date.
- **Start New Day**: Offers to save current session first, then resets and navigates to wizard.
- **Export/Import**: JSON files — individual or bulk. Validates structure and deduplicates by `savedAt`.

---

### Dark Mode

- Class-based toggle (`.dark` on `<html>`) with CSS custom property overrides.
- Persisted in localStorage (`orchestrate-theme`).
- Synced across tabs via `StorageEvent` + `useSyncExternalStore`.
- Toggle button in wizard header, dashboard header, and Welcome screen.
- PWA theme-color meta tag updated on toggle.

---

### Todoist API Reference

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/v1/projects` | GET | List projects (paginated, includes `parent_id`) — also used for token validation |
| `/api/v1/projects` | POST | Create project (`parent_id` for nesting) |
| `/api/v1/projects/{id}` | DELETE | Delete project |
| `/api/v1/sections` | GET | List sections (paginated) |
| `/api/v1/tasks` | GET | List active tasks (paginated, includes `section_id`, `parent_id`) |
| `/api/v1/tasks` | POST | Create task |
| `/api/v1/tasks/{id}` | POST | Update task (`due_datetime`, `duration`, `duration_unit`) |
| `/api/v1/tasks/{id}` | DELETE | Delete task |
| `/api/v1/sync` | POST | Complete (`item_complete`) / Reopen (`item_uncomplete`) |

All requests: `Authorization: Bearer {token}`. Dev proxy: `/api/todoist/* → https://api.todoist.com/*`.

**Local state cleanup on delete**: Both `deleteTask` and `deleteProject` recursively collect all descendant IDs before filtering local state, ensuring deeply nested children are removed.

---

### TodoistPanel Component

Displays tasks in a **collapsible nested tree** mirroring Todoist's sidebar:
- **Projects** nested via `parent_id`, with Todoist color dots and task count badges.
- **Sections** group tasks within projects, with collapsible headers.
- **Sub-tasks** rendered recursively under parent tasks.
- **Two modes**: `compact` (read-only tree, hides due dates/create inputs) and `full` (tree + inline task/project creation).
- **Task scheduling**: ⏱ icon on hover opens inline time range picker (start/end). Duration sent to Todoist API. "Clear" resets to date-only. Scheduled times displayed in both modes.
- **Desktop deep link**: "Open in Todoist ↗" uses `todoist://` URL scheme.
- **All date operations use local time** (`date-fns format`) to avoid UTC/timezone mismatches.

---

### Decisions

- **Todoist API v1 + personal token** instead of Trevor AI iframe (iframe blocked; REST v2 sunset)
- **Google Calendar embed** for read-only calendar context (officially supported)
- **Client-side token encryption** (AES-GCM via Web Crypto API)
- **No backend**
- **Parallel data model**: Orchestrate owns intentions/sessions, Todoist owns tasks, GCal provides time context
- **Multi-session assignment**: Only for background intentions
- **Step count: 5** — intention entry and todolist mapping merged into one step
- **No Spotify API** — playlists use iframe embeds + deep links; per-playlist custom URL overrides
- **Decomposed MusicPanel** — `MusicProvider`, `PlaylistSelector`, `SpotifyPlayer` as separate exports for flexible layout
- **Native HTML Drag and Drop** — no library, keeps bundle lean
- **Manual "Start New Day"** — no auto-reset
- **Non-linear wizard** — step pills always accessible; edit mode from dashboard
- **Music panel always open** — defaults to Start Work playlist
- **Green-themed icon** — favicon SVG (`#3d9970`); PWA icons generated from same source

---

### Verification Checklist

1. Walk all 5 wizard steps — add intentions, map sequentially, categorize, schedule, start music
2. Start app at different times → only remaining sessions offered in Steps 3–4
3. Complete wizard → dashboard loads. Refresh → loads from localStorage.
4. "Start New Day" → save prompt → wizard restarts with empty state
5. "Edit Plan" → wizard with step pills; jump to any step; "Done" returns
6. "Save Day" → name prompt; snapshot appears in Saved Sessions; restore replaces with confirmation
7. Wizard sidebar: saved sessions + import always visible during initial setup; restore navigates to dashboard
8. Hourly check-in fires within session → modal appears; playlist suggestion matches work type
9. "Reschedule Sessions" → navigates to Step 3 in edit mode
10. Configure Todoist token → tasks load; create/complete/delete/schedule tasks via panel
11. Delete project/task with nested children → all descendants removed from local state
12. Google Calendar embed shows configured calendars with correct colors
13. Export/import JSON sessions — validates and deduplicates
14. Dark mode toggle persists across reload and syncs across tabs
15. Browser notifications work when enabled; graceful fallback when denied
16. Token stored encrypted (not plaintext in DevTools)
17. `vite build` → serve `dist/` → full flow works
18. Responsive test at 375px, 768px, 1280px

---

### Historical Bug Fixes (all resolved)

| # | Issue | Fix |
|---|-------|-----|
| 1 | `useCurrentSession` never re-evaluated as time passed | Added `tick` state that increments every 60s |
| 2 | `RESTORE_DAY` without `migratePlan` crashed on v1 imports | Restore calls `migratePlan()` |
| 3 | Todoist pagination only fetched first page | `fetchAllPages<T>()` loops `next_cursor` |
| 4 | No error boundary — white screen on error | `ErrorBoundary` wrapping `<DayPlanProvider>` |
| 5 | Modal Escape required focus on backdrop | Document-level `keydown` listener |
| 6 | No catch-all route | `<Route path="*">` |
| 7 | `SAVE_DAY` duplicated on repeated saves | Filters by `plan.date` before prepending |
| 8 | `RESTORE_DAY` preserved stale date → discarded on reload | Stamps `date: todayISO()` |
| 9 | `SAVE_DAY` didn't include `_wizardSteps` marker → corrupted wizard step on restore | Saved plans now include `_wizardSteps: 5` |
| 10 | "Start New Day" navigated to `/setup` without `fromWelcome` → bounced to Welcome | Passes `{ state: { fromWelcome: true } }` |
| 11 | Notification icon path wrong in production (`/favicon.svg` vs `/orchestrate/`) | Uses `import.meta.env.BASE_URL` prefix |
| 12 | `deleteProject`/`deleteTask` only removed direct children from local state | Recursive descendant collection before filtering |
| 13 | `TodoistPanel` used UTC date (`toISOString().slice`) → wrong day near midnight | Replaced with `format(new Date(), 'yyyy-MM-dd')` (local time) |
| 14 | `new Date(plan.date)` parsed YYYY-MM-DD as UTC midnight | Replaced with `parseISO()` from date-fns |

### Dead Code Removed

- `useLocalStorage` hook (unused — localStorage managed directly in context and MusicPanel)
- `syncChecklist` field and `TOGGLE_SYNC_ITEM` action (vestigial from v1 todolist sync step)
- `Task` type alias (deprecated, never imported)
- `MusicPanel` convenience wrapper (unused — dashboard uses decomposed pattern)

### Deduplication

- `timeToMinutes` → extracted to `src/lib/time.ts` (shared by `useCurrentSession` and `useHourlyCheckin`)
- Resizable panel logic → extracted to `src/hooks/useResizablePanel.ts` (shared by `WizardLayout` and `Dashboard`)
- About modal text → extracted to `src/components/ui/AboutContent.tsx` (shared by `WizardLayout` and `Welcome`)
