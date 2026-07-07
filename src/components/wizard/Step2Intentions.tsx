import { useState, useRef, useCallback, useMemo, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { WizardLayout } from './WizardLayout';
import { useDayPlan } from '../../hooks/useDayPlan';
import { useTodoistData } from '../../hooks/useTodoist';
import { Button } from '../ui/Button';
import { EditableTaskList } from '../ui/EditableTaskList';
import { ConfirmModal } from '../ui/ConfirmModal';
import { useConfirmModal } from '../../hooks/useConfirmModal';
import { useIntentionRemoval } from '../../hooks/useIntentionRemoval';
import type { Intention } from '../../types';
import { TodoistPanel } from '../todoist/TodoistPanel';
import { getTaskTitle } from '../../lib/tasks';
import { useTodaysHabitsSync } from '../../hooks/useTodaysHabitsSync';
import type { LinkedTask } from '../../types';

export function Step2Intentions() {
    const { plan, dispatch } = useDayPlan();
    const { taskMap } = useTodoistData();
    const navigate = useNavigate();

    // v6.3/v6.7: surface today's habit + micro-gap instances on the timeline / dashboard. Shared
    // with the dashboard so the two surfaces can't drift.
    useTodaysHabitsSync();

    const [input, setInput] = useState('');
    const [mappingStarted, setMappingStarted] = useState(
        () => plan.intentions.some((i) => i.brokenDown || i.linkedTaskIds.length > 0),
    );
    const [collapsedIntentions, setCollapsedIntentions] = useState<Set<string>>(() => new Set());
    const [currentTasksCollapsed, setCurrentTasksCollapsed] = useState(false);
    // When collapsed, the focused "Current" card folds away and all not-yet-mapped intentions
    // (current included) drop into one reorderable list, so the user can resequence them.
    const [currentCardCollapsed, setCurrentCardCollapsed] = useState(false);
    const [selectedIntentionId, setSelectedIntentionId] = useState<string | null>(null);
    // Drag-reorder state for the current intention's linked task list.
    const [dragTaskId, setDragTaskId] = useState<string | null>(null);
    const [dragOverTaskId, setDragOverTaskId] = useState<string | null>(null);

    const { moveToBacklog, removeIntention } = useIntentionRemoval();
    const confirmDeleteCurrent = useConfirmModal<Intention>();

    const toggleCollapsed = useCallback((id: string) => {
        setCollapsedIntentions((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    const titleFor = useCallback(
        (todoistId: string, linkedTasks: LinkedTask[]) => getTaskTitle(todoistId, linkedTasks, taskMap),
        [taskMap],
    );

    // Inline editing for the current mapping intention
    const [editingTitle, setEditingTitle] = useState(false);
    const [editValue, setEditValue] = useState('');
    const editRef = useRef<HTMLInputElement>(null);

    const startEditingTitle = useCallback((title: string) => {
        setEditingTitle(true);
        setEditValue(title);
        requestAnimationFrame(() => editRef.current?.focus());
    }, []);

    const commitTitleEdit = useCallback(() => {
        const trimmed = editValue.trim();
        const current = plan.intentions.find((i) => i.id === selectedIntentionId && !i.brokenDown)
            ?? plan.intentions.find((i) => !i.brokenDown);
        if (trimmed && current && current.title !== trimmed) {
            dispatch({ type: 'UPDATE_INTENTION', intention: { ...current, title: trimmed } });
        }
        setEditingTitle(false);
        setEditValue('');
    }, [editValue, selectedIntentionId, plan.intentions, dispatch]);

    const handleEditKeyDown = useCallback(
        (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                commitTitleEdit();
            } else if (e.key === 'Escape') {
                setEditingTitle(false);
                setEditValue('');
            }
        },
        [commitTitleEdit],
    );

    // Build intention title lookup for linking mode
    const intentionTitleMap = useMemo(
        () => Object.fromEntries(plan.intentions.map((i) => [i.id, i.title])),
        [plan.intentions],
    );

    // Commit a drag-reorder of the current intention's linked tasks onto the dropped target.
    const reorderCurrentLinked = useCallback(
        (intentionId: string, orderedIds: string[], dragId: string, targetId: string) => {
            if (dragId === targetId) return;
            const next = [...orderedIds];
            const from = next.indexOf(dragId);
            const to = next.indexOf(targetId);
            if (from === -1 || to === -1) return;
            next.splice(from, 1);
            next.splice(to, 0, dragId);
            dispatch({ type: 'REORDER_INTENTION_TASKS', intentionId, todoistIds: next });
        },
        [dispatch],
    );

    // Reorder a subset of intentions (e.g. the not-yet-mapped ones) while leaving the rest
    // pinned in place. Reused by the upcoming list and the collapsed full list.
    const reorderIntentionSubset = useCallback(
        (reorderedIds: string[]) => {
            const subset = new Set(reorderedIds);
            let idx = 0;
            const full = plan.intentions.map((i) => (subset.has(i.id) ? reorderedIds[idx++] : i.id));
            dispatch({ type: 'REORDER_INTENTIONS', intentionIds: full });
        },
        [plan.intentions, dispatch],
    );

    const addIntention = () => {
        const title = input.trim();
        if (!title) return;
        dispatch({ type: 'ADD_INTENTION', title });
        setInput('');
    };

    const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addIntention();
        }
    };

    const currentMappingIntention = mappingStarted
        ? (plan.intentions.find((i) => i.id === selectedIntentionId && !i.brokenDown)
            ?? plan.intentions.find((i) => !i.brokenDown)
            ?? null)
        : null;
    const brokenDownCount = plan.intentions.filter((i) => i.brokenDown).length;
    const allBrokenDown = plan.intentions.length > 0 && plan.intentions.every((i) => i.brokenDown);
    // Every intention still awaiting mapping (the current one included).
    const mappableIntentions = plan.intentions.filter((i) => !i.brokenDown);
    const upcomingIntentions = currentMappingIntention
        ? mappableIntentions.filter((i) => i.id !== currentMappingIntention.id)
        : [];
    const upcomingCount = upcomingIntentions.length;

    const handleNext = () => {
        dispatch({ type: 'SET_WIZARD_STEP', step: 3 });
    };

    const markCurrentBrokenDown = () => {
        if (!currentMappingIntention) return;
        dispatch({
            type: 'MARK_BROKEN_DOWN',
            intentionId: currentMappingIntention.id,
            brokenDown: true,
        });
    };

    const restartMapping = () => {
        for (const intention of plan.intentions) {
            if (intention.brokenDown) {
                dispatch({ type: 'MARK_BROKEN_DOWN', intentionId: intention.id, brokenDown: false });
            }
        }
    };

    return (
        <WizardLayout canAdvance={plan.intentions.length > 0 && mappingStarted} onNext={handleNext} wide>
            <div className="flex flex-col lg:flex-row gap-6 mt-4" style={{ minHeight: '60vh' }}>
                {/* Left panel */}
                <div className="lg:w-[40%] flex-shrink-0 space-y-5 overflow-y-auto scrollbar-subtle">
                    {!mappingStarted ? (
                        /* ── Phase 1: Set intentions ── */
                        <>
                            <div>
                                <h2 className="text-2xl font-semibold mb-2">
                                    What are your intentions for today?
                                </h2>
                                <p className="text-text-light text-sm">
                                    Intentions are specific goals — not epics. What do you want to
                                    accomplish today?
                                </p>
                            </div>

                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={input}
                                    onChange={(e) => setInput(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    placeholder="Add an intention..."
                                    className="flex-1 px-4 py-2 rounded-lg border border-border bg-card text-text text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-colors"
                                    autoFocus
                                />
                                <Button onClick={addIntention} disabled={!input.trim()} size="md">
                                    Add
                                </Button>
                            </div>

                            {plan.intentions.length > 0 && (
                                <EditableTaskList tasks={plan.intentions} />
                            )}

                            {plan.intentions.length > 0 && (
                                <Button
                                    onClick={() => setMappingStarted(true)}
                                    variant="primary"
                                    size="md"
                                >
                                    Start mapping →
                                </Button>
                            )}
                        </>
                    ) : (
                        /* ── Phase 2: Sequential mapping ── */
                        <>
                            <div>
                                <h2 className="text-2xl font-semibold mb-2">
                                    Break down your intentions
                                </h2>
                                <p className="text-text-light text-sm">
                                    Go through each intention and break it into actionable tasks
                                    in your todolist.
                                </p>
                            </div>

                            {/* Add more intentions during mapping */}
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={input}
                                    onChange={(e) => setInput(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    placeholder="Add another intention..."
                                    className="flex-1 px-4 py-2 rounded-lg border border-border bg-card text-text text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-colors"
                                />
                                <Button onClick={addIntention} disabled={!input.trim()} size="md">
                                    Add
                                </Button>
                            </div>

                            {/* Edit intentions link */}
                            <div className="flex justify-end">
                                <button
                                    onClick={() => {
                                        restartMapping();
                                        setMappingStarted(false);
                                        setCurrentCardCollapsed(false);
                                    }}
                                    className="text-xs text-text-light hover:text-accent transition-colors cursor-pointer"
                                >
                                    ← Want to change intentions?
                                </button>
                            </div>

                            {/* Progress */}
                            <div>
                                <div className="flex justify-between text-xs text-text-light mb-1.5">
                                    <span>Mapping progress</span>
                                    <span>{brokenDownCount}/{plan.intentions.length}</span>
                                </div>
                                <div className="h-1.5 bg-surface-dark rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-accent rounded-full transition-all duration-500 ease-out"
                                        style={{
                                            width: plan.intentions.length > 0
                                                ? `${(brokenDownCount / plan.intentions.length) * 100}%`
                                                : '0%',
                                        }}
                                    />
                                </div>
                            </div>

                            {/* Already mapped — collapsible panels */}
                            {brokenDownCount > 0 && (
                                <div className="space-y-2">
                                    {plan.intentions
                                        .filter((i) => i.brokenDown)
                                        .map((intention) => {
                                            const isCollapsed = collapsedIntentions.has(intention.id);
                                            const linkedTasks = plan.linkedTasks.filter(
                                                (lt) => lt.intentionId === intention.id,
                                            );
                                            const completedCount = linkedTasks.filter((lt) => lt.completed).length;

                                            return (
                                                <div
                                                    key={intention.id}
                                                    className="rounded-lg border border-success/30 bg-card overflow-hidden"
                                                >
                                                    {/* Header row */}
                                                    <div className="flex items-center gap-2 px-3 py-2">
                                                        <button
                                                            onClick={() => toggleCollapsed(intention.id)}
                                                            className="flex items-center gap-2 flex-1 min-w-0 text-left cursor-pointer group"
                                                        >
                                                            {/* Chevron + tick */}
                                                            <span className="flex items-center gap-1 flex-shrink-0">
                                                                <svg
                                                                    className={`w-3 h-3 text-text-light transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
                                                                    fill="none"
                                                                    viewBox="0 0 24 24"
                                                                    stroke="currentColor"
                                                                    strokeWidth={2}
                                                                >
                                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                                                </svg>
                                                                <svg
                                                                    className="w-4 h-4 text-success flex-shrink-0"
                                                                    fill="none"
                                                                    viewBox="0 0 24 24"
                                                                    stroke="currentColor"
                                                                    strokeWidth={2}
                                                                >
                                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                                                </svg>
                                                            </span>
                                                            <span className="text-sm font-medium text-text flex-1 min-w-0 truncate">
                                                                {intention.title}
                                                            </span>
                                                        </button>
                                                        <span className="text-[10px] text-text-light tabular-nums flex-shrink-0">
                                                            {linkedTasks.length} task{linkedTasks.length !== 1 ? 's' : ''}
                                                            {completedCount > 0 && (
                                                                <span className="ml-1 text-success">
                                                                    · 🎉 {completedCount}
                                                                </span>
                                                            )}
                                                        </span>
                                                        <button
                                                            onClick={() => dispatch({ type: 'MARK_BROKEN_DOWN', intentionId: intention.id, brokenDown: false })}
                                                            className="text-[11px] text-text-light hover:text-accent transition-colors cursor-pointer flex-shrink-0 px-1.5 py-0.5 rounded hover:bg-surface-dark/50"
                                                            title="Remap this intention"
                                                        >
                                                            remap
                                                        </button>
                                                    </div>

                                                    {/* Nested task list */}
                                                    {!isCollapsed && linkedTasks.length > 0 && (
                                                        <div className="border-t border-border/50 px-3 py-2 space-y-1">
                                                            {linkedTasks.map((lt) => {
                                                                const title = titleFor(lt.todoistId, plan.linkedTasks);
                                                                return (
                                                                    <div
                                                                        key={lt.todoistId}
                                                                        className="flex items-center gap-2 py-0.5 text-xs"
                                                                    >
                                                                        <span className="w-1 h-1 rounded-full bg-border flex-shrink-0" />
                                                                        {lt.completed ? (
                                                                            <span className="line-through text-text-light flex-1 min-w-0 truncate">
                                                                                🎉 {title}
                                                                            </span>
                                                                        ) : (
                                                                            <span className="text-text flex-1 min-w-0 truncate">
                                                                                {title}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                                    {!isCollapsed && linkedTasks.length === 0 && (
                                                        <div className="border-t border-border/50 px-3 py-2">
                                                            <span className="text-xs text-text-light">No tasks linked</span>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                </div>
                            )}

                            {/* Current intention to map */}
                            {currentMappingIntention && !currentCardCollapsed && (
                                <div className="bg-card rounded-lg border-2 border-accent/30 p-5 space-y-3">
                                    <div>
                                        <div className="flex items-center gap-2">
                                            {mappableIntentions.length > 1 && (
                                                <button
                                                    onClick={() => setCurrentCardCollapsed(true)}
                                                    className="px-1 py-0.5 rounded text-text-light hover:bg-surface-dark hover:text-accent transition-colors cursor-pointer flex-shrink-0"
                                                    title="Collapse to reorder intentions"
                                                    aria-label="Collapse current intention to reorder"
                                                >
                                                    <svg className="w-3.5 h-3.5 rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                                    </svg>
                                                </button>
                                            )}
                                            <span className="text-xs font-medium text-accent uppercase tracking-wider flex-1">
                                                Current
                                            </span>
                                            <button
                                                onClick={() => void moveToBacklog(currentMappingIntention.id)}
                                                className="px-1.5 py-0.5 rounded text-text-light hover:bg-surface-dark hover:text-accent transition-colors text-sm cursor-pointer"
                                                title="Move to backlog"
                                            >
                                                📥
                                            </button>
                                            <button
                                                onClick={() => confirmDeleteCurrent.open(currentMappingIntention)}
                                                className="px-1.5 py-0.5 rounded text-text-light hover:bg-surface-dark hover:text-red-400 transition-colors text-sm cursor-pointer"
                                                title="Delete"
                                            >
                                                🗑
                                            </button>
                                        </div>
                                        {editingTitle ? (
                                            <input
                                                ref={editRef}
                                                type="text"
                                                value={editValue}
                                                onChange={(e) => setEditValue(e.target.value)}
                                                onKeyDown={handleEditKeyDown}
                                                onBlur={commitTitleEdit}
                                                className="block w-full text-lg font-semibold mt-1 px-2 py-0.5 rounded border border-accent/30 bg-accent-subtle/30 focus:outline-none focus:ring-1 focus:ring-accent/30"
                                            />
                                        ) : (
                                            <h3
                                                className="text-lg font-semibold mt-1 cursor-text rounded px-1 -mx-1 hover:bg-surface-dark/50 transition-colors"
                                                onClick={() => startEditingTitle(currentMappingIntention.title)}
                                                title="Click to edit"
                                            >
                                                {currentMappingIntention.title}
                                            </h3>
                                        )}
                                        <p className="text-sm text-text-light mt-1">
                                            Break this down into actionable tasks and link them in the todolist →
                                        </p>
                                        <p className="text-xs text-text-light/80 mt-1">
                                            Keep each intention to a <strong>single goal</strong> — not an epic. If it
                                            spans several goals, split it into separate intentions.
                                        </p>
                                    </div>

                                    {/* Linked tasks for current intention — collapsible + drag-reorderable */}
                                    {currentMappingIntention.linkedTaskIds.length > 0 && (() => {
                                        const byId = new Map(
                                            plan.linkedTasks
                                                .filter((lt) => lt.intentionId === currentMappingIntention.id)
                                                .map((lt) => [lt.todoistId, lt]),
                                        );
                                        // Render in the intention's own linkedTaskIds order (the reorderable order).
                                        const orderedIds = currentMappingIntention.linkedTaskIds.filter((id) => byId.has(id));
                                        const currentLinked = orderedIds.map((id) => byId.get(id)!);
                                        const completedCount = currentLinked.filter((lt) => lt.completed).length;
                                        const overScope = currentLinked.length > 5;

                                        return (
                                            <div className="space-y-2">
                                                <div className="rounded-lg border border-border overflow-hidden">
                                                    <button
                                                        onClick={() => setCurrentTasksCollapsed(!currentTasksCollapsed)}
                                                        className="flex items-center gap-2 w-full px-3 py-2 text-left cursor-pointer hover:bg-surface-dark/30 transition-colors"
                                                    >
                                                        <svg
                                                            className={`w-3 h-3 text-text-light transition-transform ${currentTasksCollapsed ? '' : 'rotate-90'}`}
                                                            fill="none"
                                                            viewBox="0 0 24 24"
                                                            stroke="currentColor"
                                                            strokeWidth={2}
                                                        >
                                                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                                        </svg>
                                                        <span className="text-xs text-accent font-medium">
                                                            {currentLinked.length} task{currentLinked.length !== 1 ? 's' : ''} linked
                                                        </span>
                                                        {completedCount > 0 && (
                                                            <span className="text-xs text-success">
                                                                (🎉 {completedCount} completed)
                                                            </span>
                                                        )}
                                                    </button>
                                                    {!currentTasksCollapsed && (
                                                        <div className="border-t border-border/50 px-3 py-2 space-y-1">
                                                            {currentLinked.map((lt) => {
                                                                const title = titleFor(lt.todoistId, plan.linkedTasks);
                                                                const isDragging = dragTaskId === lt.todoistId;
                                                                const isDragOver = dragOverTaskId === lt.todoistId && dragTaskId !== lt.todoistId;
                                                                return (
                                                                    <div
                                                                        key={lt.todoistId}
                                                                        draggable={!lt.completed}
                                                                        onDragStart={() => setDragTaskId(lt.todoistId)}
                                                                        onDragOver={(e) => { e.preventDefault(); if (lt.todoistId !== dragTaskId) setDragOverTaskId(lt.todoistId); }}
                                                                        onDrop={(e) => {
                                                                            e.preventDefault();
                                                                            if (dragTaskId) reorderCurrentLinked(currentMappingIntention.id, orderedIds, dragTaskId, lt.todoistId);
                                                                            setDragTaskId(null);
                                                                            setDragOverTaskId(null);
                                                                        }}
                                                                        onDragEnd={() => { setDragTaskId(null); setDragOverTaskId(null); }}
                                                                        className={`flex items-center gap-2 py-0.5 text-xs rounded transition-colors ${isDragging ? 'opacity-40' : ''} ${isDragOver ? 'border-t-2 border-accent' : ''}`}
                                                                    >
                                                                        {!lt.completed && (
                                                                            <span
                                                                                className="cursor-grab active:cursor-grabbing text-text-light/40 hover:text-text-light flex-shrink-0 select-none"
                                                                                title="Drag to reorder"
                                                                                aria-hidden
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
                                                                        {lt.completed ? (
                                                                            <span className="line-through text-text-light flex-1 min-w-0 truncate">
                                                                                🎉 {title}
                                                                            </span>
                                                                        ) : (
                                                                            <span className="text-text flex-1 min-w-0 truncate">
                                                                                {title}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Scope-creep nudge: an intention with many tasks is probably an epic. */}
                                                {overScope && (
                                                    <div className="rounded-lg border border-amber-300/60 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                                                        This intention has {currentLinked.length} tasks linked. That&apos;s a lot for a
                                                        single goal — consider splitting it into a separate intention so scope doesn&apos;t
                                                        creep. Add one above and move some tasks to it.
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })()}

                                    <div className="flex items-center gap-2">
                                        <Button onClick={markCurrentBrokenDown} size="sm">
                                            Done — {upcomingCount > 0 ? 'next' : 'finish'}
                                        </Button>
                                    </div>
                                </div>
                            )}

                            {/* Collapsed: reorder ALL not-yet-mapped intentions (current included) in one list */}
                            {currentCardCollapsed && mappableIntentions.length > 0 && (
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-medium text-text-light uppercase tracking-wider">
                                            Reorder intentions
                                        </span>
                                        <button
                                            onClick={() => setCurrentCardCollapsed(false)}
                                            className="text-xs text-accent hover:underline cursor-pointer"
                                        >
                                            Done reordering →
                                        </button>
                                    </div>
                                    <p className="text-xs text-text-light/80">
                                        Drag to reorder. Click <strong>Map →</strong> on an intention to focus it and
                                        keep breaking it down.
                                    </p>
                                    <EditableTaskList
                                        tasks={mappableIntentions}
                                        onReorder={reorderIntentionSubset}
                                        onSelect={(id) => { setSelectedIntentionId(id); setCurrentCardCollapsed(false); }}
                                    />
                                </div>
                            )}

                            {/* Upcoming intentions (focused mapping mode) */}
                            {!currentCardCollapsed && upcomingCount > 0 && (
                                <div>
                                    <EditableTaskList
                                        tasks={upcomingIntentions}
                                        onReorder={reorderIntentionSubset}
                                        onSelect={(id) => setSelectedIntentionId(id)}
                                    />
                                </div>
                            )}

                            {/* All done */}
                            {allBrokenDown && (
                                <div className="bg-accent-subtle/40 rounded-lg p-4 text-center space-y-2">
                                    <p className="text-sm font-medium text-accent">
                                        All intentions mapped — nice work!
                                    </p>
                                    <p className="text-xs text-text-light">
                                        Continue to categorize your intentions.
                                    </p>
                                </div>
                            )}

                        </>
                    )}
                </div>

                {/* Right panel: Todoist task panel */}
                <div className="flex-1 min-w-0 flex flex-col">
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="text-sm font-medium text-text-light">Task Manager</h3>
                        {mappingStarted && currentMappingIntention && (
                            <span className="text-xs text-accent">
                                Link tasks to: {currentMappingIntention.title}
                            </span>
                        )}
                    </div>
                    <div className="flex-1 rounded-lg border border-border overflow-hidden bg-card min-h-[400px] max-h-[70vh]">
                        <TodoistPanel
                            mode="full"
                            onSetup={() => navigate('/settings?tab=integrations')}
                            showFilterToggle
                            linking={mappingStarted && currentMappingIntention ? {
                                linkingIntentionId: currentMappingIntention.id,
                                linkedTaskIds: currentMappingIntention.linkedTaskIds,
                                allLinkedTasks: plan.linkedTasks,
                                intentionTitles: intentionTitleMap,
                                onLinkTask: (todoistId) => dispatch({ type: 'LINK_TASK', intentionId: currentMappingIntention.id, todoistId }),
                                onUnlinkTask: (todoistId) => dispatch({ type: 'UNLINK_TASK', todoistId }),
                            } : undefined}
                        />
                    </div>
                </div>
            </div>

            <ConfirmModal
                open={confirmDeleteCurrent.value !== null}
                onClose={confirmDeleteCurrent.close}
                onConfirm={() => confirmDeleteCurrent.value
                    ? removeIntention(confirmDeleteCurrent.value.id)
                    : Promise.resolve()
                }
                title="Delete intention permanently?"
                confirmLabel="Delete"
            >
                <p className="text-sm text-text-light mb-4">
                    <strong>{confirmDeleteCurrent.value?.title}</strong> will be removed from today.
                    Any linked tasks that are scheduled will be unscheduled.
                    To park it for later instead, cancel and click 📥.
                </p>
            </ConfirmModal>
        </WizardLayout>
    );
}
