import { useState, useCallback, useMemo } from 'react';
import { Card } from '../ui/Card';
import { SessionTimelineBar } from '../ui/SessionTimelineBar';
import { useDayPlan } from '../../context/DayPlanContext';
import { useCurrentSession } from '../../hooks/useCurrentSession';
import { useTodoist } from '../../hooks/useTodoist';
import type { LinkedTask, SessionSlot } from '../../types';

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
    sessionId: string;
    drag: ReturnType<typeof useTaskDrag>;
}

function TaskRow({ linkedTask, title, isStale, sessionId, drag }: TaskRowProps) {
    const { dispatch } = useDayPlan();
    const isDragging = drag.dragId === linkedTask.todoistId;
    const isDragOver = drag.dragOverId === linkedTask.todoistId && drag.dragId !== linkedTask.todoistId;

    return (
        <li
            draggable
            onDragStart={() => drag.handleDragStart(linkedTask.todoistId, sessionId)}
            onDragOver={(e) => drag.handleDragOver(e, linkedTask.todoistId)}
            onDrop={(e) => drag.handleDrop(e, linkedTask.todoistId, sessionId)}
            onDragEnd={drag.handleDragEnd}
            className={`flex items-center gap-2 px-2 py-1 rounded transition-all ${isDragging
                ? 'opacity-40'
                : isDragOver
                    ? 'bg-accent-subtle/50 border-l-2 border-accent'
                    : ''
                } ${isStale ? 'opacity-50' : ''}`}
        >
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

            <button
                onClick={() => dispatch({ type: 'TOGGLE_TASK_COMPLETE', todoistId: linkedTask.todoistId })}
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

            <span className={`flex-1 text-sm ${linkedTask.completed ? 'line-through text-text-light' : ''} ${isStale ? 'italic' : ''}`}>
                {isStale && <span className="mr-1" title="Task not found in Todoist">⚠</span>}
                {linkedTask.isHabit && <span className="mr-1">🔄</span>}
                {title}
            </span>

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
        </li>
    );
}

// ---- shared session card renderer ----

function SessionCard({
    session,
    isCurrent,
    isPast,
    taskIds,
    linkedTasks,
    taskMap,
    intentions,
    drag,
}: {
    session: SessionSlot;
    isCurrent: boolean;
    isPast: boolean;
    taskIds: string[];
    linkedTasks: LinkedTask[];
    taskMap: Map<string, { id: string; content: string }>;
    intentions: Map<string, { id: string; title: string }>;
    drag: ReturnType<typeof useTaskDrag>;
}) {
    const tasksInSession = taskIds
        .map((id) => linkedTasks.find((lt) => lt.todoistId === id))
        .filter((lt): lt is LinkedTask => lt !== undefined);

    // Group by intention
    const tasksByIntention = new Map<string, LinkedTask[]>();
    for (const lt of tasksInSession) {
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
                <div className="flex items-center gap-2">
                    {(() => {
                        const [sh, sm] = session.startTime.split(':').map(Number);
                        const [eh, em] = session.endTime.split(':').map(Number);
                        const totalMin = (eh * 60 + em) - (sh * 60 + sm);
                        const estTotal = tasksInSession.reduce((s, lt) => s + (lt.estimatedMinutes ?? 0), 0);
                        if (estTotal === 0) return null;
                        const h = Math.floor(estTotal / 60);
                        const m = estTotal % 60;
                        const fmt = h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
                        const over = estTotal > totalMin;
                        return (
                            <span className={`text-[10px] tabular-nums ${over ? 'text-amber-600 dark:text-amber-400' : 'text-text-light'}`}>
                                {fmt} est.{over && ' \u26a0'}
                            </span>
                        );
                    })()}
                    <span className="text-xs text-text-light">
                        {session.startTime} \u2013 {session.endTime}
                    </span>
                </div>
            </div>

            {/* Background nudge banner */}
            {bgNudges.length > 0 && (
                <div className="mb-3 px-3 py-2 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 text-xs text-amber-800 dark:text-amber-300">
                    Don't forget: {bgNudges.map((lt) => taskMap.get(lt.todoistId)?.content ?? lt.todoistId).join(', ')}
                </div>
            )}

            {tasksByIntention.size > 0 ? (
                <div className="space-y-3">
                    {[...tasksByIntention.entries()].map(([intId, tasks]) => (
                        <div key={intId}>
                            <span className="text-[10px] font-medium text-text-light uppercase tracking-wider px-2">
                                {intentions.get(intId)?.title ?? 'Unknown'}
                            </span>
                            <ul className="space-y-1.5 mt-1">
                                {tasks.map((lt) => {
                                    const todoistTask = taskMap.get(lt.todoistId);
                                    return (
                                        <TaskRow
                                            key={lt.todoistId}
                                            linkedTask={lt}
                                            title={todoistTask?.content ?? lt.todoistId}
                                            isStale={!todoistTask}
                                            sessionId={session.id}
                                            drag={drag}
                                        />
                                    );
                                })}
                            </ul>
                        </div>
                    ))}
                </div>
            ) : (
                <p className="text-xs text-text-light">No tasks scheduled</p>
            )}
        </Card>
    );
}

// ---- CurrentSession: shows only the active session ----

export function CurrentSession() {
    const { plan, settings } = useDayPlan();
    const { currentSession } = useCurrentSession(settings.sessionSlots);
    const { taskMap } = useTodoist();
    const drag = useTaskDrag();

    const intentionMap = useMemo(
        () => new Map(plan.intentions.map((i) => [i.id, i])),
        [plan.intentions],
    );

    if (!currentSession) {
        return (
            <Card>
                <p className="text-sm text-text-light">No active session right now.</p>
            </Card>
        );
    }

    const taskIds = plan.taskSessions[currentSession.id] ?? [];

    return (
        <SessionCard
            session={currentSession}
            isCurrent
            isPast={false}
            taskIds={taskIds}
            linkedTasks={plan.linkedTasks}
            taskMap={taskMap}
            intentions={intentionMap}
            drag={drag}
        />
    );
}

// ---- SessionTimeline: shows all sessions ----

export function SessionTimeline() {
    const { plan, settings } = useDayPlan();
    const { currentSession } = useCurrentSession(settings.sessionSlots);
    const { taskMap } = useTodoist();

    return (
        <SessionTimelineBar
            sessions={settings.sessionSlots}
            taskSessions={plan.taskSessions}
            linkedTasks={plan.linkedTasks}
            taskMap={taskMap}
            currentSessionId={currentSession?.id}
        />
    );
}

function isSessionPast(endTime: string): boolean {
    const now = new Date();
    const [h, m] = endTime.split(':').map(Number);
    return now.getHours() * 60 + now.getMinutes() >= h * 60 + m;
}
