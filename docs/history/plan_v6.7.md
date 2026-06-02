# Orchestrate v6.7 — Re-separate habits & micro-gaps; add recurring focus

## Context

v6.6 unified the two habit kinds on a single axis (scheduling) and gave them the *same* lifecycle: Todoist-backed, terminal once-per-day completion, one shared surface. In use that proved wrong:

1. **Micro-gaps aren't done-once.** "Flashcards", "read a section" resurface many times a day; a terminal `completed` that advances a Todoist recurrence fights that.
2. **Mandatory scheduling was too strict**, and "stabilizer" was too loaded a word — plenty of recurring things ("anime episode", "vitamins") want tracking without a fixed time.
3. **Surfacing micro-gaps next to obligations felt grindy**, and routing them through Todoist added needs-sync/overdue noise. The value Todoist gave them was *tracking*, which engagement segments already provide (native streaks are a planned follow-up).

A third recurring shape ("learn redis") fits neither kind — it's season-scoped recurring *work* that decomposes into tasks, so it belongs in the intention pipeline.

## What shipped

**Kind rename + lifecycle split** (`stabilizer → 'habit'`, `light-coherent → 'micro-gap'`):
- **habit**: Todoist-backed, terminal once/day, `targetTime` optional (timed → timeline lane; untimed → "anytime"). Keeps the v6.5/6.6 sync/reconcile/reschedule machinery. Rendered in `HabitInstanceCard`.
- **micro-gap**: **no Todoist**, **repeatable** (planned↔engaged via existing `START/STOP_HABIT_INSTANCE`, never terminal), its own `MicroGapCard` (▶/■ + rep-count badge), still feeds the Engagement Log. Computed by a new pure `computeTodaysMicroGapInstances` (`lib/habits.ts`). Excluded from Todoist sync/reconcile, the timeline, the Step 3 panel; the low-energy check-in surfaces them as the "smaller move".

**Decoupling mechanics:**
- `TodaysHabitInstance.todoistTaskId` is now optional; consumers resolve kind via `habitKindOf(life, instance)` (the old `!targetTime` proxy broke once habits could be untimed too).
- `syncHabitToTodoist` / `findNeedsSyncHabits` / `findOverdueHabits` / `useSyncHabit` early-skip micro-gaps.
- `TaskCapDefaults` keys `stabilizer/lightCoherent → habit/microGap` (`migrateTaskCaps`).
- `migrateHabit` remaps legacy kind values and strips `todoistTaskId`/`targetTime`/`windowBehavior` from micro-gaps (the orphaned v6.6 Todoist task is left for the user to delete). `_schemaVersion` stays `6.3`.

**Recurring focus** (additive): `Season.recurringFocuses?: RecurringFocus[]` (`{ id, title, recurrence, active }`), edited in `SeasonForm`/`SeasonDetail`. On matching days `SeasonFocusBanner` shows a clickable **"+ Add" chip** → `ADD_INTENTION` + `MARK_FOCUS_SEEDED` (dedupe via `plan.seededFocusIds`). Manual-only; reuses `ADD_INTENTION` + `recurrenceMatchesDate`.

### Decisions
1. Recurring focus enters the day via **manual chips**, not auto-seed.
2. Stored **additively** on the season (`recurringFocuses`); `supportingGoals` unchanged.
3. Micro-gap interaction = **▶ Start / ■ Stop, repeatable** (no terminal complete/skip, no Todoist). One-tap "instant log" deferred.
4. v6.6-era micro-gap Todoist tasks: migration clears the local link; not auto-deleted from Todoist.

## Files
- Types/reducer/migration: `types/index.ts`, `context/DayPlanContext.tsx`
- Compute/sync: `lib/habits.ts` (habitKindOf, recurrenceMatchesDate, computeTodaysMicroGapInstances, partitionByKind), `lib/habitsTodoistSync.ts`, `lib/capacity.ts`, `hooks/useSyncHabit.ts`
- Habit UI: `components/life/HabitForm.tsx`, `HabitsLibrary.tsx`, `LifeView.tsx`, `settings/CapacitySettings.tsx`
- Dashboard: `dashboard/HabitInstanceCard.tsx` (+ new `MicroGapCard`), `Dashboard.tsx`, `SessionTimeline.tsx`
- Wizard/checkin: `wizard/Step1Intentions.tsx`, `Step3Schedule.tsx`, `checkin/CheckInModal.tsx`
- Seasons/focus: `life/SeasonForm.tsx`, `SeasonDetail.tsx`, `SeasonFocusBanner.tsx`
- Docs/guide: `docs/synthesis.md`, `docs/data-model.md`, `guide/UserGuide.tsx`, `ui/AboutContent.tsx`

## Deferred
- Native **streaks** for micro-gaps (will read a durable `life.engagementHistory` per `roadmap/engagement_record_strategy.md`).
- Recurring-focus cross-day progress tracking + auto-seed mode.
- One-tap "instant log" for micro-gaps.
