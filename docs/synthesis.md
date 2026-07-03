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
| Routing | React Router v7 (`BrowserRouter`, basename `/` — served at the domain root on Cloudflare Pages) |
| State management | React Context + `useReducer` (DayPlan), React Context + `useState` (Todoist, Music) |
| Persistence | `localStorage` only — 4 primary keys + 3 auxiliary keys |
| External APIs | Todoist REST API v1, Google Calendar (REST v3 via server-mediated OAuth — API-rendered events with FullCalendar, plus a read-only timeline overlay), Spotify embed |
| Crypto | Web Crypto API — HMAC-SHA256 for OAuth `state` signing, **server-side** in the Worker. (Integration tokens are no longer encrypted in the browser; they live server-side in KV.) |
| PWA | Service worker (network-first, falls back to cache then `index.html`), manifest with maskable icons |
| Dependencies of note | `canvas-confetti` (task completion), `date-fns`, `react-router-dom` |

---

## 3. Provider Tree & Routing

### 3.1 Provider Tree

```
StrictMode                         (main.tsx)
`-- BrowserRouter (basename: /)   (main.tsx)
    `-- App                        (App.tsx)
        `-- ErrorBoundary
            `-- DayPlanProvider              <-- core app state (plan, settings, history, life)
                `-- NotificationProvider     <-- v7.8: in-app notification banner queue + viewport
                    `-- GoogleCalendarProvider   <-- v7.2: server-mediated OAuth (calendar list + write plumbing)
                        `-- TodoistProvider          <-- Todoist data + API actions
                            `-- ReconciliationProvider  <-- v6.5: central habit reconcile
                                `-- NotificationBridge  <-- v7.8: engagement nudge + sync-error toasts
                                `-- AppRoutes        <-- router switch
```

- `ErrorBoundary` is the outermost component in `App.tsx` so a crash in any provider or route is caught gracefully.
- `GoogleCalendarProvider` reads `settings` (the `googleCalendarConnected` flag) + `dispatch` from `DayPlanProvider`; it is independent of Todoist/Reconciliation (its order relative to them does not matter). The **refresh token lives server-side** (Cloudflare Worker + KV); the provider holds only a short-lived access token **in memory** (re-minted by the Worker on demand) plus a runtime shared secret in localStorage.
- `TodoistProvider` reads `settings` (connection state + habits project preference) and `plan` (linked tasks for reconciliation) from `DayPlanProvider`, so it must be nested inside it.
- `ReconciliationProvider` reads both — habits + active season + plan-date from `DayPlanProvider`, taskMap + actions from `TodoistProvider` — so it sits below both. See [`src/context/ReconciliationContext.tsx`](../src/context/ReconciliationContext.tsx).
- `NotificationProvider` (v7.8) sits above the integration providers so they (and any view) can raise in-app banners via `useNotify`. It owns the toast queue and renders `NotificationViewport` (fixed, bottom-right, themed by kind: info/success/warning/error; info/success auto-dismiss, errors persist; de-duped by `dedupeKey`). `NotificationBridge` — a headless component under all providers — runs the engagement nudge app-wide and watches the Todoist / Google Calendar / reconciliation contexts, raising an **error banner on a sync failure** (linking to Integrations). Native browser notifications are now a **background-only fallback** in `useNotifications` (fired only when the tab is hidden and the preference allows the browser channel).

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

Pressing **▶ Start** on a task in the Current Session card opens an engagement segment. Where it lands
follows the strict toggle (v7.5/7.6): **strict** drops straight into `/focus` (the first-action capture
happens there); **relaxed** runs the timer **in place** on the dashboard row and exposes a **◎** icon to
enter `/focus` on demand. Focus is a distraction-free page; its target is derived via
`findActiveFocusTask(plan)` (the engaged `LinkedTask` with an open segment), so it reflects Stop/Complete
instantly and survives a reload. **Stop** closes the segment; **Complete** ticks the task in Todoist and
returns to `/`. See the v7.6 state machine below for the in-page flow.

An optional **Pomodoro** engine (toggle persisted in `localStorage`) turns the task's estimate into a
slot schedule via `computeFocusPlan(estimate)`: ≥45 min → 20-min work blocks with 5-min breaks; 30–44
min → 10-min blocks; <30 min or unestimated → a single session. The blocks render as a vertical
`FocusSlotPlan`, and when the engine runs (`resolveBlockAt`) it highlights the live block, counts it
down, and fires a chime (`lib/sound.ts`) + notification at each work↔break boundary.

Focus Mode is the app's **execution surface**, so the **music protocol** lives here: the shared
`MusicProvider` wraps a card-less `PlaylistSelector` + `SpotifyPlayer` above the timer (v7.6). The
dashboard no longer carries the Spotify embed. (The static transition-tips card was dropped in v7.6.)

A separate **engagement nudge** (`useEngagementNudge`, run app-wide by `NotificationBridge` — v7.8,
formerly `useFocusNudge` on the Dashboard) notifies the user if they've been idle in an active session
without engaging anything (and the session still has incomplete work) past a **configurable threshold**
(`settings.engagementNudgeMinutes`, default 10; `0` disables), repeating every 30 min while idle.
**v7.8** anchors the elapsed clock to the **last engagement boundary** (`lastEngagementBoundary` — the
most recent Start→Stop today) rather than the session start, so it reports "time since you last did
something" (folded into hours via `formatDuration`), and is reworded away from "focus". The
notification fires once at the threshold; thereafter a **persistent dashboard banner**
(`useEngagementBanner`) stays visible until the user re-engages. Both share the pure `engagementIdleState`
helper in `lib/engagement.ts`. No new entities, reducer actions, or schema migration — it's a view over
the existing engagement-segment model.

**v7.4 — re-entry breadcrumb + activation ramp.** Focus Mode is the execution surface, so the v7.4
execution-friction features live here. A per-task **re-entry breadcrumb** is a cumulative trail
(`LinkedTask.contextTrail`, Phase 2 — replacing the Phase-1 `reentryNote`/`firstAction` scalars). Focus
renders the **whole trail** under a "Re-entry context" header plus a **"last worked Xm ago"** line read
from the durable engagement archive (the re-entry moment surfaced at return). The "Next step" input
holds a draft committed as one **`exit` note on Stop/Complete** (carried by `STOP_TASK_ENGAGEMENT` /
`TOGGLE_TASK_COMPLETE`), and a **"+ Add"** affordance appends a breadcrumb mid-session
(`APPEND_TASK_CONTEXT_NOTE`); the Step 2 entry point is an **`entry` note** (`APPEND_TASK_ENTRY_NOTE`, v7.6 — accumulates per engagement).
Dashboard Current Session rows show a truncated `↩` preview of the latest note. **Deliberate gates:**
you can't **Start** a task with an empty trail (dashboard ▶ prompts for a first concrete action first),
can't **Stop** in Focus without a next-step note (Stop disabled until non-empty), and the dashboard ■
on an engaged task routes to Focus so Stop is note-gated in one place. A **bounded activation ramp**
(5/10-min presets, last choice persisted to `localStorage`) is a deliberate, *closing* pre-work window —
it counts down, fires a chime + "begin work" notification at zero, and the engagement timer keeps
running alongside. Ramp is still a local component feature (mirrors the Pomodoro toggle) — no
schema/reducer change.

**v7.5 — Focus entry + strictness config.** Starting a task no longer drops the user into Focus; **▶**
starts the engagement timer in place and a separate **◎** row icon is the explicit way into `/focus`.
The **first-concrete-action** modal now shows the task title, and (since `Modal` portals to `<body>`)
it renders at full opacity even when the launching row sits inside a dimmed past-session card. A new
`settings.focusStrict` flag (default **true**, toggled from a **🔒/🔓 Focus: Strict/Relaxed** pill in the
dashboard *Today* header) governs the note gates: **strict** keeps the first-action note (on Start) and
the next-step note (on Stop **and on leaving Focus**) *required*; **relaxed** makes both optional. The
Focus header carries a **theme toggle**, and the **Exit** button is note-gated in strict mode — closing
the prior escape hatch where Exit bypassed the Stop note (relaxed mode commits any draft as a breadcrumb
on the way out). Additive settings field; no schema bump.

**v7.6 — Focus Mode execution improvements.** This iteration turns Focus into a first-class execution
surface built around an explicit state machine, and pushes execution-level metadata off the planning
dashboard into Focus. There are two Focus surfaces:

- **Selection — `FocusPicker`** (shown when nothing is engaged: fresh entry via the dashboard's **◎ Focus**
  header button, or right after a Stop, so there's no "No task / Exit" dead-end). It lists today's
  incomplete tasks grouped by intention (each with its latest `↩` breadcrumb — moved here from the
  dashboard rows; **drag-to-reorder** within an intention via `REORDER_INTENTION_TASKS`), the
  **day-context `SessionTimeline` bar** (moved out of the timer surface), and the **day-wide engagement
  log** (`EngagementTimeline`, reusing `buildEngagementLog` — moved off the dashboard). Picking a task
  engages it → the execution surface mounts.
- **Execution — `FocusActive`**, a four-phase machine with exactly one phase owning the centre:
  **`firstAction` → `ramp` → `working` ⇄ `stopping`**. `firstAction` (strict-only, when the trail has no
  `entry` note) captures the concrete first move *inline in the card* (the old dashboard modal is gone) via
  `UPSERT_TASK_ENTRY_NOTE`. `ramp` is the **default entry phase** (we always ease in before the timer)
  and centres the activation-ramp countdown with the task timer de-emphasised beside it; Begin/Skip →
  `working`, **Stop** → `stopping`. `working` centres the task count-up (or the Pomodoro block display).
  A **shared bottom action bar** runs across `firstAction`/`ramp`/`working` (one Stop button → `stopping`;
  Complete on ramp/working; Pomodoro toggle only while working) — so the first-move step can Stop too.
  **Stop** swaps the centre for `stopping` — the next-step input — where **Continue** returns without
  committing, **+ Add breadcrumb** appends an `exit` note mid-session (`APPEND_TASK_CONTEXT_NOTE`), and
  **Stop** closes the segment (→ back to the picker). The in-card **`PhaseStepper`** shows machine position
  (drops `firstAction` in relaxed mode) and is **clickable to navigate** — backwards to re-contextualize, or
  forwards (e.g. `ramp` → Focused / Wrap up), the only gate being you can't skip *out* of `firstAction`.
  Toggling the **strict/relaxed pill** mid-`firstAction` advances the machine in the same handler so it
  never strands.

The timer is an **ambient surface** (no hard card) at dashboard width (`max-w-5xl`), with a compact music
panel on top. **The card body (`TimerTaskList`) is the intention's vertical task list**: the focused task
expands to host the state machine, the others are compact rows (click to **switch focus** — `switchTo`,
note-gated in strict). The header carries the intention name, an **intention carousel** (prev/next browses
intentions *without* engaging — "moving out of the task outside the stop flow"), and an **✎ Edit toggle**
that drops the list into a **drag-to-reorder** view (`REORDER_INTENTION_TASKS`). Beside the timer, the
**`EngagementTimeline`** is the *same* day-wide log shown on the picker (shared `TimelineFrame` primitive),
reused here with the **currently-executing task's cards highlighted**. It's laid out as an **hourly grid**
bounded by the settings day-limits (`timelineStart/EndMinutes`): each engaged hour is a labelled row (runs
of empty hours **collapse** into a compact `⋯` gap row) and each Start→Stop is **one card** (one segment =
one card) placed in the hour it started, with its **start time pinned to the top and end time to the bottom** (open segments read "in progress"; closed durations break
into hours — "2h 36m"). `entry`/`exit` notes — now **accumulated per engagement** and correlated to each
segment by timestamp window — sit **outside** the card and are **deletable** (`DELETE_TASK_CONTEXT_NOTE`).
The grid behaves like a **transcript** — it anchors to the latest engaged hour (a `[data-latest]` row, not
the empty future) and shows a **jump-to-latest** affordance when scrolled away; hovering a card **portals a
popover** (so the scroll container can't clip it) with that intention's tasks in order. The
header surfaces the **re-entry metric** (`computeReentryStats`). A **back arrow** **peeks** the picker (router
`state.pick`) without ending the engagement (timer keeps running; chooser hidden while peeking). Dashboard
tidy-up: in **relaxed** mode the engaged **■** **stops in place** instead of routing to Focus (strict still
routes to capture the required note); the low-value transition-tips card is gone. One small reducer add
(`DELETE_TASK_CONTEXT_NOTE`); otherwise view/local-state — no schema change.

**v7.4 Phase 2 — durable engagement history.** Every segment close (Stop/Complete/Skip, tasks +
habits) is **written through** to `LifeContext.engagementHistory` — a durable `EngagementRecord[]`
keyed by a durable source id (`todoistId` / `Habit.id`) so re-entry latency and streaks survive
rollover. Bounded by a **90-day rolling prune** (transitional under localStorage). The **re-entry metric**
(`computeReentryStats`) is computed from this history. Pure helpers in `lib/engagementHistory.ts`. (v7.6:
the day's engagement log itself moved off the dashboard into the Focus picker as `DayEngagementTimeline`.)

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

A secondary **⚡ Quick start** link under the primary CTA (v7.4) opens the `QuickStart` modal — a low-friction entry that bypasses the 5-step wizard on low-activation days. Pick existing Todoist tasks and/or free-type new ones (both on one screen); on Start it creates Todoist tasks for the typed lines, fires the atomic `QUICK_START` reducer action (one "Today" intention + a main `LinkedTask` per id assigned to the session covering now + `setupComplete: true`), engages the first task, and navigates to `/focus`. Requires Todoist connected (free-typed lines become real Todoist tasks, keeping Todoist the source of truth).

The top-right fixed controls -- About, Settings, ThemeToggle -- are rendered by the shared `HeaderControls` component across all surfaces.

### 5.2 Wizard (5 Steps)

A sequential flow captured in `plan.wizardStep` (1-indexed, persists across refreshes). `WizardLayout` wraps every step with a collapsible saved-sessions sidebar, header with step progress pills, and Back/Next footer. An "editing" mode supports returning from the dashboard.

1. **Step 1 -- Sessions** (`Step1Sessions`). Define the day's work sessions **first** (v7.8: moved ahead of Intentions, so the session shape scopes intention planning) on a **drag-calendar** (`SessionEditorTimeline`): drag an empty area to add a block, drag a block to move, drag its edges to resize, click to rename/delete (15-min snapping, advisory overlap tint). v7.9: when Google Calendar is connected, that day's **external events render read-only** (shared positioning math in `lib/timelineEvents`) — meetings inform where sessions go. v7.10: every event surfaces as a chip in a **rail above the editable track** (row-packed so time-overlapping ones stack), kept entirely off the editing surface so nothing overlaps the blocks; chips are hoverable (`title` + the shared `tl-event-*` hover-expand styling). A **season-focus context banner** (`SeasonFocusBanner`, moved here from the Intentions step in v7.9) sits at the top: the active season's arc + supporting-goal chips and today's recurring habits (each with a ✓ to mark done). The day's sessions live on `DayPlan.sessionSlots` (seeded from the last-used day) and drive every surface thereafter. **Session Templates** (from the Life section) appear as quick-apply chips — applying one replaces the day's sessions (and clears assignments, with a confirm if any exist). A "Save as template" affordance persists the current layout to `LifeContext.sessionTemplates`. Granular reducer actions (`ADD_/UPDATE_/REMOVE_DAY_SESSION`, `APPLY_SESSION_TEMPLATE`) keep session ids stable so assignments survive a Back-edit.

2. **Step 2 -- Intentions** (`Step2Intentions`). Two phases: (a) write down intentions, (b) sequentially map each to Todoist tasks via the embedded `TodoistPanel` (Link/Unlink buttons). The current intention's linked tasks render in `linkedTaskIds` order and are **drag-reorderable** (`REORDER_INTENTION_TASKS`); linking more than 5 tasks to one intention surfaces a scope-creep nudge ("this is probably an epic — split it"). The focused "Current" card can be **collapsed** to fold all not-yet-mapped intentions (the current one included) into a single drag-reorderable list (`REORDER_INTENTIONS`); picking "Map →" re-focuses one. Mapped intentions become collapsible panels showing their linked tasks. The step also fires `REFRESH_TODAYS_HABITS` to populate today's habits (both kinds) as `TodaysHabitInstance` rows, showing a chip count; each season-banner habit chip has a ✓ to mark it done for today (`useCompleteHabitInstance`). The `TodoistPanel` renders a non-actionable "Habit" label on rows backing a `TodaysHabitInstance`, and its task rows support **drag-reorder within a sibling group** (writes Todoist `child_order` via `item_reorder`). Each intention row has archive-to-backlog and delete buttons (both unschedule linked Todoist tasks via `useIntentionRemoval`). (The season-focus context banner moved to Step 1 in v7.9, but recurring-focus chips it surfaces still add intentions here in plan order.)

3. **Step 3 -- Refine** (`Step3Refine`). Per-intention sequential flow: categorize each linked task as **main** or **background**, set an **estimate** (preset pills or custom). Background tasks clamp to `taskCapDefaults.manualBackground`. Tasks > 60 min trigger a nudge to break down via the TodoistPanel. v7.4: **main** tasks also get an optional **"First concrete action"** input (`SET_TASK_FIRST_ACTION` → `LinkedTask.firstAction`) — a concrete entry point that seeds the Focus Mode re-entry breadcrumb. Strictly optional; never gates advancing.

4. **Step 4 -- Schedule** (`Step4Schedule`). Two phases:
   - **Phase 1 (Assign):** Proportional `SessionTimelineBar` shows **all of the day's sessions** as blocks (past ones sit left of the now-line) plus a dedicated **habit lane** above where `TodaysHabitInstance` rows render at their `targetTime` (untimed ones cluster as "Anytime today"), and — when Google Calendar is connected — that day's **external calendar events as read-only faded bars inside the session band itself** (behind the session blocks; not editable on the bar, and only for calendars toggled visible on the timeline surface). A built-in **view toggle** (top-right) cycles the bar between the full configured day and just the remaining part of the day; the remaining view anchors its left edge to the in-progress session's start so the current session stays fully visible even though it began before now. Clicking a session opens its detail panel: current/upcoming sessions allow assigning tasks; a **past session is read-only for new assignments** but its tasks can be moved forward to a current/upcoming session via a "Move to…" dropdown. Task placement honours the Intentions step's sequencing (intentions in plan order, tasks in `linkedTaskIds` order) consistently — inside the timeline session blocks (via the bar's `taskOrder` prop) and in the selected-session detail panel (assigned groups, assigned background, and the Add-task lists). A "Today's intentions" overview panel lists every active intention with archive/delete buttons. The "Today's habits" panel exposes ✓ Done (mark complete) alongside Reschedule. Cannot advance until at least one task is assigned.
   - **Phase 2 (Time):** Side-by-side TodoistPanel + the API-rendered Google Calendar (FullCalendar, editable) for time-blocking, plus a "Today's habits" panel above (habit-kind only; micro-gaps are off-timeline). Habits past their target window get an inline reschedule affordance; v6.8 strict ones are tagged "missed" (greyed) but still listed and reschedulable.

5. **Step 5 -- Ready** (`Step5Launch`, v7.8). A calm "your day is ready" hand-off with the "Start Work" Spotify playlist embedded as a ramp-in on-ramp, so scheduling ends with an eased transition rather than dumping straight onto the dashboard. Completes setup (`COMPLETE_SETUP`) and offers a primary **Go to Dashboard** plus a secondary **Enter Focus Mode** launch.

The user can return from the Dashboard: "Edit Plan" -> Step 1 (Sessions, the top of the flow), "Recontextualize" -> Step 4 (Schedule). The wizard header also carries a **Life** link to `/life`.

### 5.3 Dashboard

The operational view for the rest of the day (`Dashboard.tsx`):

**Top region (full width):**
1. **Header** -- completion counter, Save/Edit/Saved Sessions buttons, `HeaderControls`.
2. **Greeting panel** -- a time-of-day greeting ("Good morning/afternoon/evening, {settings.userName}." + a day-of-week closer) beside the large live `DigitalClock`. The optional `userName` is set in Settings; the greeting omits the name when unset.
3. **Season panel** -- `SeasonContextCard variant="inline"`: one quiet panel with the context bar (name, "Week N of M" pill, date range, theme, **success criteria**, **supporting goals** as wrapping ◆ chips mirroring the Step 1 `SeasonFocusBanner`) alongside a **Recurring Focuses** column (active focuses with a cadence pill + an "+ Add focus" link that deep-links to `SeasonDetail` in edit mode via router `state.openEdit`). The music protocol (Spotify) moved to Focus Mode (§3.3).
4. **Between-session True Rest banner** -- inside the "Today" section, when no session is active and the next slot is within 60 min.

**"Today" section** -- a borderless tinted working area (header "Today") that leads with the full-width `SessionTimelineBar` (active-session pulse + habit lane rendering `TodaysHabitInstance`s) — **hidden below the `md` breakpoint**, since the proportional non-reflowing bar is cramped on narrow screens, so the current session leads on mobile — then a two-column region below (stacks on small screens). The dashboard is the home for **placement drift** (the wizard remains the home for *contextualization*): you can re-place tasks and reshape today's sessions without re-entering the wizard.
- **Task drag-and-drop + "Move to…":** the bar's task pills are draggable between session blocks and to/from the **Anytime tray**; every task row also has a per-row "Move to…" menu (sessions + Anytime) for keyboard/mobile parity. Both route through `useTaskPlacement().moveTask` (reuses `ASSIGN_TASK`/`UNASSIGN_TASK`; main stays session-exclusive). Within-session reorder stays in the Current Session card.
- **"Adjust day" toggle** (beside the "Today" header, `md`+ only): swaps the read-only bar for the wizard's `SessionEditorTimeline` to move/resize/rename/add/delete today's sessions for clock-drift (`ADD_/UPDATE_/REMOVE_DAY_SESSION`). v7.10: it now carries the same Google Calendar context as the wizard editor (all events in a chip rail above the track). Removing a session drops its tasks into the Anytime tray; `UPDATE_DAY_SESSION` keeps the id, so assignments survive a time edit. **Templates stay in the wizard** (that's "redefine the layout").
- **Left column:**
  5. **Current Session** -- active session's tasks: drag-to-reorder, completion checkboxes (with confetti), engagement Start/Stop buttons + live m:s timer on engaged rows, nudge banners for background tasks. `SessionCapacityBadge` + `SessionCapacityBanner` when over-capacity.
  5b. **Anytime today** (`AnytimeTray`) -- linked, still-open tasks committed for today but in no session (`assignedSessions.length === 0`, via `unscheduledTasks`), grouped by intention; also a drop target for "set aside for anytime". Hidden when empty.
  6. **Task Manager** -- collapsible `TodoistPanel`, defaulting to "Linked Tasks" filter.
  7. **Calendar** -- collapsible API-rendered Google Calendar (FullCalendar; create/edit/delete events, drag/resize, shows private calendars).
  - *(v7.6: the **Engagement Log** moved off the dashboard into the Focus picker as `DayEngagementTimeline` — same `buildEngagementLog` data, redrawn in the shared focus-timeline visual.)*
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
- **`settings`** -- persistent `AppSettings` (notification preference, legacy session-slot fallback, Google Calendar config, `habitsTodoistProjectId`). Note (v7.1): the live per-day sessions are `plan.sessionSlots`; `settings.sessionSlots` is only a seed/reset fallback now. The Todoist token is **not** here — it lives server-side in Workers KV (v7.2).
- **`editingStep`** -- tracks whether the user is re-editing from the dashboard (`number | null`).
- **`history`** -- array of `SavedDayPlan` entries for past sessions.
- **`life`** -- persistent `LifeContext` (seasons, habits, activeSeasonId, backlog, rest cues, session templates (v7.1), engagementHistory (v7.4 Phase 2 — durable, 90-day-pruned engagement archive)).

**Architecture:** `useReducer` with a ~60-action discriminated union. State is initialized lazily via `loadInitialState()` which calls `loadPlan()` + `loadLifeContext()` + `loadHistory()` + `loadSettings()` and handles day rollover in one place. Four `useEffect` hooks persist each slice back to `localStorage` on every change.

**Plan date freshness + rollover:** `loadPlan()` returns the current-schema persisted plan without a date gate. If the date is stale, `loadInitialState` runs `harvestStalePlan(plan)` to compute `BacklogEntry[]` for unfinished intentions, appending them to `life.backlog` with `reason: 'rollover'`. No automatic save to `SavedDayPlan` history at rollover -- the backlog preserves the meaningful unfinished part. Manual `SAVE_DAY` is the only writer to history. Auto-rollover does NOT touch Todoist -- yesterday's tasks remain visibly overdue.

**Schema guard (floor-and-migrate from 7.1):** every persisted slice (plan / settings / life) and every saved-session plan is stamped with `_schemaVersion` (current `SCHEMA_VERSION` = `7.4`, a JSON float; constants + gate helpers in `src/lib/schema.ts`). The posture is a **supported floor**, not exact-match: `MIN_SUPPORTED_SCHEMA` (= `7.1`) is the oldest version understood. On load, an artifact stamped within `[MIN_SUPPORTED_SCHEMA, SCHEMA_VERSION]` is **accepted and migrated forward** to the current shape via the `migrateToCurrent` seam; anything **below the floor** (or unstamped) is rejected — a stale/foreign plan/settings/life slice becomes fresh defaults, `loadHistory` drops out-of-range saved plans, and imports (Full Backup / Sessions) are refused. The **7.1 → 7.4** step (v7.4 Phase 2, the first real bump) folds the old `firstAction`/`reentryNote` scalars into `contextTrail` and defaults `life.engagementHistory`; saved/imported plans go through the same step via `migrateSavedPlan`. Helpers `isSupportedSchemaVersion` (numeric, exported — so the DataManagement import path gates identically to the loaders) and `migrateToCurrent` centralize the logic. **Non-additive changes are a first-class option:** bump `SCHEMA_VERSION` and add a single forward step at the seam — compat is kept from the floor upward only, and the floor is raised (deleting now-dead steps) when carrying an old version forward gets too expensive. The deep v1→7.1 chain was deleted for that cost reason (see [history/plan_v7/plan_v7.3.md](./history/plan_v7/plan_v7.3.md)) and lives in git history. See [data-model.md](./data-model.md) §4.

**Cross-slice invariants the reducer enforces:**
- Activating a season auto-deactivates the previously active one.
- Deleting a season clears its id from any habit's `seasonIds`.
- Anchor habits have no reducer-level deletion guard (`isAnchor` is a UI-only confirm prompt; `DELETE_HABIT` always removes once dispatched).
- Deleting a habit also drops any `TodaysHabitInstance` rows for it from `plan.todaysHabits`.
- `REFRESH_TODAYS_HABITS` is idempotent via a **value-stable merge** -- the compute paths re-emit every matching habit, the reducer dedupes by `habitId`, refreshes a `planned` instance's time/duration/title (so habit-form edits propagate same-day), and returns the same state when nothing changed (no render loop). Two precompute paths feed it: `computeTodaysHabitInstances(...)` ('habit' kind — Todoist task due today + unchecked) and `computeTodaysMicroGapInstances(...)` ('micro-gap' kind — no Todoist, recurrence + season match). Step 1 + the dashboard dispatch both.
- Habit instance lifecycle: `START_HABIT_INSTANCE` pushes a new open `EngagementSegment`; `STOP_HABIT_INSTANCE` closes it (→ `planned`); `COMPLETE_HABIT_INSTANCE` closes + sets status, caller closes the Todoist occurrence; `SKIP_HABIT_INSTANCE` keeps the instance (prevents re-add); `RESCHEDULE_HABIT_INSTANCE` is always in-place (moves `targetTime`, stamps `rescheduledAt`, appends to `rescheduleHistory`; segments/status preserved). **No Todoist write** for start/stop/reschedule. `REFRESH_TODAYS_HABITS` merges habit-form edits into existing planned instances (refreshes `targetTime`/`durationMinutes`/`titleSnapshot`), but preserves the user-chosen time when `rescheduledAt` is set.
- `TOGGLE_TASK_COMPLETE` also sets `status` and closes any open engagement segment. `START_TASK_ENGAGEMENT` pushes a new open `EngagementSegment`; `STOP_TASK_ENGAGEMENT` closes it (→ `pending`). Each Start→Stop is an individual segment (durations derived, not accumulated).
- v7.4 Phase 2: `UPSERT_TASK_ENTRY_NOTE` sets the single `entry` note on `LinkedTask.contextTrail`; `STOP_TASK_ENGAGEMENT` / `TOGGLE_TASK_COMPLETE` carry an optional `exitNote` (appended as an `exit` note) and **archive the closing segment** to `life.engagementHistory` (as do the habit close actions). `QUICK_START` is the atomic low-friction entry — seeds a "Today" intention + a main `LinkedTask` per id (assigned to the session covering `now` via `pickSessionIdForTime`), seeds `sessionSlots` from `settings` if empty, and sets `setupComplete`. Phase 2 **bumps the schema to `7.4`** (first bump since 7.1; floor stays 7.1, `migrateToCurrent` folds the old breadcrumb scalars into `contextTrail`).
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
| **Todoist** | REST API v1 with a personal API token. **(v7.2)** The token is held **server-side in Workers KV**; all calls go through the same-origin Cloudflare Pages Function proxy (`/api/todoist/*`), guarded by the shared secret, which injects the `Authorization` header — the token never reaches the browser. Full CRUD on tasks/projects, completion via Sync API. Stale-while-revalidate cache (5min hydration / 30s focus on both tasks and projects). HTTP 401 -> `authFailed` flag + reconnect banner. Setup: [deployment.md](./deployment.md); how it works: [reference/cloudflare_workers.md](./reference/cloudflare_workers.md) §8 (and §12 for cost/quotas). | Source of truth for tasks. Orchestrate stores only Todoist task IDs + a `titleSnapshot` fallback. |
| **Google Calendar** | **Display:** events are now **API-rendered**, not iframed — `listEvents` fetches the selected calendars over the visible range and FullCalendar renders them (day / 3-day / week timeGrid views, bounded to the configured day window so the whole day fits, per-calendar colors). This shows **private/imported calendars** (the old public iframe could not) and is **fully editable**: drag-move + resize patch time/duration, clicking an event opens an editor (title/time, or delete), and dragging an empty slot creates a new event on a writable calendar (owner/writer) — all written back to Google (`events.insert` / `events.patch` / `events.delete`). The same events also overlay the **SessionTimelineBar** for day context: events in the gaps render as read-only labelled blocks (title + start–end) on the timeline, while events a session *masks* surface as chips in a single-row rail above it (concurrent ones cluster). Both focus/expand (and word-wrap) on hover; editing happens only in the rendered view. Each calendar is **independently toggleable per surface** (`showOnTimeline` / `showInCalendar`), so the timeline overlay and the calendar view can show different subsets. **Auth (v7.2):** server-mediated OAuth via Cloudflare Pages Functions (`functions/api/auth/google/*`) — the auth-code flow with the **client secret + refresh token held server-side** in Workers KV (roadmap option E2). The browser holds only a runtime **shared secret** (entered in Settings, `localStorage` key `orchestrate-cf-secret`) and asks the Worker for short-lived access tokens. Reading, listing, creating, patching, and deleting events are covered by `calendar.events` + `calendarlist.readonly`; **v7.7 Phase 3** adds `calendar.app.created` to provision a dedicated **"Orchestrate" calendar** (name configurable in Settings) — created automatically on (re)connect once the scope is granted. The day's **sessions are written back** to it via the **Sync** control (the timeline bar's ↻ and the rendered calendar's button, which now reconcile sessions → events *and* refetch; tracked by `plan.sessionCalendarEventIds`). Each session can carry a **No Distraction blocklist** suffix (`settings.blocklists` → `SessionSlot.blocklist`) appended to its event name (e.g. `Afternoon Session -ND`); when a session becomes current the dashboard prompts to **confirm the blocklist**, which locks it (`plan.sessionStarts`) until the session ends. Only `googleCalendarConnected`, the selected calendar entries, `orchestrateCalendar{Name,Id}`, and `blocklists` persist client-side. How it works: [reference/cloudflare_workers.md](./reference/cloudflare_workers.md); setup: [deployment.md](./deployment.md). | Time context. The user's existing Todoist<->Google Calendar sync makes scheduled tasks appear automatically. Server-held refresh token enables future unattended writes. |
| **Spotify** | Embedded player iframe. 6 curated playlists, custom URL override per playlist. | Music protocol. |

**Hosting + minimal backend.** The app is a static SPA deployed to **Cloudflare Pages** (served at the domain root). The server-side code is the **Pages Functions** under `functions/api/*`: the Google Calendar OAuth flow (`auth/google/*`) and the Todoist proxy + token endpoints (`todoist/*`, `todoist-auth/*`), both backed by a single Workers KV namespace and guarded by one shared secret. **All app data still lives in `localStorage`** (no app-data backend) — the only server-side state is the integration tokens in KV (Google refresh token, Todoist personal token). Todoist API calls flow browser → same-origin Worker proxy → Todoist (the proxy injects the token), so the token is never in the browser; there's no longer a Vite dev proxy. The Functions are the first piece of the staged infrastructure direction — see [vision.md](./vision.md) "Infrastructure is subordinate to the vision" and [roadmap/persistence_and_backend_migration.md](./roadmap/persistence_and_backend_migration.md). Deployment + setup: [deployment.md](./deployment.md).

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

**Reschedule semantics** (v6.4; **'habit'-kind only** — micro-gaps are untimed and not reschedulable): `RESCHEDULE_HABIT_INSTANCE` is **always in-place** — it updates `targetTime`, stamps `rescheduledAt`, and appends a `RescheduleEventEntry` (`{ at, fromTime?, toTime? }`) to the instance's `rescheduleHistory`. The instance keeps its `id`, `status`, and `segments` (an engaged instance keeps its open segment running at the new time). Every reschedule is recorded regardless of engagement, and surfaces as a "⤴ … {from} → {to} · Rescheduled" row in the dashboard engagement log — *not* as a tag in the Today view. The recurring Todoist task's `due_string` stays unchanged. (This replaced an earlier v6.3 clone-on-engagement mechanic; the historical `'unfinished'` status is gone.)

**Habits Library** (`/habits`): groups active habits into **Habits** and **Micro-gaps** sections (+ collapsible Inactive). Shows a "needs sync" banner for **'habit'-kind** entries that are unsynced or whose Todoist task is missing (micro-gaps never sync, so they're excluded); the banner **names each affected habit** as a chip (a ⚠ marks a task that's gone missing in Todoist) and offers — alongside Migrate / Re-sync — a confirm-gated **bulk "Delete habits"** escape hatch for habits the user would rather drop than push to Todoist. Bulk sync resolves the default project once to avoid duplicate creation. Habit-save is locked out during migration to prevent races. CRUD (create / edit / pause / delete) and the create/edit/anchor-delete **modal stack** run through the shared `useHabitForms` hook (over `useHabitMutations`), also used by `LifeView`, so the two surfaces share one mutation + form path; the needs-sync banner and bulk-delete modal stay library-only.

### Intentions Backlog

**Pure helpers** in `lib/backlog.ts`: `hasUnfinishedWork`, `buildBacklogEntry` (splits pending vs completed tasks; captures engagement records), `harvestStalePlan`, `rebuildLinkedTasksForBacklogEntry`.

**Hook** `useIntentionRemoval()`: single boundary for intention removal. Three operations: `moveToBacklog`, `removeIntention`, `discardFromBacklog`. Each unschedules Todoist tasks first, then dispatches.

**Lifecycle**: Day rollover harvests automatically. Manual archive via intention row buttons. "Bring to today" reconstructs fresh LinkedTasks for pending IDs only. Discard unschedules + removes.

**Sidebar**: `HistorySidebar` (Dashboard + Wizard) with Sessions and Backlog tabs. "Work Items" button toggles it (with backlog count badge).

---

## 10. Data Model Essentials

Three interlocking ideas:

**Intentions own LinkedTasks.** An intention has `linkedTaskIds` (ordered Todoist IDs). Every `LinkedTask` has an `intentionId` back-reference. Habits do not live here. v7.4 Phase 2: a `LinkedTask` also carries `contextTrail` — a cumulative re-entry breadcrumb trail of `ContextNote`s (`entry` from Step 2, `exit` appended on each Stop/Complete in Focus Mode); the latest note is the task's "start here".

**Habits live separately on `DayPlan.todaysHabits`.** `TodaysHabitInstance` is the day-of carrier for both kinds (resolve via `habitKindOf`). 'habit'-kind: timed → timeline lane, untimed → "Anytime today" (both in `HabitInstanceCard`). 'micro-gap'-kind: repeatable rows in `MicroGapCard`. Independent of session assignment and excluded from capacity arithmetic.

**Tasks (not intentions) are scheduled.** `DayPlan.taskSessions: Record<sessionId, todoistId[]>` is the source of truth. `LinkedTask.assignedSessions` is a derived mirror. Habits never participate. A session is a *soft context bucket*, not a clock — a task's placement is **session-bound**, **Anytime today** (in no bucket; `assignedSessions.length === 0`, surfaced in the dashboard Anytime tray), or **time-anchored** via a Todoist due time (no in-app per-task clock). See [data-model.md](./data-model.md) §1 (LinkedTask → Placement states).

**LifeContext sits above the day.** Persistent state (`life: LifeContext`, persisted to `orchestrate-life-context`) holds `seasons[]` (each with optional `recurringFocuses[]`), `habits[]`, `activeSeasonId`, `backlog[]`, `restCues`, and (v7.4 Phase 2) `engagementHistory[]` — the durable, 90-day-pruned archive of closed engagement segments (write-through on every Stop/Complete/Skip; keyed by durable `todoistId`/`Habit.id`). 'habit'-kind carry `todoistTaskId` + optional `targetTime`/`windowBehavior`; 'micro-gap'-kind carry none of those. `REFRESH_TODAYS_HABITS` (Step 1 mount) consumes both compute paths to populate `plan.todaysHabits`.

The plan auto-resets daily. Stale task handling: completed tasks stay visible via `titleSnapshot`; deleted tasks auto-unlink; externally-completed tasks are detected and marked complete (not unlinked).

Full entity semantics, reducer actions, and schema-compatibility notes: [data-model.md](./data-model.md).

---

## 11. Persistence

All **app data** via `localStorage`. The only server-side state is the **integration tokens in Workers KV** — the Google refresh token and the Todoist personal token — held by the Pages Functions (not localStorage); see §7. The persistence direction is analysed in [roadmap/persistence_and_backend_migration.md](./roadmap/persistence_and_backend_migration.md).

| Key | Content | Written By |
|---|---|---|
| `orchestrate-day-plan` | Current `DayPlan` + schema markers | `DayPlanProvider` |
| `orchestrate-settings` | `AppSettings` + schema marker | `DayPlanProvider` |
| `orchestrate-history` | `SavedDayPlan[]` | `DayPlanProvider` |
| `orchestrate-life-context` | `LifeContext` + schema marker | `DayPlanProvider` |
| `orchestrate-todoist-cache` | Tasks, projects, sections, fetchedAt | `TodoistProvider` |
| `orchestrate-cf-secret` | Shared secret guarding the OAuth Worker endpoints | `appSecret.ts` (read reactively via `useAppSecret`) |
| `orchestrate-theme` | `"light"` or `"dark"` | `useTheme` |
| `orchestrate-active-playlist` | Playlist ID | `MusicProvider` |
| `orchestrate-custom-playlist-urls` | `Record<playlistId, spotifyUrl>` | `MusicProvider` |

**Backup**: Settings page Data tab has Full Backup (bundles settings + life + history **+ the live `currentDay`**, stamped `_schemaVersion`; `_backupVersion: 2`), Import Backup (**authoritative restore** — see below; refuses non-`7.1` files), and **Import Day Plan** (renamed from "Import Sessions"; imports a single day plan, or an exported day-plans array, into Saved Sessions; refuses non-`7.1` plans). `HistorySidebar` has per-session Restore/Export/Delete. **`IMPORT_BACKUP` is authoritative**: each slice the backup carries *replaces* the local one (settings/life/history), and `currentDay` replaces today's plan (re-dated to today) — recovery means "make this device match the backup", not merge. Because that's destructive, `useDataImport` parks a validated backup in `pendingBackup` and the UI confirms (`ConfirmModal`, "Replace & Restore") before dispatching whenever local data exists; a pristine install imports straight through. The shared parse/validate/dispatch logic lives in `useDataImport` (over `lib/dataImport.ts`); the Welcome page's "Restore from a backup" opens an in-place `RestoreModal` that imports and then loads any restored day as today's plan (`RESTORE_DAY`) without leaving the page — no Settings round-trip.

**Backup scope & integrations** — a Full Backup is **data + integration references/preferences, never credentials**:
- **Todoist.** *Not* in the backup: the personal API token (server-side in Workers KV `todoist:token`; the browser never holds it). *In* the backup: `settings.habitsTodoistProjectId`, and every embedded **task reference** — `LinkedTask.todoistId` + `titleSnapshot` inside `history[].plan`, and `todoistTaskId` on `life.habits[]` and habit instances (IDs/labels, not auth). After restoring on a fresh device/deployment, re-enter the **app secret** and **reconnect Todoist** (paste token) in Settings → Integrations; the imported IDs re-link automatically for the same account.
- **Google Calendar.** *Not* in the backup: the OAuth refresh/access tokens (Workers KV / in-memory, server-side). *In* the backup: `settings.googleCalendarConnected` (flag), `settings.googleCalendarIds` (selected `GoogleCalendarEntry[]`), `settings.calendarViewMode`. The imported `googleCalendarConnected: true` is provisional — `GoogleCalendarProvider` re-checks `/api/auth/google/status` on load, so a device whose KV has no token self-corrects to disconnected; re-authorize Google if it shows disconnected.
- **Shared secret** (`orchestrate-cf-secret`, localStorage) is **not** in any backup — it's installation-specific and re-entered per device.
- **Not in the full backup by design:** the Todoist cache, and theme/music/pomodoro prefs. (As of `_backupVersion: 2`, today's live `plan` **is** included as `currentDay`.)

**Reset**: Settings → Data → Reset section has two destructive actions, each gated by a `ConfirmModal`:
- **Reset Today's Plan** dispatches `RESET_DAY` — replaces `plan` with a fresh plan (sessions re-seeded from settings/defaults) and clears `editingStep`. Settings, history, life (seasons / habits / backlog / rest cues / session templates), and Todoist auth are untouched. Useful for cleaning up after a `RESTORE_DAY` that imported an unwanted session.
- **Reset Everything** dispatches `RESET_ALL` and manually clears `orchestrate-todoist-cache` — a factory reset of all four reducer-managed slices (plan + settings + history + life). It does **not** touch the server-side integration tokens (Todoist/Google in KV) or the shared secret (`orchestrate-cf-secret`) — disconnect those from Settings → Integrations. Tasks/projects in Todoist itself are not modified. Theme and music prefs (separate localStorage keys outside the reducer) survive.

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
| `useAppSecret` | `hooks/useAppSecret.ts` | v7.2: reactive read of the shared Cloudflare Worker secret via `useSyncExternalStore` (returns `{ secret, hasSecret }`); updates in-tab on `setStoredSecret` and across tabs via the `storage` event. Backs the `isConfigured`/`hasSecret` state in both the Todoist + Google providers and their setup forms. |
| `useGoogleCalendarData` | `hooks/useGoogleCalendar.ts` | v7.2: read-only Google Calendar OAuth state (isConfigured = shared secret set / isConnected / authFailed, available calendars) |
| `useGoogleCalendarActions` | `hooks/useGoogleCalendar.ts` | v7.2: setAppSecret, connect/disconnect, checkConnection, refreshCalendars, createEvent (Worker-mediated) |
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

Repo-root deployment files (outside `src/`): Cloudflare Pages Functions in `functions/` — `api/auth/google/*` (OAuth endpoints + `_lib.ts`), `api/todoist/[[path]].ts` (Todoist proxy) + `api/todoist-auth/*` (token/status/disconnect), and `_shared.ts` (shared secret guard `requireAppSecret`/`checkSecret`/`hasSharedSecret`, `json` helper, Todoist env type + KV-key/API constants — the Google `_lib.ts` re-exports `json`/`requireAppSecret` from it rather than keeping its own copy); plus `wrangler.toml` (Pages config + KV binding) and `public/_redirects` (SPA fallback). How it works: [reference/cloudflare_workers.md](./reference/cloudflare_workers.md); setup: [deployment.md](./deployment.md).

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
|   +-- GoogleCalendarContext.tsx   # v7.2: server-mediated OAuth state + calendar list + createEvent plumbing
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
|   +-- useHabitReschedule.ts, useToggleHabitInstance.ts, useTodaysHabitsSync.ts
|   `-- useAppSecret.ts          # v7.2: reactive shared-secret read (useSyncExternalStore)
|
+-- lib/
|   +-- appSecret.ts            # v7.2: shared Cloudflare Worker secret storage (get/set/hasStoredSecret + subscribe for reactive reads) — used by Google + Todoist via useAppSecret
|   +-- googleAuth.ts           # v7.2: Worker OAuth client (re-exports appSecret; startGoogleLogin, fetchAccessToken, fetchConnectionStatus, disconnectGoogle)
|   +-- googleCalendarApi.ts    # v7.2: Calendar REST v3 client (listCalendars, createCalendarEvent)
|   +-- schema.ts               # SCHEMA_VERSION / MIN_SUPPORTED_SCHEMA + gate (isSupportedSchemaVersion) + migrateToCurrent seam — shared by DayPlanContext loaders + DataManagement import
|   +-- time.ts                 # Time utilities (timeToMinutes, todayISO, etc.)
|   +-- habits.ts               # habitMatchesDate/recurrenceMatchesDate, habitKindOf, partitionByKind, computeTodaysMicroGapInstances, getActiveHabits, getAnchorHabits
|   +-- habitsTodoistSync.ts    # buildDueString, ensureHabitsProject, syncHabitToTodoist, computeTodaysHabitInstances, findStaleTodaysHabitInstances, findOverdueHabits, reconcileOverdueHabits, findNeedsSyncHabits
|   +-- backlog.ts              # hasUnfinishedWork, buildBacklogEntry, harvestStalePlan, rebuildLinkedTasksForBacklogEntry
|   +-- engagementHistory.ts    # v7.4 P2: durable engagement archive — buildRecordFromClosedSegment, appendEngagementRecord, pruneEngagementHistory (90d), computeReentryStats, lastEndedFor
|   +-- intentionUnschedule.ts  # unscheduleIntentionTasks pure helper
|   +-- seasons.ts              # findActiveSeason, getSeasonProgress
|   +-- tasks.ts                # getTaskTitle, collectDescendantIds
|   +-- capacity.ts             # computeSessionCapacity / computeAllSessionCapacities
|   +-- timeline.ts             # time<->position geometry (formatHour, minutesToPct/pctToMinutes)
|   +-- spotify.ts              # spotifyPlaylistId, isValidSpotifyUrl
|   `-- todoistApi.ts           # v7.2: proxy API_BASE + TodoistAuthError, getTodoistStatus, storeTodoistToken, disconnectTodoist
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
    |   +-- Step1Sessions.tsx, Step2Intentions.tsx, Step3Refine.tsx, Step4Schedule.tsx, Step5Launch.tsx
    +-- dashboard/
    |   +-- Dashboard.tsx, SessionTimeline.tsx, MusicPanel.tsx, DigitalClock.tsx
    |   +-- InsightCard.tsx, HistorySidebar.tsx, BacklogTab.tsx
    |   +-- HabitInstanceCard.tsx, TrueRestCard.tsx
    |   +-- SessionCapacityBadge.tsx, SessionCapacityBanner.tsx
    +-- checkin/
    |   `-- CheckInModal.tsx
    +-- todoist/
    |   +-- TodoistPanel.tsx, TodoistSetup.tsx, RenderedCalendar.tsx
    +-- settings/
    |   +-- SettingsPage.tsx, ConfigurationSettings.tsx, DataManagement.tsx, GoogleCalendarSetup.tsx
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