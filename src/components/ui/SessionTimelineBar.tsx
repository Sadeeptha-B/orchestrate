import { useMemo } from 'react';
import { timeToMinutes } from '../../lib/time';
import type { LinkedTask, SessionSlot } from '../../types';

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
    /** All linked tasks (used to resolve type, habit flag, etc.). */
    linkedTasks: LinkedTask[];
    /** Todoist task lookup: id → { content }. */
    taskMap: Map<string, { id: string; content: string }>;
    /** Interactive mode: ID of the currently selected session. */
    selectedSessionId?: string | null;
    /** Interactive mode: callback when a session block is clicked. */
    onSelectSession?: (sessionId: string) => void;
    /** Dashboard mode: ID of the currently active session (shows pulse indicator). */
    currentSessionId?: string | null;
}

export function SessionTimelineBar({
    sessions,
    taskSessions,
    linkedTasks,
    taskMap,
    selectedSessionId,
    onSelectSession,
    currentSessionId,
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

    const getTaskTitle = (todoistId: string) => {
        const fromTodoist = taskMap.get(todoistId)?.content;
        if (fromTodoist) return fromTodoist;
        const lt = linkedTasks.find((t) => t.todoistId === todoistId);
        return lt?.titleSnapshot ?? todoistId;
    };

    const isInteractive = onSelectSession !== undefined;

    return (
        <div className="space-y-1">
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

            {/* Session blocks */}
            <div className="relative" style={{ minHeight: 80 }}>
                {sessions.map((session) => {
                    const { left, width } = slotPosition(session);
                    const isSelected = selectedSessionId === session.id;
                    const isCurrent = currentSessionId === session.id;
                    const assignedIds = taskSessions[session.id] ?? [];
                    const sessionMain = mainTasks.filter((lt) => assignedIds.includes(lt.todoistId));
                    const sessionBg = backgroundTasks.filter((lt) => assignedIds.includes(lt.todoistId));

                    const blockClasses = [
                        'absolute top-0 rounded-lg border p-2 text-left overflow-hidden transition-colors',
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
                            <div className="flex flex-wrap gap-1">
                                {sessionMain.map((lt) => (
                                    <span
                                        key={lt.todoistId}
                                        className="px-1.5 py-0.5 text-[9px] rounded-full bg-accent/15 text-accent leading-tight"
                                    >
                                        {getTaskTitle(lt.todoistId)}
                                    </span>
                                ))}
                                {sessionBg.map((lt) => (
                                    <span
                                        key={lt.todoistId}
                                        className="px-1.5 py-0.5 text-[9px] rounded-full bg-surface-dark text-text-light leading-tight"
                                    >
                                        {lt.isHabit && '🔄 '}{getTaskTitle(lt.todoistId)}
                                    </span>
                                ))}
                                {sessionMain.length === 0 && sessionBg.length === 0 && (
                                    <span className="text-[9px] text-text-light">Empty</span>
                                )}
                            </div>
                        </>
                    );

                    return isInteractive ? (
                        <button
                            key={session.id}
                            onClick={() => onSelectSession(session.id)}
                            className={blockClasses}
                            style={{ left: `${left}%`, width: `${width}%`, minHeight: 70 }}
                        >
                            {content}
                        </button>
                    ) : (
                        <div
                            key={session.id}
                            className={blockClasses}
                            style={{ left: `${left}%`, width: `${width}%`, minHeight: 70 }}
                        >
                            {content}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
