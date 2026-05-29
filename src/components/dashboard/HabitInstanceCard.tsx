import { useState } from 'react';
import { Card } from '../ui/Card';
import { useDayPlan } from '../../hooks/useDayPlan';
import { useTodoistActions, useTodoistData } from '../../hooks/useTodoist';
import { useHabitReschedule } from '../../hooks/useHabitReschedule';
import { compareHabitInstancesByTime } from '../../lib/habits';
import {
    buildEngagementLog,
    engagementStatusLabel,
    formatLocalTimeOfDay,
} from '../../lib/engagementLog';
import { HabitTimeEditor } from './HabitTimeEditor';
import type { TodaysHabitInstance } from '../../types';

type CardView = 'today' | 'log';

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
    const { taskMap } = useTodoistData();
    const reschedule = useHabitReschedule();
    const [view, setView] = useState<CardView>('today');

    const habitById = new Map(life.habits.map((h) => [h.id, h]));

    // v6.4: engagement-log row count — drives whether the "Log" tab is selectable.
    const engagementRows = buildEngagementLog(plan, taskMap);
    const hasEngagementRows = engagementRows.length > 0;

    if (plan.todaysHabits.length === 0 && !hasEngagementRows) return null;

    // Sort: timed first (by targetTime), then untimed.
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
            <div className="flex items-center justify-between mb-3 gap-3">
                <h4 className="text-sm font-semibold flex items-center gap-2">
                    <span aria-hidden>🔁</span>
                    {view === 'today' ? "Today's habits" : 'Engagement log'}
                    <span className="text-xs font-normal text-text-light">
                        ({view === 'today' ? instances.length : engagementRows.length})
                    </span>
                </h4>
                {/* v6.4: view toggle — today's actionable list vs. flat engagement log. */}
                <div className="flex rounded-md border border-border overflow-hidden text-[10px] flex-shrink-0">
                    <button
                        onClick={() => setView('today')}
                        className={`px-2 py-0.5 transition-colors cursor-pointer ${
                            view === 'today'
                                ? 'bg-accent text-white'
                                : 'text-text-light hover:bg-surface-dark'
                        }`}
                        aria-pressed={view === 'today'}
                    >
                        Today
                    </button>
                    <button
                        onClick={() => setView('log')}
                        disabled={!hasEngagementRows}
                        className={`px-2 py-0.5 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 ${
                            view === 'log'
                                ? 'bg-accent text-white'
                                : 'text-text-light hover:bg-surface-dark'
                        }`}
                        aria-pressed={view === 'log'}
                        title={hasEngagementRows ? 'View engagement log' : 'No engagement yet'}
                    >
                        Log
                    </button>
                </div>
            </div>

            {view === 'log' ? (
                <EngagementLogView rows={engagementRows} />
            ) : (
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
                    // v6.4: engaged instances always show the chip (even at 0m) so the
                    // user sees feedback the moment they press Start, not after a minute.
                    const showEngagementChip = isEngaged || (isUnfinished && engagementMinutes > 0);
                    const engagementChipLabel = engagementMinutes > 0
                        ? `${engagementMinutes}m engaged`
                        : 'engaged';
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
                                    {engagementChipLabel}
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
            )}
        </Card>
    );
}

/**
 * v6.4: scrollable engagement log — combines habit instances and intention tasks that
 * have an engagement record, sorted by `startedAt`. Container max-height keeps the
 * dashboard from growing unbounded as the day accumulates.
 */
function EngagementLogView({ rows }: { rows: ReturnType<typeof buildEngagementLog> }) {
    if (rows.length === 0) {
        return <p className="text-xs text-text-light px-2 py-3">No engagement yet today.</p>;
    }
    return (
        <ul className="space-y-1.5 max-h-72 overflow-y-auto scrollbar-subtle pr-1">
            {rows.map((row) => {
                const start = formatLocalTimeOfDay(row.startedAt);
                const end = row.endedAt ? formatLocalTimeOfDay(row.endedAt) : null;
                const isOngoing = !row.endedAt && row.status === 'engaged';
                const label = engagementStatusLabel(row);
                const statusTone =
                    row.status === 'engaged' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' :
                    row.status === 'completed' ? 'bg-success/10 text-success-foreground/80 dark:text-success' :
                    row.status === 'unfinished' ? 'bg-surface-dark text-text-light/70' :
                    row.status === 'skipped' ? 'bg-surface-dark text-text-light/50' :
                    'bg-surface-dark text-text-light';
                return (
                    <li
                        key={row.key}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm ${isOngoing ? 'bg-amber-50/50 dark:bg-amber-900/10' : ''}`}
                    >
                        <span className="text-[10px] tabular-nums text-text-light flex-shrink-0 min-w-[6.5rem]">
                            {start}{end ? ` → ${end}` : ' → …'}
                        </span>
                        <span className="text-sm" aria-hidden>{row.kind === 'habit' ? '🔁' : '📝'}</span>
                        <span className="flex-1 text-sm truncate" title={row.title}>
                            {row.title}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-dark text-text-light tabular-nums flex-shrink-0">
                            {row.totalMinutes}m
                        </span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 ${statusTone}`}>
                            {label}
                        </span>
                    </li>
                );
            })}
        </ul>
    );
}
