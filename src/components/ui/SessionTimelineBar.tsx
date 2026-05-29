import { useEffect, useMemo, useState } from 'react';
import { timeToMinutes } from '../../lib/time';
import { getTaskTitle } from '../../lib/tasks';
import type { LinkedTask, SessionSlot, TodaysHabitInstance } from '../../types';
import type { SessionCapacity } from '../../lib/capacity';
import { SessionCapacityBadge } from '../dashboard/SessionCapacityBadge';

function nowInMinutes(): number {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
}

/**
 * v6.3 / v6.4: status → pill styling for habit instances rendered in the lane / anytime cluster.
 * Combines border style (solid/dashed) + bg fill + text color to make each state
 * distinguishable at a glance, even when the pill is too narrow for the title.
 */
function habitPillClass(status: TodaysHabitInstance['status']): string {
    switch (status) {
        case 'engaged':
            return 'border-2 border-amber-400 bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 animate-pulse';
        case 'completed':
            return 'border border-success/40 bg-success/15 text-success-foreground/80 dark:text-success';
        case 'unfinished':
            return 'border border-dashed border-amber-400/60 bg-amber-50/50 text-amber-700/80 dark:bg-amber-900/15 dark:text-amber-300/70';
        case 'skipped':
            return 'border border-dashed border-text-light/40 bg-surface-dark/30 text-text-light/50 line-through';
        case 'planned':
        default:
            return 'border border-accent/40 bg-accent-subtle text-accent';
    }
}

/**
 * v6.4: state icon prefix. Distinct icons make the pill readable when the title is
 * truncated — the user can tell what state a habit is in from the icon alone.
 */
function habitPillIcon(status: TodaysHabitInstance['status']): string {
    switch (status) {
        case 'engaged':    return '⏵';   // playing
        case 'completed':  return '🎉';
        case 'unfinished': return '⤴';   // engaged-then-rescheduled
        case 'skipped':    return '⤼';
        case 'planned':
        default:           return '🔁';
    }
}

/** v6.4: human-readable status word for the pill tooltip. */
function habitStatusLabel(status: TodaysHabitInstance['status']): string {
    switch (status) {
        case 'engaged':    return 'engaged';
        case 'completed':  return 'completed';
        case 'unfinished': return 'rescheduled — engaged earlier';
        case 'skipped':    return 'skipped';
        case 'planned':
        default:           return 'planned';
    }
}

/**
 * v6.4: full tooltip line for a habit pill. Includes title, target time, planned duration,
 * status, and (when applicable) engaged minutes — covers the "I can't read the truncated
 * pill" case without growing the pill itself.
 */
function habitPillTooltip(i: TodaysHabitInstance): string {
    const parts = [i.titleSnapshot];
    if (i.targetTime) parts.push(i.targetTime);
    parts.push(`${i.durationMinutes}m`);
    parts.push(habitStatusLabel(i.status));
    const engaged = i.engagement?.totalMinutes ?? 0;
    if (engaged > 0) parts.push(`${engaged}m engaged`);
    return parts.join(' · ');
}

/** Format minutes since midnight to a short label like "6am", "2:30pm". */
function formatHour(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    const suffix = h >= 12 ? 'pm' : 'am';
    const display = h > 12 ? h - 12 : h === 0 ? 12 : h;
    return m === 0 ? `${display}${suffix}` : `${display}:${String(m).padStart(2, '0')}${suffix}`;
}

interface SessionTimelineBarProps {
    /** Session slots to display on the timeline. */
    sessions: SessionSlot[];
    /** Map of sessionId → assigned todoist task IDs. */
    taskSessions: Record<string, string[]>;
    /** All linked tasks (used to resolve type). */
    linkedTasks: LinkedTask[];
    /** Todoist task lookup: id → { content }. */
    taskMap: Map<string, { id: string; content: string }>;
    /** Interactive mode: ID of the currently selected session. */
    selectedSessionId?: string | null;
    /** Interactive mode: callback when a session block is clicked. */
    onSelectSession?: (sessionId: string) => void;
    /** Dashboard mode: ID of the currently active session (shows pulse indicator). */
    currentSessionId?: string | null;
    /** v6: optional per-session capacity data. When provided, each block shows a capacity badge. */
    capacities?: Record<string, SessionCapacity>;
    /** v6.3: stabilizer habit instances for today. Timed ones render in the habit lane above
     * the session blocks; untimed ones cluster as "Anytime today" chips above the timeline. */
    todaysHabits?: TodaysHabitInstance[];
}

export function SessionTimelineBar({
    sessions,
    taskSessions,
    linkedTasks,
    taskMap,
    selectedSessionId,
    onSelectSession,
    currentSessionId,
    capacities,
    todaysHabits,
}: SessionTimelineBarProps) {
    const mainTasks = useMemo(
        () => linkedTasks.filter((lt) => lt.type === 'main'),
        [linkedTasks],
    );
    const backgroundTasks = useMemo(
        () => linkedTasks.filter((lt) => lt.type === 'background'),
        [linkedTasks],
    );

    // Timeline bounds
    const { dayStart, dayEnd, hourMarks } = useMemo(() => {
        if (sessions.length === 0) return { dayStart: 0, dayEnd: 1, hourMarks: [] };
        const start = Math.min(...sessions.map((s) => timeToMinutes(s.startTime)));
        const end = Math.max(...sessions.map((s) => timeToMinutes(s.endTime)));
        const marks: number[] = [];
        const firstHour = Math.floor(start / 60) * 60;
        for (let m = firstHour; m <= end; m += 60) {
            if (m >= start) marks.push(m);
        }
        return { dayStart: start, dayEnd: end, hourMarks: marks };
    }, [sessions]);

    const totalMinutes = dayEnd - dayStart;

    const slotPosition = (slot: SessionSlot) => {
        const start = timeToMinutes(slot.startTime);
        const end = timeToMinutes(slot.endTime);
        return {
            left: ((start - dayStart) / totalMinutes) * 100,
            width: ((end - start) / totalMinutes) * 100,
        };
    };

    const titleFor = (todoistId: string) => getTaskTitle(todoistId, linkedTasks, taskMap);

    const isInteractive = onSelectSession !== undefined;

    // Current-time indicator — re-render once per minute
    const [now, setNow] = useState(nowInMinutes);
    useEffect(() => {
        const id = setInterval(() => setNow(nowInMinutes()), 60_000);
        return () => clearInterval(id);
    }, []);
    const nowPercent =
        sessions.length > 0 && now >= dayStart && now <= dayEnd
            ? ((now - dayStart) / totalMinutes) * 100
            : null;

    // v6.3: split habit instances into timed (placed on the lane) vs untimed (anytime cluster).
    // Terminal-state instances (completed/unfinished/skipped) still render but in a muted style.
    const timedHabits = (todaysHabits ?? []).filter((i) => Boolean(i.targetTime));
    const anytimeHabits = (todaysHabits ?? []).filter((i) => !i.targetTime);

    return (
        <div className="relative space-y-1 pt-5">
            {/* v6.3: "Anytime today" cluster — untimed habit instances surface above the time-axis. */}
            {anytimeHabits.length > 0 && (
                <div className="flex flex-wrap items-center gap-1 mb-1">
                    <span className="text-[9px] uppercase tracking-wider text-text-light/70 mr-1">Anytime</span>
                    {anytimeHabits.map((i) => {
                        const engaged = i.engagement?.totalMinutes ?? 0;
                        const showEngagedBadge =
                            (i.status === 'engaged' || i.status === 'unfinished') && engaged > 0;
                        return (
                            <span
                                key={i.id}
                                className={`px-1.5 py-0.5 text-[9px] rounded-full leading-tight inline-flex items-center gap-1 ${habitPillClass(i.status)}`}
                                title={habitPillTooltip(i)}
                            >
                                <span aria-hidden>{habitPillIcon(i.status)}</span>
                                <span className="truncate">{i.titleSnapshot}</span>
                                {showEngagedBadge && (
                                    <span className="px-1 rounded bg-amber-200/70 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200 tabular-nums">
                                        {engaged}m
                                    </span>
                                )}
                            </span>
                        );
                    })}
                </div>
            )}

            {/* Hour labels */}
            <div className="relative h-5">
                {hourMarks.map((m) => (
                    <span
                        key={m}
                        className="absolute text-[10px] text-text-light -translate-x-1/2"
                        style={{ left: `${((m - dayStart) / totalMinutes) * 100}%` }}
                    >
                        {formatHour(m)}
                    </span>
                ))}
            </div>

            {/* Timeline track */}
            <div className="relative h-2 rounded-full bg-border/40">
                {hourMarks.map((m) => (
                    <div
                        key={m}
                        className="absolute top-0 bottom-0 w-px bg-border"
                        style={{ left: `${((m - dayStart) / totalMinutes) * 100}%` }}
                    />
                ))}
            </div>

            {/* v6.3: Habit lane — timed instances positioned by targetTime, width by durationMinutes.
                v6.4: each pill carries a state-specific icon and (for engaged/unfinished) an inline
                "Nm" engagement badge. The icon + badge stay legible even when the title truncates
                in narrow pills, and the tooltip surfaces full title + duration + status + engaged
                minutes for the hover case. */}
            {timedHabits.length > 0 && totalMinutes > 0 && (
                <div className="relative h-7">
                    {timedHabits.map((i) => {
                        const startM = timeToMinutes(i.targetTime!);
                        const leftPct = ((startM - dayStart) / totalMinutes) * 100;
                        const widthPct = Math.max((i.durationMinutes / totalMinutes) * 100, 1.5);
                        if (leftPct < 0 || leftPct > 100) return null;
                        const engaged = i.engagement?.totalMinutes ?? 0;
                        const showEngagedBadge =
                            (i.status === 'engaged' || i.status === 'unfinished') && engaged > 0;
                        return (
                            <div
                                key={i.id}
                                className={`absolute top-0 px-1.5 py-0.5 text-[9px] rounded-full leading-tight inline-flex items-center gap-1 overflow-hidden ${habitPillClass(i.status)}`}
                                style={{ left: `${leftPct}%`, width: `${Math.min(widthPct, 100 - leftPct)}%` }}
                                title={habitPillTooltip(i)}
                            >
                                <span aria-hidden className="flex-shrink-0">{habitPillIcon(i.status)}</span>
                                <span className="truncate min-w-0">{i.titleSnapshot}</span>
                                {showEngagedBadge && (
                                    <span className="px-1 rounded bg-amber-200/70 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200 tabular-nums flex-shrink-0">
                                        {engaged}m
                                    </span>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Session blocks — single-cell grid so the cell auto-sizes to the tallest block.
                Each block layers in the same cell via grid-area, positioned horizontally by margin-left/width. */}
            <div className="grid items-start" style={{ gridTemplateColumns: '1fr', minHeight: 80 }}>
                {sessions.map((session) => {
                    const { left, width } = slotPosition(session);
                    const isSelected = selectedSessionId === session.id;
                    const isCurrent = currentSessionId === session.id;
                    const assignedIds = taskSessions[session.id] ?? [];
                    const sessionMain = mainTasks.filter((lt) => assignedIds.includes(lt.todoistId));
                    const sessionBg = backgroundTasks.filter((lt) => assignedIds.includes(lt.todoistId));

                    const blockClasses = [
                        'rounded-lg border p-2 text-left overflow-hidden transition-colors',
                        isSelected
                            ? 'border-accent bg-accent/5 ring-1 ring-accent/30'
                            : isCurrent
                                ? 'border-accent/40 bg-accent/5 ring-2 ring-accent/30'
                                : 'border-border bg-card',
                        isInteractive ? 'cursor-pointer hover:border-accent/40' : '',
                    ].join(' ');

                    const content = (
                        <>
                            <div className="flex items-baseline justify-between gap-1 mb-1.5">
                                <span className="text-[11px] font-medium truncate flex items-center gap-1.5">
                                    {isCurrent && (
                                        <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse flex-shrink-0" />
                                    )}
                                    {session.name}
                                </span>
                                <span className="text-[9px] text-text-light flex-shrink-0">
                                    {session.startTime}–{session.endTime}
                                </span>
                            </div>
                            {capacities?.[session.id] && (
                                <div className="mb-1.5">
                                    <SessionCapacityBadge capacity={capacities[session.id]} />
                                </div>
                            )}
                            <div className="flex flex-wrap gap-1">
                                {sessionMain.map((lt) => (
                                    <span
                                        key={lt.todoistId}
                                        className={`px-1.5 py-0.5 text-[9px] rounded-full leading-tight ${lt.completed ? 'bg-success/10 text-text-light line-through' : 'bg-accent/15 text-accent'}`}
                                    >
                                        {lt.completed && '🎉 '}{titleFor(lt.todoistId)}
                                    </span>
                                ))}
                                {sessionBg.map((lt) => (
                                    <span
                                        key={lt.todoistId}
                                        className={`px-1.5 py-0.5 text-[9px] rounded-full leading-tight ${lt.completed ? 'bg-success/10 text-text-light line-through' : 'bg-surface-dark text-text-light'}`}
                                    >
                                        {lt.completed && '🎉 '}{titleFor(lt.todoistId)}
                                    </span>
                                ))}
                                {sessionMain.length === 0 && sessionBg.length === 0 && (
                                    <span className="text-[9px] text-text-light">Empty</span>
                                )}
                            </div>
                        </>
                    );

                    const blockStyle = {
                        gridArea: '1 / 1',
                        marginLeft: `${left}%`,
                        width: `${width}%`,
                        minHeight: 70,
                    } as const;

                    return isInteractive ? (
                        <button
                            key={session.id}
                            onClick={() => onSelectSession(session.id)}
                            className={blockClasses}
                            style={blockStyle}
                        >
                            {content}
                        </button>
                    ) : (
                        <div
                            key={session.id}
                            className={blockClasses}
                            style={blockStyle}
                        >
                            {content}
                        </div>
                    );
                })}
            </div>

            {/* Current-time indicator: time label, dot, vertical line spanning the bar */}
            {nowPercent != null && (
                <div
                    className="absolute top-0 bottom-0 pointer-events-none z-10"
                    style={{ left: `${nowPercent}%` }}
                >
                    <span className="absolute top-0 -translate-x-1/2 text-[10px] font-semibold text-accent whitespace-nowrap leading-none">
                        {formatHour(now)}
                    </span>
                    <div className="absolute top-4 bottom-0 w-px bg-accent -translate-x-1/2" />
                    <div className="absolute top-4 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-accent" />
                </div>
            )}
        </div>
    );
}
