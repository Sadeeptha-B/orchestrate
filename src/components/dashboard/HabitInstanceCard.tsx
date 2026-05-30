import { Card } from '../ui/Card';
import { useDayPlan } from '../../hooks/useDayPlan';
import { useTodoistActions, useTodoistData } from '../../hooks/useTodoist';
import { useHabitReschedule } from '../../hooks/useHabitReschedule';
import { compareHabitInstancesByTime } from '../../lib/habits';
import {
    buildEngagementLog,
    formatLocalTimeOfDay,
} from '../../lib/engagementLog';
import { openSegment } from '../../lib/engagement';
import { EngagementTimer } from './EngagementTimer';
import { HabitTimeEditor } from './HabitTimeEditor';
import type { TodaysHabitInstance } from '../../types';

const SECTION_HEADING = 'text-sm font-semibold text-text-light uppercase tracking-wider';

/**
 * v6.3: dashboard card surfacing today's stabilizer habit instances. Replaces the old
 * orphan-habit-task rendering inside session cards. Habits live independent of sessions —
 * each row has its own Start/Stop/Complete/Skip/Reschedule controls.
 *
 *  - planned    → [▶ Start] [✓ Complete] [⤴ Reschedule] [✕ Skip]
 *  - engaged    → [■ Stop]  [✓ Complete] [⤴ Reschedule] [✕ Skip]  + live m:s segment timer
 *  - completed / skipped → muted row (controls hidden)
 *
 * v6.4: the engagement log lives in its own sibling card ({@link EngagementLogCard}) on the
 * right rail rather than behind a view toggle here — the two are independent surfaces.
 */
export function HabitInstanceCard() {
    const { plan, life, dispatch } = useDayPlan();
    const { completeTask, createTaskComment } = useTodoistActions();
    const reschedule = useHabitReschedule();

    if (plan.todaysHabits.length === 0) return null;

    const habitById = new Map(life.habits.map((h) => [h.id, h]));
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
        <section className="space-y-2">
            <h3 className={SECTION_HEADING}>Today&apos;s Habits</h3>
            <Card className="py-2 px-2">
                <div className="max-h-[24rem] overflow-y-auto scrollbar-subtle -mr-1 pr-1">
                    <ul className="space-y-0.5">
                        {instances.map((i) => {
                            const habit = habitById.get(i.habitId);
                            const isEngaged = i.status === 'engaged';
                            const isCompleted = i.status === 'completed';
                            const isSkipped = i.status === 'skipped';
                            const isTerminal = isCompleted || isSkipped;
                            const isRescheduling = reschedule.reschedulingId === i.id;
                            const liveSegment = isEngaged ? openSegment(i.segments) : undefined;
                            return (
                                <li
                                    key={i.id}
                                    className={`px-1.5 py-1 rounded transition-colors ${
                                        isEngaged ? 'bg-amber-50/50 dark:bg-amber-900/10'
                                        : isTerminal ? 'opacity-60'
                                        : ''
                                    }`}
                                >
                                    {/* Line 1: icon, title, pills, live timer */}
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-xs flex-shrink-0" aria-hidden>{isCompleted ? '🎉' : '🔁'}</span>
                                        <span className={`flex-1 min-w-0 text-xs truncate ${isCompleted ? 'line-through text-text-light' : ''}`} title={i.titleSnapshot}>
                                            {i.titleSnapshot}
                                            {!isTerminal && habit?.minimumViable && (
                                                <span className="ml-1.5 text-[10px] text-text-light/70">· {habit.minimumViable}</span>
                                            )}
                                        </span>
                                        {i.targetTime ? (
                                            <span className="text-[10px] px-1 py-px rounded-full bg-accent/10 text-accent tabular-nums flex-shrink-0">
                                                {i.targetTime}
                                            </span>
                                        ) : (
                                            <span className="text-[10px] px-1 py-px rounded-full bg-surface-dark text-text-light flex-shrink-0">
                                                Anytime
                                            </span>
                                        )}
                                        <span className="text-[10px] px-1 py-px rounded-full bg-surface-dark text-text-light tabular-nums flex-shrink-0">
                                            {i.durationMinutes}m
                                        </span>
                                        {liveSegment && (
                                            <span className="text-[10px] px-1 py-px rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 flex-shrink-0 inline-flex items-center gap-1">
                                                <span className="w-1 h-1 rounded-full bg-amber-500 animate-pulse" aria-hidden />
                                                <EngagementTimer segment={liveSegment} />
                                            </span>
                                        )}
                                        {isSkipped && (
                                            <span className="text-[10px] px-1 py-px rounded-full bg-surface-dark text-text-light/70 capitalize flex-shrink-0">
                                                skipped
                                            </span>
                                        )}
                                    </div>

                                    {/* Line 2: actions */}
                                    {!isTerminal && (
                                        <div className="flex items-center gap-0.5 mt-1 pl-5">
                                            {isRescheduling ? (
                                                <HabitTimeEditor
                                                    value={reschedule.time}
                                                    onChange={reschedule.setTime}
                                                    onSave={() => reschedule.save(i)}
                                                    onCancel={reschedule.cancel}
                                                />
                                            ) : (
                                                <>
                                                    <button
                                                        onClick={() => handleStartStop(i)}
                                                        className={`w-5 h-5 flex items-center justify-center rounded text-[10px] cursor-pointer transition-colors ${isEngaged ? 'bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-300' : 'text-text-light hover:bg-surface-dark hover:text-accent'}`}
                                                        title={isEngaged ? 'Stop' : 'Start'}
                                                        aria-label={isEngaged ? 'Stop engagement timer' : 'Start engagement timer'}
                                                    >
                                                        {isEngaged ? '■' : '▶'}
                                                    </button>
                                                    <button
                                                        onClick={() => handleComplete(i)}
                                                        className="w-5 h-5 flex items-center justify-center rounded text-[10px] text-text-light hover:bg-surface-dark hover:text-success transition-colors cursor-pointer"
                                                        title="Mark complete"
                                                        aria-label="Complete habit"
                                                    >
                                                        ✓
                                                    </button>
                                                    <button
                                                        onClick={() => reschedule.open(i)}
                                                        className="w-5 h-5 flex items-center justify-center rounded text-[10px] text-text-light hover:bg-surface-dark hover:text-accent transition-colors cursor-pointer"
                                                        title="Reschedule"
                                                        aria-label="Reschedule"
                                                    >
                                                        ⤴
                                                    </button>
                                                    <button
                                                        onClick={() => handleSkip(i)}
                                                        className="w-5 h-5 flex items-center justify-center rounded text-[10px] text-text-light hover:bg-surface-dark hover:text-red-400 transition-colors cursor-pointer"
                                                        title="Skip for today"
                                                        aria-label="Skip"
                                                    >
                                                        ✕
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                </div>
            </Card>
        </section>
    );
}

/**
 * v6.4: engagement log card — one row per engagement segment (individual Start→Stop) across
 * habits + tasks, plus reschedule events, sorted by time. A sibling of {@link HabitInstanceCard}
 * on the right rail; hidden entirely until there's something to show.
 */
export function EngagementLogCard() {
    const { plan } = useDayPlan();
    const { taskMap } = useTodoistData();

    const rows = buildEngagementLog(plan, taskMap);
    if (rows.length === 0) return null;

    return (
        <section className="space-y-2">
            <h3 className={SECTION_HEADING}>Engagement Log</h3>
            <Card>
                <div className="max-h-[24rem] overflow-y-auto scrollbar-subtle -mr-1 pr-1">
                    <ul className="space-y-1.5">
                        {rows.map((row) => {
                            if (row.entryType === 'reschedule') {
                                const at = formatLocalTimeOfDay(row.at);
                                const from = row.fromTime ?? 'anytime';
                                const to = row.toTime ?? 'anytime';
                                return (
                                    <li key={row.key} className="flex items-center gap-2 px-2 py-1.5 rounded text-sm">
                                        <span className="text-[10px] tabular-nums text-text-light flex-shrink-0 min-w-[6.5rem]">
                                            {at}
                                        </span>
                                        <span className="text-sm" aria-hidden>⤴</span>
                                        <span className="flex-1 text-sm truncate" title={row.title}>
                                            {row.title}
                                        </span>
                                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-dark text-text-light tabular-nums flex-shrink-0">
                                            {from} → {to}
                                        </span>
                                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-dark text-text-light/70 flex-shrink-0">
                                            Rescheduled
                                        </span>
                                    </li>
                                );
                            }
                            const start = formatLocalTimeOfDay(row.segment.startedAt);
                            const end = row.segment.endedAt ? formatLocalTimeOfDay(row.segment.endedAt) : null;
                            const live = !row.segment.endedAt;
                            return (
                                <li
                                    key={row.key}
                                    className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm ${live ? 'bg-amber-50/50 dark:bg-amber-900/10' : ''}`}
                                >
                                    <span className="text-[10px] tabular-nums text-text-light flex-shrink-0 min-w-[6.5rem]">
                                        {start}{end ? ` → ${end}` : ' → …'}
                                    </span>
                                    <span className="text-sm" aria-hidden>{row.kind === 'habit' ? '🔁' : '📝'}</span>
                                    <span className="flex-1 text-sm truncate" title={row.title}>
                                        {row.title}
                                    </span>
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 inline-flex items-center gap-1 ${live ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' : 'bg-surface-dark text-text-light'}`}>
                                        {live && <span className="w-1 h-1 rounded-full bg-amber-500 animate-pulse" aria-hidden />}
                                        <EngagementTimer segment={row.segment} />
                                    </span>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            </Card>
        </section>
    );
}
