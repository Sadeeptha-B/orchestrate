import type {
    DayPlan,
    Habit,
    HabitKind,
    HabitRecurrence,
    LifeContext,
    TaskCapDefaults,
    TodaysHabitInstance,
} from '../types';
import { minutesOfDay, timeToMinutes } from './time';

export function getActiveHabits(life: LifeContext): Habit[] {
    return life.habits.filter((habit) => habit.active);
}

export function getAnchorHabits(habits: Habit[]): Habit[] {
    return habits.filter((habit) => habit.isAnchor);
}

/**
 * Split habits into the two kinds, preserving input order within each bucket.
 * Shared by the surfaces that group habits by kind (LifeView, SeasonDetail, HabitsLibrary).
 */
export function partitionByKind(habits: Habit[]): { habits: Habit[]; microGaps: Habit[] } {
    const habitsOut: Habit[] = [];
    const microGaps: Habit[] = [];
    for (const h of habits) {
        (h.kind === 'micro-gap' ? microGaps : habitsOut).push(h);
    }
    return { habits: habitsOut, microGaps };
}

/**
 * v6.7: resolve the kind of a today-instance by joining back to its parent habit. Consumers
 * use this instead of the old `!targetTime` proxy, which is no longer reliable now that
 * 'habit'-kind instances can also be untimed ("anytime"). Falls back to `'habit'` if the
 * parent habit was deleted (the instance is dropped from the plan anyway).
 */
export function habitKindOf(life: LifeContext, instance: TodaysHabitInstance): HabitKind {
    return life.habits.find((h) => h.id === instance.habitId)?.kind ?? 'habit';
}

/**
 * Sort comparator for today's habit instances: timed instances first (ascending by
 * `targetTime`), untimed ("Anytime today") instances last. Shared by the dashboard
 * `HabitInstanceCard` and the wizard's `Step3HabitsPanel`.
 */
export function compareHabitInstancesByTime(a: TodaysHabitInstance, b: TodaysHabitInstance): number {
    if (a.targetTime && b.targetTime) return timeToMinutes(a.targetTime) - timeToMinutes(b.targetTime);
    if (a.targetTime) return -1;
    if (b.targetTime) return 1;
    return 0;
}

/**
 * v6.8: derived "missed" presentation for a timed 'habit'-kind instance.
 *
 * Replaces the old v6.1 "strict hides the row" behavior: a `windowBehavior: 'strict'` habit whose
 * target window has elapsed is no longer dropped by `computeTodaysHabitInstances` — it stays
 * surfaced as a `planned`, fully-actionable instance (you can still Start/Complete/Skip/Reschedule
 * it), but every surface presents it as **missed** (greyed, no longer prompted as a live to-do).
 * `'lenient'` habits never read as missed — they stay ordinary `planned` rows all day.
 *
 * This is purely derived from `now` (no persisted status, no migration), so a habit flips to
 * "missed" live as the clock crosses its window end. "Missed" only applies to a *timed*,
 * *strict* instance still in `planned` state — once the user engages/completes/skips it, the real
 * status takes over.
 */
export function isHabitInstanceMissed(
    habit: Habit | undefined,
    instance: TodaysHabitInstance,
    now: Date,
): boolean {
    if (!habit || habit.kind !== 'habit') return false;
    if (habit.windowBehavior !== 'strict') return false; // default 'lenient' never reads as missed
    if (instance.status !== 'planned') return false;
    if (!instance.targetTime) return false;              // untimed ("anytime") has no window
    const windowEnd = timeToMinutes(instance.targetTime) + instance.durationMinutes;
    return minutesOfDay(now) > windowEnd;
}

/**
 * v6.8: ids of today's instances currently presenting as "missed" (see {@link isHabitInstanceMissed}).
 * Used by surfaces that only hold instances, not the parent habits (e.g. `SessionTimelineBar`).
 */
export function getMissedInstanceIds(
    life: LifeContext,
    instances: TodaysHabitInstance[],
    now: Date,
): Set<string> {
    const byId = new Map(life.habits.map((h) => [h.id, h]));
    const out = new Set<string>();
    for (const i of instances) {
        if (isHabitInstanceMissed(byId.get(i.habitId), i, now)) out.add(i.id);
    }
    return out;
}

/**
 * True if a recurrence rule matches the given local-calendar date.
 * `dateISO` is YYYY-MM-DD; parsed as local date to avoid timezone off-by-one.
 * v6.7: extracted so recurring-focus cadence can reuse it without a full Habit.
 */
export function recurrenceMatchesDate(recurrence: HabitRecurrence, dateISO: string): boolean {
    const [y, m, d] = dateISO.split('-').map(Number);
    const dow = new Date(y, m - 1, d).getDay(); // 0=Sun..6=Sat
    switch (recurrence.kind) {
        case 'daily':
            return true;
        case 'weekdays':
            return dow >= 1 && dow <= 5;
        case 'weekly':
        case 'custom':
            return recurrence.daysOfWeek?.includes(dow) ?? false;
    }
}

/** True if the habit's recurrence rule matches the given local-calendar date. */
export function habitMatchesDate(habit: Habit, dateISO: string): boolean {
    return recurrenceMatchesDate(habit.recurrence, dateISO);
}

/**
 * True if a habit is in scope for the currently active season. Season-agnostic habits
 * (empty `seasonIds`) are always in scope; season-scoped habits require the active season
 * to be one of theirs. Shared by every today-instance / reconcile compute path.
 */
export function habitInSeasonScope(habit: Habit, activeSeasonId: string | null): boolean {
    if (habit.seasonIds.length === 0) return true;
    return activeSeasonId !== null && habit.seasonIds.includes(activeSeasonId);
}

/**
 * v6.7: compute today's micro-gap instances — the no-Todoist counterpart to
 * `computeTodaysHabitInstances`. Filters active 'micro-gap' habits whose recurrence + season
 * scope match today. Emits untimed, non-Todoist instances; the repeatable lifecycle
 * (planned↔engaged) is driven by the existing START/STOP reducer actions.
 *
 * Re-emits every matching habit on each call (including ones already in `plan.todaysHabits`) so
 * habit-form edits propagate — `REFRESH_TODAYS_HABITS` dedupes by `habitId` and value-stably
 * merges the refreshed fields into the existing planned instance.
 */
export function computeTodaysMicroGapInstances(args: {
    life: LifeContext;
    plan: DayPlan;
    taskCaps: TaskCapDefaults;
}): TodaysHabitInstance[] {
    const { life, plan, taskCaps } = args;
    const dateISO = plan.date;
    const activeSeasonId = life.activeSeasonId;
    const out: TodaysHabitInstance[] = [];

    for (const habit of life.habits) {
        if (!habit.active) continue;
        if (habit.kind !== 'micro-gap') continue;
        if (!habitMatchesDate(habit, dateISO)) continue;
        if (!habitInSeasonScope(habit, activeSeasonId)) continue;

        out.push({
            id: crypto.randomUUID(),
            habitId: habit.id,
            titleSnapshot: habit.name,
            durationMinutes: habit.targetDurationMinutes ?? taskCaps.microGap,
            status: 'planned',
        });
    }
    return out;
}
