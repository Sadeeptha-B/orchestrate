# Orchestrate — Data Model Reference

> For a high-level overview, start at [synthesis.md](./synthesis.md). This document covers semantics, invariants, lifecycle rules, relationships, and schema compatibility. **For exact type shapes, read the source**: [`src/types/index.ts`](../src/types/index.ts). Todoist API mirror types live in [`src/hooks/useTodoist.ts`](../src/hooks/useTodoist.ts).

---

## 1. Entity Semantics & Invariants

### Intention

A high-level goal for today. Top-level organizational unit.

- Owns zero or more `LinkedTask` entries (via `intentionId` back-reference; `linkedTaskIds` maintains display order).
- Toggling completion cascades to all linked tasks.
- `brokenDown` tracks whether the user finished mapping tasks in Step 1.

### LinkedTask

A Todoist task surfaced inside the plan, always bound to an intention via `intentionId`.

**Task types:**
- **main** — Primary work thread. Exclusive to one session (assigning removes from any previous session).
- **background** — Small nudge task. Can be assigned to multiple sessions. Cap: `taskCapDefaults.manualBackground` (default 30 min).
- **unclassified** — Default after linking. Must be categorized before advancing past Step 2.

**Engagement model (v6.4 — segment list):** engagement is a list of `EngagementSegment` (`{ startedAt, endedAt? }`) on `LinkedTask.segments` / `TodaysHabitInstance.segments`. Each Start→Stop is **one individual segment** — not a cumulative accumulator. Named "segment" (not "session") to avoid clashing with the first-class work `Session`/`SessionSlot`. Duration is always *derived* (`endedAt − startedAt`, or `now − startedAt` while open); no stored minute/second totals.

Lifecycle:
1. New / restored task: `status = 'pending'`, no segments.
2. Start (`START_TASK_ENGAGEMENT`): `status = 'engaged'`, push a new open segment `{ startedAt: now }` (no-op if one is already open).
3. Stop (`STOP_TASK_ENGAGEMENT`): close the open segment (`endedAt = now`), return `status` to `pending` so the ▶/■ button flips back. A subsequent Start pushes a **fresh** segment — the timer counts from 0:00 again, and each Start/Stop is a distinct log entry.
4. Complete (`TOGGLE_TASK_COMPLETE`): close any open segment, `status = 'completed'`.
5. Moved to backlog while engaged: the `segments` array is copied into `BacklogEntry.unfinishedTaskRecords`.

**Display — [`<EngagementTimer>`](../src/components/dashboard/EngagementTimer.tsx) + [`lib/engagement.ts`](../src/lib/engagement.ts):** the timer renders one segment as `M:SS` (or `H:MM:SS` past an hour), ticking once per second while the segment is open (no `endedAt`). Card rows (`HabitInstanceCard` / `SessionTimeline`) show only the **open** segment while engaged — counting from 0:00, gone when stopped. The engagement-log view renders **one row per segment** (`segmentSeconds`). Glance surfaces that want a rounded total (timeline-lane badge, backlog memo) derive it via `totalEngagedSeconds(segments)`.

**`completed` vs `status`:** `completed` mirrors `status === 'completed'`. Both are written together by the reducer. `completed` is retained for backward compat — many callers (capacity calc, completion counter, session visuals) still read it.

**Title fallback chain:** `taskMap.get(todoistId)?.content` -> `titleSnapshot` -> raw `todoistId`.

### TodaysHabitInstance

A habit's manifestation for today (both kinds). Lives on `DayPlan.todaysHabits`, independent of session assignment. Resolve an instance's kind via its parent habit (`habitKindOf(life, instance)`), **not** by `targetTime` presence — v6.7 habits can be untimed too.

- **'habit'-kind** instances: carry a `todoistTaskId`; timed ones (with `targetTime`) sit on the timeline, untimed ones cluster as "Anytime today". Terminal once/day (Complete/Skip). Reschedulable. Rendered in `HabitInstanceCard`.
- **'micro-gap'-kind** instances (v6.7): **no `todoistTaskId`**, always untimed, **repeatable** — Start/Stop logs a rep and the instance stays `planned`/`engaged` all day (never `completed`/`skipped`). Rendered in `MicroGapCard`. Segments still feed the Engagement Log.

**Status semantics:**
- **planned** — surfaced for today, not yet acted on (micro-gaps idle here between reps).
- **engaged** — user pressed Start on the card.
- **completed** — done (**'habit' kind only**). Caller also fires `actions.completeTask(todoistTaskId)` to close Todoist's current occurrence.
- **skipped** — terminal, user explicitly skipped today ('habit' kind only).
- **missed** (v6.8) — *not* a persisted status: a **derived presentation** of a `planned`, timed, `windowBehavior: 'strict'` instance whose window (`targetTime + durationMinutes`) has elapsed for the current `now`. Surfaces grey it out and stop prompting it as a live to-do, but it stays fully actionable (Complete/Skip/Start/Reschedule). Computed by `isHabitInstanceMissed(habit, instance, now)` (`lib/habits.ts`); `lenient` instances never read as missed.

(v6.4 removed the old `'unfinished'` status — the v6.3 clone-on-reschedule predecessor. Reschedules are in-place now and segments survive them, so no clone is produced. Current 7.1-only builds do not read older persisted variants.)

**Reschedule — always in-place (v6.4):** `RESCHEDULE_HABIT_INSTANCE` updates `targetTime` on the existing instance, stamps `rescheduledAt`, and appends a `RescheduleEventEntry` (`{ at, fromTime?, toTime? }`) to `rescheduleHistory`. The instance keeps its `id`, `status`, and `segments` — if it was engaged, the open segment keeps running at the new target time. **Every reschedule is recorded**, whether or not the instance was engaged. The recurring Todoist task is **never** touched. The `rescheduledAt` stamp doubles as a "user-chose-this-time" sentinel that `REFRESH_TODAYS_HABITS` honors.

**In-day surface — [`lib/engagementLog.ts`](../src/lib/engagementLog.ts).** A read-only helper flattens today's activity into a sortable `EngagementLogRow[]` union, ordered by time:
- **engagement rows** — **one per `EngagementSegment`** across all habit instances + tasks (individual, not cumulative — a Start/Stop/Start produces two rows). Each carries the `segment`; the row renders the ticking `<EngagementTimer>` (live while the segment is open).
- **reschedule rows** — one per `rescheduleHistory` entry, rendered as "⤴ {title} · {from} → {to} · Rescheduled" at the clock time it happened.

The dashboard renders this in a dedicated **`EngagementLogCard`** (a self-headed sibling of `HabitInstanceCard` on the right rail — the two are independent surfaces, each hidden when empty; both exported from `HabitInstanceCard.tsx`). It is the in-day record of "what actually happened today", and the read interface a future durable `life.engagementHistory` would feed (see [roadmap/engagement_record_strategy.md](roadmap/engagement_record_strategy.md)) — a flat list of segments harvested across days; the helper signature stays stable so the upgrade swaps the input source, not the consumer. The `HabitInstanceCard` ("Today's Habits") shows no "rescheduled" tag — reschedules live in the log. Closed (non-live) rows are individually deletable from the card via `DELETE_TASK_ENGAGEMENT_SEGMENT` / `DELETE_HABIT_ENGAGEMENT_SEGMENT` / `DELETE_HABIT_RESCHEDULE_ENTRY`.

**Refresh merge (`REFRESH_TODAYS_HABITS`):** Called on Step 1 mount and whenever habits / Todoist cache change. For each habit:
- If no existing instance → append the computed one.
- If existing is `planned` and `rescheduledAt` is unset → update `targetTime`, `durationMinutes`, and `titleSnapshot` from the helper (this is how habit-form edits propagate to today's instance).
- If existing is `planned` and `rescheduledAt` is set → only update `durationMinutes` and `titleSnapshot`; preserve the user's chosen time.
- If existing is in any other status → leave alone.

`REFRESH_TODAYS_HABITS` only ever appends/refreshes — it never *removes*. So when a habit's Todoist task is completed (or moved off today) directly in the Todoist app, the compute path simply stops emitting it while the already-surfaced `planned` instance would linger. `useTodaysHabitsSync` closes that gap with a separate `PRUNE_STALE_HABIT_INSTANCES` pass (driven by `findStaleTodaysHabitInstances`, gated on `tasksHydrated`): it drops `planned` 'habit'-kind instances whose backing task is now `checked` or no longer due today. Engaged/completed/skipped instances and unchecked-still-due-today tasks (e.g. a strict habit past its window) are left untouched — as is (v6.8) a timed **lenient** instance deliberately surfaced today against a *tomorrow*-dated task; `findStaleTodaysHabitInstances` shares the `isLenientPastWindow` predicate with `computeTodaysHabitInstances` so the surface + prune paths agree instead of flickering the row.

**Capacity exclusion:** Habits do not consume session capacity. The timeline visualization makes overlap obvious without folding habit duration into capacity arithmetic.

### DayPlan

The central document for a single day. Stored in localStorage and auto-reset daily.

**Key invariants:**
- `linkedTasks` is the flat, denormalized list of intention-bound tasks. Each task's `intentionId` back-references its parent.
- `todaysHabits` is a parallel list for habit instances (both kinds, v6.6). Independent of `linkedTasks` / `taskSessions`.
- `taskSessions` is a map from session IDs to ordered arrays of Todoist task IDs. **Habits never appear here.**
- `sessionSlots` (v7.1) is the **authoritative per-day session list** — every downstream surface (dashboard timeline, carousel, check-ins, capacity, focus nudge) reads it, not `AppSettings.sessionSlots`. Seeded on a new day from the most-recent persisted plan's slots (continuity) → else the legacy global `settings.sessionSlots` → else `defaultSessionSlots`, always with fresh ids. Edited in the wizard's **Sessions** step. `taskSessions` keys reference these ids.
- `intentions[i].linkedTaskIds` is the ordered list of task IDs belonging to that intention. Kept in sync with `linkedTasks` by the reducer.
- `seededFocusIds` (v6.7, optional): recurring-focus ids already added as intentions today, so the Step 1 banner chip doesn't re-offer them. Preserved across same-day reloads; reset on rollover.

(v6.6 removed `habitLog` — the Light Pool log. Habits of both kinds now flow through `todaysHabits`.)

### SessionSlot

A configurable time block (`{ id, name, startTime, endTime }`). Built-in defaults: early-morning (06:00-08:00), morning (09:00-13:00), afternoon (14:30-18:30), night (20:30-23:00) in `src/data/sessions.ts`. **v7.1: sessions are per-day** — the live list lives on `DayPlan.sessionSlots`, edited via a drag-calendar in the wizard's Sessions step. The midnight end-of-day boundary is serialized as `"24:00"` (→ 1440 via `timeToMinutes`), never `"00:00"`.

### SessionTemplate

v7.1: a named, reusable set of session slots (`{ id, name, slots: SessionSlot[], createdAt }`) stored on `LifeContext.sessionTemplates`. Managed in the Life section (`/session-templates`) and quick-applied during the wizard's Sessions step. Applying a template (`APPLY_SESSION_TEMPLATE`) replaces `DayPlan.sessionSlots` with **fresh-id copies** of the template's slots and clears all task assignments (every prior session id vanishes).

### AppSettings

Persistent user preferences. Survives daily plan resets.

**`sessionSlots`** (v7.1): no longer the live source for the day's sessions — retained only as a legacy seed/reset fallback and the source for the one-time "My sessions" template migration. The live per-day list is `DayPlan.sessionSlots`.

**Todoist token (v7.2):** held **server-side in Workers KV**, not in the browser and not in any backup. The app sends the shared `X-App-Secret` to the same-origin Worker proxy (`/api/todoist/*`), which injects the `Authorization` header. (The legacy `todoistToken`/`todoistTokenIV`/`todoistTokenKey` settings fields were removed — the historical browser-encrypted token is gone.)

**`habitsTodoistProjectId`:** Lazily created on first 'habit'-kind save. Resolved by `ensureHabitsProject(...)`. Included in a Full Backup (it's an ID, not a credential).

**`taskCapDefaults`** keys: `{ habit, microGap, manualBackground }`. Absent keys are filled from defaults by `fillTaskCaps` on load.

**Google Calendar (v7.2):** `googleCalendarIds` is the **selected subset** of calendars to overlay in the embed, sourced from the Calendar API list (each `GoogleCalendarEntry` carries `id`/`name`/`color`/`primary`). `googleCalendarConnected: boolean` records that the user authorized Google Calendar via the **server-mediated OAuth flow**; on load the `GoogleCalendarProvider` uses it to re-check the server connection (`/api/auth/google/status`). The **refresh token lives server-side in KV**; the browser only ever holds a short-lived access token **in memory** (minted by the Worker on demand). `calendarViewMode` is unchanged (embed week/month/agenda). Full OAuth model: [reference/cloudflare_workers.md](./reference/cloudflare_workers.md).

### Season

A medium-horizon focus period (4-12 weeks).

**Invariants:**
- Exactly one season can be `active` at a time. Activating one auto-deactivates the previous.
- Deleting a season clears its id from any habit's `seasonIds`.

**`recurringFocuses`** (v6.7, optional `RecurringFocus[]`): cadenced work-threads (see below). Additive — `supportingGoals` (plain `string[]`, display-only chips) is unchanged.

### RecurringFocus

v6.7: a season-scoped recurring **work-thread** (e.g. "Learn redis") — recurring work that decomposes into tasks, not an atomic habit. `{ id, title, recurrence: HabitRecurrence, active }`. On days its cadence matches (`recurrenceMatchesDate`), the Step 1 `SeasonFocusBanner` shows it as a clickable **"+ Add" chip**; clicking dispatches `ADD_INTENTION` (seeding a normal intention the user breaks down via Steps 1–3) + `MARK_FOCUS_SEEDED` (records the id in `plan.seededFocusIds` so the chip drops out for the day). **Manual only** — no auto-seed. Cross-day progress tracking is a planned follow-up.

### Habit

A first-class recurring entity. **v6.7** discriminates `kind` by *lifecycle*:

- **habit** — the normal recurring thing. Synced to Todoist as a recurring task; **terminal once/day** (Complete advances the recurrence). `targetTime` is **optional**: timed → timeline lane; untimed → "anytime today". Reschedulable. Both timed and untimed habits render in `HabitInstanceCard`.
- **micro-gap** — a light, **repeatable** filler. **Never synced to Todoist**, always untimed, never terminal — Start/Stop logs a rep and it stays available all day. Rendered in its own `MicroGapCard`; segments still feed the Engagement Log. (v6.6 briefly unified these as "light-coherent" Todoist-backed terminal habits; v6.7 re-separated them — Todoist's complete-advances-recurrence model fights repeatability, and the value Todoist gave was tracking, which engagement segments already provide. Native streaks are a planned follow-up.)

(Historical: pre-v6.7 the kinds were `'stabilizer'`/`'light-coherent'`; that remap lived in the now-removed migration chain — see git history.)

**`isAnchor`** is orthogonal to `kind` — a pure importance tag marking a habit as load-bearing (sleep, meditation, gym, shutdown, weekly review). It does **not** alter behavior or block deletion at the reducer level; the only current effect is UI affordances — anchors sort to the front of habit lists and deleting an *active* anchor prompts a confirm dialog (cancellable, but deletion is permitted once confirmed). The protection axis is forward-looking scaffolding for recovery-mode / Minimum Viable Day, where anchors are the non-negotiables preserved when the plan is narrowed.

**Recurrence matching** (`src/lib/habits.ts -> habitMatchesDate`): `daily` = every day, `weekdays` = Mon-Fri, `weekly`/`custom` = only listed `daysOfWeek` (weekly without `daysOfWeek` does not match).

**Todoist sync** (`src/lib/habitsTodoistSync.ts`, **'habit' kind only** — v6.7): saving a habit calls `ensureHabitsProject(...)` -> `resolveHabitProjectId(...)` -> `syncHabitToTodoist(...)`. Creates or updates the recurring task with `due_string` from `buildDueString(habit)` (timed → "every day at HH:mm", untimed → "every day") and `duration` from `targetDurationMinutes`. Project changes trigger a Sync API `item_move`. Sync failures are non-blocking. `syncHabitToTodoist`, `findNeedsSyncHabits`, and `findOverdueHabits` all early-skip `micro-gap` habits.

**Today's instances:** two compute paths feed the same `REFRESH_TODAYS_HABITS`:
- `computeTodaysHabitInstances` (`habitsTodoistSync.ts`) — **'habit' kind only**: active habits with `todoistTaskId` whose Todoist task is due today + unchecked; honors season scope; timed habits get a `targetTime`. **v6.8: a due-today habit is always emitted regardless of `windowBehavior`** — `strict` no longer drops a past-window row. Instead the instance stays a `planned`, fully-actionable row and every surface *presents* it as "missed" (greyed, no longer prompted as a live to-do) via the derived `isHabitInstanceMissed(habit, instance, now)` helper (`lib/habits.ts`); `lenient` habits never read as missed. "missed" is a pure display derivation from `now` — no persisted status, no migration. v6.8 "surface anyway" rescue (unchanged): a timed, **lenient** habit created/edited after its time has passed is anchored by Todoist to *tomorrow* (today's slot is gone) — `computeTodaysHabitInstances` still surfaces it today (predicate `isLenientPastWindow`), unless it already has a `completed`/`skipped` instance today (so an in-app check-off, which also rolls the task to tomorrow, isn't resurrected). `findStaleTodaysHabitInstances` mirrors the predicate so the surfaced row isn't pruned each tick.
- `computeTodaysMicroGapInstances` (`lib/habits.ts`, v6.7) — **'micro-gap' kind only**: pure, no Todoist; active micro-gaps whose recurrence + season match today, emitted untimed with `durationMinutes` from `targetDurationMinutes ?? taskCaps.microGap`.
Both re-emit every matching habit on each call (including ones already in `plan.todaysHabits`); idempotency lives in `REFRESH_TODAYS_HABITS`, whose value-stable merge dedupes by `habitId` and refreshes the existing planned instance's time/duration/title (so habit-form edits propagate same-day) without allocating when nothing changed. Step 1 mount and the dashboard (`useTodaysHabitsSync`) dispatch both.

**Overdue reconcile** (v6.4 helpers, v6.5 driver, **'habit' kind only** — `findOverdueHabits` + `reconcileOverdueHabits`): Todoist's recurrence engine only advances on completion, so a habit missed yesterday sits at yesterday's due date and never surfaces. Overdue habits whose recurrence + season still match today get their Todoist `due_datetime` (or `due_date`) bumped forward to today; `due_string` is preserved so the rule continues to drive future occurrences. The helper returns an optimistic patch map so `computeTodaysHabitInstances` runs against the bumped state in the same tick. The central `ReconciliationProvider` runs it (preceded by a needs-sync repair via `findNeedsSyncHabits`) on first hydration and on window focus; see [synthesis.md](./synthesis.md) "Habit-Task Sync → Central reconciliation". Skip is handled in the UI by also calling Todoist `completeTask` so the recurrence engine advances cleanly — see `SKIP_HABIT_INSTANCE`. (Micro-gaps never participate in reconcile — no Todoist.)

### BacklogEntry

A parked intention stored on `LifeContext.backlog`.

**Two creation paths** (both via `lib/backlog.ts -> buildBacklogEntry`):
- **Manual** (`reason: 'manual'`): user moves an intention to the backlog during planning.
- **Rollover** (`reason: 'rollover'`): `loadInitialState` harvests unfinished intentions on date-change.

**Completed-task partitioning:** `buildBacklogEntry` splits `linkedTaskIds` by completion. Completed IDs are stripped; their `titleSnapshot` goes to `completedTaskTitles` (read-only context). This avoids rebuilding stale completed tasks that Step 2 can't render (absent from the Todoist API).

**Engagement carryover:** When an intention with engaged tasks moves to backlog, each task's `segments` are copied into `unfinishedTaskRecords` (`Record<todoistId, EngagementSegment[]>`). On restore, rebuilt LinkedTasks get `rescheduledFromTodoistId` + `rescheduledAt` stamps; the segments stay on the BacklogEntry as annotation.

### RestCue

Non-task recovery prompts. 8 built-in cues in `src/data/restCues.ts`. User customizations stored in `LifeContext.restCues`. When `undefined`, falls back to built-ins. First add/update/delete auto-seeds from defaults.

Not a Habit — no completion semantics, no logging, no streak. Pure prompt data.

### LifeContext

Persistent state slice holding multi-day entities: `seasons`, `habits`, `activeSeasonId`, `restCues`, `backlog`, `sessionTemplates` (v7.1). Persisted to `orchestrate-life-context` localStorage key.

---

## 2. Entity Relationships

```
Intention  1 --> N  LinkedTask       (via intentionId / linkedTaskIds)
LinkedTask N --> M  SessionSlot      (via taskSessions / assignedSessions; main=1:1, bg=1:N)
LinkedTask       -->  TodoistTask    (via todoistId; TodoistTask is ephemeral API data)
Habit      1 --> 1  TodaysHabitInstance per day  (via habitId; reschedule is in-place, no clone)
TodaysHabitInstance  -->  TodoistTask  (via todoistTaskId; stable recurring task, 'habit' kind only)
Habit      N --> M  Season           (via seasonIds; [] = always-on)
BacklogEntry     -->  Intention      (snapshot, pending-only linkedTaskIds)
DayPlan          1 --> N  SessionSlot (via DayPlan.sessionSlots; authoritative per-day, v7.1)
SessionTemplate  1 --> N  SessionSlot (LifeContext.sessionTemplates; quick-applied in the wizard)
```

`DayPlan.taskSessions` is the source of truth for session assignments. `LinkedTask.assignedSessions` is a derived convenience kept in sync by the reducer.

---

## 3. Reducer Action Catalog

All state mutations flow through the `DayPlanContext` reducer (`src/context/DayPlanContext.tsx`). The `Action` type is a discriminated union of ~57 variants.

### 3.1 Intention Actions

| Action | Payload | Effect |
|---|---|---|
| `ADD_INTENTION` | `title` | Creates a new Intention, appends to list |
| `REMOVE_INTENTION` | `intentionId` | Removes intention + its LinkedTasks + session assignments. Call sites route through `useIntentionRemoval()` to unschedule Todoist tasks first. |
| `UPDATE_INTENTION` | `intention` | Replaces in-place |
| `REORDER_INTENTIONS` | `intentionIds` | Reorders to match the provided ID sequence |
| `TOGGLE_INTENTION_COMPLETE` | `intentionId` | Toggles completed. Cascades to all linked tasks. |
| `MARK_BROKEN_DOWN` | `intentionId, brokenDown` | Sets the `brokenDown` flag (Step 1 mapping progress) |

### 3.2 Task Actions

| Action | Payload | Effect |
|---|---|---|
| `LINK_TASK` | `intentionId, todoistId` | Creates a new LinkedTask (or moves existing to a different intention). Updates `linkedTasks` and `intentions[].linkedTaskIds`. |
| `REORDER_INTENTION_TASKS` | `intentionId, todoistIds` | Reorders one intention's `linkedTaskIds` to the given sequence (ids not currently linked are ignored; any omitted linked ids are appended in prior order). Step 1 surfaces this list in `linkedTaskIds` order. |
| `UNLINK_TASK` | `todoistId` | Removes the LinkedTask, cleans up `linkedTaskIds` and `taskSessions` |
| `CATEGORIZE_TASK` | `todoistId, taskType` | Sets `type` to main / background / unclassified |
| `SET_TASK_ESTIMATE` | `todoistId, minutes` | Sets `estimatedMinutes` |
| `ASSIGN_TASK` | `todoistId, sessionId` | Main: exclusive (removes from other sessions first). Background: additive. Updates both `taskSessions` and `assignedSessions`. |
| `UNASSIGN_TASK` | `todoistId, sessionId` | Removes task from the specified session |
| `TOGGLE_TASK_COMPLETE` | `todoistId, titleSnapshot?` | Toggles `completed` + `status`. Optionally stores title snapshot. Closes any open engagement. |
| `SYNC_TASK_SNAPSHOTS` | `snapshots` | Batch-updates `titleSnapshot` when Todoist titles change |
| `REORDER_SESSION_TASKS` | `sessionId, taskIds` | Replaces task order within a session |
| `START_TASK_ENGAGEMENT` | `todoistId, now` | Sets `status = 'engaged'`. Pushes a new open segment `{ startedAt: now }` to `segments` (no-op if one is open). |
| `STOP_TASK_ENGAGEMENT` | `todoistId, now` | Closes the open segment (`endedAt = now`), returns `status` to `'pending'`. A subsequent Start pushes a fresh segment (timer from 0:00; distinct log row). |
| `DELETE_TASK_ENGAGEMENT_SEGMENT` | `todoistId, segmentStartedAt` | Removes the matching segment from a LinkedTask (deletes one Engagement Log row). If it was the open segment and none remain open, returns `status` to `'pending'`. |

### 3.3 Habit Instance Actions

| Action | Payload | Effect |
|---|---|---|
| `REFRESH_TODAYS_HABITS` | `instances` | **Value-stable merge by `habitId`** (not a blind append): new habits are appended; an existing `planned` instance has its `targetTime`/`durationMinutes`/`titleSnapshot` refreshed from the compute helper (preserving a user-chosen time when `rescheduledAt` is set); engaged/completed/skipped instances are left alone. Returns the same state object when nothing changed, so re-firing is a true no-op (no render loop). See §1 *Refresh merge*. |
| `START_HABIT_INSTANCE` | `instanceId, now` | Sets `status = 'engaged'`. Pushes a new open segment `{ startedAt: now }` (no-op if one is open). |
| `STOP_HABIT_INSTANCE` | `instanceId, now` | Closes the open segment, returns `status` to `'planned'`. A subsequent Start pushes a fresh segment (timer from 0:00; distinct log row). |
| `COMPLETE_HABIT_INSTANCE` | `instanceId, now` | Sets `status = 'completed'`, `completedAt = now`, closes any open segment. Caller completes Todoist task. |
| `SKIP_HABIT_INSTANCE` | `instanceId, now` | Sets `status = 'skipped'`. Terminal. Closes any open segment so an in-flight engagement (Start then ✕ Skip) is recorded. Caller (v6.4) posts a `"Skipped via Orchestrate on <date>"` comment on the Todoist task, then fires `completeTask` so the recurrence engine advances. |
| `RESCHEDULE_HABIT_INSTANCE` | `instanceId, newTargetTime?, now` | **v6.4: always in-place.** Updates `targetTime`, stamps `rescheduledAt`, appends a `RescheduleEventEntry` to `rescheduleHistory`. Keeps `id`/`status`/`segments` (engaged instances keep their open segment running). Logged regardless of engagement. No clone, no Todoist write. |
| `DELETE_HABIT_ENGAGEMENT_SEGMENT` | `instanceId, segmentStartedAt` | Removes the matching segment from a `TodaysHabitInstance` (deletes one Engagement Log row). If it was the open segment and none remain open, returns `status` to `'planned'`. |
| `DELETE_HABIT_RESCHEDULE_ENTRY` | `instanceId, rescheduleAt` | Removes the matching `RescheduleEventEntry` from `rescheduleHistory` (deletes one reschedule row from the Engagement Log). Does not restore `targetTime`. |
| `PRUNE_STALE_HABIT_INSTANCES` | `instanceIds` | Drops the listed instances from `todaysHabits`. Caller (`useTodaysHabitsSync`, via `findStaleTodaysHabitInstances`) supplies `planned` 'habit'-kind instances whose backing Todoist task was completed / moved off today out-of-band (e.g. checked off in the Todoist app). Gated on `tasksHydrated`. Value-stable. |

### 3.4 Backlog Actions

| Action | Payload | Effect |
|---|---|---|
| `MOVE_INTENTION_TO_BACKLOG` | `intentionId, reason?` | Scrubs intention + LinkedTasks from plan. Builds BacklogEntry (captures each engaged task's `segments`). Appends to `life.backlog`. Caller handles Todoist unschedule. |
| `RESTORE_FROM_BACKLOG` | `backlogId, taskCache, now?` | Pulls entry off backlog. Appends intention to plan. Rebuilds fresh LinkedTasks for pending IDs (unclassified, no estimate). Stamps reschedule fields on previously-engaged tasks. |
| `DELETE_BACKLOG_ENTRY` | `backlogId` | Removes entry. Caller handles Todoist unschedule. |

### 3.5 Wizard & Global Actions

| Action | Payload | Effect |
|---|---|---|
| `SET_WIZARD_STEP` | `step` | Sets `plan.wizardStep` |
| `COMPLETE_SETUP` | *(none)* | Sets `plan.setupComplete = true` |
| `ADD_CHECKIN` | `checkIn` | Appends to `plan.checkIns` |
| `MARK_FOCUS_SEEDED` | `focusId` | v6.7: records a recurring-focus id in `plan.seededFocusIds` so the Step 1 banner chip doesn't re-offer it today. Idempotent. |
| `RESET_DAY` | *(none)* | Replaces plan with `freshPlan(seedSessionSlots(...))` (sessions re-seeded from settings/defaults), clears `editingStep`. Other slices (settings, history, life) untouched. Surfaced from Settings → Data → Reset Today's Plan. |
| `RESET_ALL` | *(none)* | Factory reset: replaces every reducer-managed slice with defaults — `plan = freshPlan(defaultSessionSlots)`, `history = []`, `life = emptyLifeContext()`, `settings = defaultSettings()`. Caller is responsible for clearing aux localStorage keys outside the reducer (`orchestrate-todoist-cache`). **Does not** clear the server-side tokens in KV (Todoist/Google) or the `orchestrate-cf-secret` — disconnect those from Settings → Integrations. Surfaced from Settings → Data → Reset Everything. |
| `UPDATE_SETTINGS` | `settings` | Shallow-merges into settings |
| `SET_EDITING_STEP` | `step` | Tracks which wizard step the user is re-editing from the dashboard |

### 3.5b Per-Day Session Actions (v7.1)

Operate on `DayPlan.sessionSlots`. Granular and **id-stable** so `taskSessions` / `assignedSessions` survive rename/resize.

| Action | Payload | Effect |
|---|---|---|
| `ADD_DAY_SESSION` | `session` (no id) | Appends a slot; reducer stamps a fresh `id`. |
| `UPDATE_DAY_SESSION` | `session` | Replaces by id (rename/resize/move). No assignment impact — id is preserved. |
| `REMOVE_DAY_SESSION` | `sessionId` | Removes the slot **and** prunes `taskSessions[sessionId]` plus every `linkedTask.assignedSessions` entry for it. |
| `APPLY_SESSION_TEMPLATE` | `templateId` | Replaces `sessionSlots` with fresh-id copies of the template's slots; clears `taskSessions` and all `assignedSessions` (old ids vanish). UI confirms when assignments exist. |

### 3.6 History Actions

| Action | Payload | Effect |
|---|---|---|
| `SAVE_DAY` | `label` | Creates a SavedDayPlan snapshot. Replaces any existing entry for same date. Only writer to `history` (rollover uses backlog instead). |
| `RESTORE_DAY` | `savedAt` | Finds a current-schema saved plan, strips persistence markers, and sets its date to today |
| `DELETE_SAVED_DAY` | `savedAt` | Removes entry from history |
| `IMPORT_SESSIONS` | `sessions` | Merges imported sessions, deduplicating by `savedAt`. Caller (`DataManagement`) refuses non-`7.1` saved plans before dispatching. |
| `IMPORT_BACKUP` | `settings?, life?, history?` | Merge-by-id import (habits appended as-is — no migration). Caller (`DataManagement`) refuses backups whose `_schemaVersion` isn't `7.1` before dispatching. |

### 3.7 Life Scaffolding Actions

| Action | Payload | Effect |
|---|---|---|
| `ADD_SEASON` | `season` | Appends; if `active: true`, deactivates others |
| `UPDATE_SEASON` | `season` | Replaces in-place. Enforces single-active invariant. |
| `DELETE_SEASON` | `seasonId` | Removes; clears `activeSeasonId` if active; clears id from habit `seasonIds` |
| `ACTIVATE_SEASON` | `seasonId | null` | Sets exactly one active (or none) |
| `ADD_HABIT` | `habit` | Appends (caller generates id + createdAt so it can sync to Todoist with the same id) |
| `UPDATE_HABIT` | `habit` | Replaces in-place |
| `DELETE_HABIT` | `habitId` | Removes the habit; also drops matching `TodaysHabitInstance` rows. (No anchor guard — `isAnchor` is a UI-only confirm prompt now.) The reducer is Todoist-agnostic; the **caller** (`useHabitMutations`, shared by HabitsLibrary + LifeView) also deletes the backing recurring Todoist task, best-effort. |
| `TOGGLE_HABIT_ACTIVE` | `habitId` | Flips `active` flag |

(v6.6 removed the §3.8 Light Pool actions — `LOG_HABIT_START` / `LOG_HABIT_COMPLETE` / `DELETE_HABIT_LOG_ENTRY` — along with `HabitLogEntry`. Light-coherent habits now use the habit-instance lifecycle actions in §3.3.)

### 3.9 True Rest Cue Actions

| Action | Payload | Effect |
|---|---|---|
| `ADD_REST_CUE` | `cue` | Appends new cue. Auto-seeds from defaults if `restCues` is undefined. |
| `UPDATE_REST_CUE` | `cue` | Replaces in-place. Auto-seeds if undefined. |
| `DELETE_REST_CUE` | `cueId` | Removes cue. Auto-seeds if undefined. |
| `REPLACE_REST_CUES` | `cues | undefined` | Bulk-replaces. Pass `undefined` to reset to built-in defaults. |

### 3.10 Session Template Actions (v7.1)

Operate on `LifeContext.sessionTemplates` (mirrors the Habit/RestCue CRUD pattern; persisted to `orchestrate-life-context`).

| Action | Payload | Effect |
|---|---|---|
| `ADD_SESSION_TEMPLATE` | `template` (no id/createdAt) | Appends; reducer stamps `id` + `createdAt`. |
| `UPDATE_SESSION_TEMPLATE` | `template` | Replaces by id. |
| `DELETE_SESSION_TEMPLATE` | `templateId` | Removes by id. |

---

## 4. Schema Version & Compatibility

Current schema: **7.1**. Every persisted slice (plan / settings / life) and every saved-session plan
is stamped with `_schemaVersion` on write. **There is no in-app migration** — the historical v1→v7.1
chain (and the `_wizardSteps` step-remap) was removed; it lives in git history.

**Hard guard (7.1 only).** A single helper, `isCurrentSchema(raw)` (`raw._schemaVersion === SCHEMA_VERSION`),
gates every read:
- **Load.** `loadPlan` / `loadSettings` / `loadLifeContext` reject anything not stamped `7.1` and fall back
  to a fresh/default value (the app starts clean rather than crashing). `loadHistory` keeps only saved
  plans stamped `7.1`. Plan markers are stripped via `stripPlanMarkers` before use.
- **Import.** `DataManagement` refuses a Full Backup whose top-level `_schemaVersion !== 7.1`, rejects malformed nested slices, and rejects saved sessions whose plans aren't `7.1` (`validateSessions`), surfacing an error instead of dispatching.
- **Restore.** `RESTORE_DAY` trusts history (already guarded) and just strips markers + re-dates to today.

This is safe for in-place data because the live app already persists every slice in 7.1 shape with the
marker. Because there's no migration, the author re-exports a fresh session + Full Backup once on this
change; those become the canonical 7.1 artifacts going forward.

**Adding a future migration.** Bump `SCHEMA_VERSION`, then either (a) re-introduce a `migrate*()` step
branching on the stamped version, or (b) keep the hard guard and re-export. The `_schemaVersion` stamp is
the anchor for either path.

---

## 5. localStorage Schema

| Key | Content | Notes |
|---|---|---|
| `orchestrate-day-plan` | Serialized `DayPlan` + `_schemaVersion` marker | Marker read by the load-time schema guard only |
| `orchestrate-settings` | Serialized `AppSettings` + `_schemaVersion` | No token here — the Todoist token is server-side in KV |
| `orchestrate-history` | `SavedDayPlan[]` | Each entry's `plan` carries its own `_schemaVersion`; non-`7.1` entries are dropped on load |
| `orchestrate-life-context` | Serialized `LifeContext` + `_schemaVersion` | Seasons, habits, backlog, rest cues, session templates (v7.1) |
| `orchestrate-todoist-cache` | `{ tasks, projects, sections, fetchedAt }` | Stale-while-revalidate (5min hydration / 30s focus) |
| `orchestrate-cf-secret` | Shared secret guarding the Worker endpoints | Installation-specific; never backed up |
| `orchestrate-theme` | `"light"` or `"dark"` | Written by `useTheme` |
| `orchestrate-active-playlist` | Playlist ID string | Written by `MusicProvider` |
| `orchestrate-custom-playlist-urls` | `Record<playlistId, spotifyUrl>` | Written by `MusicProvider` |

---

## 5b. Backup Scope & Integrations

A **Full Backup** is the JSON `{ settings, life, history, _backupVersion, _schemaVersion }` from
`DataManagement.exportFullBackup`. **Sessions export** is just `SavedDayPlan[]`. Both are **data +
integration references/preferences — never credentials.**

**Todoist**
- **Not in the backup:** the personal API token (server-side, Workers KV `todoist:token`).
- **In the backup:** `settings.habitsTodoistProjectId`; and every embedded **task reference** —
  `LinkedTask.todoistId` + `titleSnapshot` inside `history[].plan`, and `todoistTaskId` on `life.habits[]`
  and habit instances. IDs/labels, not auth.
- **After restore (new device/deployment):** re-enter the **app secret** and **reconnect Todoist** (paste
  token) in Settings → Integrations. Imported task IDs re-link automatically for the same Todoist account.

**Google Calendar**
- **Not in the backup:** the OAuth refresh token (KV `google:refresh_token`) or access tokens (KV cache /
  in-memory).
- **In the backup:** `settings.googleCalendarConnected` (flag), `settings.googleCalendarIds`
  (`GoogleCalendarEntry[]`), `settings.calendarViewMode`.
- **Caveat:** imported `googleCalendarConnected: true` is provisional — `GoogleCalendarProvider` re-checks
  `/api/auth/google/status` on load, so a device whose KV has no token self-corrects to disconnected.
  Re-authorize Google if it shows disconnected.

**Shared secret** (`orchestrate-cf-secret`) is **not** in any backup — re-enter per device.

**Not in the Full Backup by design:** today's `plan` (only saved sessions in `history`), the Todoist cache,
and theme/music/pomodoro prefs.

---

## 6. Todoist Data Lifecycle

### Fetch cycle
1. On window focus / initial mount, `TodoistProvider` checks cache age.
2. If cache < 5 min: use cached data, skip fetch.
3. Otherwise: paginated fetch of tasks, projects, sections through the same-origin Worker proxy (`/api/todoist/*`, which injects the server-held token) -> save to cache.

### Deduplication
- Inflight requests tracked via `inflightRef`. Duplicate calls return the existing promise.
- Requests within 30s of last fetch are skipped (unless `force: true`).

### Reconciliation (one-time after first fetch)
- **Title sync:** updates `titleSnapshot` on any LinkedTask whose Todoist title has changed.
- **Stale task cleanup:** any LinkedTask not in the Todoist response and not already completed is marked complete (assumption: completed externally). Not unlinked — session tracking preserved.

### Mutations
All mutations are optimistic — local state updates immediately. API failures set an error flag but don't roll back (known trade-off for simplicity).

| Mutation | Local effect |
|---|---|
| `createTask` | Appends API response to `tasks` |
| `completeTask` | Sync API `item_close` (advances recurring tasks to their next due date; ends regular ones). Recurring → keep in cache + `refreshTasks({ force: true })`; non-recurring → filter from `tasks` |
| `reopenTask` | Full `refreshTasks({ force: true })` after Sync API call |
| `updateTask` | Replaces task with API response |
| `deleteTask` | Recursively removes task and descendants |
| `createProject` | Appends API response |
| `deleteProject` | Recursively removes project, its tasks, and sections |