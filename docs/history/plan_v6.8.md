# Orchestrate v6.8 — Timed habits past their target window: surface, don't hide

## Context

A timed `'habit'`-kind instance has a target window (`targetTime + durationMinutes`). v6.1's `windowBehavior` controlled what happened once that window had elapsed by the time you opened the app:

- `'lenient'` ("surface anyway") — keep showing it.
- `'strict'` ("hide for today") — drop it from today's plan entirely.

Two problems surfaced in use, both rooted in the same mistake — letting the *window* decide a habit's *existence*:

1. **Todoist rolls the next occurrence forward.** If you create or edit a timed habit *after* its time has already passed today, Todoist anchors the recurring task's next due date to **tomorrow** — today's slot never existed. The plain "due today" gate then silently dropped a habit you explicitly wanted to see today.
2. **"Hide for today" erased the record and the controls.** A `strict` habit past its window vanished — so a habit you'd *already done before planning* couldn't be marked complete in-app, and the timeline lost it as a record of the day. The setting conflated three separate things: "don't nag me to do this now", "don't show it at all", and "don't let me log it".

The fix across the iteration: **a due-today habit is always surfaced as a record**; `windowBehavior` now governs *presentation*, not *existence*.

## What shipped

### Part 1 — "Surface anyway" rescue (commit `997355c`)

A timed, **lenient** habit whose target time has elapsed but whose recurring Todoist task has rolled to **tomorrow** is rescued back onto today.

- New predicate `isLenientPastWindow(habit, targetTime, nowMinutes)` (`lib/habitsTodoistSync.ts`) — the single source of truth for the rescue, **shared by the read and prune paths so they can't disagree and flicker the row**:
  - `computeTodaysHabitInstances` emits the instance even though the backing task is dated tomorrow — *unless* the habit already has a `completed`/`skipped` instance today (an in-app check-off also rolls the task forward; we must not resurrect it).
  - `findStaleTodaysHabitInstances` mirrors the predicate so the deliberately-surfaced row isn't pruned right back out each tick.
- Date comparisons run through `dueDateLocal(...)` (floating vs fixed-TZ handling) so late-evening habits in non-UTC zones aren't misclassified as tomorrow.

### Part 2 — "Missed" presentation for strict past-window habits (commit `d1ae35f`)

`strict` ("hide for today") no longer hides. A due-today habit is **always emitted as a `planned`, fully-actionable instance** regardless of `windowBehavior`; a strict one past its window is instead *presented* as **"missed"**.

- `computeTodaysHabitInstances` (`lib/habitsTodoistSync.ts`) — removed the `windowBehavior === 'strict'` past-window drop. Due-today habits always push. The Part-1 lenient rescue is unchanged.
- **"missed" is a derived presentation, not a persisted status** — no new `HabitInstanceStatus`, **no migration**. New pure helpers in `lib/habits.ts`:
  - `isHabitInstanceMissed(habit, instance, now)` — true for a `strict`, timed, `planned` instance whose `targetTime + durationMinutes` has elapsed for `now`. `'lenient'` never reads as missed; once the user engages/completes/skips it, the real status takes over. Because it's derived from `now`, a row flips to "missed" live as the clock crosses the window end.
  - `getMissedInstanceIds(life, instances, now)` — for surfaces that hold only instances, not the parent habits.
- **Surfaces** (all keep the row as a greyed record that's still completable — Start/Complete/Skip/Reschedule remain):
  - `SessionTimelineBar` — new optional `missedInstanceIds` prop; a local `DisplayStatus = HabitInstanceStatus | 'missed'` adds a greyed/dashed `⏰` style for missed scheduled markers. Wired from `SessionTimeline` (dashboard) and `Step3Schedule`, which compute the set via `getMissedInstanceIds`.
  - `HabitInstanceCard` — missed rows get `⏰`, muted opacity, and a "missed" pill; controls stay visible.
  - `Step3HabitsPanel` — strict past-window habits now appear (tagged "missed") instead of being filtered out; rescheduling one to a future time clears the tag (it's no longer past its window).
- **Copy** — `HabitForm` relabeled the control from "If I'm planning past the target window" / **"Surface anyway" · "Hide for today"** to **"Once the target window has passed"** / **"Keep as to-do" · "Mark as missed"**, with helper text describing the greyed-but-completable behavior.

### Decisions

1. **Presentation, not status.** "missed" is derived from `now` rather than a stored `HabitInstanceStatus`, so the instance stays genuinely `planned`/actionable, it's live-correct as time passes, and there's no migration. This realizes "prominence, not existence".
2. **`strict` ≠ terminal.** A missed habit is recoverable — every lifecycle control stays available, since the common trigger is "I already did it before planning".
3. **`lenient` stays plain.** Lenient past-window habits remain ordinary `planned` rows (no "missed" treatment) — that visible difference is what still justifies keeping the setting.
4. **Rescue scope held.** The Part-1 "surface anyway" rescue stays **lenient-only**. A *strict* habit created after its time (task rolled to tomorrow) deliberately does **not** surface today — extending the rescue there would risk falsely tagging "missed" a habit that was actually completed in the Todoist app (Orchestrate can't distinguish "done in Todoist" from "created late"). The handled case is a *pre-existing* strict habit whose time passed before planning.
5. **No schema bump.** `_schemaVersion` stays `6.3` (no persisted-shape change).

## Files

- Compute/helpers: `lib/habitsTodoistSync.ts` (`isLenientPastWindow`, `computeTodaysHabitInstances`, `findStaleTodaysHabitInstances`), `lib/habits.ts` (`isHabitInstanceMissed`, `getMissedInstanceIds`)
- Timeline: `ui/SessionTimelineBar.tsx` (`missedInstanceIds` prop, `DisplayStatus`), `dashboard/SessionTimeline.tsx`
- Dashboard: `dashboard/HabitInstanceCard.tsx`
- Wizard: `wizard/Step3Schedule.tsx` (`Step3HabitsPanel`)
- Habit form: `life/HabitForm.tsx` (window-behavior labels + copy)
- Types: `types/index.ts` (`windowBehavior` doc)
- Docs/guide: `docs/synthesis.md`, `docs/data-model.md`, `guide/UserGuide.tsx`

## Deferred

- **"Completed in Todoist before planning" has no record.** A recurring task you check off directly in Todoist before planning rolls forward, and Orchestrate only sees a recurring task's *next* occurrence — so it never surfaces as a completed instance today. Closing this needs the Todoist completed-items API. A follow-up attempt (fetch `tasks/completed/by_completion_date` and reflect into a `completed` instance) was prototyped and **reverted** — the matching proved fragile (recurring completions don't tie back to the live task id cleanly, plus duplicate-task and indexing-lag issues) and wasn't worth the complexity. Left out of scope.
- **Durable miss history / streaks.** "missed" is per-day and derived; a persistent record of misses (for streaks / failure-tolerance nudges) waits on the durable `life.engagementHistory` in `roadmap/engagement_record_strategy.md`.
