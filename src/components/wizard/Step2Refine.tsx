import { useState, useMemo, useEffect, useCallback } from 'react';
import { WizardLayout } from './WizardLayout';
import { useDayPlan } from '../../context/DayPlanContext';
import { useTodoistData } from '../../hooks/useTodoist';
import { TodoistPanel } from '../todoist/TodoistPanel';
import { TodoistSetup } from '../todoist/TodoistSetup';
import { Modal } from '../ui/Modal';
import type { LinkedTask } from '../../types';

const TYPE_OPTIONS: { value: LinkedTask['type']; label: string; description: string }[] = [
    { value: 'main', label: 'Main', description: 'Primary work thread for the day' },
    { value: 'background', label: 'Background', description: 'Recurring habit or nudge task' },
];

const ESTIMATE_PRESETS = [15, 30, 45, 60];
const BACKGROUND_MAX_MINUTES = 30;

export function Step2Refine() {
    const { plan, dispatch } = useDayPlan();
    const { taskMap } = useTodoistData();
    const [currentIntentionIndex, setCurrentIntentionIndex] = useState(0);
    const [showSetup, setShowSetup] = useState(false);
    const [taskPanelOpen, setTaskPanelOpen] = useState(false);

    const intentions = plan.intentions;
    const currentIntention = intentions[currentIntentionIndex];

    const intentionTitleMap = useMemo(
        () => Object.fromEntries(plan.intentions.map((i) => [i.id, i.title])),
        [plan.intentions],
    );

    const canAdvanceStep = plan.linkedTasks.length > 0 &&
        plan.linkedTasks.every((lt) => lt.completed || (lt.type !== 'unclassified' && lt.estimatedMinutes !== null));

    const currentLinkedTasks = currentIntention
        ? plan.linkedTasks.filter((lt) => lt.intentionId === currentIntention.id)
        : [];

    const canAdvanceIntention = currentLinkedTasks.length > 0 &&
        currentLinkedTasks.every((lt) => lt.completed || (lt.type !== 'unclassified' && lt.estimatedMinutes !== null));

    const isLastIntention = currentIntentionIndex >= intentions.length - 1;

    // Auto-open task panel when any non-background task in current intention exceeds 1hr
    const hasLongTask = currentLinkedTasks.some(
        (lt) => !lt.completed && lt.type !== 'background' && lt.estimatedMinutes !== null && lt.estimatedMinutes > 60,
    );
    useEffect(() => {
        if (hasLongTask) setTaskPanelOpen(true);
    }, [hasLongTask]);

    const openTaskPanel = useCallback(() => setTaskPanelOpen(true), []);

    const handleNextIntention = () => {
        if (isLastIntention) {
            dispatch({ type: 'SET_WIZARD_STEP', step: 3 });
        } else {
            setCurrentIntentionIndex((i) => i + 1);
        }
    };

    const handleNext = () => {
        dispatch({ type: 'SET_WIZARD_STEP', step: 3 });
    };

    if (!currentIntention) {
        return (
            <WizardLayout canAdvance onNext={handleNext}>
                <div className="space-y-4 mt-4">
                    <h2 className="text-2xl font-semibold">Categorize your tasks</h2>
                    <p className="text-text-light text-sm">
                        No intentions found. Go back to Step 1 to create intentions and link tasks.
                    </p>
                </div>
            </WizardLayout>
        );
    }

    return (
        <WizardLayout canAdvance={canAdvanceStep} onNext={handleNext} wide hideNext>
            <div className="flex flex-col lg:flex-row gap-6 mt-4" style={{ minHeight: '60vh' }}>
                {/* Left panel: categorization + estimation */}
                <div className={`flex-shrink-0 space-y-5 overflow-y-auto transition-all ${taskPanelOpen ? 'lg:w-[40%]' : 'w-full max-w-3xl'}`}>
                    {/* Header */}
                    <div>
                        <h2 className="text-2xl font-semibold mb-1">Categorize &amp; estimate</h2>
                        <p className="text-text-light text-sm">
                            Set each task as main or background, then estimate how long it will take.
                        </p>
                    </div>

                    {/* Progress indicator */}
                    <div className="flex items-center gap-2">
                        <div className="flex gap-1">
                            {intentions.map((_, i) => (
                                <div
                                    key={i}
                                    className={`h-1.5 rounded-full transition-colors ${i < currentIntentionIndex ? 'bg-accent w-4' :
                                        i === currentIntentionIndex ? 'bg-accent w-6' :
                                            'bg-border w-4'
                                        }`}
                                />
                            ))}
                        </div>
                        <span className="text-xs text-text-light tabular-nums">
                            {currentIntentionIndex + 1} of {intentions.length}
                        </span>
                    </div>

                    {/* Intention title */}
                    <div className="rounded-lg border border-accent/30 bg-accent/[0.03] px-4 py-2.5 w-fit">
                        <h3 className="font-medium text-sm">{currentIntention.title}</h3>
                        <span className="text-xs text-text-light">
                            {currentLinkedTasks.length} task{currentLinkedTasks.length !== 1 ? 's' : ''} linked
                        </span>
                    </div>

                    {/* Tip */}
                    <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                        <p className="text-xs text-blue-900 dark:text-blue-200">
                            <strong>💡 Tip:</strong> Main tasks are primary work threads (30+ min).
                            Background tasks are habits/nudges (≤30 min each, can be scheduled multiple times).
                        </p>
                    </div>

                    {/* Tasks for current intention */}
                    <div className="space-y-3">
                        {currentLinkedTasks.length === 0 && (
                            <p className="text-xs text-text-light py-4 text-center">
                                No tasks linked to this intention.{' '}
                                <button onClick={openTaskPanel} className="text-accent hover:underline cursor-pointer">
                                    Open the task manager
                                </button>{' '}
                                to create and link tasks.
                            </p>
                        )}
                        {currentLinkedTasks.map((lt) => (
                            <TaskCard
                                key={lt.todoistId}
                                linkedTask={lt}
                                taskMap={taskMap}
                                horizontal={!taskPanelOpen}
                                onCategorize={(taskType) =>
                                    dispatch({ type: 'CATEGORIZE_TASK', todoistId: lt.todoistId, taskType })
                                }
                                onToggleHabit={() =>
                                    dispatch({ type: 'TOGGLE_TASK_HABIT', todoistId: lt.todoistId })
                                }
                                onSetEstimate={(minutes) =>
                                    dispatch({ type: 'SET_TASK_ESTIMATE', todoistId: lt.todoistId, minutes })
                                }
                                onUnlink={() =>
                                    dispatch({ type: 'UNLINK_TASK', todoistId: lt.todoistId })
                                }
                                onOpenTaskPanel={openTaskPanel}
                            />
                        ))}
                    </div>

                    {/* Navigation */}
                    <div className="flex items-center justify-between pt-2">
                        {currentIntentionIndex > 0 ? (
                            <button
                                onClick={() => setCurrentIntentionIndex((i) => i - 1)}
                                className="text-sm text-accent hover:underline cursor-pointer"
                            >
                                ← Previous intention
                            </button>
                        ) : (
                            <div />
                        )}
                        <button
                            onClick={handleNextIntention}
                            disabled={!canAdvanceIntention}
                            className={`px-4 py-2 text-sm rounded-lg transition-colors cursor-pointer ${canAdvanceIntention
                                ? 'bg-accent text-white hover:bg-accent/90'
                                : 'bg-border text-text-light cursor-not-allowed'
                                }`}
                        >
                            {isLastIntention ? 'Done — continue to scheduling →' : 'Done — next intention →'}
                        </button>
                    </div>

                    {!canAdvanceIntention && currentLinkedTasks.length > 0 && (
                        <p className="text-xs text-warning">
                            Categorize and estimate all tasks for this intention to continue.
                        </p>
                    )}
                </div>

                {/* Right panel: Todoist task panel (collapsible) */}
                {taskPanelOpen ? (
                    <div className="flex-1 min-w-0 flex flex-col">
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="text-sm font-medium text-text-light">Task Manager</h3>
                            <div className="flex items-center gap-3">
                                <span className="text-xs text-accent">
                                    Link tasks to: {currentIntention.title}
                                </span>
                                <button
                                    onClick={() => setTaskPanelOpen(false)}
                                    className="text-xs text-text-light hover:text-text cursor-pointer"
                                    title="Collapse task manager"
                                >
                                    ✕
                                </button>
                            </div>
                        </div>
                        <div className="flex-1 rounded-lg border border-border bg-card min-h-[400px]">
                            <TodoistPanel
                                mode="full"
                                onSetup={() => setShowSetup(true)}
                                showFilterToggle
                                linking={{
                                    linkingIntentionId: currentIntention.id,
                                    linkedTaskIds: currentIntention.linkedTaskIds,
                                    allLinkedTasks: plan.linkedTasks,
                                    intentionTitles: intentionTitleMap,
                                    onLinkTask: (todoistId) => dispatch({ type: 'LINK_TASK', intentionId: currentIntention.id, todoistId }),
                                    onUnlinkTask: (todoistId) => dispatch({ type: 'UNLINK_TASK', todoistId }),
                                }}
                            />
                        </div>
                    </div>
                ) : (
                    <button
                        onClick={openTaskPanel}
                        className="hidden lg:flex items-center gap-2 self-start px-4 py-2.5 text-xs rounded-lg border border-dashed border-border text-text-light hover:border-accent hover:text-accent transition-colors cursor-pointer whitespace-nowrap"
                    >
                        <span>📋</span> Open Task Manager
                    </button>
                )}
            </div>

            {/* Integrations setup modal */}
            <Modal open={showSetup} onClose={() => setShowSetup(false)} title="Integrations">
                <TodoistSetup />
            </Modal>
        </WizardLayout>
    );
}

// ─── Task Card ───────────────────────────────────────────────────────────────

function TaskCard({
    linkedTask: lt,
    taskMap,
    horizontal,
    onCategorize,
    onToggleHabit,
    onSetEstimate,
    onUnlink,
    onOpenTaskPanel,
}: {
    linkedTask: LinkedTask;
    taskMap: Map<string, { id: string; content: string }>;
    horizontal?: boolean;
    onCategorize: (taskType: LinkedTask['type']) => void;
    onToggleHabit: () => void;
    onSetEstimate: (minutes: number) => void;
    onUnlink: () => void;
    onOpenTaskPanel: () => void;
}) {
    const [customInput, setCustomInput] = useState('');
    const todoistTask = taskMap.get(lt.todoistId);
    const isStale = !todoistTask && !lt.completed;
    const title = todoistTask?.content ?? lt.titleSnapshot ?? lt.todoistId;
    const isBackground = lt.type === 'background';

    // Completed tasks: compact read-only display
    if (lt.completed) {
        return (
            <div className="rounded-lg border border-success/30 bg-success/5 overflow-hidden">
                <div className="px-4 py-3 flex items-center gap-2">
                    <span className="text-sm">🎉</span>
                    <span className="text-sm line-through text-text-light flex-1 min-w-0 truncate">
                        {title}
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-success/10 text-success flex-shrink-0">
                        Completed
                    </span>
                </div>
            </div>
        );
    }

    const handleCustomEstimate = (value: string) => {
        const num = parseInt(value, 10);
        if (!isNaN(num) && num > 0) {
            const clamped = isBackground ? Math.min(num, BACKGROUND_MAX_MINUTES) : num;
            setCustomInput(String(clamped));
            onSetEstimate(clamped);
        } else {
            setCustomInput(value);
        }
    };

    const handlePreset = (minutes: number) => {
        if (isBackground && minutes > BACKGROUND_MAX_MINUTES) return;
        setCustomInput('');
        onSetEstimate(minutes);
    };

    const isPresetSelected = (minutes: number) =>
        lt.estimatedMinutes === minutes && customInput === '';

    const isCustom = lt.estimatedMinutes !== null && !ESTIMATE_PRESETS.includes(lt.estimatedMinutes);

    const categoryPills = (
        <div className="flex items-center gap-1.5 flex-wrap">
            {TYPE_OPTIONS.map((opt) => (
                <button
                    key={opt.value}
                    onClick={() => onCategorize(opt.value)}
                    className={`px-2.5 py-1 text-xs rounded-full border transition-colors cursor-pointer ${lt.type === opt.value
                        ? 'bg-accent text-white border-accent'
                        : 'border-border text-text-light hover:border-accent hover:text-accent'
                        }`}
                    title={opt.description}
                >
                    {opt.label}
                </button>
            ))}
            {isBackground && (
                <button
                    onClick={onToggleHabit}
                    className={`px-2 py-1 text-xs rounded-full border transition-colors cursor-pointer ${lt.isHabit
                        ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700'
                        : 'border-border text-text-light hover:border-amber-400 hover:text-amber-600'
                        }`}
                    title={lt.isHabit ? 'Marked as habit — click to unmark' : 'Mark as recurring habit'}
                >
                    🔄 Habit
                </button>
            )}
        </div>
    );

    const estimateSection = lt.type !== 'unclassified' && (
        <div className="space-y-1.5">
            {!horizontal && (
                <span className="text-[10px] font-medium text-text-light uppercase tracking-wider">
                    ⏱ Time estimate
                </span>
            )}
            <div className="flex items-center gap-1.5 flex-wrap">
                {horizontal && (
                    <span className="text-[10px] font-medium text-text-light uppercase tracking-wider mr-1">
                        ⏱
                    </span>
                )}
                {ESTIMATE_PRESETS.map((minutes) => {
                    const disabled = isBackground && minutes > BACKGROUND_MAX_MINUTES;
                    return (
                        <button
                            key={minutes}
                            onClick={() => handlePreset(minutes)}
                            disabled={disabled}
                            className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${disabled
                                ? 'border-border text-text-light/40 cursor-not-allowed'
                                : isPresetSelected(minutes)
                                    ? 'bg-accent text-white border-accent'
                                    : 'border-border text-text-light hover:border-accent hover:text-accent cursor-pointer'
                                }`}
                        >
                            {minutes >= 60 ? `${minutes / 60}hr` : `${minutes}m`}
                        </button>
                    );
                })}
                <input
                    type="number"
                    min={1}
                    max={isBackground ? BACKGROUND_MAX_MINUTES : undefined}
                    placeholder="min"
                    value={isCustom && customInput === '' ? lt.estimatedMinutes ?? '' : customInput}
                    onChange={(e) => handleCustomEstimate(e.target.value)}
                    className={`w-16 px-2 py-1 text-xs rounded-lg border text-center transition-colors ${isCustom
                        ? 'border-accent bg-accent/5'
                        : 'border-border'
                        }`}
                />
            </div>

            {/* Background cap message */}
            {isBackground && (
                <p className="text-[10px] text-text-light">
                    Capped at 30 min per scheduling (can be scheduled multiple times/day)
                </p>
            )}

            {/* Over 1hr nudge */}
            {lt.estimatedMinutes !== null && lt.estimatedMinutes > 60 && !isBackground && (
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2 mt-1">
                    <p className="text-xs text-amber-800 dark:text-amber-300">
                        This task is over an hour. Create a new task for the overflow.{' '}
                        <button
                            onClick={onOpenTaskPanel}
                            className="font-medium underline hover:no-underline cursor-pointer"
                        >
                            Open task manager →
                        </button>
                    </p>
                </div>
            )}
        </div>
    );

    if (horizontal) {
        return (
            <div className={`rounded-lg border bg-card overflow-hidden ${isStale ? 'opacity-50 border-border' : 'border-border'}`}>
                <div className="px-4 py-3 flex items-center gap-4 flex-wrap">
                    {/* Title */}
                    <span className={`text-sm font-medium min-w-0 truncate ${isStale ? 'italic' : ''}`}>
                        {isStale && <span className="mr-1" title="Task not found in Todoist">⚠</span>}
                        {title}
                    </span>
                    {isStale && (
                        <button onClick={onUnlink} className="text-xs text-red-500 hover:underline cursor-pointer flex-shrink-0">Remove</button>
                    )}
                    {!isStale && (
                        <>
                            <div className="h-4 w-px bg-border flex-shrink-0" />
                            {categoryPills}
                            {lt.type !== 'unclassified' && (
                                <>
                                    <div className="h-4 w-px bg-border flex-shrink-0" />
                                    {estimateSection}
                                </>
                            )}
                        </>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className={`rounded-lg border bg-card overflow-hidden ${isStale ? 'opacity-50 border-border' : 'border-border'}`}>
            <div className="px-4 py-3 space-y-2.5">
                {/* Task title */}
                <div className="flex items-center gap-2">
                    <span className={`text-sm font-medium flex-1 min-w-0 truncate ${isStale ? 'italic' : ''}`}>
                        {isStale && <span className="mr-1" title="Task not found in Todoist">⚠</span>}
                        {title}
                    </span>
                    {isStale && (
                        <button
                            onClick={onUnlink}
                            className="text-xs text-red-500 hover:underline cursor-pointer flex-shrink-0"
                        >
                            Remove
                        </button>
                    )}
                </div>

                {!isStale && (
                    <>
                        {categoryPills}
                        {estimateSection}
                    </>
                )}
            </div>
        </div>
    );
}
