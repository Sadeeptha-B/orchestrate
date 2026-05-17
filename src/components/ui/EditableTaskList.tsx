import { useState, useRef, useCallback, type KeyboardEvent } from 'react';
import type { Intention } from '../../types';
import { useDayPlan } from '../../hooks/useDayPlan';
import { useIntentionRemoval } from '../../hooks/useIntentionRemoval';
import { ConfirmModal } from './ConfirmModal';
import { useConfirmModal } from '../../hooks/useConfirmModal';

interface EditableTaskListProps {
    tasks: Intention[];
}

export function EditableTaskList({ tasks }: EditableTaskListProps) {
    const { dispatch } = useDayPlan();
    const { moveToBacklog, removeIntention } = useIntentionRemoval();
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editValue, setEditValue] = useState('');
    const [dragId, setDragId] = useState<string | null>(null);
    const [dragOverId, setDragOverId] = useState<string | null>(null);
    const confirmDelete = useConfirmModal<Intention>();
    const inputRef = useRef<HTMLInputElement>(null);

    const startEdit = useCallback((task: Intention) => {
        setEditingId(task.id);
        setEditValue(task.title);
        // Focus after render
        requestAnimationFrame(() => inputRef.current?.focus());
    }, []);

    const commitEdit = useCallback(() => {
        if (!editingId) return;
        const trimmed = editValue.trim();
        if (trimmed) {
            const task = tasks.find((t) => t.id === editingId);
            if (task && task.title !== trimmed) {
                dispatch({ type: 'UPDATE_INTENTION', intention: { ...task, title: trimmed } });
            }
        }
        setEditingId(null);
        setEditValue('');
    }, [editingId, editValue, tasks, dispatch]);

    const cancelEdit = useCallback(() => {
        setEditingId(null);
        setEditValue('');
    }, []);

    const handleEditKeyDown = useCallback(
        (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                commitEdit();
            } else if (e.key === 'Escape') {
                cancelEdit();
            }
        },
        [commitEdit, cancelEdit],
    );

    // --- Drag and drop ---
    const handleDragStart = useCallback((taskId: string) => {
        setDragId(taskId);
    }, []);

    const handleDragOver = useCallback(
        (e: React.DragEvent, taskId: string) => {
            e.preventDefault();
            if (taskId !== dragId) {
                setDragOverId(taskId);
            }
        },
        [dragId],
    );

    const handleDrop = useCallback(
        (e: React.DragEvent, targetId: string) => {
            e.preventDefault();
            if (!dragId || dragId === targetId) {
                setDragId(null);
                setDragOverId(null);
                return;
            }

            const ids = tasks.map((t) => t.id);
            const fromIndex = ids.indexOf(dragId);
            const toIndex = ids.indexOf(targetId);
            if (fromIndex === -1 || toIndex === -1) return;

            const reordered = [...ids];
            reordered.splice(fromIndex, 1);
            reordered.splice(toIndex, 0, dragId);

            dispatch({ type: 'REORDER_INTENTIONS', intentionIds: reordered });
            setDragId(null);
            setDragOverId(null);
        },
        [dragId, tasks, dispatch],
    );

    const handleDragEnd = useCallback(() => {
        setDragId(null);
        setDragOverId(null);
    }, []);

    if (tasks.length === 0) return null;

    return (
        <>
            <ul className="space-y-2">
                {tasks.map((task) => {
                    const isEditing = editingId === task.id;
                    const isDragging = dragId === task.id;
                    const isDragOver = dragOverId === task.id && dragId !== task.id;

                    return (
                        <li
                            key={task.id}
                            draggable={!isEditing}
                            onDragStart={() => handleDragStart(task.id)}
                            onDragOver={(e) => handleDragOver(e, task.id)}
                            onDrop={(e) => handleDrop(e, task.id)}
                            onDragEnd={handleDragEnd}
                            className={`flex items-center gap-2 px-4 py-3 bg-card rounded-lg border transition-all ${isDragging
                                ? 'opacity-40 border-accent/40'
                                : isDragOver
                                    ? 'border-accent border-dashed'
                                    : 'border-border'
                                }`}
                        >
                            {/* Drag handle */}
                            <span
                                className="cursor-grab active:cursor-grabbing text-text-light/50 hover:text-text-light select-none flex-shrink-0"
                                title="Drag to reorder"
                            >
                                <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                                    <circle cx="3.5" cy="2" r="1.2" />
                                    <circle cx="8.5" cy="2" r="1.2" />
                                    <circle cx="3.5" cy="6" r="1.2" />
                                    <circle cx="8.5" cy="6" r="1.2" />
                                    <circle cx="3.5" cy="10" r="1.2" />
                                    <circle cx="8.5" cy="10" r="1.2" />
                                </svg>
                            </span>

                            {/* Title: editable or display */}
                            {isEditing ? (
                                <input
                                    ref={inputRef}
                                    type="text"
                                    value={editValue}
                                    onChange={(e) => setEditValue(e.target.value)}
                                    onKeyDown={handleEditKeyDown}
                                    onBlur={commitEdit}
                                    className="flex-1 text-sm px-2 py-0.5 rounded border border-accent/30 bg-accent-subtle/30 focus:outline-none focus:ring-1 focus:ring-accent/30"
                                />
                            ) : (
                                <span
                                    className="flex-1 text-sm cursor-text"
                                    onClick={() => startEdit(task)}
                                    title="Click to edit"
                                >
                                    {task.title}
                                </span>
                            )}

                            {/* Right side: custom actions, backlog, delete (v6.2) */}
                            <div className="flex items-center gap-1 flex-shrink-0">
                                <button
                                    onClick={() => void moveToBacklog(task.id)}
                                    className="px-1.5 py-0.5 rounded text-text-light hover:bg-surface-dark hover:text-accent transition-colors text-sm cursor-pointer"
                                    title="Move to backlog"
                                    aria-label={`Move ${task.title} to backlog`}
                                >
                                    📥
                                </button>
                                <button
                                    onClick={() => confirmDelete.open(task)}
                                    className="px-1.5 py-0.5 rounded text-text-light hover:bg-surface-dark hover:text-red-400 transition-colors text-sm cursor-pointer"
                                    title="Delete"
                                    aria-label={`Delete ${task.title}`}
                                >
                                    🗑
                                </button>
                            </div>
                        </li>
                    );
                })}
            </ul>

            <ConfirmModal
                open={confirmDelete.value !== null}
                onClose={confirmDelete.close}
                onConfirm={() => confirmDelete.value ? removeIntention(confirmDelete.value.id) : Promise.resolve()}
                title="Delete intention permanently?"
                confirmLabel="Delete"
            >
                <p className="text-sm text-text-light mb-4">
                    <strong>{confirmDelete.value?.title}</strong> will be removed from today.
                    Any of its linked Todoist tasks that are currently scheduled will be unscheduled.
                    To park it for later instead, cancel and click 📥.
                </p>
            </ConfirmModal>
        </>
    );
}
