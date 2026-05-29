import { Card } from '../ui/Card';
import { useDayPlan } from '../../hooks/useDayPlan';
import { useTodoistActions } from '../../hooks/useTodoist';
import { useHabitReschedule } from '../../hooks/useHabitReschedule';
import { compareHabitInstancesByTime } from '../../lib/habits';
import { HabitTimeEditor } from './HabitTimeEditor';
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
    const { completeTask, createTaskComment } = useTodoistActions();
    const reschedule = useHabitReschedule();

    const habitById = new Map(life.habits.map((h) => [h.id, h]));

    if (plan.todaysHabits.length === 0) return null;

    // Sort: timed first (by targetTime), then untimed. Single list — no separate "today so far" log.
    const instances = [...plan.todaysHabits].sort(compareHabitInstancesByTime);

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
        // v6.4: log to console.error (in addition to the UI error surfaced by handleApiError)
        // so a habit failing to advance in Todoist leaves a debuggable trail.
        completeTask(instance.todoistTaskId).catch((err) => {
            console.error(`[habits] complete: Todoist task ${instance.todoistTaskId} failed:`, err);
        });
    };

    const handleSkip = (instance: TodaysHabitInstance) => {
        const nowISO = new Date().toISOString();
        dispatch({ type: 'SKIP_HABIT_INSTANCE', instanceId: instance.id, now: nowISO });
        // v6.4: Todoist has no native "skip" semantic — completion looks the same as a
        // done. Post a comment first so the skip is traceable in Todoist's own task
        // history, then complete the occurrence so its recurrence engine advances.
        // The Orchestrate-side `'skipped'` status preserves the user-facing distinction.
        createTaskComment(instance.todoistTaskId, `Skipped via Orchestrate on ${plan.date}`).catch((err) => {
            console.error(`[habits] skip: Todoist comment on ${instance.todoistTaskId} failed:`, err);
        });
        completeTask(instance.todoistTaskId).catch((err) => {
            console.error(`[habits] skip: Todoist completion on ${instance.todoistTaskId} failed:`, err);
        });
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
                    const isUnfinished = i.status === 'unfinished';
                    const isTerminal = isCompleted || isSkipped || isUnfinished;
                    const engagementMinutes = i.engagement?.totalMinutes ?? 0;
                    const isRescheduling = reschedule.reschedulingId === i.id;
                    // v6.3: unfinished predecessor of a clone-on-reschedule. Render as a
                    // historical row at its original time with the engagement chip — this
                    // is the durable in-day record of "I worked N minutes here earlier."
                    const showEngagementChip = (isEngaged || isUnfinished) && engagementMinutes > 0;
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
                            {showEngagementChip && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 tabular-nums flex-shrink-0">
                                    {engagementMinutes}m engaged
                                </span>
                            )}
                            {isUnfinished && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-dark text-text-light/70 flex-shrink-0">
                                    rescheduled
                                </span>
                            )}
                            {isSkipped && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-dark text-text-light/70 capitalize flex-shrink-0">
                                    skipped
                                </span>
                            )}

                            {!isTerminal && (
                                isRescheduling ? (
                                    <HabitTimeEditor
                                        value={reschedule.time}
                                        onChange={reschedule.setTime}
                                        onSave={() => reschedule.save(i)}
                                        onCancel={reschedule.cancel}
                                    />
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
                                            onClick={() => reschedule.open(i)}
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
