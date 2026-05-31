import type { Habit, LifeContext, TodaysHabitInstance } from '../types';
import { timeToMinutes } from './time';

export function getActiveHabits(life: LifeContext): Habit[] {
    return life.habits.filter((habit) => habit.active);
}

export function getAnchorHabits(habits: Habit[]): Habit[] {
    return habits.filter((habit) => habit.isAnchor);
}

/**
 * Split habits into the two kinds, preserving input order within each bucket.
 * Shared by the surfaces that group habits by kind (LifeView, SeasonDetail).
 */
export function partitionByKind(habits: Habit[]): { stabilizers: Habit[]; lightCoherent: Habit[] } {
    const stabilizers: Habit[] = [];
    const lightCoherent: Habit[] = [];
    for (const h of habits) {
        (h.kind === 'stabilizer' ? stabilizers : lightCoherent).push(h);
    }
    return { stabilizers, lightCoherent };
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
 * True if the habit's recurrence rule matches the given local-calendar date.
 * `dateISO` is YYYY-MM-DD; parsed as local date to avoid timezone off-by-one.
 */
export function habitMatchesDate(habit: Habit, dateISO: string): boolean {
    const [y, m, d] = dateISO.split('-').map(Number);
    const dow = new Date(y, m - 1, d).getDay(); // 0=Sun..6=Sat
    switch (habit.recurrence.kind) {
        case 'daily':
            return true;
        case 'weekdays':
            return dow >= 1 && dow <= 5;
        case 'weekly':
        case 'custom':
            return habit.recurrence.daysOfWeek?.includes(dow) ?? false;
    }
}
