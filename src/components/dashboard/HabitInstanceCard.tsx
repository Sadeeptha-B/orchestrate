import { useState } from 'react';
import { Card } from '../ui/Card';
import { useDayPlan } from '../../hooks/useDayPlan';
import { useTodoistActions } from '../../hooks/useTodoist';
import { timeToMinutes } from '../../lib/time';
import type { TodaysHabitInstance } from '../../types';

/**
 * v6.3: dashboard card surfacing today's stabilizer habit instances. Replaces the old
 * orphan-habit-task rendering inside session cards. Habits live independent of sessions —
 * each row has its own Start/Stop/Complete/Skip/Reschedule controls.
 *
 *  - planned    → [▶ Start] [✓ Complete] [⤴ Reschedule] [✕ Skip]
 *  - engaged    → [■ Stop]  [✓ Complete] [⤴ Reschedule] [✕ Skip]  + "(Nm engaged)" label
 *  - completed / unfinished / skipped → muted footer entry
 */
export function HabitInstanceCard() {
    const { plan, life, dispatch } = useDayPlan();
    const { completeTask } = useTodoistActions();
    const [reschedulingId, setReschedulingId] = useState<string | null>(null);
    const [reschedTime, setReschedTime] = useState<string>('');

    const habitById = new Map(life.habits.map((h) => [h.id, h]));

    if (plan.todaysHabits.length === 0) return null;

    // Sort: timed first (by targetTime), then untimed. Single list — no separate "today so far" log.
    const sortByTime = (a: TodaysHabitInstance, b: TodaysHabitInstance) => {
        if (a.targetTime && b.targetTime) return timeToMinutes(a.targetTime) - timeToMinutes(b.targetTime);
        if (a.targetTime) return -1;
        if (b.targetTime) return 1;
        return 0;
    };
    const instances = [...plan.todaysHabits].sort(sortByTime);

    const handleStartStop = (instance: TodaysHabitInstance) => {
        const nowISO = new Date().toISOString();
        dispatch({
            type: instance.status === 'engaged' ? 'STOP_HABIT_INSTANCE' : 'START_HABIT_INSTANCE',
            instanceId: instance.id,
            now: nowISO,
        });
    };

    const handleComplete = (instance: TodaysHabitInstance) => {
        const nowISO = new Date().toISOString();
        dispatch({ type: 'COMPLETE_HABIT_INSTANCE', instanceId: instance.id, now: nowISO });
        // Push completion to the recurring Todoist task; failures don't block local state.
        completeTask(instance.todoistTaskId).catch((err) => {
            console.warn(`[v6.3] failed to complete habit Todoist task ${instance.todoistTaskId}:`, err);
        });
    };

    const handleSkip = (instance: TodaysHabitInstance) => {
        dispatch({ type: 'SKIP_HABIT_INSTANCE', instanceId: instance.id });
    };

    const openReschedule = (instance: TodaysHabitInstance) => {
        setReschedulingId(instance.id);
        setReschedTime(instance.targetTime ?? '');
    };

    const saveReschedule = (instance: TodaysHabitInstance) => {
        const nowISO = new Date().toISOString();
        dispatch({
            type: 'RESCHEDULE_HABIT_INSTANCE',
            instanceId: instance.id,
            newTargetTime: reschedTime || undefined,
            now: nowISO,
        });
        setReschedulingId(null);
        setReschedTime('');
    };

    return (
        <Card>
            <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold flex items-center gap-2">
                    <span aria-hidden>🔁</span>
                    Today&apos;s habits
                    <span className="text-xs font-normal text-text-light">({instances.length})</span>
                </h4>
            </div>

            <ul className="space-y-2">
                {instances.map((i) => {
                    const habit = habitById.get(i.habitId);
                    const isEngaged = i.status === 'engaged';
                    const isCompleted = i.status === 'completed';
                    const isSkipped = i.status === 'skipped';
                    const isTerminal = isCompleted || isSkipped || i.status === 'unfinished';
                    const engagementMinutes = i.engagement?.totalMinutes ?? 0;
                    const isRescheduling = reschedulingId === i.id;
                    return (
                        <li
                            key={i.id}
                            className={`flex items-center gap-2 px-2 py-1.5 rounded transition-colors ${
                                isEngaged ? 'bg-amber-50/50 dark:bg-amber-900/10'
                                : isTerminal ? 'opacity-60'
                                : ''
                            }`}
                        >
                            <span className="text-sm" aria-hidden>{isCompleted ? '🎉' : '🔁'}</span>
                            <span className={`flex-1 text-sm truncate ${isCompleted ? 'line-through text-text-light' : ''}`} title={i.titleSnapshot}>
                                {i.titleSnapshot}
                                {!isTerminal && habit?.minimumViable && (
                                    <span className="ml-2 text-[11px] text-text-light/70">· {habit.minimumViable}</span>
                                )}
                            </span>
                            {i.targetTime ? (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent/10 text-accent tabular-nums flex-shrink-0">
                                    {i.targetTime}
                                </span>
                            ) : (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-dark text-text-light flex-shrink-0">
                                    Anytime
                                </span>
                            )}
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-dark text-text-light tabular-nums flex-shrink-0">
                                {i.durationMinutes}m
                            </span>
                            {isEngaged && engagementMinutes > 0 && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 tabular-nums flex-shrink-0">
                                    {engagementMinutes}m engaged
                                </span>
                            )}
                            {isSkipped && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-dark text-text-light/70 capitalize flex-shrink-0">
                                    skipped
                                </span>
                            )}

                            {!isTerminal && (
                                isRescheduling ? (
                                    <span className="flex items-center gap-1 flex-shrink-0">
                                        <input
                                            type="time"
                                            value={reschedTime}
                                            onChange={(e) => setReschedTime(e.target.value)}
                                            className="px-1 py-0.5 text-xs rounded border border-border bg-card"
                                        />
                                        <button
                                            onClick={() => saveReschedule(i)}
                                            className="px-2 py-0.5 text-[10px] rounded bg-accent text-white hover:bg-accent/80 cursor-pointer"
                                        >
                                            Save
                                        </button>
                                        <button
                                            onClick={() => { setReschedulingId(null); setReschedTime(''); }}
                                            className="px-2 py-0.5 text-[10px] rounded text-text-light hover:bg-surface-dark cursor-pointer"
                                        >
                                            Cancel
                                        </button>
                                    </span>
                                ) : (
                                    <span className="flex items-center gap-0.5 flex-shrink-0">
                                        <button
                                            onClick={() => handleStartStop(i)}
                                            className={`w-6 h-6 flex items-center justify-center rounded text-xs cursor-pointer transition-colors ${isEngaged ? 'bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-300' : 'text-text-light hover:bg-surface-dark hover:text-accent'}`}
                                            title={isEngaged ? 'Stop' : 'Start'}
                                            aria-label={isEngaged ? 'Stop engagement timer' : 'Start engagement timer'}
                                        >
                                            {isEngaged ? '■' : '▶'}
                                        </button>
                                        <button
                                            onClick={() => handleComplete(i)}
                                            className="w-6 h-6 flex items-center justify-center rounded text-text-light hover:bg-surface-dark hover:text-success transition-colors cursor-pointer"
                                            title="Mark complete"
                                            aria-label="Complete habit"
                                        >
                                            ✓
                                        </button>
                                        <button
                                            onClick={() => openReschedule(i)}
                                            className="w-6 h-6 flex items-center justify-center rounded text-text-light hover:bg-surface-dark hover:text-accent transition-colors cursor-pointer"
                                            title="Reschedule"
                                            aria-label="Reschedule"
                                        >
                                            ⤴
                                        </button>
                                        <button
                                            onClick={() => handleSkip(i)}
                                            className="w-6 h-6 flex items-center justify-center rounded text-text-light hover:bg-surface-dark hover:text-red-400 transition-colors cursor-pointer"
                                            title="Skip for today"
                                            aria-label="Skip"
                                        >
                                            ✕
                                        </button>
                                    </span>
                                )
                            )}
                        </li>
                    );
                })}
            </ul>
        </Card>
    );
}
