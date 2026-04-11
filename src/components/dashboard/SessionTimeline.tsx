import { useState, useRef, useCallback, type KeyboardEvent } from 'react';
import { Card } from '../ui/Card';
import { useDayPlan } from '../../context/DayPlanContext';
import { useCurrentSession } from '../../hooks/useCurrentSession';
import type { Intention, SessionSlot } from '../../types';

// ---- shared intention row hooks (used by both CurrentSession and SessionTimeline) ----

function useIntentionEditing() {
    const { plan, dispatch } = useDayPlan();
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editValue, setEditValue] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    const startEdit = useCallback((intention: Intention) => {
        setEditingId(intention.id);
        setEditValue(intention.title);
        requestAnimationFrame(() => inputRef.current?.focus());
    }, []);

    const commitEdit = useCallback(() => {
        if (!editingId) return;
        const trimmed = editValue.trim();
        if (trimmed) {
            const intention = plan.intentions.find((i) => i.id === editingId);
            if (intention && intention.title !== trimmed) {
                dispatch({ type: 'UPDATE_INTENTION', intention: { ...intention, title: trimmed } });
            }
        }
        setEditingId(null);
        setEditValue('');
    }, [editingId, editValue, plan.intentions, dispatch]);

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

function useIntentionDrag() {
    const { plan, dispatch } = useDayPlan();
    const [dragId, setDragId] = useState<string | null>(null);
    const [dragOverId, setDragOverId] = useState<string | null>(null);
    const [dragSessionId, setDragSessionId] = useState<string | null>(null);

    const handleDragStart = useCallback((intentionId: string, sessionId: string) => {
        setDragId(intentionId);
        setDragSessionId(sessionId);
    }, []);

    const handleDragOver = useCallback(
        (e: React.DragEvent, intentionId: string) => {
            e.preventDefault();
            if (intentionId !== dragId) setDragOverId(intentionId);
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
            const ids = plan.intentionSessions[sessionId] ?? [];
            const fromIndex = ids.indexOf(dragId);
            const toIndex = ids.indexOf(targetId);
            if (fromIndex === -1 || toIndex === -1) return;
            const reordered = [...ids];
            reordered.splice(fromIndex, 1);
            reordered.splice(toIndex, 0, dragId);
            dispatch({ type: 'REORDER_SESSION_INTENTIONS', sessionId, intentionIds: reordered });
            setDragId(null);
            setDragOverId(null);
            setDragSessionId(null);
        },
        [dragId, dragSessionId, plan.intentionSessions, dispatch],
    );

    const handleDragEnd = useCallback(() => {
        setDragId(null);
        setDragOverId(null);
        setDragSessionId(null);
    }, []);

    return { dragId, dragOverId, handleDragStart, handleDragOver, handleDrop, handleDragEnd };
}

// ---- shared intention row renderer ----

interface IntentionRowProps {
    intention: Intention;
    sessionId: string;
    editing: ReturnType<typeof useIntentionEditing>;
    drag: ReturnType<typeof useIntentionDrag>;
}

function IntentionRow({ intention, sessionId, editing, drag }: IntentionRowProps) {
    const { dispatch } = useDayPlan();
    const isEditing = editing.editingId === intention.id;
    const isDragging = drag.dragId === intention.id;
    const isDragOver = drag.dragOverId === intention.id && drag.dragId !== intention.id;

    return (
        <li
            draggable={!isEditing}
            onDragStart={() => drag.handleDragStart(intention.id, sessionId)}
            onDragOver={(e) => drag.handleDragOver(e, intention.id)}
            onDrop={(e) => drag.handleDrop(e, intention.id, sessionId)}
            onDragEnd={drag.handleDragEnd}
            className={`flex items-center gap-2 px-2 py-1 rounded transition-all ${isDragging
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
                onClick={() => dispatch({ type: 'TOGGLE_INTENTION_COMPLETE', intentionId: intention.id })}
                className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors cursor-pointer ${intention.completed
                        ? 'bg-success border-success text-white'
                        : 'border-border hover:border-accent'
                    }`}
                aria-label={`Mark ${intention.title} as ${intention.completed ? 'incomplete' : 'complete'}`}
            >
                {intention.completed && (
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
                    className={`flex-1 text-sm cursor-text ${intention.completed ? 'line-through text-text-light' : ''}`}
                    onClick={() => editing.startEdit(intention)}
                    title="Click to edit"
                >
                    {intention.isHabit && <span className="mr-1">🔄</span>}
                    {intention.title}
                </span>
            )}

            <span
                className={`ml-auto text-[10px] px-2 py-0.5 rounded-full flex-shrink-0 ${intention.type === 'main'
                        ? 'bg-accent/10 text-accent'
                        : 'bg-surface-dark text-text-light'
                    }`}
            >
                {intention.type}
            </span>
        </li>
    );
}

// ---- shared session card renderer ----

function SessionCard({
    session,
    isCurrent,
    isPast,
    intentions,
    editing,
    drag,
}: {
    session: SessionSlot;
    isCurrent: boolean;
    isPast: boolean;
    intentions: Intention[];
    editing: ReturnType<typeof useIntentionEditing>;
    drag: ReturnType<typeof useIntentionDrag>;
}) {
    // Background nudge banner for active session
    const bgNudges = isCurrent
        ? intentions.filter((i) => i.type === 'background' && !i.completed)
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
                    {session.startTime} – {session.endTime}
                </span>
            </div>

            {/* Background nudge banner */}
            {bgNudges.length > 0 && (
                <div className="mb-3 px-3 py-2 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 text-xs text-amber-800 dark:text-amber-300">
                    Don't forget: {bgNudges.map((i) => i.title).join(', ')}
                </div>
            )}

            {intentions.length > 0 ? (
                <ul className="space-y-1.5">
                    {intentions.map((intention) => (
                        <IntentionRow
                            key={intention.id}
                            intention={intention}
                            sessionId={session.id}
                            editing={editing}
                            drag={drag}
                        />
                    ))}
                </ul>
            ) : (
                <p className="text-xs text-text-light">No intentions scheduled</p>
            )}
        </Card>
    );
}

// ---- CurrentSession: shows only the active session ----

export function CurrentSession() {
    const { plan, settings } = useDayPlan();
    const { currentSession } = useCurrentSession(settings.sessionSlots);
    const editing = useIntentionEditing();
    const drag = useIntentionDrag();

    if (!currentSession) {
        return (
            <Card>
                <p className="text-sm text-text-light">No active session right now.</p>
            </Card>
        );
    }

    const assignedIds = plan.intentionSessions[currentSession.id] ?? [];
    const intentions = assignedIds
        .map((id) => plan.intentions.find((i) => i.id === id))
        .filter((i): i is Intention => i !== undefined);

    return (
        <SessionCard
            session={currentSession}
            isCurrent
            isPast={false}
            intentions={intentions}
            editing={editing}
            drag={drag}
        />
    );
}

// ---- SessionTimeline: shows all sessions ----

export function SessionTimeline() {
    const { plan, settings } = useDayPlan();
    const { currentSession } = useCurrentSession(settings.sessionSlots);
    const editing = useIntentionEditing();
    const drag = useIntentionDrag();

    return (
        <div className="space-y-4">
            {settings.sessionSlots.map((session) => {
                const isCurrent = currentSession?.id === session.id;
                const isPast = !isCurrent && isSessionPast(session.endTime);
                const assignedIds = plan.intentionSessions[session.id] ?? [];
                const intentions = assignedIds
                    .map((id) => plan.intentions.find((i) => i.id === id))
                    .filter((i): i is Intention => i !== undefined);

                return (
                    <SessionCard
                        key={session.id}
                        session={session}
                        isCurrent={isCurrent}
                        isPast={isPast}
                        intentions={intentions}
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
