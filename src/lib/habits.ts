import type {
    DayPlan,
    Habit,
    HabitKind,
    HabitRecurrence,
    LifeContext,
    TaskCapDefaults,
    TodaysHabitInstance,
} from '../types';
import { timeToMinutes } from './time';

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
 * v6.7: compute today's micro-gap instances — the no-Todoist counterpart to
 * `computeTodaysHabitInstances`. Filters active 'micro-gap' habits whose recurrence + season
 * scope match today and that aren't already represented in `plan.todaysHabits`. Emits untimed,
 * non-Todoist instances; the repeatable lifecycle (planned↔engaged) is driven by the existing
 * START/STOP reducer actions. Idempotent against `plan.todaysHabits` (caller passes the full plan;
 * `REFRESH_TODAYS_HABITS` further dedupes by `habitId`).
 */
export function computeTodaysMicroGapInstances(args: {
    life: LifeContext;
    plan: DayPlan;
    taskCaps: TaskCapDefaults;
}): TodaysHabitInstance[] {
    const { life, plan, taskCaps } = args;
    const dateISO = plan.date;
    const activeSeasonId = life.activeSeasonId;
    const existingHabitIds = new Set(plan.todaysHabits.map((i) => i.habitId));
    const out: TodaysHabitInstance[] = [];

    for (const habit of life.habits) {
        if (!habit.active) continue;
        if (habit.kind !== 'micro-gap') continue;
        if (existingHabitIds.has(habit.id)) continue;
        if (!habitMatchesDate(habit, dateISO)) continue;
        if (habit.seasonIds.length > 0 && (!activeSeasonId || !habit.seasonIds.includes(activeSeasonId))) continue;

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
