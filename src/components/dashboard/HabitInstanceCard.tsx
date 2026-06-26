import { useState } from 'react';
import { Card } from '../ui/Card';
import { useDayPlan } from '../../hooks/useDayPlan';
import { useTodoistActions, useTodoistData } from '../../hooks/useTodoist';
import { useHabitReschedule } from '../../hooks/useHabitReschedule';
import { useToggleHabitInstance } from '../../hooks/useToggleHabitInstance';
import { useCompleteHabitInstance } from '../../hooks/useCompleteHabitInstance';
import { compareHabitInstancesByTime, habitKindOf, isHabitInstanceMissed } from '../../lib/habits';
import {
    buildEngagementLog,
    formatLocalTimeOfDay,
} from '../../lib/engagementLog';
import { computeReentryStats } from '../../lib/engagementHistory';
import { openSegment, totalEngagedSeconds } from '../../lib/engagement';
import { EngagementTimer } from './EngagementTimer';
import { HabitTimeEditor } from './HabitTimeEditor';
import type { TodaysHabitInstance } from '../../types';

const SECTION_HEADING = 'text-sm font-semibold text-text-light uppercase tracking-wider';

/**
 * v6.3: dashboard card surfacing today's **'habit'-kind** instances (v6.7: micro-gaps moved to
 * their own {@link MicroGapCard}). Habits live independent of sessions — each row has its own
 * Start/Stop/Complete/Skip/Reschedule controls. Timed habits sort first ("Scheduled"); untimed
 * habits cluster under "Anytime".
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
    const handleStartStop = useToggleHabitInstance();
    const completeInstance = useCompleteHabitInstance();

    const habitById = new Map(life.habits.map((h) => [h.id, h]));
    const now = new Date(); // v6.8: for the derived "missed" presentation (past-window strict habits)
    // v6.7: this card is 'habit'-kind only; micro-gaps render in MicroGapCard.
    const instances = plan.todaysHabits
        .filter((i) => habitKindOf(life, i) === 'habit')
        .sort(compareHabitInstancesByTime);
    if (instances.length === 0) return null;

    const handleComplete = completeInstance;

    const handleSkip = async (instance: TodaysHabitInstance) => {
        const nowISO = new Date().toISOString();
        if (!instance.todoistTaskId) {
            dispatch({ type: 'SKIP_HABIT_INSTANCE', instanceId: instance.id, now: nowISO });
            return;
        }
        // v6.4: Todoist has no native "skip" semantic — completion looks the same as a
        // done. Post a comment first so the skip is traceable in Todoist's own task
        // history, then complete the occurrence so its recurrence engine advances.
        // The Orchestrate-side `'skipped'` status preserves the user-facing distinction.
        await createTaskComment(instance.todoistTaskId, `Skipped via Orchestrate on ${plan.date}`);
        const completed = await completeTask(instance.todoistTaskId);
        if (!completed) return;
        dispatch({ type: 'SKIP_HABIT_INSTANCE', instanceId: instance.id, now: nowISO });
    };

    const renderRow = (i: TodaysHabitInstance) => {
        const habit = habitById.get(i.habitId);
        const isEngaged = i.status === 'engaged';
        const isCompleted = i.status === 'completed';
        const isSkipped = i.status === 'skipped';
        const isTerminal = isCompleted || isSkipped;
        // v6.8: a strict, timed, past-window planned habit reads as "missed" — greyed, but still
        // fully actionable (Complete/Skip/Start/Reschedule stay available below).
        const isMissed = isHabitInstanceMissed(habit, i, now);
        const isRescheduling = reschedule.reschedulingId === i.id;
        const liveSegment = isEngaged ? openSegment(i.segments) : undefined;
        const icon = isCompleted ? '🎉' : isMissed ? '⏰' : '🔁';
        return (
            <li
                key={i.id}
                className={`px-1.5 py-1 rounded transition-colors ${isEngaged ? 'bg-amber-50/50 dark:bg-amber-900/10'
                        : isTerminal || isMissed ? 'opacity-60'
                            : ''
                    }`}
            >
                {/* Line 1: icon, title, pills, live timer */}
                <div className="flex items-center gap-1.5">
                    <span className="text-xs flex-shrink-0" aria-hidden>{icon}</span>
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
                    {isMissed && (
                        <span className="text-[10px] px-1 py-px rounded-full bg-surface-dark text-text-light/70 flex-shrink-0">
                            missed
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
    };

    // v6.7: within 'habit' kind, split timed ("Scheduled") from untimed ("Anytime"). Sub-headers
    // only appear when both are present — single-bucket days stay flat.
    const scheduled = instances.filter((i) => Boolean(i.targetTime));
    const anytime = instances.filter((i) => !i.targetTime);
    const showGroups = scheduled.length > 0 && anytime.length > 0;

    const GROUP_HEADING = 'text-[10px] uppercase tracking-wider text-text-light/70 px-1.5 mb-0.5';

    return (
        <section className="space-y-2">
            <h3 className={SECTION_HEADING}>Today&apos;s Habits</h3>
            <Card className="py-2 px-2">
                <div className="max-h-[24rem] overflow-y-auto scrollbar-subtle -mr-1 pr-1">
                    {showGroups ? (
                        <div className="space-y-2">
                            <div>
                                <p className={GROUP_HEADING}>Scheduled</p>
                                <ul className="space-y-0.5">{scheduled.map(renderRow)}</ul>
                            </div>
                            <div>
                                <p className={GROUP_HEADING}>Anytime</p>
                                <ul className="space-y-0.5">{anytime.map(renderRow)}</ul>
                            </div>
                        </div>
                    ) : (
                        <ul className="space-y-0.5">{instances.map(renderRow)}</ul>
                    )}
                </div>
            </Card>
        </section>
    );
}

/**
 * v6.7: dashboard card surfacing today's **'micro-gap'-kind** instances — light, repeatable
 * fillers pulled opportunistically. Unlike habits these are NOT terminal: ▶ Start / ■ Stop logs a
 * rep (an engagement segment) and the row stays available all day. No Todoist, no complete/skip/
 * reschedule. A rep counter + accumulated time render once the user has engaged it at least once.
 * Segments still flow into the Engagement Log. Hidden when empty.
 */
export function MicroGapCard() {
    const { plan, life } = useDayPlan();
    const toggle = useToggleHabitInstance();

    const instances = plan.todaysHabits.filter((i) => habitKindOf(life, i) === 'micro-gap');
    if (instances.length === 0) return null;

    const habitById = new Map(life.habits.map((h) => [h.id, h]));

    return (
        <section className="space-y-2">
            <h3 className={SECTION_HEADING}>Micro-gaps</h3>
            <Card className="py-2 px-2">
                <div className="max-h-[24rem] overflow-y-auto scrollbar-subtle -mr-1 pr-1">
                    <ul className="space-y-0.5">
                        {instances.map((i) => {
                            const habit = habitById.get(i.habitId);
                            const isEngaged = i.status === 'engaged';
                            const liveSegment = isEngaged ? openSegment(i.segments) : undefined;
                            const reps = (i.segments ?? []).length;
                            // Sum completed reps only (pass 0 so any open segment contributes 0 — the
                            // in-progress one is shown by the live timer, and `Date.now()` is impure in render).
                            const totalMin = Math.floor(totalEngagedSeconds(i.segments, 0) / 60);
                            return (
                                <li
                                    key={i.id}
                                    className={`px-1.5 py-1 rounded transition-colors ${isEngaged ? 'bg-amber-50/50 dark:bg-amber-900/10' : ''}`}
                                >
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-xs flex-shrink-0" aria-hidden>✦</span>
                                        <span className="flex-1 min-w-0 text-xs truncate" title={i.titleSnapshot}>
                                            {i.titleSnapshot}
                                            {habit?.minimumViable && (
                                                <span className="ml-1.5 text-[10px] text-text-light/70">· {habit.minimumViable}</span>
                                            )}
                                        </span>
                                        {reps > 0 && (
                                            <span className="text-[10px] px-1 py-px rounded-full bg-surface-dark text-text-light tabular-nums flex-shrink-0">
                                                {reps}× · {totalMin}m
                                            </span>
                                        )}
                                        {liveSegment && (
                                            <span className="text-[10px] px-1 py-px rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 flex-shrink-0 inline-flex items-center gap-1">
                                                <span className="w-1 h-1 rounded-full bg-amber-500 animate-pulse" aria-hidden />
                                                <EngagementTimer segment={liveSegment} />
                                            </span>
                                        )}
                                        <button
                                            onClick={() => toggle(i)}
                                            className={`w-5 h-5 flex items-center justify-center rounded text-[10px] cursor-pointer transition-colors flex-shrink-0 ${isEngaged ? 'bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-300' : 'text-text-light hover:bg-surface-dark hover:text-accent'}`}
                                            title={isEngaged ? 'Stop' : 'Start'}
                                            aria-label={isEngaged ? 'Stop engagement timer' : 'Start a rep'}
                                        >
                                            {isEngaged ? '■' : '▶'}
                                        </button>
                                    </div>
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
    const { plan, life, dispatch } = useDayPlan();
    const { taskMap } = useTodoistData();
    const [open, setOpen] = useState(true);

    const rows = buildEngagementLog(plan, taskMap);
    // v7.4 Phase 2: re-entry metric over the durable archive (problem-statement §15 Principle 5).
    const reentry = computeReentryStats(life.engagementHistory, { windowDays: 7 });
    if (rows.length === 0) return null;

    const deleteRow = (row: (typeof rows)[number]) => {
        if (row.entryType === 'reschedule') {
            dispatch({ type: 'DELETE_HABIT_RESCHEDULE_ENTRY', instanceId: row.sourceId, rescheduleAt: row.at });
        } else if (row.kind === 'habit') {
            dispatch({ type: 'DELETE_HABIT_ENGAGEMENT_SEGMENT', instanceId: row.sourceId, segmentStartedAt: row.segment.startedAt });
        } else {
            dispatch({ type: 'DELETE_TASK_ENGAGEMENT_SEGMENT', todoistId: row.sourceId, segmentStartedAt: row.segment.startedAt });
        }
    };

    return (
        <section className="space-y-2">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="flex items-center gap-2 text-sm font-semibold text-text-light uppercase tracking-wider hover:text-accent transition-colors cursor-pointer"
                aria-expanded={open}
            >
                <svg
                    className={`w-3 h-3 transition-transform ${open ? 'rotate-90' : ''}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
                Engagement Log
            </button>
            {reentry.resumeCount > 0 && (
                <p className="text-[11px] text-text-light tabular-nums">
                    Re-entry · ~{reentry.medianGapMinutes}m to resume · {reentry.resumeCount} {reentry.resumeCount === 1 ? 'resume' : 'resumes'} (7d)
                </p>
            )}
            {open && <Card className="py-2 px-2">
                <div className="max-h-[24rem] overflow-y-auto scrollbar-subtle -mr-1 pr-1">
                    <ul className="space-y-0.5">
                        {rows.map((row) => {
                            if (row.entryType === 'reschedule') {
                                const at = formatLocalTimeOfDay(row.at);
                                const from = row.fromTime ?? 'anytime';
                                const to = row.toTime ?? 'anytime';
                                return (
                                    <li key={row.key} className="group flex items-center gap-1.5 px-1.5 py-1 rounded text-xs hover:bg-surface-dark/50 transition-colors">
                                        <span className="tabular-nums text-text-light flex-shrink-0">{at}</span>
                                        <span aria-hidden>⤴</span>
                                        <span className="flex-1 min-w-0 truncate" title={row.title}>{row.title}</span>
                                        <span className="text-[10px] px-1 py-px rounded-full bg-surface-dark text-text-light tabular-nums flex-shrink-0">
                                            {from} → {to}
                                        </span>
                                        <button
                                            onClick={() => deleteRow(row)}
                                            className="w-4 h-4 flex items-center justify-center rounded text-[10px] text-text-light/40 hover:text-red-400 hover:bg-surface-dark transition-colors cursor-pointer opacity-0 group-hover:opacity-100 flex-shrink-0"
                                            title="Delete entry"
                                            aria-label="Delete reschedule entry"
                                        >
                                            ✕
                                        </button>
                                    </li>
                                );
                            }
                            const start = formatLocalTimeOfDay(row.segment.startedAt);
                            const end = row.segment.endedAt ? formatLocalTimeOfDay(row.segment.endedAt) : null;
                            const live = !row.segment.endedAt;
                            return (
                                <li
                                    key={row.key}
                                    className={`group flex items-center gap-1.5 px-1.5 py-1 rounded text-xs transition-colors ${live ? 'bg-amber-50/50 dark:bg-amber-900/10' : 'hover:bg-surface-dark/50'}`}
                                >
                                    <span className="tabular-nums text-text-light flex-shrink-0">
                                        {start}{end ? ` → ${end}` : ' → …'}
                                    </span>
                                    <span aria-hidden>{row.kind === 'habit' ? '🔁' : '📝'}</span>
                                    <span className="flex-1 min-w-0 truncate" title={row.title}>{row.title}</span>
                                    <span className={`text-[10px] px-1 py-px rounded-full flex-shrink-0 inline-flex items-center gap-1 ${live ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' : 'bg-surface-dark text-text-light'}`}>
                                        {live && <span className="w-1 h-1 rounded-full bg-amber-500 animate-pulse" aria-hidden />}
                                        <EngagementTimer segment={row.segment} />
                                    </span>
                                    {!live && (
                                        <button
                                            onClick={() => deleteRow(row)}
                                            className="w-4 h-4 flex items-center justify-center rounded text-[10px] text-text-light/40 hover:text-red-400 hover:bg-surface-dark transition-colors cursor-pointer opacity-0 group-hover:opacity-100 flex-shrink-0"
                                            title="Delete entry"
                                            aria-label="Delete engagement entry"
                                        >
                                            ✕
                                        </button>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                </div>
            </Card>}
        </section>
    );
}
