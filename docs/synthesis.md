> **Start here.** This is the canonical context document for Orchestrate. Deeper references: [vision.md](./vision.md) (durable "why"), [data-model.md](./data-model.md) (entity semantics, invariants, reducer actions, migrations — **the authoritative source for the term definitions summarized in §4**), [backlog.md](./backlog.md) (forward-looking proposals), and the subsystem walkthroughs in [reference/](./reference/) (backend, persistence, backup & restore, [focus-mode](./reference/focus-mode.md), [habits-sync](./reference/habits-sync.md)). The in-app user guide lives in [`src/components/guide/UserGuide.tsx`](../src/components/guide/UserGuide.tsx). For current type definitions, read [`src/types/index.ts`](../src/types/index.ts) directly. Frozen historical artifacts live in [history/](./history/) — do not treat them as current state. A full docs map is in [README.md](./README.md).

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
| Persistence | `localStorage` working store (4 primary + auxiliary keys), mirrored to a **per-user D1 sync sidecar** (v7.9; per-user v7.10) for cross-device/deployment consistency |
| Auth (v7.10) | **Cloudflare Access** (Zero Trust) fronts the whole origin — Google SSO against an email allowlist; Pages Functions verify the Access JWT (`jose`) and namespace KV/D1 by the verified email. No in-app credential. |
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
            `-- SyncGate                     <-- v7.9: cold-start D1 pull+merge before state loads
                `-- DayPlanProvider              <-- core app state (plan, settings, history, life)
                    `-- NotificationProvider     <-- v7.8: in-app notification banner queue + viewport
                        `-- GoogleCalendarProvider   <-- v7.2: server-mediated OAuth (calendar list + write plumbing)
                            `-- TodoistProvider          <-- Todoist data + API actions
                                `-- ReconciliationProvider  <-- v6.5: central habit reconcile
                                    `-- NotificationBridge  <-- v7.8: engagement nudge + sync-error toasts
                                    `-- AsciiBuddy          <-- ASCII slice-of-life companion (fixed overlay, all routes)
                                    `-- AppRoutes        <-- router switch
```

- `ErrorBoundary` is the outermost component in `App.tsx` so a crash in any provider or route is caught gracefully.
- `SyncGate` (v7.9) wraps `DayPlanProvider` and blocks the first render until the D1 sync sidecar's cold-start pull-and-merge resolves (`pullAndMerge`, [`src/lib/cloudSync.ts`](../src/lib/cloudSync.ts)) — it merges the remote whole-slice snapshot into localStorage (last-write-wins per slice) *before* `DayPlanProvider`'s loader runs, so the loader reconciles/migrates/rolls-over the winning state. It resolves fast (≤~2s cap; skipped instantly when offline), so startup is never blocked for long. See §11.1.
- `GoogleCalendarProvider` reads `settings` (the `googleCalendarConnected` flag) + `dispatch` from `DayPlanProvider`; it is independent of Todoist/Reconciliation (its order relative to them does not matter). The **refresh token lives server-side** (Cloudflare Worker + KV, per user); the provider holds only a short-lived access token **in memory** (re-minted by the Worker on demand). Requests are authenticated by the Cloudflare Access session cookie — there is no in-app credential (v7.10).
- `TodoistProvider` reads `settings` (connection state + habits project preference) and `plan` (linked tasks for reconciliation) from `DayPlanProvider`, so it must be nested inside it.
- `ReconciliationProvider` reads both — habits + active season + plan-date from `DayPlanProvider`, taskMap + actions from `TodoistProvider` — so it sits below both. See [`src/context/ReconciliationContext.tsx`](../src/context/ReconciliationContext.tsx).
- `AsciiBuddy` is a purely cosmetic ASCII companion rendered once beside `NotificationBridge` (fixed overlay, default bottom-left — toasts own the bottom-right) so it persists across route changes without its animation resetting. Its activity is derived from day state (`useBuddyActivity`, top wins): asleep outside the settings day window, planning pose on `/setup`, working out while a habit instance is engaged, watering a plant or coding during a task engagement (deterministic per-task pick), swimming when the clock sits in a gap between sessions (True Rest), idle otherwise. The widget layers three one-shots on top: a celebration burst when the day's completed count (tasks + habits) rises, a pet burst, and occasional idle dances. Interactions: **drag to move** (position persists device-locally), **click to expand in place into the ambient view** — a small diorama with a faint accent ASCII backdrop per activity (meadow/garden/sea/night/study), a caption, and a **mode picker** that pins any activity (or auto, following the day; pin persists device-locally). Click the buddy in the diorama to pet; click the card or Esc to shrink. Hover shows the minimize chip control. Decoration glyphs (sparkles, plants, waves…) render in the accent green; the figure stays neutral. Honors `prefers-reduced-motion`; defaults to the minimized chip on `/focus` (the distraction-free surface). All preferences are device-local localStorage — deliberately outside the synced schema. Frames live in `src/components/buddy/animations.ts`.
- `NotificationProvider` (v7.8) sits above the integration providers so they (and any view) can raise in-app banners via `useNotify`. It owns the toast queue and renders `NotificationViewport` (fixed, bottom-right, themed by kind: info/success/warning/error; info/success auto-dismiss, errors persist; de-duped by `dedupeKey`). `NotificationBridge` — a headless component under all providers — runs the engagement nudge app-wide and watches the Todoist / Google Calendar / reconciliation contexts, raising an **error banner on a sync failure** (linking to Integrations). Native browser notifications are now a **background-only fallback** in `useNotifications` (fired only when the tab is hidden and the preference allows the browser channel).

### 3.2 Routing

Eleven routes, all defined in `AppRoutes` inside `App.tsx`:

| Path | Component | Guard |
|---|---|---|
| `/` | `Onboarding`, `Dashboard`, or `Welcome` | v7.10: shows the first-run `Onboarding` flow until `settings.onboardingComplete` (per account, synced); then `Dashboard` when `plan.setupComplete === true`, otherwise `Welcome` (hub) |
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

Life routes are always reachable (no `setupComplete` gate) — `setupComplete` is a daily flag while seasons/habits are durable. The full gating logic behind the `/`, `/setup`, and `/focus` guards — onboarding vs. the daily loop, and where the Todoist requirement applies — is in [reference/onboarding-and-gating.md](./reference/onboarding-and-gating.md).

### 3.3 Focus Mode

Focus Mode (`/focus`) is the app's **execution surface** — the dashboard plans (*what* and *when*), Focus executes (*one thing now, where did I leave off*). Pressing **▶ Start** opens an engagement segment; in **strict** mode it drops into `/focus`, in **relaxed** it runs the timer in place with a **◎** icon to enter Focus on demand. The surface has two faces on one route: a **selection** picker (`FocusPicker`) when nothing is engaged, and an **execution** surface (`FocusActive`) — a four-phase state machine `firstAction → ramp → working ⇄ stopping` — when something is. Focus owns the execution-level concerns kept off the planning dashboard: the engagement timer, the per-task **re-entry breadcrumb** (`LinkedTask.contextTrail`) and its durable archive (`life.engagementHistory`), the day-wide **engagement timeline**, the **activation ramp**, the optional **Pomodoro** engine, the **music protocol**, and the strict/relaxed **note gates** (`settings.focusStrict`). A separate app-wide **engagement nudge** flags idle time in an active session.

**Full behavior — the state machine, the two surfaces, the engagement timeline, Pomodoro/ramp, note gates, and the engagement nudge — is documented in [reference/focus-mode.md](./reference/focus-mode.md).** Execution-layer data shapes are in [data-model.md](./data-model.md).

---

## 4. Vocabulary

> This table is a quick glossary. [data-model.md](./data-model.md) is the **authoritative** source for entity semantics, invariants, and lifecycle — when the two disagree, data-model.md wins and this table is stale.

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
Onboarding (first run, per account) --> Welcome (hub) --> Wizard (5 steps) --> Dashboard
                                             ^                                    |
                                             +------------------------------------+  (Edit Plan / Recontextualize)
```

### 5.0 Onboarding (first run — v7.10)

Before the daily loop, a one-time **onboarding flow** (`src/components/onboarding/Onboarding.tsx`) renders at `/` until `settings.onboardingComplete` is set (synced via D1, so it runs once per *account*, not per device). Three steps: what Orchestrate is (reuses `AboutContent`) → **connect Todoist** (required — Continue is disabled until `/status` reports configured) → **connect Google Calendar** (encouraged, skippable; the OAuth `return=home` target lands the callback back in the flow). Steps auto-reflect already-connected integrations, so an existing account clicks straight through. The reusable connect UIs are `TodoistConnectCard` and `GoogleConnectCard` (shared with Settings).

**`onboardingComplete` (one-time, per-account) and `plan.setupComplete` (per-day) are independent flags; the Todoist requirement is a separate live signal (`useTodoistGate`) enforced app-wide** — a persistent gate banner + the `/setup` route guard + disabled Todoist-write controls, with planning entry hard-blocked and the Dashboard/Focus kept soft (viewable). Settings → Data also carries the three account actions (Restart walkthrough, Sign out, Reset Everything). The full entry-gating behavior is documented in [reference/onboarding-and-gating.md](./reference/onboarding-and-gating.md).

### 5.1 Welcome (Home Hub)

The landing page (`Welcome.tsx`) is a multi-purpose hub:

- **Today card** -- plan status (idle / resuming / first-time), primary CTA (`Plan Your Day` / `Resume Planning`) that navigates to `/setup`, and the wizard step timeline.
- **Life card** -- active season summary, anchor habits as inline pills, and quick links to `/habits` and `/season`.

Three plan-status modes determine the CTA label:
1. **First ever visit** -- no history, no in-progress plan.
2. **Resuming** -- intentions exist or `wizardStep > 1`.
3. **Returning** -- history exists but today's plan is fresh.

Appears at `/` whenever `plan.setupComplete === false` (and onboarding is done). Once complete, `/` shows the Dashboard. When first-ever, an inline "Restore your data" hint navigates to `/settings?tab=data`.

v7.10: the Today card carries an **integration status strip** (Todoist / Google Calendar chips — ✓ or "Connect →"), and Todoist is a **hard gate**: when `/status` resolves unconfigured, the primary CTA becomes **Connect Todoist →** (routing to Settings → Integrations) and planning can't start — Orchestrate plans *from* Todoist tasks, so the wizard is unusable without it. Life/Seasons/Habits/Guide stay reachable.

A secondary **⚡ Quick start** link under the primary CTA (v7.4) opens the `QuickStart` modal — a low-friction entry that bypasses the 5-step wizard on low-activation days. Pick existing Todoist tasks and/or free-type new ones (both on one screen); on Start it creates Todoist tasks for the typed lines, fires the atomic `QUICK_START` reducer action (one "Today" intention + a main `LinkedTask` per id assigned to the session covering now + `setupComplete: true`), engages the first task, and navigates to `/focus`. Requires Todoist connected (free-typed lines become real Todoist tasks, keeping Todoist the source of truth).

The top-right fixed controls -- About, Settings, ThemeToggle -- are rendered by the shared `HeaderControls` component across all surfaces.

### 5.2 Wizard (5 Steps)

A sequential flow captured in `plan.wizardStep` (1-indexed, persists across refreshes). `WizardLayout` wraps every step with a collapsible saved-sessions sidebar, header with step progress pills, and Back/Next footer. An "editing" mode supports returning from the dashboard.

1. **Step 1 -- Sessions** (`Step1Sessions`). The day's work sessions are defined **first**, so the session shape scopes the rest of planning, on a **drag-calendar** (`SessionEditorTimeline`): drag an empty area to add a block, drag a block to move, drag its edges to resize, click to rename/delete (15-min snapping, advisory overlap tint). A **season-focus context banner** (`SeasonFocusBanner`) sits at the top — the active season's arc + supporting-goal chips and today's recurring habits (each with a ✓ to mark done). The day's sessions live on `DayPlan.sessionSlots` (seeded from the last-used day) and drive every surface thereafter. When Google Calendar is connected, that day's **external events surface as chips in a row-packed rail above the editable track** (time-overlapping ones stack onto separate rows; hover raises and expands a chip), kept entirely off the editing surface so nothing overlaps the session blocks — meetings inform where sessions go without cluttering the edit. When it is *not* connected, a dismissible **calendar nudge** sits above the editor ("connect to see your meetings here"); dismissal persists to `settings.calendarNudgeDismissed`. **Session Templates** (from the Life section) appear as quick-apply chips — applying one replaces the day's sessions and clears assignments (with a confirm if any exist); a "Save as template" affordance persists the current layout to `LifeContext.sessionTemplates`. Granular reducer actions (`ADD_/UPDATE_/REMOVE_DAY_SESSION`, `APPLY_SESSION_TEMPLATE`) keep session ids stable so assignments survive a Back-edit.

2. **Step 2 -- Intentions** (`Step2Intentions`). Two phases: (a) write down intentions, (b) sequentially map each to Todoist tasks via the embedded `TodoistPanel` (Link/Unlink buttons). The current intention's linked tasks render in `linkedTaskIds` order and are **drag-reorderable** (`REORDER_INTENTION_TASKS`); linking more than 5 tasks to one intention surfaces a scope-creep nudge ("this is probably an epic — split it"). The focused "Current" card can be **collapsed** to fold all not-yet-mapped intentions (the current one included) into a single drag-reorderable list (`REORDER_INTENTIONS`); picking "Map →" re-focuses one. Mapped intentions become collapsible panels showing their linked tasks. The step also fires `REFRESH_TODAYS_HABITS` to populate today's habits (both kinds) as `TodaysHabitInstance` rows, showing a chip count; each season-banner habit chip has a ✓ to mark it done for today (`useCompleteHabitInstance`). The `TodoistPanel` renders a non-actionable "Habit" label on rows backing a `TodaysHabitInstance`, and its task rows support **drag-reorder within a sibling group** (writes Todoist `child_order` via `item_reorder`). Each intention row has archive-to-backlog and delete buttons (both unschedule linked Todoist tasks via `useIntentionRemoval`). Intentions seeded by the Step 1 season banner's recurring-focus chips appear in this list in plan order.

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

**Architecture:** `useReducer` over a large discriminated-union `Action` type (full catalog in [data-model.md](./data-model.md) §3). State is initialized lazily via `loadInitialState()` which calls `loadPlan()` + `loadLifeContext()` + `loadHistory()` + `loadSettings()` and handles day rollover in one place. Four `useEffect` hooks persist each slice back to `localStorage` on every change.

**Plan date freshness + rollover:** `loadPlan()` returns the current-schema persisted plan without a date gate. If the date is stale, `loadInitialState` runs `harvestStalePlan(plan)` to compute `BacklogEntry[]` for unfinished intentions, appending them to `life.backlog` with `reason: 'rollover'`. No automatic save to `SavedDayPlan` history at rollover -- the backlog preserves the meaningful unfinished part. Manual `SAVE_DAY` is the only writer to history. Auto-rollover does NOT touch Todoist -- yesterday's tasks remain visibly overdue.

**Schema guard (floor-and-migrate):** every persisted slice (plan / settings / life) and every saved-session plan is stamped with `_schemaVersion` on write; on load, an artifact within the supported range (`[MIN_SUPPORTED_SCHEMA, SCHEMA_VERSION]`, both in `src/lib/schema.ts`) is **accepted and migrated forward** via the `migrateToCurrent` seam, while anything below the floor (or unstamped) is rejected — the slice falls back to fresh defaults, out-of-range saved plans are dropped, and imports are refused. The numeric gate `isSupportedSchemaVersion` is shared by the loaders and the DataManagement import path so they stay aligned. Non-additive changes are a first-class option (bump the version, add one forward step; raise the floor and delete dead steps when an old step gets expensive). **The version numbers, the individual migration steps, and the compatibility posture are owned by [data-model.md](./data-model.md) §4 — see there, not here.**

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
| **Todoist** | REST API v1 with a personal API token. **(v7.2, per-user v7.10)** The token is held **server-side in Workers KV** under the caller's Access identity; all calls go through the same-origin Cloudflare Pages Function proxy (`/api/todoist/*`), authenticated by the Access session cookie, which injects the `Authorization` header — the token never reaches the browser. Full CRUD on tasks/projects, completion via Sync API. Stale-while-revalidate cache (5min hydration / 30s focus on both tasks and projects). HTTP 401 -> `authFailed` flag + reconnect banner. Setup: [deployment.md](./deployment.md); how it works: [reference/backend.md](./reference/backend.md) §8 (and §12 for cost/quotas). | Source of truth for tasks. Orchestrate stores only Todoist task IDs + a `titleSnapshot` fallback. |
| **Google Calendar** | **Display:** events are now **API-rendered**, not iframed — `listEvents` fetches the selected calendars over the visible range and FullCalendar renders them (day / 3-day / week timeGrid views, bounded to the configured day window so the whole day fits, per-calendar colors). This shows **private/imported calendars** (the old public iframe could not) and is **fully editable**: drag-move + resize patch time/duration, clicking an event opens an editor (title/time, or delete), and dragging an empty slot creates a new event on a writable calendar (owner/writer) — all written back to Google (`events.insert` / `events.patch` / `events.delete`). The same events also overlay the **SessionTimelineBar** for day context: events in the gaps render as read-only labelled blocks (title + start–end) on the timeline, while events a session *masks* surface as chips in a single-row rail above it (concurrent ones cluster). Both focus/expand (and word-wrap) on hover; editing happens only in the rendered view. Each calendar is **independently toggleable per surface** (`showOnTimeline` / `showInCalendar`), so the timeline overlay and the calendar view can show different subsets. **Auth (v7.2, per-user v7.10):** server-mediated OAuth via Cloudflare Pages Functions (`functions/api/auth/google/*`) — the auth-code flow with the **client secret + per-user refresh tokens held server-side** in Workers KV (roadmap option E2). The browser holds no credential — requests carry the Cloudflare Access session cookie, and the Worker asks Google for short-lived access tokens on demand. The signed OAuth `state` binds the initiating user's identity and an allowlisted return target (Settings or onboarding). Reading, listing, creating, patching, and deleting events are covered by `calendar.events` + `calendarlist.readonly`; **v7.7 Phase 3** adds `calendar.app.created` to provision a dedicated **"Orchestrate" calendar** (name configurable in Settings) — created automatically on (re)connect once the scope is granted. The day's **sessions are written back** to it via the **Sync** control (the timeline bar's ↻ and the rendered calendar's button, which now reconcile sessions → events *and* refetch; tracked by `plan.sessionCalendarEventIds`). Each session can carry a **No Distraction blocklist** suffix (`settings.blocklists` → `SessionSlot.blocklist`) appended to its event name (e.g. `Afternoon Session -ND`); when a session becomes current the dashboard prompts to **confirm the blocklist**, which locks it (`plan.sessionStarts`) until the session ends. Only `googleCalendarConnected`, the selected calendar entries, `orchestrateCalendar{Name,Id}`, and `blocklists` persist client-side. How it works: [reference/backend.md](./reference/backend.md); setup: [deployment.md](./deployment.md). | Time context. The user's existing Todoist<->Google Calendar sync makes scheduled tasks appear automatically. Server-held refresh token enables future unattended writes. |
| **Spotify** | Embedded player iframe. 6 curated playlists, custom URL override per playlist. | Music protocol. |

**Hosting + minimal backend.** The app is a static SPA deployed to **Cloudflare Pages** (served at the domain root), with the whole origin behind a **Cloudflare Access** application (v7.10): visitors sign in with a pre-approved Google account at the edge before anything is served, and the Access policy's email list *is* the user allowlist. The server-side code is the **Pages Functions** under `functions/api/*`: the Google Calendar OAuth flow (`auth/google/*`), the Todoist proxy + token endpoints (`todoist/*`, `todoist-auth/*`), the state-sync endpoints (`state/*`), and `/api/me`. Every Function verifies the `Cf-Access-Jwt-Assertion` JWT (`requireUser` in `functions/_shared.ts`) and uses the verified email to namespace **per-user** KV credential keys and D1 sync rows — a handful of pre-approved users use the app fully independently. localStorage remains the offline-first working store; server-side state is the per-user integration tokens (KV) and the per-user slice mirror (D1, §11.1). How it works: [reference/backend.md](./reference/backend.md); setup: [deployment.md](./deployment.md).

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

**Core file:** `src/lib/habitsTodoistSync.ts` (**'habit' kind only** — micro-gaps never touch Todoist).
Saving a 'habit'-kind entry syncs a recurring Todoist task (`buildDueString` → `ensureHabitsProject` →
`resolveHabitProjectId` → `syncHabitToTodoist`), resolved via a durable-marker adoption ladder so a
link-less habit adopts an existing task instead of duplicating. A day-of layer (`useTodaysHabitsSync`)
feeds `computeTodaysHabitInstances` + `computeTodaysMicroGapInstances` into `REFRESH_TODAYS_HABITS` and
prunes stale rows. A central `ReconciliationProvider` (mounted between `TodoistProvider` and `AppRoutes`)
runs needs-sync repair + overdue bump on hydration and focus, surfaced app-wide by the `HabitSyncChip`.
Skip posts a Todoist comment then completes; reschedule is always in-place; delete propagates to Todoist
best-effort via `useHabitMutations`.

**Full module walkthrough — the sync/delete/day-of/reconcile layers, overdue bump, skip/reschedule
semantics, and the Habits Library — is in [reference/habits-sync.md](./reference/habits-sync.md).**
Entity semantics + reducer actions are in [data-model.md](./data-model.md).

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

`localStorage` is the **working store** for all app data. As of v7.9 the four reducer slices are also **mirrored to a D1 database** (the sync sidecar, §11.1) so multiple deployments/devices share one logical store; localStorage stays authoritative for offline-first reads. The only other server-side state is the **integration tokens in Workers KV** — the Google refresh token and the Todoist personal token — held by the Pages Functions (not localStorage); see §7. The persistence direction is analysed in [roadmap/persistence_and_backend_migration.md](./roadmap/persistence_and_backend_migration.md).

| Key | Content | Written By |
|---|---|---|
| `orchestrate-day-plan` | Current `DayPlan` + schema markers | `DayPlanProvider` |
| `orchestrate-settings` | `AppSettings` + schema marker | `DayPlanProvider` |
| `orchestrate-history` | `SavedDayPlan[]` | `DayPlanProvider` |
| `orchestrate-life-context` | `LifeContext` + schema marker | `DayPlanProvider` |
| `orchestrate-sync-meta` | `{ [slice]: updatedAtMs }` — per-slice last-write clock for the D1 sidecar | `cloudSync.ts` (device-local; never backed up) |
| `orchestrate-sync-reset-pending` | `{ [slice]: true }` — explicit local-clear intent so a deliberate reset beats the cloud snapshot on next startup | `cloudSync.ts` (device-local; cleared after the next local write or remote adoption) |
| `orchestrate-todoist-cache` | Tasks, projects, sections, fetchedAt | `TodoistProvider` |
| `orchestrate-user` | v7.10: the Access identity (email) this browser last synced as — drives the identity-switch guard | `identity.ts` (stamped by `cloudSync.ts` on pull) |
| `orchestrate-theme` | `"light"` or `"dark"` | `useTheme` |
| `orchestrate-active-playlist` | Playlist ID | `MusicProvider` |
| `orchestrate-custom-playlist-urls` | `Record<playlistId, spotifyUrl>` | `MusicProvider` |

### 11.1 D1 sync sidecar (v7.9)

> **Full walkthrough:** [reference/persistence.md](./reference/persistence.md) is the canonical guide to the whole persistence stack — `localStorage` working store, the sync merge/conflict model, local-vs-remote D1, and the integration caches. This section is the summary.

A thin cloud mirror so a user's **real devices** (all on the production store) converge on one app-state instead of drifting into separate installations. (The related bug where separate installations each auto-provisioned a duplicate Orchestrate calendar / habit tasks is prevented at the integration layer by **same-named reuse**, not by the mirror — local dev deliberately uses a *separate* database; see [reference/persistence.md](./reference/persistence.md) §5.6.) **localStorage remains the offline-first working store**; the sidecar layers push/pull on top.

- **Store.** One D1 table `slices(user_id, key, value, schema_version, updated_at)`, primary key `(user_id, key)` — one row per user per slice (`plan` | `settings` | `history` | `life`), `value` being the exact JSON string the client persists, `user_id` the verified Access email (v7.10). Bound as `SYNC_DB` on the Pages project. Endpoints (identity-guarded like every Function): `GET /api/state` (returns `{ user, slices }` — `user` feeds the identity-switch guard) and `PUT /api/state/:key` (upsert one, last-write-wins). See [reference/backend.md](./reference/backend.md).
- **Conflict model.** Coarse whole-slice **last-write-wins** by a device-local `updatedAt` (ms) kept in `orchestrate-sync-meta`. The server enforces LWW inside the upsert (`WHERE excluded.updated_at >= slices.updated_at`, 409 otherwise). A separate device-local `orchestrate-sync-reset-pending` marker distinguishes an *explicit local clear* from an accidentally missing slice, so startup merge never overwrites a valid remote snapshot with freshly-mounted defaults. No field-level merge — sufficient for a single user across a couple of devices ([roadmap §4](./roadmap/persistence_and_backend_migration.md)).
- **Pull (cold start).** `SyncGate` (§3.1) calls `pullAndMerge` before `DayPlanProvider` mounts: fetch the remote snapshot (≤2s, skipped offline), and per slice write the winner into localStorage so the existing loaders migrate/validate/roll-over it. A slice whose remote stamp is *newer* than this build's `SCHEMA_VERSION` is neither adopted nor overwritten (stale client safety). **Identity-switch guard (v7.10):** the response's `user` is compared with the `orchestrate-user` stamp; a mismatch (different account on this browser profile) clears all local app slices + the Todoist cache before merging, so users on a shared machine never cross-pollinate.
- **Push (mutation).** Each persist effect calls `notifyChanged(slice, serialized)` after writing localStorage; genuine changes bump the meta clock and debounce-push (~2.5s), flushed on `pagehide`/tab-hidden with `keepalive`. The **first mount fire is skipped** unless an init-time event (day-rollover, bootstrap, local-newer merge) marked the slice — so merely opening the app never claims "newest" and clobbers another device. `RESET_ALL` / `IMPORT_BACKUP` push like any mutation; recovery paths are D1 Time Travel (7 days) + the manual Full Backup file.
- **Not synced:** the Todoist cache, theme/music prefs, and the sync sidecar's own device-local bookkeeping keys (`orchestrate-sync-meta`, `orchestrate-sync-reset-pending`, `orchestrate-user`).

**Backup**: Settings page Data tab has Full Backup (bundles settings + life + history **+ the live `currentDay`**, stamped `_schemaVersion` — built by `lib/backup.ts`), Import Backup (**authoritative restore** — see below; refuses non-`7.1` files), and **Import Day Plan** (renamed from "Import Sessions"; imports a single day plan, or an exported day-plans array, into Saved Sessions; refuses non-`7.1` plans). `HistorySidebar` has per-session Restore/Export/Delete. **`IMPORT_BACKUP` is authoritative**: each slice the backup carries *replaces* the local one (settings/life/history), and `currentDay` replaces today's plan (re-dated to today) — recovery means "make this device match the backup", not merge. Because that's destructive, `useDataImport` parks every validated backup in `pendingBackup` and the shared `RestoreConfirmModal` ("Replace & Restore") always confirms before dispatching — offering a default-on **download of the current data first**, the same escape hatch Reset Everything has. The shared parse/validate/dispatch logic lives in `useDataImport` (over `lib/dataImport.ts`); the Welcome page's "Restore from a backup" opens an in-place `RestoreModal` that imports and then loads any restored day as today's plan (`RESTORE_DAY`) without leaving the page — no Settings round-trip.

**Backup scope & integrations** — a Full Backup is **data + integration references/preferences, never credentials**:
- **Todoist.** *Not* in the backup: the personal API token (server-side in Workers KV `todoist:token`; the browser never holds it). *In* the backup: `settings.habitsTodoistProjectId`, and every embedded **task reference** — `LinkedTask.todoistId` + `titleSnapshot` inside `history[].plan`, and `todoistTaskId` on `life.habits[]` and habit instances (IDs/labels, not auth). After restoring on a fresh deployment, **reconnect Todoist** (paste token) in Settings → Integrations; the imported IDs re-link automatically for the same account.
- **Google Calendar.** *Not* in the backup: the OAuth refresh/access tokens (Workers KV / in-memory, server-side). *In* the backup: `settings.googleCalendarConnected` (flag), `settings.googleCalendarIds` (selected `GoogleCalendarEntry[]`), `settings.calendarViewMode`. The imported `googleCalendarConnected: true` is provisional — `GoogleCalendarProvider` re-checks `/api/auth/google/status` on load, so a device whose KV has no token self-corrects to disconnected; re-authorize Google if it shows disconnected.
- **Provenance (v7.11 / schema 7.7).** Backups stamp `_exportedAt` + `_originHost`, and the **account fingerprints** ride inside `settings`: `todoistAccount` (Todoist user id/email via `GET /user`) and `googleAccount` (primary calendar id = account email), stamped at connect when absent. At import, `useDataImport` compares them (plus the origin host, plus `_exportedAt` against the sync meta clock — an **"Older backup"** warning when the file predates the live data by >5 min) against the live connections and surfaces warnings in the confirm modal (which every backup import passes through), whose copy states that a restore syncs to other devices. At runtime, a fingerprint↔live-account **mismatch pauses all habit-task writes** (red "account changed" chip/banner with an explicit adopt action) and pauses the Google calendar prune/auto-provision (notice + adopt in Settings) — so a foreign registry can no longer trigger mass re-creation in the wrong account. The stamp/compare/adopt cycle is one shared hook (`useAccountFingerprint`, whose ok/wait/blocked `fingerprintVerdict` gates `ReconciliationProvider`, `useSyncHabit`, and the Google writers alike), and the notice is one shared `AccountMismatchBanner`. See [reference/backup_and_restore.md](./reference/backup_and_restore.md).
- **Durable markers (v7.11).** The same-account complement to the fingerprints: every habit task carries the **`orchestrate-habit` label** (class marker: "ours") plus an **`[orchestrate:habit:<uuid>]` description token** (instance marker: which habit — exact, rename-proof pairing for stores that share a backup lineage, since backups carry habit uuids), and the Orchestrate calendar carries an **`orchestrate:managed-calendar` token in its description** (stamped at create; backfilled on rename and on the linked calendar). Provisioning resolves **id → marker adoption → create** (task adoption: uuid token first, then label + exact name): a registry-less store on the same account (fresh local dev, post-`RESET_ALL`, backup-seeded) adopts the existing task / the marker-carrying calendar (taking over its live name) instead of duplicating. The **create rung is consent-gated for previously-linked habits**: automatic reconcile passes are adopt-only when a habit's task has vanished (a deliberate deletion in Todoist stays deleted); re-creation happens only from the Habits page — the bulk Re-sync, or the per-habit recreate on each missing habit's chip. Residuals: renames pair with nothing only when no uuid is shared (hand-recreated habits), and the calendar description patch is best-effort under the narrow `calendar.app.created` scope.
- **Not in the full backup by design:** the Todoist cache, the identity stamp, and theme/music/pomodoro prefs. (Today's live `plan` **is** included, as `currentDay`, whenever it has content.)

**Reset**: Settings → Data → Reset section has two destructive actions, each gated by a `ConfirmModal`:
- **Reset Today's Plan** dispatches `RESET_DAY` — replaces `plan` with a fresh plan (sessions re-seeded from settings/defaults) and clears `editingStep`. Settings, history, life (seasons / habits / backlog / rest cues / session templates), and Todoist auth are untouched. Useful for cleaning up after a `RESTORE_DAY` that imported an unwanted session.
- **Reset Everything** dispatches `RESET_ALL` and manually clears `orchestrate-todoist-cache` — a factory reset of all four reducer-managed slices (plan + settings + history + life). It does **not** touch the server-side integration tokens (Todoist/Google in KV) — disconnect those from Settings → Integrations. The confirm modal offers a **Full Backup download first** (default on) and an opt-in **delete of the habit tasks Orchestrate created in Todoist** (default off; ids snapshotted before the wipe, deleted best-effort after) — declined, those tasks stay as orphans that keep the `orchestrate-habit` marker, so re-creating same-named habits later *adopts* them rather than duplicating (renamed habits still create fresh tasks). Other Todoist tasks/projects are never modified. Theme and music prefs (separate localStorage keys outside the reducer) survive.

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
| `useGcalCallback` | `hooks/useGcalCallback.ts` | v7.10: processes the OAuth callback redirect (`?gcal=connected\|error`) wherever it lands (Settings panel or onboarding) — re-checks the connection, maps error reasons to human copy, strips the one-shot params. |
| `useGoogleCalendarData` | `hooks/useGoogleCalendar.ts` | v7.2: read-only Google Calendar OAuth state (isConnected / authFailed, available calendars) |
| `useGoogleCalendarActions` | `hooks/useGoogleCalendar.ts` | v7.2: connect(returnTo)/disconnect, checkConnection, refreshCalendars, createEvent (Worker-mediated) |
| `useIntentionRemoval` | `hooks/useIntentionRemoval.ts` | moveToBacklog, removeIntention, discardFromBacklog |
| `useConfirmModal` | `hooks/useConfirmModal.ts` | Reusable confirm-dialog state |
| `useHabitReconciliation` | `hooks/useHabitReconciliation.ts` | v6.5: read central reconcile status — counts, the **named needs-sync habit list**, error, in-flight — + manual trigger |
| `useSyncHabit` | `hooks/useSyncHabit.ts` | Per-habit →Todoist sync + habit-patch write-back (**'habit' kind only** — micro-gaps early-return). Shared by HabitsLibrary save flow and `ReconciliationProvider`. v7.11: gated by `fingerprintVerdict` (waits for identity, blocks on mismatch) and resolves via the adoption ladder with an `allowCreate` opt-out. |
| `useAccountFingerprint` | `hooks/useAccountFingerprint.ts` | v7.11: the shared account-provenance cycle for both integrations — stamp-when-absent, mismatch object (for `AccountMismatchBanner`), adopt action, and the pure `fingerprintVerdict` (`ok`/`wait`/`blocked`) every auto-writer gates on. |
| `useDataImport` | `hooks/useDataImport.ts` | Shared restore/import logic (Settings → Data + Welcome `RestoreModal`): parse/validate via `dataImport.ts`, provenance warnings (accounts, origin host, backup age vs the sync meta clock), and the parked `pendingBackup` the shared `RestoreConfirmModal` confirms. |
| `useHabitMutations` | `hooks/useHabitMutations.ts` | Shared habit create/edit/delete with best-effort Todoist sync (project resolution + `useSyncHabit`), plus the `HabitForm` Todoist props and `syncError`. Used (via `useHabitForms`) by `HabitsLibrary` and `LifeView` so both surfaces share one CRUD path. |
| `useHabitForms` | `hooks/useHabitForms.tsx` | Wraps `useHabitMutations` and owns the shared create/edit/anchor-delete **modal stack** + open/edit/`requestDelete` triggers. Returns a ready-to-render `modals` node so `HabitsLibrary` and `LifeView` render the same form/confirm plumbing instead of duplicating the JSX. |
| `useHabitReschedule` | `hooks/useHabitReschedule.ts` | Shared inline-reschedule state for `TodaysHabitInstance` rows (HabitInstanceCard + Step3HabitsPanel); pairs with `HabitTimeEditor`. |
| `useToggleHabitInstance` | `hooks/useToggleHabitInstance.ts` | Start/Stop a `TodaysHabitInstance` (both kinds): dispatches `START_/STOP_HABIT_INSTANCE`. Shared by `HabitInstanceCard` + `MicroGapCard`. |
| `useTodaysHabitsSync` | `hooks/useTodaysHabitsSync.ts` | Day-of sync effect: feeds `computeTodaysHabitInstances` + `computeTodaysMicroGapInstances` into `REFRESH_TODAYS_HABITS`, then prunes deleted-habit and stale instances. Mounted by Step 1 + dashboard. |

---

## 14. Directory Structure

Repo-root deployment files (outside `src/`): Cloudflare Pages Functions in `functions/` — `api/auth/google/*` (OAuth endpoints + `_lib.ts`), `api/todoist/[[path]].ts` (Todoist proxy) + `api/todoist-auth/*` (token/status/disconnect), `api/state/*` (D1 sync), `api/me.ts` (identity), and `_shared.ts` (the Cloudflare Access JWT guard `requireUser` via `jose`, `json` helper, per-user KV-key helpers, env types — the Google `_lib.ts` re-exports `json`/`requireUser` from it rather than keeping its own copy); plus `wrangler.toml` (Pages config + KV/D1 bindings), `db/schema.sql` + `db/migrate_add_user_id.sql`, and `public/_redirects` (SPA fallback). How it works: [reference/backend.md](./reference/backend.md); setup: [deployment.md](./deployment.md).

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
|   `-- ReconciliationContext.tsx   # v6.5: central habit reconcile (overdue + needs-sync); v7.11: fingerprint gate, marker backfill, adopt-only autos + recreateHabitTask
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
|   +-- useBuddyActivity.ts     # ASCII buddy activity mapping (day window / engaged habit / engaged task)
|   +-- useAccountFingerprint.ts # v7.11: shared account-provenance cycle (stamp/compare/adopt + fingerprintVerdict gate)
|   +-- useDataImport.ts        # shared backup/day-plan import logic (validation, provenance warnings, pendingBackup)
|   `-- useGcalCallback.ts       # v7.10: OAuth callback (?gcal=…) processing, shared by Settings + onboarding
|
+-- lib/
|   +-- identity.ts             # v7.10: Access identity utilities (orchestrate-user stamp, SessionExpiredError, redirect-aware apiFetch, /api/me client)
|   +-- googleAuth.ts           # v7.2: Worker OAuth client (startGoogleLogin(returnTo), fetchAccessToken, fetchConnectionStatus, disconnectGoogle)
|   +-- googleCalendarApi.ts    # v7.2: Calendar REST v3 client (listCalendars, createCalendarEvent)
|   +-- schema.ts               # SCHEMA_VERSION / MIN_SUPPORTED_SCHEMA + gate (isSupportedSchemaVersion) + migrateToCurrent seam — shared by DayPlanContext loaders + DataManagement import
|   +-- time.ts                 # Time utilities (timeToMinutes, todayISO, etc.)
|   +-- habits.ts               # habitMatchesDate/recurrenceMatchesDate, habitKindOf, partitionByKind, computeTodaysMicroGapInstances, getActiveHabits, getAnchorHabits
|   +-- habitsTodoistSync.ts    # buildDueString, ensureHabitsProject, syncHabitToTodoist (id → uuid token → marker+name → create ladder, allowCreate), findAdoptableTask, marker helpers (hasHabitMarker, habitIdTokenOf, withHabitIdToken), computeTodaysHabitInstances, findStaleTodaysHabitInstances, findOverdueHabits, reconcileOverdueHabits, findNeedsSyncHabits
|   +-- backlog.ts              # hasUnfinishedWork, buildBacklogEntry, harvestStalePlan, rebuildLinkedTasksForBacklogEntry
|   +-- engagementHistory.ts    # v7.4 P2: durable engagement archive — buildRecordFromClosedSegment, appendEngagementRecord, pruneEngagementHistory (90d), computeReentryStats, lastEndedFor
|   +-- intentionUnschedule.ts  # unscheduleIntentionTasks pure helper
|   +-- seasons.ts              # findActiveSeason, getSeasonProgress
|   +-- tasks.ts                # getTaskTitle, collectDescendantIds
|   +-- capacity.ts             # computeSessionCapacity / computeAllSessionCapacities
|   +-- timeline.ts             # time<->position geometry (formatHour, minutesToPct/pctToMinutes)
|   +-- spotify.ts              # spotifyPlaylistId, isValidSpotifyUrl
|   +-- cloudSync.ts            # v7.9: D1 sync sidecar client — pullAndMerge, notifyChanged, markLocalReset, latestLocalChangeMs, identity-switch guard
|   +-- dataImport.ts           # FullBackup shape + validateBackup (discriminated rejection reasons), validateSessions, validateDayPlan
|   +-- backup.ts               # v7.11: downloadFullBackup — one builder for the Export button, reset opt-in, and restore escape hatch
|   +-- download.ts             # downloadJSON helper
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
    +-- RestoreModal.tsx        # Welcome-page in-place restore (import + load a day as today)
    +-- RestoreConfirmModal.tsx # v7.11: shared restore confirm — warnings + backup-first escape hatch
    +-- buddy/
    |   `-- AsciiBuddy.tsx, animations.ts   # ASCII slice-of-life companion overlay + frame data
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
        +-- HabitSyncChip.tsx, AccountMismatchBanner.tsx   # header sync/mismatch chip; v7.11 shared mismatch notice
        `-- formStyles.ts
```

---

## 15. What's NOT Built Yet

The remaining proposals in [backlog.md](./backlog.md) are NOT implemented. Key items:

- **Per-slice D1 snapshots.** No automatic point-in-time restore yet — backups remain manual-only (both destructive flows offer a pre-action download). Design settled in the backlog entry.
- **Modes, rituals, recovery mode.** No `DayPlan.mode`, no ritual templates / `RitualPlayer`, no Minimum Viable Day. (Targeted for v7.)
- **Reviews and drift detection.** No `/review` route, no weekly/seasonal review flows, no drift-signal aggregation. (Targeted for v8.)

Treat these as future work, not current behavior.