import { useState, useRef, useCallback, type KeyboardEvent } from 'react';
import { Card } from '../ui/Card';
import { useDayPlan } from '../../context/DayPlanContext';
import { useCurrentSession } from '../../hooks/useCurrentSession';
import type { Task, SessionSlot } from '../../types';

// ---- shared task row hooks (used by both CurrentSession and SessionTimeline) ----

function useTaskEditing() {
    const { plan, dispatch } = useDayPlan();
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editValue, setEditValue] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    const startEdit = useCallback((task: Task) => {
        setEditingId(task.id);
        setEditValue(task.title);
        requestAnimationFrame(() => inputRef.current?.focus());
    }, []);

    const commitEdit = useCallback(() => {
        if (!editingId) return;
        const trimmed = editValue.trim();
        if (trimmed) {
            const task = plan.tasks.find((t) => t.id === editingId);
            if (task && task.title !== trimmed) {
                dispatch({ type: 'UPDATE_TASK', task: { ...task, title: trimmed } });
            }
        }
        setEditingId(null);
        setEditValue('');
    }, [editingId, editValue, plan.tasks, dispatch]);

    const cancelEdit = useCallback(() => {
        setEditingId(null);
        setEditValue('');
    }, []);

    const handleEditKeyDown = useCallback(
        (e: KeyboardEvent) => {
            if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
            else if (e.key === 'Escape') cancelEdit();
        },
        [commitEdit, cancelEdit],
    );

    return { editingId, editValue, setEditValue, inputRef, startEdit, commitEdit, handleEditKeyDown };
}

function useTaskDrag() {
    const { plan, dispatch } = useDayPlan();
    const [dragId, setDragId] = useState<string | null>(null);
    const [dragOverId, setDragOverId] = useState<string | null>(null);
    const [dragSessionId, setDragSessionId] = useState<string | null>(null);

    const handleDragStart = useCallback((taskId: string, sessionId: string) => {
        setDragId(taskId);
        setDragSessionId(sessionId);
    }, []);

    const handleDragOver = useCallback(
        (e: React.DragEvent, taskId: string) => {
            e.preventDefault();
            if (taskId !== dragId) setDragOverId(taskId);
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

// ---- shared task row renderer ----

interface TaskRowProps {
    task: Task;
    sessionId: string;
    editing: ReturnType<typeof useTaskEditing>;
    drag: ReturnType<typeof useTaskDrag>;
}

function TaskRow({ task, sessionId, editing, drag }: TaskRowProps) {
    const { dispatch } = useDayPlan();
    const isEditing = editing.editingId === task.id;
    const isDragging = drag.dragId === task.id;
    const isDragOver = drag.dragOverId === task.id && drag.dragId !== task.id;

    return (
        <li
            draggable={!isEditing}
            onDragStart={() => drag.handleDragStart(task.id, sessionId)}
            onDragOver={(e) => drag.handleDragOver(e, task.id)}
            onDrop={(e) => drag.handleDrop(e, task.id, sessionId)}
            onDragEnd={drag.handleDragEnd}
            className={`flex items-center gap-2 px-2 py-1 rounded transition-all ${
                isDragging
                    ? 'opacity-40'
                    : isDragOver
                        ? 'bg-accent-subtle/50 border-l-2 border-accent'
                        : ''
            }`}
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
                onClick={() => dispatch({ type: 'TOGGLE_TASK_COMPLETE', taskId: task.id })}
                className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors cursor-pointer ${
                    task.completed
                        ? 'bg-success border-success text-white'
                        : 'border-border hover:border-accent'
                }`}
                aria-label={`Mark ${task.title} as ${task.completed ? 'incomplete' : 'complete'}`}
            >
                {task.completed && (
                    <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                )}
            </button>

            {isEditing ? (
                <input
                    ref={editing.inputRef}
                    type="text"
                    value={editing.editValue}
                    onChange={(e) => editing.setEditValue(e.target.value)}
                    onKeyDown={editing.handleEditKeyDown}
                    onBlur={editing.commitEdit}
                    className="flex-1 text-sm px-2 py-0.5 rounded border border-accent/30 bg-accent-subtle/30 focus:outline-none focus:ring-1 focus:ring-accent/30"
                />
            ) : (
                <span
                    className={`flex-1 text-sm cursor-text ${task.completed ? 'line-through text-text-light' : ''}`}
                    onClick={() => editing.startEdit(task)}
                    title="Click to edit"
                >
                    {task.title}
                </span>
            )}

            <span
                className={`ml-auto text-[10px] px-2 py-0.5 rounded-full flex-shrink-0 ${
                    task.type === 'main'
                        ? 'bg-accent/10 text-accent'
                        : 'bg-surface-dark text-text-light'
                }`}
            >
                {task.type}
            </span>
        </li>
    );
}

// ---- shared session card renderer ----

function SessionCard({
    session,
    isCurrent,
    isPast,
    tasks,
    editing,
    drag,
}: {
    session: SessionSlot;
    isCurrent: boolean;
    isPast: boolean;
    tasks: Task[];
    editing: ReturnType<typeof useTaskEditing>;
    drag: ReturnType<typeof useTaskDrag>;
}) {
    return (
        <Card
            className={`transition-all duration-300 ${
                isCurrent
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
                    {session.startTime} – {session.endTime}
                </span>
            </div>

            {tasks.length > 0 ? (
                <ul className="space-y-1.5">
                    {tasks.map((task) => (
                        <TaskRow
                            key={task.id}
                            task={task}
                            sessionId={session.id}
                            editing={editing}
                            drag={drag}
                        />
                    ))}
                </ul>
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
    const editing = useTaskEditing();
    const drag = useTaskDrag();

    if (!currentSession) {
        return (
            <Card>
                <p className="text-sm text-text-light">No active session right now.</p>
            </Card>
        );
    }

    const assignedIds = plan.taskSessions[currentSession.id] ?? [];
    const tasks = assignedIds
        .map((id) => plan.tasks.find((t) => t.id === id))
        .filter((t): t is Task => t !== undefined);

    return (
        <SessionCard
            session={currentSession}
            isCurrent
            isPast={false}
            tasks={tasks}
            editing={editing}
            drag={drag}
        />
    );
}

// ---- SessionTimeline: shows all sessions ----

export function SessionTimeline() {
    const { plan, settings } = useDayPlan();
    const { currentSession } = useCurrentSession(settings.sessionSlots);
    const editing = useTaskEditing();
    const drag = useTaskDrag();

    return (
        <div className="space-y-4">
            {settings.sessionSlots.map((session) => {
                const isCurrent = currentSession?.id === session.id;
                const isPast = !isCurrent && isSessionPast(session.endTime);
                const assignedIds = plan.taskSessions[session.id] ?? [];
                const tasks = assignedIds
                    .map((id) => plan.tasks.find((t) => t.id === id))
                    .filter((t): t is Task => t !== undefined);

                return (
                    <SessionCard
                        key={session.id}
                        session={session}
                        isCurrent={isCurrent}
                        isPast={isPast}
                        tasks={tasks}
                        editing={editing}
                        drag={drag}
                    />
                );
            })}
        </div>
    );
}

function isSessionPast(endTime: string): boolean {
    const now = new Date();
    const [h, m] = endTime.split(':').map(Number);
    return now.getHours() * 60 + now.getMinutes() >= h * 60 + m;
}
