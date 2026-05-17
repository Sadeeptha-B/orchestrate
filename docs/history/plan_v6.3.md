# Plan v6.3 — Habit/Session Decoupling + Task Engagement & Reschedule Records

> Frozen post-implementation plan. The living docs ([synthesis.md](../synthesis.md), [data-model.md](../data-model.md), [architecture.md](../architecture.md), [user-guide.md](../user-guide.md)) reflect the result. This document preserves the *narrative* of how v6.3 was designed and which tradeoffs landed where.

## Context

Three intertwined defects in the v6.2 model:

1. **Stabilizer habits masqueraded as background tasks.** `INJECT_HABIT_TASKS` created `LinkedTask` rows with `type: 'background'` + `sourceHabitId`, and the wizard's Step 3 invited the user to drop them into sessions ("Unassigned habits" tray; per-session "🔁 Habits" group). A daily-recurring ritual is not the same kind of thing as a one-shot intention task.

2. **Stabilizers were forced into session-scope.** A habit's lifecycle is "today at 7am for 15 min", not "in the morning session". Auto-assigning by `due.datetime → session window` was a workaround. With `Habit.targetTime` already on the model, the right move is to position stabilizers directly on the timeline independent of session boundaries.

3. **Reschedule + backlog erased engagement history.** When an intention was moved to the backlog, `unscheduleIntentionTasks` cleared Todoist scheduling and `MOVE_INTENTION_TO_BACKLOG` dropped the LinkedTask rows. If the user had already engaged with a task (started it, did partial work), no record survived.

The user's proposed mechanic — **on reschedule of an engaged task, generate an identical successor and mark the predecessor `unfinished`** — became the unifying primitive. It applies the same way to lenient habits: when a missed lenient habit is retargeted, generate a one-off Orchestrate-side successor instance, leaving the recurring Todoist task untouched.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Habit representation in `DayPlan` | **New `TodaysHabitInstance` type** on `plan.todaysHabits`, distinct from `LinkedTask` | `LinkedTask` is for intention-bound work; mixing habits into it created the original conflation. Separate carriers, separate lifecycle. |
| Habit positioning | **Dedicated habit lane** above the session blocks in `SessionTimelineBar`. Untimed habits cluster as "Anytime today" chips above the time axis. | Clear semantic separation from sessions. Spatial-time link is preserved (vs. a sidebar list). Floating overlays on session blocks were considered but rejected as visually entangling. |
| Engagement detection | **Explicit Start/Stop button** (▶/■) on each LinkedTask row and HabitInstance row. | Implicit detection is too easy to false-positive (any reorder/expand triggers it). Explicit user action keeps the engagement record meaningful. |
| Capacity inclusion | **Habits do not consume session capacity** | Matches the "habits aren't session-scoped" principle. If a user packs a session that overlaps a 30-min stabilizer, the timeline visualization makes the overlap obvious — no need to fold habit duration into the capacity arithmetic. |
| Reschedule mechanic for lenient habits | **Clone-and-mark-unfinished, Orchestrate-side only** | Don't touch the recurring Todoist task. Predecessor flips to `unfinished` (if engaged) or `skipped` (if untouched); successor with new `targetTime` is appended to `todaysHabits` with `rescheduledFromId`. Todoist's recurrence stays clean. |
| Engagement carryover on backlog | **`BacklogEntry.unfinishedTaskRecords: Record<todoistId, EngagementRecord>`** | Engagement memo lives on the BacklogEntry only — restored LinkedTasks get a `rescheduledFromTodoistId` stamp but no copy of the engagement record. The annotation in the Backlog tab is the user-facing surface. |
| `completed: boolean` vs `status` | **Keep `completed` as a mirror** of `status === 'completed'` | Migration safety net. Many callers (capacity calc, session-card visuals, completion counter) still read `completed`. Both fields are written together in `TOGGLE_TASK_COMPLETE`. |
| Schema version | **`6.3`** (JSON float). | Matches the product label. Stamped on plan, settings, life, and saved-session payloads. |
| Scope phasing | **Single PR, one cohesive iteration.** | The habit decoupling and engagement work share data-model surface area (the `EngagementRecord` type, the `LinkedTask.status` field). Staging would have meant two migrations and two coordinated dance partners for the same conceptual shift. |

## Architectural shape

No new contexts. The reducer surface grows; the existing providers carry through.

- **New types** (`src/types/index.ts`): `TodaysHabitInstance`, `HabitInstanceStatus`, `EngagementRecord`, `LinkedTaskStatus`. Extended: `LinkedTask` (adds `status`, `engagement`, `rescheduledFromTodoistId`, `rescheduledAt`; drops `sourceHabitId`, `skippedForToday`). Extended: `DayPlan` (adds `todaysHabits`). Extended: `BacklogEntry` (adds `unfinishedTaskRecords`). Removed: `HabitTaskInjection`.

- **Reducer actions**:
  - Replaced: `INJECT_HABIT_TASKS` → `REFRESH_TODAYS_HABITS { instances: TodaysHabitInstance[] }`. `SKIP_HABIT_TASK` → `SKIP_HABIT_INSTANCE { instanceId }`.
  - Added: `START_HABIT_INSTANCE`, `STOP_HABIT_INSTANCE`, `COMPLETE_HABIT_INSTANCE`, `RESCHEDULE_HABIT_INSTANCE`, `START_TASK_ENGAGEMENT`, `STOP_TASK_ENGAGEMENT`.
  - Modified: `TOGGLE_TASK_COMPLETE` now also sets `status` and closes engagement. `MOVE_INTENTION_TO_BACKLOG` captures engagement into `unfinishedTaskRecords`. `RESTORE_FROM_BACKLOG` accepts a `now` arg and stamps `rescheduledFromTodoistId`/`rescheduledAt` on rebuilt LinkedTasks that had engagement.
  - `DELETE_HABIT` cleanup pivots from `plan.linkedTasks` (drop `sourceHabitId` matches) to `plan.todaysHabits` (drop `habitId` matches).

- **Helpers**:
  - `lib/habitsTodoistSync.ts` — renamed `computeHabitTasksToInject` → `computeTodaysHabitInstances`; added `cloneHabitInstanceForReschedule`. Drops the `resolveSessionForTime` branch (no session pre-assignment).
  - `lib/backlog.ts` — `buildBacklogEntry` walks engagement records; `rebuildLinkedTasksForBacklogEntry` accepts `nowISO` and stamps reschedule fields for engaged ids.
  - `lib/habits.ts` — `isHabitDerivedTask` removed (no callers).
  - `lib/intentionUnschedule.ts` — the `sourceHabitId` skip branch is now structurally unreachable; the arg list is preserved for API stability.
  - `context/DayPlanContext.tsx` — new `closeEngagement(record, nowISO)` helper accumulates minutes across cycles.

- **UI**:
  - **New** `src/components/dashboard/HabitInstanceCard.tsx` — lists today's stabilizer instances with per-row Start/Stop/Complete/Skip/Reschedule controls.
  - **Modified** `src/components/ui/SessionTimelineBar.tsx` — adds the habit lane above session blocks, "Anytime today" cluster above the time axis. Drops the `isHabitDerivedTask(lt) && '🔁 '` prefix logic from session-block task pills.
  - **Modified** `src/components/dashboard/SessionTimeline.tsx` — removes `HABIT_GROUP_KEY` synthetic grouping; pass `plan.todaysHabits` through to `SessionTimelineBar`; adds Start/Stop button to `TaskRow`.
  - **Modified** `src/components/dashboard/Dashboard.tsx` — mounts `HabitInstanceCard` between Timeline and CurrentSession.
  - **Modified** `src/components/wizard/Step1Intentions.tsx` — dispatches `REFRESH_TODAYS_HABITS` from `computeTodaysHabitInstances`. Chip copy updated. Passes `habitTodoistIds` to `TodoistPanel.linking` for the "🔁 Habit" label.
  - **Modified** `src/components/wizard/Step2Refine.tsx` — drops the "Stabilizer habits skip this step entirely" tip text.
  - **Modified** `src/components/wizard/Step3Schedule.tsx` — removes the "Unassigned habits" tray and the "🔁 Habits" group from the selected-session detail. Removes the 🔁 prefix on the Add-background buttons and Phase 2 session summary. Passes `todaysHabits` to `SessionTimelineBar`. Adds a new `Phase2HabitsPanel` above the Todoist + Calendar split with a per-row Reschedule affordance for lenient habits past their window.
  - **Modified** `src/components/todoist/TodoistPanel.tsx` — `LinkingProps` gains `habitTodoistIds: Set<string>`; the habit-detection logic checks the Set instead of `LinkedTask.sourceHabitId`.
  - **Modified** `src/components/dashboard/BacklogTab.tsx` — renders a `✱ Engaged earlier: N task(s), Mm` annotation when `entry.unfinishedTaskRecords` is populated.

## Migration v6.2 → v6.3

Performed in `migratePlan`:
1. For every `LinkedTask` with `sourceHabitId`: emit a synthetic `TodaysHabitInstance` (uuid, `habitId: sourceHabitId`, `todoistTaskId: lt.todoistId`, `titleSnapshot: lt.titleSnapshot ?? todoistId`, `durationMinutes: lt.estimatedMinutes ?? 30`, `targetTime: undefined`, `status` from `completed` / `skippedForToday`). Drop the LinkedTask. Prune its id from every `taskSessions[sessionId]`.
2. For every remaining LinkedTask: stamp `status: completed ? 'completed' : 'pending'`. Drop the deprecated `sourceHabitId` / `skippedForToday` fields.
3. Initialize `plan.todaysHabits: []` when missing.
4. Stamp `_schemaVersion: 6.3` on every persist.

Lossless and one-shot. Habits that were already completed today retain their completed state via the synthetic instance; assigned-session info is intentionally dropped (the new model doesn't need it).

## What's deliberately not in scope

- **Cross-day engagement aggregation.** Engagement records are local to the day for LinkedTasks and to the instance for TodaysHabitInstance. The backlog carries them across one day-boundary (predecessor → successor on Bring-to-today). A multi-day engagement ledger is a v7 concern.
- **Capacity inclusion for habits.** Locked to "no" by design choice. If the user later wants the hybrid "count engaged habits but not planned ones," it's a small change to `computeSessionCapacity` — but not in this iteration.
- **Engagement on Light Pool habits.** `HabitLogEntry` already has start/complete + duration, which is the Light Pool's engagement model. No changes there.
- **Engagement export.** Imports/exports round-trip the new fields via the existing `IMPORT_BACKUP` plumbing; no dedicated UI to inspect engagement history outside the backlog annotation.
- **Automatic clone-on-reschedule for user LinkedTasks.** Today, only the backlog → restore path stamps `rescheduledFromTodoistId`. An explicit "Reschedule to tomorrow" affordance for engaged user tasks was scoped out — the backlog flow already covers it.
