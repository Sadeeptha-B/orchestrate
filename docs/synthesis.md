> **Start here.** This is the canonical context document for the current state of Orchestrate. Deeper references: [user-guide.md](./user-guide.md) (mental model & how to use the entities), [vision.md](./vision.md) (durable "why"), [architecture.md](./architecture.md), [data-model.md](./data-model.md), [backlog.md](./backlog.md) (forward-looking proposals). Frozen historical artifacts live in [history/](./history/) — do not treat them as current state.
>
> **Last updated:** 2026-05-17 · **Schema:** v6.2 · **Iteration history:** [history/plan_v6.x.md](./history/plan_v6.x.md)

# Orchestrate — Purpose & Current Feature Set

A self-contained synthesis of what Orchestrate is, what it does today, and the design tensions that shaped it. Intended as handoff context for another agent.

---

## 1. Purpose

Orchestrate is a **single-user, browser-based daily contextualization companion**. It does *not* try to replace the user's todolist or calendar — it sits alongside them and walks the user through a structured, friction-reducing morning ritual that turns a vague "what am I doing today?" into a concrete, scheduled, music-cued plan.

The core problem it targets:
- **Task and time blindness.** Generic todo lists store epics; they don't help on a fresh day when the relevant unit is *intent for today*, not *open work in general*.
- **Contextualization friction.** The mental work of comparing today's goals against an existing todo list, breaking work into actionable tasks, fitting them into available time, and locking into a working state is high-effort and skipped by most apps.
- **Sustained focus.** Once the day starts, drift, fatigue, and context loss erode follow-through. Orchestrate nudges hour-by-hour and ties working state to a music protocol.

The app is **opinionated and personal** to the author's workflow: fixed default session slots (early morning, morning, afternoon, night), a curated 6-playlist Spotify protocol, and integrations with the specific tools the author already uses (Todoist + Google Calendar).

---

## 2. Operating Model

The user's day flows through three primary surfaces, with a hierarchical-planning layer above them:

```
Welcome (hub)  ─▶  Wizard (4 steps)  ─▶  Dashboard
   │  ▲                ▲                       │
   │  └────────────────┴── Edit Plan / Recontextualize
   │                                           │
   └────────────┐                  ┌───────────┘
                ▼                  ▼
         /life  ─▶  /season  ─▶  /season/:id
                ▼
              /habits
```

Welcome is a multi-purpose home hub (since v5.1): a "Today" card with the wizard CTA + step timeline, plus a "Life" card surfacing the active season and anchor habits with quick links into `/life` / `/habits` / `/season`. The `/life` family of routes is the scaffolding above the day — where Seasons, Habits, and (in v7+) Rituals and Reviews live. Life routes are reachable directly (no `setupComplete` requirement) so users can edit habits/seasons without first walking through the wizard.

### 2.1 Vocabulary

| Term | Meaning |
|---|---|
| **Intention** | A high-level goal for *today* (e.g. "Finish assignment 3"). Today-scoped, user-created. v6.2: can be parked in the **Backlog** instead of deleted. |
| **LinkedTask** | A Todoist task surfaced inside Orchestrate's plan. Either bound to an intention (`intentionId`) or an **orphan habit-task** (`sourceHabitId`, no parent intention). The unit that gets scheduled. |
| **Backlog** | Persistent pool of parked intentions at `life.backlog`. Populated via manual `📥` or day-rollover harvest. Surfaces in the `HistorySidebar`'s Backlog tab. |
| **Main task** | A primary work thread. Exclusive to one session. |
| **Background task** | A small/recurring task. Can be assigned to multiple sessions. Cap resolved from `Habit.targetDurationMinutes` (stabilizers) or `AppSettings.taskCapDefaults` per kind (defaults: stabilizer 30 / lightCoherent 20 / manualBackground 30). |
| **Season** | A medium-horizon focus period (4–12 weeks) with theme, goals, non-goals, success criteria, optional capacity budget. Exactly one active at a time. |
| **Habit** | A first-class recurring entity. Discriminated by `kind` into **stabilizer** and **light-coherent**. Owns recurrence rule, minimum-viable form, trigger cue, anchor flag, season scope. |
| **Stabilizer** | `kind: 'stabilizer'` habit. Synced to Todoist as a recurring task; surfaces as a session-assigned orphan LinkedTask each day it's due. Auto-assignment via Todoist `due.datetime` → SessionSlot. |
| **Light-coherent** | `kind: 'light-coherent'` habit. Micro-gap filler. Surfaces in the **Light Pool**, logged via `plan.habitLog`. Never enters the task plan. |
| **Light Pool** | Dashboard panel + `/life` section listing today's active light-coherent habits. Start/Complete writes a `HabitLogEntry`. |
| **True Rest** | Catalog of non-task recovery cues. 8 built-in; user-customizable via `/rest-cues`. Surfaced on Dashboard `InsightCard`, in the check-in modal for low-energy states, and as a between-session banner. |
| **Anchor habit** | `isAnchor: true` — protected from accidental deletion while active. Orthogonal to `kind`. See [user-guide.md](./user-guide.md) §6. |
| **Session** | A configurable time block (default: early-morning, morning, afternoon, night). Tasks are assigned to sessions. |
| **Session capacity** | Advisory arithmetic: `(session length − buffer) − Σ estimatedMinutes`. Status `over` at >150% — non-blocking banner, wizard always advances. |
| **Check-in** | Hourly prompt during active sessions: feeling + work type → playlist suggestion. Low-resource states surface Light Pool rows + True Rest cue. `stuck` adds avoidance-note capture. |

### 2.2 The Wizard (4 steps)

Sequential setup that captures the day's plan:

1. **Step 1 — Intentions.** Two phases: (a) write down intentions for the day, (b) sequentially walk through each intention and *map* it to specific Todoist tasks via the embedded TodoistPanel ("Link"/"Unlink" buttons). Mapped intentions become collapsible panels showing their linked tasks; users can remap individually or restart mapping wholesale. **v6.1:** stabilizer habits no longer appear in the intention list — instead, the step mounts an injection effect (`INJECT_HABIT_TASKS`) that surfaces today's stabilizer Todoist tasks as orphan LinkedTasks with auto-assigned sessions. An informational chip ("N habit tasks scheduled for today — see Step 3") appears in Phase 1 when any are present. The TodoistPanel renders a non-actionable "🔁 Habit" label in place of the Link button on rows backed by a habit-task. **v6.2:** each intention row now shows two icon buttons — `📥` (Move to backlog) and `🗑` (Delete, confirm-modal). Both unschedule the intention's linked Todoist tasks via the shared `useIntentionRemoval` hook.

2. **Step 2 — Refine.** Per-intention sequential flow. For each linked task: categorize as **main** or **background**, and set an **estimate** (preset pills: 15m / 30m / 45m / 1hr, or custom). Background tasks clamp to `taskCapDefaults.manualBackground` (default 30 min). Tasks > 60 min trigger a non-blocking nudge to break down via the TodoistPanel (collapsed by default; auto-opens on >60min estimates). **v6.1:** orphan habit-tasks (no `intentionId`) bypass Step 2 entirely — they arrive pre-typed (`background`) and pre-estimated from injection.

3. **Step 3 — Schedule.** Two phases:
   - **Phase 1 (Assign):** A proportional `SessionTimelineBar` shows sessions as blocks. User clicks a session and assigns tasks to it. Main tasks are exclusive to one session; background tasks can be assigned to multiple. **v6.1:** habit-tasks already arrive pre-assigned to sessions whose time range covers their Todoist `due.datetime`; any habit-tasks without a resolvable session land in an "Unassigned habits" tray above the timeline (drag/drop into a session). The selected-session detail panel groups assigned habit-tasks under a "🔁 Habits" header. **v6.2:** the top of Phase 1 shows a "Today's intentions (N)" overview panel listing every active intention with task count + `📥` (Move to backlog) + `🗑` (Delete) buttons — for the overcommitment-realization moment. Cannot advance until at least one task is assigned.
   - **Phase 2 (Time):** Side-by-side TodoistPanel + Google Calendar embed. User schedules concrete times in Todoist (which sync to Google Calendar via the user's existing Todoist↔Calendar sync). Estimate-based auto-fill: entering a start time auto-computes end time from `estimatedMinutes`.

4. **Step 4 — Start Music.** Plays the "Start Work" Spotify playlist as a ramp-in trigger, then transitions to the Dashboard.

The user can return to any step from the Dashboard ("Edit Plan" → Step 1, "Recontextualize" → Step 3).

### 2.3 The Dashboard

The operational view for the rest of the day. Layout (top to bottom):

1. **Header** — completion counter (linked tasks done / total), Save / Edit / Saved Sessions, and `HeaderControls` (About / Settings / ThemeToggle).
2. **Music row** — `PlaylistSelector` (6 work-type buttons) + live `DigitalClock`.
3. **Player row** — embedded `SpotifyPlayer` iframe + `InsightCard` (alternates between the Transition Tips music cheat-sheet and a True Rest recovery cue every 2 min; manual `›` advance).
4. **Timeline** — `SessionTimelineBar` (read-only) with a pulse on the active session.
5. **Current Session** — detailed card with the active session's tasks: drag-to-reorder, completion checkboxes (with `canvas-confetti` on completion), nudge banners for background tasks.
6. **Task Manager** — collapsible TodoistPanel, defaulting to "Linked Tasks" filter.
7. **Calendar** — collapsible Google Calendar embed.

Throughout the day:
- **Hourly check-in** modal fires on each whole hour during an active session. Captures feeling (great/okay/struggling/stuck) + work type. The work type maps to a suggested playlist. Optionally sends an OS notification. The check-in can route the user back to Step 3 to recontextualize.
- **`useCurrentSession`** polls every 60s to determine the active session.

---

## 3. Music Protocol

Music is treated as a deliberate state machine, not background ambience. Six curated Spotify playlists are mapped to work types:

| Work type | Playlist | Use |
|---|---|---|
| *(start of day)* | 🚀 Start Work | Ramp-in trigger; 5–10 min then switch |
| Coding / problem solving | 🧠 Deep Focus | Sustained focus |
| Lectures / passive input | 🌊 Lo-Fi Beats | Light work |
| Restless / high energy | 🔥 Brain Food | Stimulating but controlled |
| Low energy / foggy | 🧱 Peaceful Piano | Gentle re-entry |
| Reading / deep cognition | 🔇 White Noise | Or silence — language-heavy work |

Users can override any playlist with a custom Spotify URL. The check-in suggests a playlist based on declared work type. Full protocol (transition rules, volume guidance, when to go silent) is captured in [music_routine.md](./music_routine.md) and surfaced in the dashboard's `InsightCard` (which cycles the Transition Tips alongside True Rest cues).

---

## 4. External Integrations

| System | Integration | Purpose |
|---|---|---|
| **Todoist** | REST API v1 with personal API token (AES-256-GCM encrypted in localStorage). Full CRUD on tasks/projects, completion via Sync API. Stale-while-revalidate cache (5min hydration / 30s focus on **both** tasks and projects, post-v6.1). HTTP 401 routes to an `authFailed` flag surfaced as a reconnect banner in Settings. | Source of truth for tasks. Orchestrate stores only Todoist task IDs + a `titleSnapshot` fallback. |
| **Google Calendar** | Read-only embed iframe. Multi-calendar with per-calendar colors. Week / month / agenda view. | Time context. The user's existing Todoist↔Google Calendar sync makes scheduled tasks appear automatically. |
| **Spotify** | Embedded player iframe. 6 curated playlists, custom URL override per playlist. | Music protocol. |

Important nuance: Orchestrate has **no backend**. All persistence is `localStorage`. Todoist API calls are direct from the browser (via Vite dev proxy in development to dodge CORS). The Todoist token is encrypted client-side; key + IV + ciphertext all live in localStorage — protects against casual inspection, not against an attacker with browser-profile access.

---

## 5. Data Model — The Essentials

Three interlocking ideas:

**Intentions own (manually linked) LinkedTasks.** An intention has `linkedTaskIds: string[]` (ordered Todoist IDs). A `LinkedTask` has either an `intentionId` back-reference (manual link) **or** a `sourceHabitId` (orphan habit-task, v6.1) — never both. Plus `type` + `estimatedMinutes` + `assignedSessions[]` + `completed` + `titleSnapshot?` + `skippedForToday?`. The flat `linkedTasks` array on `DayPlan` is the denormalized list.

**Tasks (not intentions) are scheduled.** `DayPlan.taskSessions: Record<sessionId, todoistId[]>` is the source of truth for what runs in each session. `LinkedTask.assignedSessions` is a derived mirror kept in sync by the reducer.

**LifeContext sits above the day.** A separate persistent state slice (`life: LifeContext` on the provider, persisted to `orchestrate-life-context`) holds `seasons[]`, `habits[]`, `activeSeasonId`, and (v6.2) `backlog?: BacklogEntry[]`. **v6.1:** stabilizer habits carry `todoistTaskId` (the persistent recurring Todoist task), `targetTime`, `targetDurationMinutes`, and `windowBehavior`. The `INJECT_HABIT_TASKS` action (fired on Step 1 mount, re-fired when the Todoist cache grows) consumes `computeHabitTasksToInject(...)` from `lib/habitsTodoistSync.ts` to surface eligible orphan habit-tasks for the day. **v6.2:** `BacklogEntry` snapshots a parked intention as `{ id, intention (with pending-only linkedTaskIds), archivedAt, archivedFromDate, reason: 'manual' | 'rollover', taskSnapshots?, completedTaskTitles? }`. Completed-task ids never enter `linkedTaskIds`; their titles ride along in `completedTaskTitles` purely for context display in the Backlog tab.

Consequence: **a single intention can have both main and background tasks** (the v4 fix), and **habit-tasks live alongside intention-bound tasks in the same `linkedTasks` array** — distinguished by which of `intentionId` / `sourceHabitId` is set.

The plan auto-resets daily. **v6.2:** the init path is a coordinated `loadInitialState()` helper that peeks at the persisted plan via `peekRawPlan()` — when the date is stale, it harvests unfinished intentions into `life.backlog` and returns a fresh plan. **No automatic save** to `SavedDayPlan` history happens at rollover; the backlog already preserves the meaningful unfinished part of yesterday, so `history` is reserved for explicit manual saves. User preferences (Todoist token, session slots, calendar IDs, **`habitsTodoistProjectId`** in v6.1) survive in `AppSettings`. Manually-saved days can be restored from the `HistorySidebar` Sessions tab.

A migration chain (v1 → v2 → v3 → v4 → v4.1 → v5 → v6 → v6.1 → **v6.2**) handles old saved sessions on load. v6 → v6.1 dropped habit-derived intentions and re-anchored their LinkedTasks as orphans. v6.1 → v6.2 has no plan-shape changes; just stamps the new `_schemaVersion: 6.2` marker and defaults `life.backlog` to `[]`. Schema marker is now `6.2` (a JSON float) on plan, settings, life, and saved-session payloads.

Stale task handling is well-developed: completed tasks stay visible (strikethrough + 🎉) using `titleSnapshot`; deleted tasks auto-unlink; externally-completed tasks are detected and marked complete (not unlinked) so session tracking is preserved.

Full type catalog and reducer action list: [data-model.md](./data-model.md). Historical implementation plan: [history/plan_v4.md](./history/plan_v4.md).

---

## 6. Tech Stack

- **React 19** + TypeScript + **Vite 8**
- **Tailwind CSS v4** with `@theme` CSS custom properties; light/dark themes via `.dark` class on `<html>`
- **React Router v7** (BrowserRouter, basename `/orchestrate/`)
- State: React Context + `useReducer` for the core `DayPlan`; split contexts for Todoist (data vs actions, to avoid render thrash); a small Music context scoped to the dashboard
- Persistence: `localStorage` only — 4 primary keys + 3 auxiliary keys
- Crypto: Web Crypto API (AES-256-GCM) for the Todoist token
- PWA: service worker (network-first, falls back to cache then `index.html`), manifest with maskable icons
- Dependencies of note: `canvas-confetti` (task completion celebration), `date-fns`, `react-router-dom`

---

## 7. What's In Today (Feature Inventory)

**Setup & onboarding**
- Welcome hub (v5.1): Today card (plan-status copy + primary CTA + wizard step timeline) and Life card (active season summary, anchor habits, quick links to `/habits` and `/season`). Detects first-visit / resuming / returning.
- Todoist token setup (paste + encrypt) with validation
- Multi-calendar Google Calendar configuration with colors and view mode

**Wizard**
- Step 1: intention entry, sequential mapping to Todoist tasks, individual or wholesale remap, collapsible mapped-intention panels showing linked tasks. **Season focus banner** at the top of Phase 1 surfaces the active season's name + theme and renders each `supportingGoal` as a clickable chip — clicking adds it as an intention via `ADD_INTENTION` (already-added goals render as disabled `✓` chips). Empty-state nudge with "Set up a season" link when no season is active. **v6.1:** mounts `INJECT_HABIT_TASKS` (idempotent; re-fires when Todoist `taskMap` grows) so today's stabilizer habit-tasks land in `plan.linkedTasks` as orphan tasks; an inline chip shows the count.
- Step 2: per-intention categorization + estimation, preset + custom estimate input, background `manualBackground` cap (v6.1: orphan habit-tasks bypass this step), >60min breakdown nudge with auto-opening task manager, horizontal task cards when panel collapsed
- Step 3: two-phase scheduling — proportional timeline assignment + side-by-side Todoist/Calendar time scheduling with estimate-based end-time auto-fill, phase gating, completed-task short-circuit. **v6.1:** orphan habit-tasks render under a "🔁 Habits" group inside the selected-session detail; an "Unassigned habits" tray sits above the timeline for any habit-tasks without a resolvable session.
- Step 4: Spotify start-work playback + setup completion

**Dashboard**
- **Season context card** rendered as a right-rail companion to the Timeline section: active season name (links to `/season/:id`), primary theme, date range with "Week N of M" pill (when both dates set), first 3 supporting goals with inline "+N more" expand/"Show less" toggle, "Manage" button. Empty-state card prompts "Create a season" with a secondary "Why seasons?" link to `/life`.
- Live current-session detection
- Drag-to-reorder tasks within a session
- Inline task completion with confetti
- Persistent linked-task indicators in the TodoistPanel ("linked to: {intention}" amber labels) at all times, not just during mapping
- Inline task title editing (click → edit → Enter to commit)
- Filter toggle (All / Linked) inside the TodoistPanel header
- 6-playlist selector with per-playlist custom URL override
- Embedded Spotify player and Google Calendar
- Static music transition tips card

**Through-the-day support**
- Hourly check-in modal (feeling + work type + playlist suggestion + recontextualize button)
- OS notification support (with user preference: in-app / browser / both)
- Recontextualize jump back to Step 3 from check-in

**Life scaffolding (v5–v6.1)**
- First-class `Season` entity: name, theme, supporting goals, non-goals, success criteria, optional capacity budget. Exactly one active.
- First-class `Habit` entity (v6 discriminated): `kind: 'stabilizer' | 'light-coherent'`, recurrence, minimum-viable, trigger cue, completion rule, failure tolerance, anchor flag, season membership. **v6.1 (stabilizers only):** `todoistTaskId` (the synced recurring task), `todoistProjectId` (per-habit project override), `targetTime` (`"HH:mm"`), `targetDurationMinutes`, `windowBehavior` (`'strict' | 'lenient'`).
- Anchor habits get protection from accidental deletion (must deactivate first).
- **Stabilizers (v6.1):** saving a stabilizer in `HabitsLibrary`/`HabitForm` calls `ensureHabitsProject(...)` once to resolve the workspace default (the lazily-created "Habits" project, the user's pick from the `TodoistSetup` dropdown, or the per-habit override), then `syncHabitToTodoist(...)` to push a recurring task with `due_string` derived from `Habit.recurrence` + `targetTime` (e.g. `"every weekday at 7:00"`). Editing a habit's project moves the existing task via the Sync API (`item_move`). The Migrate-banner bulk path resolves the default project once before iterating, fixing a v6.1 closure bug that previously created a duplicate project per habit; it also names the destination project inline and exposes a **Choose project** shortcut that navigates to `/settings?tab=integrations` so users can pick a default before kicking off the bulk migrate. On planning, the habit's task surfaces as an orphan LinkedTask (no intention) auto-assigned to the session containing its `due.datetime`.
- **Light-coherent habits never enter the task plan** — they live in the Light Pool, logged via `plan.habitLog`.
- Per-task duration caps: stabilizer habit-tasks use `Habit.targetDurationMinutes ?? taskCapDefaults.stabilizer`; manually-categorized backgrounds use `taskCapDefaults.manualBackground`.
- New routes: `/life` (hub, includes a Light Pool section with weekly cadence rollup), `/season` (list), `/season/:id` (detail), `/habits` (library), `/rest-cues`.
- `ActiveSeasonBadge` in Dashboard + Wizard headers.
- "Life" button in Dashboard header.
- **Post-v6.1 integration hardening**:
  - **Re-sync banner**: the `/habits` "needs sync" banner now also detects stabilizers whose previously-synced Todoist task has gone missing (cache-loaded but `taskMap.get(todoistTaskId) === undefined`), not just unsynced ones. Copy and button label flip between "Migrate" / "Re-sync" accordingly. The re-sync path uses the same loop and the helper's create-branch fall-through to recreate missing tasks.
  - **Self-healing stale references on save**: `syncStabilizer` now patches the habit in a single follow-up `UPDATE_HABIT` when it detects a stale `todoistProjectId` (per-habit override pointing at a deleted project — silently fell back to default) or when the create branch returned a fresh `todoistTaskId` (covers out-of-band Todoist task deletion).
  - **Refresh-projects affordance**: both `TodoistSetup` and `HabitForm` render a `↻ Refresh` button calling `actions.refreshProjects({ force: true })` so newly-created Todoist projects show up without an app reload. Both surfaces also detect stale project ids (default in Settings; per-habit in HabitForm) and render warnings with explicit "Clear" affordances.
  - **Habit-save lockout during migration**: while the migrate loop is running, the **New Habit** button and per-row Pause/Edit/Delete buttons are disabled — prevents a concurrent `handleCreate` from racing the loop's `ensureHabitsProject` call (the user-task-vs-background-task distinction the user resolved against a mutex).
  - **Auth-failure surfacing**: HTTP 401 from any Todoist call flips a new `authFailed` flag on `TodoistDataContext`; `TodoistSetup` renders a red top banner and flips the status badge to "Token rejected" so a revoked/expired token never disappears into the silent project/section fetch path.
  - **`IMPORT_BACKUP` runs the same habit migration as `loadLifeContext`**: a v6 backup imported into v6.1 picks up `todoistTaskId` / `targetDurationMinutes` / `windowBehavior` defaults instead of looking unsynced.

**Day-level intelligence (v6)**
- **Light Pool panel** on the Dashboard (between Current Session and Task Manager) — per-row Start/Complete writes to `plan.habitLog`, never enters the task plan.
- **True Rest** — surfaced via the `InsightCard` on the Dashboard player row (alternates between Transition Tips and a True Rest cue on a 2-min auto-cycle with manual `›` advance), as an inline cue in the check-in modal for low-resource states, and as a between-session banner when the next slot is within 60 min. The cue catalog is user-configurable via the dedicated `/rest-cues` page (`RestCuesManager`): filterable by category (All / Physical / Breath / Sensory), with per-row inline add/edit/delete. Custom cues are stored in `life.restCues`; when unset, the 8 built-in defaults from `src/data/restCues.ts` are used. First edit auto-seeds from defaults so no explicit "Customize" step is needed.
- **Session capacity arithmetic** in `src/lib/capacity.ts` — surfaces a per-session `SessionCapacityBadge` on the Step 3 timeline and the Dashboard Current Session card, plus a `SessionCapacityBanner` above the Step 3 timeline when any session is `over` (> 150%). Mid-session calc uses remaining minutes. Background tasks count once per assignment.
- **Per-task duration caps** — `AppSettings.taskCapDefaults` (stabilizer 30 / lightCoherent 20 / manualBackground 30, all tunable in Settings) replace the old hard 30-min background clamp; **v6.1:** stabilizers override per-habit via `Habit.targetDurationMinutes` (was `maxBlockMinutes`).
- **Check-in upgrades** — `feeling === 'stuck'` adds a "What exactly are you avoiding?" capture (persisted as `CheckIn.avoidanceNote`); low-resource states reveal 1–2 Light Pool rows + a True Rest cue.

**Persistence & history**
- Auto-reset of plan when date changes — **v6.2:** harvests unfinished intentions into the backlog before resetting. The stale plan itself is otherwise discarded; `SavedDayPlan` history is reserved for explicit manual saves.
- Manual save/restore of named day-plans (`SavedDayPlan` history), surfaced in the `HistorySidebar` Sessions tab.
- Import/export saved sessions with cross-version migration.
- **Full Backup** export/import bundles `{ settings, life, history }` to a single JSON file (merge-by-id on import; v6.2: `life.backlog` round-trips too) — the no-backend safety net for cross-device snapshotting.

**Intentions Backlog (v6.2)**
- Discarded intentions can move to `life.backlog` instead of being deleted. `📥` (non-destructive) and `🗑` (confirm-modal) icon buttons live on every intention row in Step 1 (`EditableTaskList`) and Step 3's new "Today's intentions ({N})" overview panel.
- Day rollover harvests unfinished intentions (those with at least one uncompleted intention-bound linked task) automatically.
- **Completed-task handling on archive:** `buildBacklogEntry` strips already-completed task ids from `intention.linkedTaskIds`. Their titles are stashed in `BacklogEntry.completedTaskTitles?: string[]` and rendered as a `✓ Done: …` annotation under the pending-count line in the Backlog tab. Restore reconstructs `LinkedTask` rows only for the pending ids, so Step 2 never sees a "stale" completed task masquerading as fresh `unclassified` work.
- Surfaces in the second tab of the renamed `HistorySidebar` (was `SavedSessions`). Wizard + Dashboard headers expose a single `Work Items` button (with a backlog-count suffix when non-empty) that toggles the sidebar; Sessions vs Backlog selection lives inside the sidebar's own tab toggle.
- **"Bring to today"** re-creates the intention with fresh `LinkedTask` rows (`type: 'unclassified'`, no estimate, no assignment) for *pending* ids only — user re-flows them through Step 2 + Step 3.
- **Bug fix bundled in**: `REMOVE_INTENTION` and all backlog paths now correctly clear `due_*` fields on linked Todoist tasks via `unscheduleIntentionTasks` (`due_string: 'no date'`). Habit-derived orphan tasks (`sourceHabitId` set) are explicitly skipped. Previously these tasks stayed scheduled in Todoist after intention deletion.

**Cross-cutting**
- Light/dark theme with cross-tab sync
- Saved-sessions sidebar in wizard (drag-to-resize)
- Error boundary
- PWA install + offline-tolerant cache
- Stale Todoist task handling: snapshot sync, deleted-task auto-unlink, externally-completed-task auto-mark, fallback display chain
- Todoist data layer with request deduplication, 30s focus-refresh window covering tasks + projects (post-v6.1), 5min cache TTL, stale-while-revalidate, 401 → `authFailed` flag + reconnect banner
- **In-app user guide** at `/guide` — mirrors [user-guide.md](./user-guide.md); reachable from the About modal on Welcome, Dashboard, and every Wizard step.

---

## 8. What's NOT In Today (Per User Direction)

**The remaining proposals in [backlog.md](./backlog.md) are NOT yet implemented.** Specifically, the following are out of scope for current state:

- **Modes, rituals, recovery mode.** No `DayPlan.mode` field, no ritual templates / `RitualPlayer`, no Minimum Viable Day. (Targeted for v7.)
- **Reviews and drift detection.** No `/review` route, no weekly/seasonal review flows, no drift-signal aggregation. (Targeted for v8.)

Treat these as future work, not current behavior. **First-class habits and Seasons shipped in v5; the Habit.kind split, Light Pool, True Rest, capacity arithmetic, and the legacy `isHabit` purge shipped in v6; the habit-as-task decoupling shipped in v6.1; the intentions backlog + Todoist unschedule-on-discard shipped in v6.2** (see [history/plan_v5.md](./history/plan_v5.md), [history/plan_v6.md](./history/plan_v6.md), and [history/plan_v6.x.md](./history/plan_v6.x.md)).

---

## 9. Design Tensions Worth Knowing

- **Single source of truth split.** Todoist owns tasks; Orchestrate owns intentions and the link between intentions and tasks. The `titleSnapshot` field is the bridge — it lets us survive Todoist deletions/completions without losing planning history.
- **No backend, by choice.** Everything is client-side. This shapes everything: the auth model, the encryption-not-security-only-obfuscation reality, the localStorage migration chain, the lack of cross-device sync.
- **Opinionated defaults over configurability.** Default sessions, default playlist set, fixed 4-step wizard. Settings exist (session slots, playlist URLs, calendar IDs, notification preference) but the *shape* of the day is built-in.
- **Personal tool, not a product.** The requirements document is explicit: "This version is specific to the author's needs."
