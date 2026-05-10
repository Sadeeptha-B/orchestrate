import type { Habit, LifeContext } from '../types';

export function getActiveHabits(life: LifeContext): Habit[] {
    return life.habits.filter((habit) => habit.active);
}

export function getAnchorHabits(habits: Habit[]): Habit[] {
    return habits.filter((habit) => habit.isAnchor);
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
