import { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../ui/Card';
import { SessionTimelineBar } from '../ui/SessionTimelineBar';
import { SessionCapacityBadge } from './SessionCapacityBadge';
import { SessionCapacityBanner } from './SessionCapacityBanner';
import { useDayPlan } from '../../hooks/useDayPlan';
import { useCurrentSession } from '../../hooks/useCurrentSession';
import { useTodoistData, useTodoistActions, type TodoistTask } from '../../hooks/useTodoist';
import { addMinutesToTime, todayISO } from '../../lib/time';
import { computeSessionCapacity } from '../../lib/capacity';
import { buildLinkedTaskMap, getLinkedTasksByIds, unscheduledTasks } from '../../lib/tasks';
import { getMissedInstanceIds, habitKindOf } from '../../lib/habits';
import { useTaskPlacement, readTaskDragPayload, writeTaskDragPayload } from '../../hooks/useTaskPlacement';
import { useDayCalendarEvents } from '../../hooks/useDayCalendarEvents';
import { useGoogleCalendarData } from '../../hooks/useGoogleCalendar';
import { useSessionCalendarSync } from '../../hooks/useSessionCalendarSync';
import { EngagementTimer } from './EngagementTimer';
import { openSegment } from '../../lib/engagement';
import type { Intention, LinkedTask, SessionSlot } from '../../types';

/** Today's "HH:MM–HH:MM" (or "HH:MM") if the task is scheduled for today, else null. */
function getScheduledRange(task: TodoistTask | undefined): string | null {
    if (!task?.due?.date) return null;
    const todayStr = todayISO();
    if (!task.due.date.startsWith(todayStr) || !task.due.date.includes('T')) return null;
    const start = task.due.date.slice(11, 16);
    const durationMinutes = task.duration?.unit === 'minute' ? task.duration.amount : null;
    if (!durationMinutes) return start;
    return `${start}–${addMinutesToTime(start, durationMinutes)}`;
}

// ---- shared task row hooks (used by both CurrentSession and SessionTimeline) ----

function useTaskDrag() {
    const { plan, dispatch } = useDayPlan();
    const [dragId, setDragId] = useState<string | null>(null);
    const [dragOverId, setDragOverId] = useState<string | null>(null);
    const [dragSessionId, setDragSessionId] = useState<string | null>(null);

    const handleDragStart = useCallback((todoistId: string, sessionId: string) => {
        setDragId(todoistId);
        setDragSessionId(sessionId);
    }, []);

    const handleDragOver = useCallback(
        (e: React.DragEvent, todoistId: string) => {
            e.preventDefault();
            if (todoistId !== dragId) setDragOverId(todoistId);
        },
        [dragId],
    );

    const handleDrop = useCallback(
        (e: React.DragEvent, targetId: string, sessionId: string) => {
            e.preventDefault();
            if (!dragId || dragId === targetId || sessionId !== dragSessionId) {
                setDragId(null);
                setDragOverId(null);
                setDragSessionId(null);
                return;
            }
            const ids = plan.taskSessions[sessionId] ?? [];
            const fromIndex = ids.indexOf(dragId);
            const toIndex = ids.indexOf(targetId);
            if (fromIndex === -1 || toIndex === -1) return;
            const reordered = [...ids];
            reordered.splice(fromIndex, 1);
            reordered.splice(toIndex, 0, dragId);
            dispatch({ type: 'REORDER_SESSION_TASKS', sessionId, taskIds: reordered });
            setDragId(null);
            setDragOverId(null);
            setDragSessionId(null);
        },
        [dragId, dragSessionId, plan.taskSessions, dispatch],
    );

    const handleDragEnd = useCallback(() => {
        setDragId(null);
        setDragOverId(null);
        setDragSessionId(null);
    }, []);

    return { dragId, dragOverId, handleDragStart, handleDragOver, handleDrop, handleDragEnd };
}

// ---- task row renderer ----

interface TaskRowProps {
    linkedTask: LinkedTask;
    title: string;
    isStale: boolean;
    /** Session this row is rendered under, or `null` for the Anytime tray. */
    sessionId: string | null;
    /** Within-session reorder drag. Omitted in the Anytime tray (no order there). */
    drag?: ReturnType<typeof useTaskDrag>;
    scheduledRange: string | null;
}

function TaskRow({ linkedTask, title, isStale, sessionId, drag, scheduledRange }: TaskRowProps) {
    const { plan, settings, dispatch } = useDayPlan();
    const { moveTask } = useTaskPlacement();
    const navigate = useNavigate();
    const { completeTask, reopenTask } = useTodoistActions();
    const [menuOpen, setMenuOpen] = useState(false);
    // Within-session reorder is only available when rendered under a session with a drag controller.
    const canReorder = drag != null && sessionId != null;
    // In the Anytime tray (no session), the row is instead a cross-session drag source (→ a block).
    const isAnytimeSource = sessionId === null;
    const isDragging = canReorder && drag!.dragId === linkedTask.todoistId;
    const isDragOver = canReorder && drag!.dragOverId === linkedTask.todoistId && drag!.dragId !== linkedTask.todoistId;
    const isEngaged = linkedTask.status === 'engaged';
    const liveSegment = isEngaged ? openSegment(linkedTask.segments) : undefined;
    const strict = settings.focusStrict ?? true;

    const handleToggle = () => {
        dispatch({ type: 'TOGGLE_TASK_COMPLETE', todoistId: linkedTask.todoistId, titleSnapshot: title });
        if (linkedTask.completed) {
            reopenTask(linkedTask.todoistId);
        } else {
            completeTask(linkedTask.todoistId);
        }
    };

    const openFocus = () => navigate('/focus');
    const startInPlace = () =>
        dispatch({ type: 'START_TASK_ENGAGEMENT', todoistId: linkedTask.todoistId, now: new Date().toISOString() });

    // ▶ / ■. Behaviour follows the strict toggle.
    //  - engaged + strict → ■ opens Focus, where the required next-step note is captured before Stop.
    //  - engaged + relaxed → ■ stops in place: no final note is recorded, so routing to Focus (v7.5)
    //    was pointless friction (v7.6 fix). The segment closes right on the dashboard.
    //  - not engaged + strict → start + land directly in Focus (first-action capture happens there).
    //  - not engaged + relaxed → start the timer in place; the dashboard stays put.
    const handleEngagementToggle = () => {
        if (isEngaged) {
            if (strict) {
                openFocus();
            } else {
                dispatch({ type: 'STOP_TASK_ENGAGEMENT', todoistId: linkedTask.todoistId, now: new Date().toISOString() });
            }
            return;
        }
        startInPlace();
        if (strict) openFocus();
    };

    // ◎ : explicit Focus entry, shown in relaxed mode so the user can still choose the focused view.
    const handleOpenFocus = () => {
        if (!isEngaged) startInPlace();
        openFocus();
    };

    return (
        <li
            draggable={canReorder || isAnytimeSource}
            onDragStart={
                canReorder
                    ? () => drag!.handleDragStart(linkedTask.todoistId, sessionId!)
                    : isAnytimeSource
                        ? (e) => writeTaskDragPayload(e, { todoistId: linkedTask.todoistId, fromSessionId: null })
                        : undefined
            }
            onDragOver={canReorder ? (e) => drag!.handleDragOver(e, linkedTask.todoistId) : undefined}
            onDrop={canReorder ? (e) => drag!.handleDrop(e, linkedTask.todoistId, sessionId!) : undefined}
            onDragEnd={canReorder ? drag!.handleDragEnd : undefined}
            className={`flex items-center gap-2 px-2 py-1 rounded transition-all ${isAnytimeSource ? 'cursor-grab active:cursor-grabbing' : ''} ${isDragging
                ? 'opacity-40'
                : isDragOver
                    ? 'bg-accent-subtle/50 border-l-2 border-accent'
                    : ''
                } ${isStale ? 'opacity-50' : ''}`}
        >
            {canReorder && (
                <span
                    className="cursor-grab active:cursor-grabbing text-text-light/40 hover:text-text-light select-none flex-shrink-0"
                    title="Drag to reorder"
                >
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor">
                        <circle cx="3.5" cy="2" r="1.2" />
                        <circle cx="8.5" cy="2" r="1.2" />
                        <circle cx="3.5" cy="6" r="1.2" />
                        <circle cx="8.5" cy="6" r="1.2" />
                        <circle cx="3.5" cy="10" r="1.2" />
                        <circle cx="8.5" cy="10" r="1.2" />
                    </svg>
                </span>
            )}

            {!linkedTask.completed && (
                <button
                    onClick={handleEngagementToggle}
                    className={`w-4 h-4 rounded flex-shrink-0 flex items-center justify-center transition-colors cursor-pointer text-[9px] ${isEngaged
                        ? 'bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-300'
                        : 'text-text-light/60 hover:text-accent hover:bg-accent-subtle'
                        }`}
                    aria-label={isEngaged ? (strict ? 'Open Focus to stop' : 'Stop engagement timer') : strict ? 'Start in Focus Mode' : 'Start engagement timer'}
                    title={isEngaged ? (strict ? 'Open Focus to stop' : 'Stop (no note needed in relaxed)') : strict ? 'Start — lands in Focus Mode' : 'Start working (timer stays here)'}
                >
                    {isEngaged ? '■' : '▶'}
                </button>
            )}

            {/* v7.5: in relaxed mode ▶ keeps the timer on the dashboard, so this ◎ is the explicit way
                into the distraction-free Focus page. In strict mode ▶ already lands in Focus. */}
            {!linkedTask.completed && !isEngaged && !strict && (
                <button
                    onClick={handleOpenFocus}
                    className="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center transition-colors cursor-pointer text-[11px] leading-none text-text-light/60 hover:text-accent hover:bg-accent-subtle"
                    aria-label="Enter Focus Mode for this task"
                    title="Enter Focus Mode"
                >
                    ◎
                </button>
            )}

            <button
                onClick={handleToggle}
                className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors cursor-pointer ${linkedTask.completed
                    ? 'bg-success border-success text-white'
                    : 'border-border hover:border-accent'
                    }`}
                aria-label={`Mark task as ${linkedTask.completed ? 'incomplete' : 'complete'}`}
            >
                {linkedTask.completed && (
                    <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                )}
            </button>

            <span className="flex-1 min-w-0">
                {/* v7.6: the re-entry breadcrumb preview moved to the Focus picker — it's execution-level
                    metadata, surfaced where you choose what to work on, not on the planning dashboard. */}
                <span className={`block text-sm truncate ${linkedTask.completed ? 'line-through text-text-light' : ''} ${isStale ? 'italic' : ''}`}>
                    {linkedTask.completed && <span className="mr-1">🎉</span>}
                    {isStale && <span className="mr-1" title="Task not found in Todoist">⚠</span>}
                    {title}
                </span>
            </span>

            {liveSegment && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 flex-shrink-0 inline-flex items-center gap-1">
                    <span className="w-1 h-1 rounded-full bg-amber-500 animate-pulse" aria-hidden />
                    <EngagementTimer segment={liveSegment} />
                </span>
            )}

            {scheduledRange && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent/10 text-accent flex-shrink-0 tabular-nums">
                    {scheduledRange}
                </span>
            )}

            {linkedTask.estimatedMinutes != null && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-dark text-text-light flex-shrink-0 tabular-nums">
                    {linkedTask.estimatedMinutes}m
                </span>
            )}

            <span
                className={`ml-auto text-[10px] px-2 py-0.5 rounded-full flex-shrink-0 ${linkedTask.type === 'main'
                    ? 'bg-accent/10 text-accent'
                    : 'bg-surface-dark text-text-light'
                    }`}
            >
                {linkedTask.type}
            </span>

            {/* Move to… — keyboard/mobile path for re-placing a task (same dispatch as drag-and-drop). */}
            <div className="relative flex-shrink-0">
                <button
                    onClick={() => setMenuOpen((o) => !o)}
                    className="w-5 h-5 flex items-center justify-center rounded text-text-light/60 hover:text-accent hover:bg-accent-subtle transition-colors cursor-pointer leading-none"
                    aria-label="Move task to another session"
                    title="Move to…"
                >
                    ⋯
                </button>
                {menuOpen && (
                    <>
                        <div className="fixed inset-0 z-20" onClick={() => setMenuOpen(false)} />
                        <div className="absolute right-0 top-6 z-30 min-w-[10rem] py-1 rounded-lg border border-border bg-card shadow-lg">
                            <span className="block px-3 py-1 text-[10px] uppercase tracking-wider text-text-light">
                                Move to
                            </span>
                            {sessionId !== null && (
                                <button
                                    onClick={() => { moveTask(linkedTask.todoistId, sessionId, null); setMenuOpen(false); }}
                                    className="block w-full text-left px-3 py-1.5 text-sm text-text hover:bg-accent-subtle transition-colors cursor-pointer"
                                >
                                    Anytime
                                </button>
                            )}
                            {plan.sessionSlots
                                .filter((s) => s.id !== sessionId)
                                .map((s) => (
                                    <button
                                        key={s.id}
                                        onClick={() => { moveTask(linkedTask.todoistId, sessionId, s.id); setMenuOpen(false); }}
                                        className="block w-full text-left px-3 py-1.5 text-sm text-text hover:bg-accent-subtle transition-colors cursor-pointer"
                                    >
                                        {s.name} <span className="text-text-light tabular-nums">{s.startTime}</span>
                                    </button>
                                ))}
                            {plan.sessionSlots.filter((s) => s.id !== sessionId).length === 0 && sessionId !== null && (
                                <span className="block px-3 py-1.5 text-xs text-text-light">No other sessions</span>
                            )}
                        </div>
                    </>
                )}
            </div>
        </li>
    );
}

// ---- shared session card renderer ----

function SessionCard({
    session,
    isCurrent,
    isPast,
    taskIds,
    linkedTaskMap,
    taskMap,
    intentions,
    drag,
}: {
    session: SessionSlot;
    isCurrent: boolean;
    isPast: boolean;
    taskIds: string[];
    linkedTaskMap: Map<string, LinkedTask>;
    taskMap: Map<string, TodoistTask>;
    intentions: Map<string, Intention>;
    drag: ReturnType<typeof useTaskDrag>;
}) {
    const tasksInSession = getLinkedTasksByIds(taskIds, linkedTaskMap);

    // v6.3: group by intention. Habit-derived tasks no longer reach this surface
    // (stabilizers are TodaysHabitInstance now, rendered separately).
    const tasksByIntention = new Map<string, LinkedTask[]>();
    for (const lt of tasksInSession) {
        if (lt.intentionId === undefined) continue;
        const list = tasksByIntention.get(lt.intentionId) ?? [];
        list.push(lt);
        tasksByIntention.set(lt.intentionId, list);
    }

    // Background nudge banner for active session
    const bgNudges = isCurrent
        ? tasksInSession.filter((lt) => lt.type === 'background' && !lt.completed)
        : [];

    return (
        <Card
            className={`transition-all duration-300 ${isCurrent
                ? 'ring-2 ring-accent/30 border-accent/40'
                : isPast
                    ? 'opacity-50'
                    : ''
                }`}
        >
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    {isCurrent && (
                        <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
                    )}
                    <h4 className="font-medium text-sm">{session.name}</h4>
                </div>
                <span className="text-xs text-text-light">
                    {session.startTime}{' \u2013 '}{session.endTime}
                </span>
            </div>

            {/* Background nudge banner */}
            {bgNudges.length > 0 && (
                <div className="mb-3 px-3 py-2 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 text-xs text-amber-800 dark:text-amber-300">
                    Don't forget: {bgNudges.map((lt) => taskMap.get(lt.todoistId)?.content ?? lt.titleSnapshot ?? lt.todoistId).join(', ')}
                </div>
            )}

            {tasksByIntention.size > 0 ? (
                <div className="space-y-3">
                    {[...tasksByIntention.entries()].map(([intId, tasks]) => {
                        const groupTitle = intentions.get(intId)?.title ?? 'Unknown';
                        return (
                            <div key={intId}>
                                <span className="text-[10px] font-medium text-text-light uppercase tracking-wider px-2">
                                    {groupTitle}
                                </span>
                                <ul className="space-y-1.5 mt-1">
                                    {tasks.map((lt) => {
                                        const todoistTask = taskMap.get(lt.todoistId);
                                        const title = todoistTask?.content ?? lt.titleSnapshot ?? lt.todoistId;
                                        // Only truly stale if not in Todoist AND not completed (completed tasks are expected to be absent)
                                        const isStale = !todoistTask && !lt.completed;
                                        return (
                                            <TaskRow
                                                key={lt.todoistId}
                                                linkedTask={lt}
                                                title={title}
                                                isStale={isStale}
                                                sessionId={session.id}
                                                drag={drag}
                                                scheduledRange={getScheduledRange(todoistTask)}
                                            />
                                        );
                                    })}
                                </ul>
                            </div>
                        );
                    })}
                </div>
            ) : (
                <p className="text-xs text-text-light">No tasks scheduled</p>
            )}
        </Card>
    );
}

// ---- CurrentSession: carousel across all sessions, defaulting to active/upcoming ----

interface CurrentSessionProps {
    /** null = follow auto-selection; otherwise the session the user has pinned. */
    pinnedSessionId: string | null;
    onPinnedChange: (sessionId: string | null) => void;
}

export function CurrentSession({ pinnedSessionId, onPinnedChange }: CurrentSessionProps) {
    const { plan, settings } = useDayPlan();
    const { currentSession, remainingSessions } = useCurrentSession(plan.sessionSlots);
    const { taskMap } = useTodoistData();
    const drag = useTaskDrag();

    const sessions = plan.sessionSlots;

    const intentionMap = useMemo(
        () => new Map(plan.intentions.map((i) => [i.id, i])),
        [plan.intentions],
    );
    const linkedTaskMap = useMemo(
        () => buildLinkedTaskMap(plan.linkedTasks),
        [plan.linkedTasks],
    );

    // Auto-select: current session → first remaining → last session (end-of-day).
    const autoIndex = useMemo(() => {
        if (currentSession) return sessions.findIndex((s) => s.id === currentSession.id);
        if (remainingSessions.length > 0) return sessions.findIndex((s) => s.id === remainingSessions[0].id);
        return Math.max(0, sessions.length - 1);
    }, [currentSession, remainingSessions, sessions]);

    const pinnedIndex = useMemo(() => {
        if (pinnedSessionId === null) return null;
        const idx = sessions.findIndex((s) => s.id === pinnedSessionId);
        return idx === -1 ? null : idx;
    }, [pinnedSessionId, sessions]);
    const displayIndex = pinnedIndex ?? autoIndex;
    const displayedSession = sessions[displayIndex] ?? null;

    const isViewingCurrent = displayedSession?.id === currentSession?.id;
    const upcomingSession = !currentSession ? remainingSessions[0] : undefined;
    const isViewingUpcoming = displayedSession?.id === upcomingSession?.id;
    const isPast = displayedSession
        ? !remainingSessions.some((s) => s.id === displayedSession.id)
        : false;

    const activeCapacity = useMemo(() => {
        if (!isViewingCurrent || !currentSession) return null;
        return computeSessionCapacity(currentSession, plan.taskSessions, plan.linkedTasks, settings);
    }, [isViewingCurrent, currentSession, plan.taskSessions, plan.linkedTasks, settings]);

    if (sessions.length === 0) {
        return (
            <Card>
                <p className="text-sm text-text-light">No sessions planned.</p>
            </Card>
        );
    }

    const taskIds = displayedSession ? (plan.taskSessions[displayedSession.id] ?? []) : [];

    return (
        <div className="space-y-2">
            {/* Nav bar */}
            <div className="flex items-center justify-between gap-3 px-1">
                <span className="text-xs text-text-light">
                    {isViewingUpcoming && upcomingSession ? (
                        <>
                            No active session — next up at{' '}
                            <span className="tabular-nums text-text font-medium">
                                {upcomingSession.startTime}
                            </span>
                        </>
                    ) : isViewingCurrent ? (
                        <span className="text-accent font-medium">Now</span>
                    ) : isPast ? (
                        'Past session'
                    ) : (
                        'Upcoming session'
                    )}
                </span>
                <div className="flex items-center gap-1.5">
                    {pinnedIndex !== null && (
                        <button
                            onClick={() => onPinnedChange(null)}
                            className="text-[10px] px-2 py-0.5 rounded-full bg-accent/10 text-accent hover:bg-accent/20 transition-colors cursor-pointer"
                            title={currentSession ? 'Jump to current session' : 'Jump to upcoming session'}
                        >
                            ↩ {currentSession ? 'Current' : 'Upcoming'}
                        </button>
                    )}
                    <button
                        onClick={() => onPinnedChange(sessions[Math.max(0, displayIndex - 1)].id)}
                        disabled={displayIndex === 0}
                        className="w-6 h-6 flex items-center justify-center rounded text-text-light hover:text-text hover:bg-surface-dark transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer text-base leading-none"
                        aria-label="Previous session"
                    >
                        ‹
                    </button>
                    <span className="text-xs tabular-nums text-text-light min-w-[2.5rem] text-center">
                        {displayIndex + 1} / {sessions.length}
                    </span>
                    <button
                        onClick={() => onPinnedChange(sessions[Math.min(sessions.length - 1, displayIndex + 1)].id)}
                        disabled={displayIndex === sessions.length - 1}
                        className="w-6 h-6 flex items-center justify-center rounded text-text-light hover:text-text hover:bg-surface-dark transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer text-base leading-none"
                        aria-label="Next session"
                    >
                        ›
                    </button>
                </div>
            </div>

            {activeCapacity && (
                <div className="flex items-center justify-between gap-3 px-1">
                    <span className="text-xs text-text-light">Remaining capacity this session</span>
                    <SessionCapacityBadge capacity={activeCapacity} />
                </div>
            )}
            {activeCapacity?.status === 'over' && currentSession && (
                <SessionCapacityBanner
                    sessions={[currentSession]}
                    capacities={{ [currentSession.id]: activeCapacity }}
                />
            )}

            {displayedSession ? (
                <SessionCard
                    session={displayedSession}
                    isCurrent={isViewingCurrent}
                    isPast={isPast}
                    taskIds={taskIds}
                    linkedTaskMap={linkedTaskMap}
                    taskMap={taskMap}
                    intentions={intentionMap}
                    drag={drag}
                />
            ) : (
                <Card>
                    <p className="text-sm text-text-light">No sessions planned.</p>
                </Card>
            )}
        </div>
    );
}

// ---- SessionTimeline: shows all sessions + the habit lane ----

interface SessionTimelineProps {
    /** Session currently pinned in the carousel below — gets a selected ring here. */
    pinnedSessionId: string | null;
    /** Click a session block to pin it in the carousel. */
    onSelectSession: (sessionId: string) => void;
}

export function SessionTimeline({ pinnedSessionId, onSelectSession }: SessionTimelineProps) {
    const { plan, life, settings } = useDayPlan();
    const { currentSession } = useCurrentSession(plan.sessionSlots);
    const { taskMap } = useTodoistData();
    const { moveTask } = useTaskPlacement();
    const { events: externalEvents, refetch: refetchEvents } = useDayCalendarEvents(todayISO());
    const { isConnected: gcalConnected } = useGoogleCalendarData();
    const { sync } = useSessionCalendarSync();
    const handleSync = useCallback(async () => { await sync(); refetchEvents(); }, [sync, refetchEvents]);

    // v6.7: only 'habit'-kind instances belong on the timeline; micro-gaps live in their own panel.
    const timelineHabits = plan.todaysHabits.filter((i) => habitKindOf(life, i) === 'habit');
    // v6.8: grey out strict habits whose window has elapsed (still actionable, just "missed").
    const missedInstanceIds = getMissedInstanceIds(life, timelineHabits, new Date());

    return (
        <SessionTimelineBar
            dateISO={todayISO()}
            sessions={plan.sessionSlots}
            taskSessions={plan.taskSessions}
            linkedTasks={plan.linkedTasks}
            taskMap={taskMap}
            currentSessionId={currentSession?.id}
            selectedSessionId={pinnedSessionId}
            onSelectSession={onSelectSession}
            todaysHabits={timelineHabits}
            missedInstanceIds={missedInstanceIds}
            timelineStartMinutes={settings.timelineStartMinutes}
            timelineEndMinutes={settings.timelineEndMinutes}
            onMoveTask={moveTask}
            externalEvents={externalEvents}
            onSync={gcalConnected ? handleSync : undefined}
        />
    );
}

// ---- AnytimeTray: linked tasks committed for today but not placed in any session ----

export function AnytimeTray() {
    const { plan } = useDayPlan();
    const { taskMap } = useTodoistData();
    const { moveTask } = useTaskPlacement();
    const [isDragOver, setIsDragOver] = useState(false);

    const intentionMap = useMemo(
        () => new Map(plan.intentions.map((i) => [i.id, i])),
        [plan.intentions],
    );

    const tasks = useMemo(() => unscheduledTasks(plan.linkedTasks), [plan.linkedTasks]);

    // Group by intention, preserving plan intention order (mirrors SessionCard).
    const tasksByIntention = useMemo(() => {
        const map = new Map<string, LinkedTask[]>();
        for (const lt of tasks) {
            if (lt.intentionId === undefined) continue;
            const list = map.get(lt.intentionId) ?? [];
            list.push(lt);
            map.set(lt.intentionId, list);
        }
        return map;
    }, [tasks]);

    // Hidden when empty — unless something is being dragged over it (so it can become a drop target).
    if (tasks.length === 0 && !isDragOver) return null;

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(false);
        const payload = readTaskDragPayload(e);
        if (payload) moveTask(payload.todoistId, payload.fromSessionId, null);
    };

    return (
        <div className="space-y-2">
            <h3 className="text-sm font-semibold text-text-light uppercase tracking-wider">
                Anytime today
            </h3>
            <Card
                onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={handleDrop}
                className={isDragOver ? 'ring-2 ring-accent/40 border-accent/40' : ''}
            >
                <p className="text-[11px] text-text-light mb-2">
                    Committed for today, not tied to a session. Drag onto a session, or use ⋯ to place it.
                </p>
                {tasksByIntention.size > 0 ? (
                    <div className="space-y-3">
                        {[...tasksByIntention.entries()].map(([intId, intTasks]) => {
                            const groupTitle = intentionMap.get(intId)?.title ?? 'Unknown';
                            return (
                                <div key={intId}>
                                    <span className="text-[10px] font-medium text-text-light uppercase tracking-wider px-2">
                                        {groupTitle}
                                    </span>
                                    <ul className="space-y-1.5 mt-1">
                                        {intTasks.map((lt) => {
                                            const todoistTask = taskMap.get(lt.todoistId);
                                            const title = todoistTask?.content ?? lt.titleSnapshot ?? lt.todoistId;
                                            const isStale = !todoistTask && !lt.completed;
                                            return (
                                                <TaskRow
                                                    key={lt.todoistId}
                                                    linkedTask={lt}
                                                    title={title}
                                                    isStale={isStale}
                                                    sessionId={null}
                                                    scheduledRange={getScheduledRange(todoistTask)}
                                                />
                                            );
                                        })}
                                    </ul>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <p className="text-xs text-text-light">Drop a task here to set it aside for anytime today.</p>
                )}
            </Card>
        </div>
    );
}
