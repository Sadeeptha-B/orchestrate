import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useDayPlan } from '../../hooks/useDayPlan';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { habitMatchesDate } from '../../lib/habits';
import type { Habit, HabitLogEntry, SavedDayPlan } from '../../types';

/**
 * v6 /life section: today's Light Pool roster + weekly cadence per light-coherent habit.
 *
 * Cadence is the count of completed `HabitLogEntry` entries (matching this habit) across
 * today's plan plus the last 7 days of saved history. Soft target: `recurrence.timesPerWeek`
 * when set; otherwise just shows the count.
 */
export function LightPoolSection() {
    const { plan, life, history } = useDayPlan();

    const lightHabits = useMemo(
        () => life.habits.filter((h) => h.active && h.kind === 'light-coherent'),
        [life.habits],
    );

    const cadenceByHabit = useMemo(
        () => computeWeeklyCadence(lightHabits, plan.habitLog, history),
        [lightHabits, plan.habitLog, history],
    );

    if (lightHabits.length === 0) {
        return (
            <Card>
                <h3 className="font-medium mb-2">Light pool</h3>
                <p className="text-sm text-text-light mb-3">
                    Small, resumable activities you can pull during micro-gaps — flashcards,
                    short reading, idea capture. They never enter the day's task plan; they
                    just get logged.
                </p>
                <Button size="sm">
                    <Link to="/habits">Create a light-coherent habit</Link>
                </Button>
            </Card>
        );
    }

    return (
        <Card>
            <div className="flex items-center justify-between mb-3">
                <h3 className="font-medium">Light pool</h3>
                <Link to="/habits" className="text-xs text-text-light hover:text-accent">
                    Manage
                </Link>
            </div>
            <p className="text-xs text-text-light mb-3">
                Today's roster and the weekly cadence per habit.
            </p>
            <ul className="space-y-2">
                {lightHabits.map((h) => {
                    const matchesToday = habitMatchesDate(h, plan.date);
                    const cadence = cadenceByHabit.get(h.id) ?? 0;
                    const target = h.recurrence.timesPerWeek;
                    return (
                        <li
                            key={h.id}
                            className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
                        >
                            <div className="min-w-0 flex-1">
                                <div className="text-sm truncate">
                                    {h.name}
                                    {!matchesToday && (
                                        <span className="ml-2 text-[10px] uppercase tracking-wider text-text-light">
                                            not today
                                        </span>
                                    )}
                                </div>
                                {h.minimumViable && (
                                    <div className="text-[11px] text-text-light truncate">
                                        {h.minimumViable}
                                    </div>
                                )}
                            </div>
                            <div className="text-xs text-text-light whitespace-nowrap">
                                {cadence}
                                {target ? ` / ${target}` : ''} this week
                            </div>
                        </li>
                    );
                })}
            </ul>
        </Card>
    );
}

function computeWeeklyCadence(
    lightHabits: Habit[],
    todayLog: HabitLogEntry[],
    history: SavedDayPlan[],
): Map<string, number> {
    const counts = new Map<string, number>(lightHabits.map((h) => [h.id, 0]));
    const sinceMs = Date.now() - 7 * 24 * 60 * 60 * 1000;

    const tally = (entries: HabitLogEntry[] | undefined) => {
        if (!entries) return;
        for (const e of entries) {
            if (!e.completedAt) continue;
            if (Date.parse(e.completedAt) < sinceMs) continue;
            if (counts.has(e.habitId)) counts.set(e.habitId, (counts.get(e.habitId) ?? 0) + 1);
        }
    };
    tally(todayLog);
    for (const h of history) tally(h.plan?.habitLog);
    return counts;
}
