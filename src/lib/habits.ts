import type { Habit, LifeContext, TodaysHabitInstance } from '../types';
import { timeToMinutes } from './time';

export function getActiveHabits(life: LifeContext): Habit[] {
    return life.habits.filter((habit) => habit.active);
}

export function getAnchorHabits(habits: Habit[]): Habit[] {
    return habits.filter((habit) => habit.isAnchor);
}

/**
 * v6: filter habits to the Light Pool — light-coherent habits that match today
 * AND that are either season-agnostic or member of the currently active season.
 */
export function getLightPoolHabits(life: LifeContext, dateISO: string): Habit[] {
    const activeSeasonId = life.activeSeasonId;
    return life.habits.filter((h) => {
        if (!h.active) return false;
        if (h.kind !== 'light-coherent') return false;
        if (!habitMatchesDate(h, dateISO)) return false;
        if (h.seasonIds.length === 0) return true;
        return activeSeasonId !== null && h.seasonIds.includes(activeSeasonId);
    });
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
