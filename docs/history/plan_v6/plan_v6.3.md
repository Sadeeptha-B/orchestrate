# Plan v6.3 — Habit/Session Decoupling + Task Engagement & Reschedule Records

> Frozen post-implementation plan. The living docs ([synthesis.md](../synthesis.md), [data-model.md](../data-model.md)) reflect the result. This document preserves the *narrative* of how v6.3 was designed and which tradeoffs landed where.

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
| Reschedule mechanic for habits | **Branched on engagement.** No engagement → in-place update of `targetTime` + `rescheduledAt` stamp. Engagement present → clone: predecessor goes to terminal `'unfinished'` with its engagement record intact; successor is a fresh `'planned'` instance at the new time. The recurring Todoist task is untouched in both paths. | The first design (always clone) marked predecessors `'skipped'` / `'unfinished'` even when the user hadn't touched the habit — a needless strikethrough trail. The second design (always in-place) erased engagement on reschedule, losing the durable record. The branched design preserves the user-facing simplicity of in-place moves for untouched habits while keeping the engagement record durable when work has happened. The `rescheduledAt` sentinel lets `REFRESH_TODAYS_HABITS` distinguish "user chose this time" from "habit-form edit should propagate." |
| Engagement carryover on backlog | **`BacklogEntry.unfinishedTaskRecords: Record<todoistId, EngagementRecord>`** | Engagement memo lives on the BacklogEntry only — restored LinkedTasks get a `rescheduledFromTodoistId` stamp but no copy of the engagement record. The annotation in the Backlog tab is the user-facing surface. |
| `completed: boolean` vs `status` | **Keep `completed` as a mirror** of `status === 'completed'` | Migration safety net. Many callers (capacity calc, session-card visuals, completion counter) still read `completed`. Both fields are written together in `TOGGLE_TASK_COMPLETE`. |
| Schema version | **`6.3`** (JSON float). | Matches the product label. Stamped on plan, settings, life, and saved-session payloads. |
| Scope phasing | **Single PR, one cohesive iteration.** | The habit decoupling and engagement work share data-model surface area (the `EngagementRecord` type, the `LinkedTask.status` field). Staging would have meant two migrations and two coordinated dance partners for the same conceptual shift. |

## Architectural shape

No new contexts. The reducer surface grows; the existing providers carry through.

- **New types** (`src/types/index.ts`): `TodaysHabitInstance` (`id`, `habitId`, `todoistTaskId`, `titleSnapshot`, `durationMinutes`, optional `targetTime`, `status`, optional `completedAt`/`engagement`/`rescheduledAt`), `HabitInstanceStatus`, `EngagementRecord`, `LinkedTaskStatus`. Extended: `LinkedTask` (adds `status`, `engagement`, `rescheduledFromTodoistId`, `rescheduledAt`; drops `sourceHabitId`, `skippedForToday`). Extended: `DayPlan` (adds `todaysHabits`). Extended: `BacklogEntry` (adds `unfinishedTaskRecords`). Removed: `HabitTaskInjection`.

- **Reducer actions**:
  - Replaced: `INJECT_HABIT_TASKS` → `REFRESH_TODAYS_HABITS { instances: TodaysHabitInstance[] }`. `SKIP_HABIT_TASK` → `SKIP_HABIT_INSTANCE { instanceId }`.
  - Added: `START_HABIT_INSTANCE`, `STOP_HABIT_INSTANCE`, `COMPLETE_HABIT_INSTANCE`, `RESCHEDULE_HABIT_INSTANCE` (in-place update of `targetTime` + `rescheduledAt`), `START_TASK_ENGAGEMENT`, `STOP_TASK_ENGAGEMENT`.
  - `REFRESH_TODAYS_HABITS` merges into existing planned instances (refreshes `targetTime`/`durationMinutes`/`titleSnapshot` from the latest habit definition, but preserves `targetTime` when `rescheduledAt` is set — so habit-form edits propagate while user reschedules stick).
  - Modified: `TOGGLE_TASK_COMPLETE` now also sets `status` and closes engagement. `MOVE_INTENTION_TO_BACKLOG` captures engagement into `unfinishedTaskRecords`. `RESTORE_FROM_BACKLOG` accepts a `now` arg and stamps `rescheduledFromTodoistId`/`rescheduledAt` on rebuilt LinkedTasks that had engagement.
  - `DELETE_HABIT` cleanup pivots from `plan.linkedTasks` (drop `sourceHabitId` matches) to `plan.todaysHabits` (drop `habitId` matches).

- **Helpers**:
  - `lib/habitsTodoistSync.ts` — renamed `computeHabitTasksToInject` → `computeTodaysHabitInstances`. Drops the `resolveSessionForTime` branch (no session pre-assignment).
  - `lib/backlog.ts` — `buildBacklogEntry` walks engagement records; `rebuildLinkedTasksForBacklogEntry` accepts `nowISO` and stamps reschedule fields for engaged ids.
  - `lib/habits.ts` — `isHabitDerivedTask` removed (no callers).
  - `lib/intentionUnschedule.ts` — the `sourceHabitId` skip branch is now structurally unreachable; the arg list is preserved for API stability.
  - `context/DayPlanContext.tsx` — new `closeEngagement(record, nowISO)` helper accumulates minutes across cycles.

- **UI**:
  - **New** `src/components/dashboard/HabitInstanceCard.tsx` — single sorted list of today's stabilizer instances (no separate completed/skipped log) with per-row Start/Stop/Complete/Skip/Reschedule controls. Completed/skipped rows render in place with terminal styling; controls hidden.
  - **Modified** `src/components/ui/SessionTimelineBar.tsx` — adds the habit lane above session blocks, "Anytime today" cluster above the time axis. Drops the `isHabitDerivedTask(lt) && '🔁 '` prefix logic from session-block task pills.
  - **Modified** `src/components/dashboard/SessionTimeline.tsx` — removes `HABIT_GROUP_KEY` synthetic grouping; pass `plan.todaysHabits` through to `SessionTimelineBar`; adds Start/Stop button to `TaskRow`.
  - **Modified** `src/components/dashboard/Dashboard.tsx` — mounts `HabitInstanceCard` between Timeline and CurrentSession.
  - **Modified** `src/components/wizard/Step1Intentions.tsx` — dispatches `REFRESH_TODAYS_HABITS` from `computeTodaysHabitInstances`. Chip copy updated. Passes `habitTodoistIds` to `TodoistPanel.linking` for the "🔁 Habit" label.
  - **Modified** `src/components/wizard/Step2Refine.tsx` — drops the "Stabilizer habits skip this step entirely" tip text.
  - **Modified** `src/components/wizard/Step3Schedule.tsx` — removes the "Unassigned habits" tray and the "🔁 Habits" group from the selected-session detail. Removes the 🔁 prefix on the Add-background buttons and Phase 2 session summary. Passes `todaysHabits` to `SessionTimelineBar`. Adds a new `Step3HabitsPanel` rendered in **both** Phase 1 (below the timeline) and Phase 2 (above the Todoist + Calendar split), with a Reschedule affordance on every active instance — Step 3 is the planning step, so the user should be able to set/change times regardless of whether the target window has elapsed.
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

- **Cross-day engagement aggregation / durable engagement log.** In-day, engagement records live on `LinkedTask.engagement` and `TodaysHabitInstance.engagement` (the latter on the `'unfinished'` predecessor for engagement-aware reschedules). The backlog carries LinkedTask engagement across one day-boundary via `BacklogEntry.unfinishedTaskRecords`. There is **no cross-day engagement ledger yet** — engagement records die when the day's plan is dropped at rollover unless the day was manually `SAVE_DAY`-ed. Five paths considered for a future iteration:
   1. **`life.engagementHistory: EngagementLogEntry[]`** — every Stop / Complete / clone-on-reschedule appends. Rollover migration harvests the predecessor records from `plan.todaysHabits`. Pure in-app; needs a "trim older than N weeks" knob.
   2. **Todoist comments** — on Stop, post `"Engaged 18m, 2026-05-19T07:00–07:18"` as a comment on the underlying Todoist task. No OAuth (the existing token covers comments). Surfaces inside Todoist; one-way.
   3. **Todoist `duration` field** — update on Complete to actual engaged minutes. Semantic mismatch (Todoist's duration is "expected" not "actual") and overwritten by recurring rollover; not recommended.
   4. **ICS subscription feed** — Orchestrate generates an ICS for engagement events; user subscribes in Google Calendar. No OAuth but needs Orchestrate reachable on a URL.
   5. **Defer to the v8 Reviews iteration** — engagement records feed weekly aggregation in a dedicated `/review` route.
   Recommendation: (1) as the foundational store, (2) optionally as a write-side mirror for cross-app visibility, (5) as the consumer. The current `'unfinished'` predecessor in `plan.todaysHabits` is already the harvest source for (1).
- **Capacity inclusion for habits.** Locked to "no" by design choice. If the user later wants the hybrid "count engaged habits but not planned ones," it's a small change to `computeSessionCapacity` — but not in this iteration.
- **Engagement on Light Pool habits.** `HabitLogEntry` already has start/complete + duration, which is the Light Pool's engagement model. No changes there.
- **Engagement export.** Imports/exports round-trip the new fields via the existing `IMPORT_BACKUP` plumbing; no dedicated UI to inspect engagement history outside the backlog annotation.
- **Automatic clone-on-reschedule for user LinkedTasks.** Today, only the backlog → restore path stamps `rescheduledFromTodoistId`. An explicit "Reschedule to tomorrow" affordance for engaged user tasks was scoped out — the backlog flow already covers it.
