import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { WizardLayout } from './WizardLayout';
import { useDayPlan } from '../../context/DayPlanContext';
import { useTodoist } from '../../hooks/useTodoist';
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
    const { taskMap } = useTodoist();
    const [currentIntentionIndex, setCurrentIntentionIndex] = useState(0);
    const [showSetup, setShowSetup] = useState(false);
    const [taskPanelFiltered, setTaskPanelFiltered] = useState(false);
    const [filteredPanelHeight, setFilteredPanelHeight] = useState<number | null>(null);
    const panelRef = useRef<HTMLDivElement>(null);

    // Measure the panel's natural height when in filtered mode
    useEffect(() => {
        if (!taskPanelFiltered || !panelRef.current) return;
        const el = panelRef.current;
        const measure = () => setFilteredPanelHeight(el.scrollHeight);
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        return () => observer.disconnect();
    }, [taskPanelFiltered, currentIntentionIndex, plan.linkedTasks.length]);

    const intentions = plan.intentions;
    const currentIntention = intentions[currentIntentionIndex];

    const intentionTitleMap = useMemo(
        () => Object.fromEntries(plan.intentions.map((i) => [i.id, i.title])),
        [plan.intentions],
    );

    const canAdvanceStep = plan.linkedTasks.length > 0 &&
        plan.linkedTasks.every((lt) => lt.type !== 'unclassified' && lt.estimatedMinutes !== null);

    const currentLinkedTasks = currentIntention
        ? plan.linkedTasks.filter((lt) => lt.intentionId === currentIntention.id)
        : [];

    const canAdvanceIntention = currentLinkedTasks.length > 0 &&
        currentLinkedTasks.every((lt) => lt.type !== 'unclassified' && lt.estimatedMinutes !== null);

    const isLastIntention = currentIntentionIndex >= intentions.length - 1;

    const linkedTaskIds = useMemo(
        () => new Set(plan.linkedTasks.map((lt) => lt.todoistId)),
        [plan.linkedTasks],
    );

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
                <div className="lg:w-[40%] flex-shrink-0 space-y-5 overflow-y-auto">
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
                    <div className="rounded-lg border border-accent/30 bg-accent/[0.03] px-4 py-3">
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
                                No tasks linked to this intention. Use the task panel on the right to create and link tasks.
                            </p>
                        )}
                        {currentLinkedTasks.map((lt) => (
                            <TaskCard
                                key={lt.todoistId}
                                linkedTask={lt}
                                taskMap={taskMap}
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

                {/* Right panel: Todoist task panel */}
                <div className="flex-1 min-w-0 flex flex-col">
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                            <h3 className="text-sm font-medium text-text-light">Task Manager</h3>
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={() => setTaskPanelFiltered(false)}
                                    className={`px-2 py-0.5 text-[10px] rounded-full border transition-colors cursor-pointer ${!taskPanelFiltered
                                        ? 'bg-accent text-white border-accent'
                                        : 'border-border text-text-light hover:border-accent hover:text-accent'
                                        }`}
                                >
                                    All Tasks
                                </button>
                                <button
                                    onClick={() => setTaskPanelFiltered(true)}
                                    className={`px-2 py-0.5 text-[10px] rounded-full border transition-colors cursor-pointer ${taskPanelFiltered
                                        ? 'bg-accent text-white border-accent'
                                        : 'border-border text-text-light hover:border-accent hover:text-accent'
                                        }`}
                                >
                                    Linked Tasks
                                </button>
                            </div>
                        </div>
                        <span className="text-xs text-accent">
                            Link tasks to: {currentIntention.title}
                        </span>
                    </div>
                    <div
                        ref={panelRef}
                        className="flex-1 rounded-lg border border-border bg-card min-h-[400px]"
                        style={!taskPanelFiltered && filteredPanelHeight
                            ? { maxHeight: filteredPanelHeight, overflowY: 'auto' }
                            : undefined
                        }
                    >
                        <TodoistPanel
                            mode="full"
                            onSetup={() => setShowSetup(true)}
                            linking={{
                                linkingIntentionId: currentIntention.id,
                                linkedTaskIds: currentIntention.linkedTaskIds,
                                allLinkedTasks: plan.linkedTasks,
                                intentionTitles: intentionTitleMap,
                                onLinkTask: (todoistId) => dispatch({ type: 'LINK_TASK', intentionId: currentIntention.id, todoistId }),
                                onUnlinkTask: (todoistId) => dispatch({ type: 'UNLINK_TASK', todoistId }),
                            }}
                            filterToTaskIds={taskPanelFiltered ? linkedTaskIds : undefined}
                        />
                    </div>
                </div>
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
    onCategorize,
    onToggleHabit,
    onSetEstimate,
    onUnlink,
}: {
    linkedTask: LinkedTask;
    taskMap: Map<string, { id: string; content: string }>;
    onCategorize: (taskType: LinkedTask['type']) => void;
    onToggleHabit: () => void;
    onSetEstimate: (minutes: number) => void;
    onUnlink: () => void;
}) {
    const [customInput, setCustomInput] = useState('');
    const todoistTask = taskMap.get(lt.todoistId);
    const isStale = !todoistTask;
    const title = todoistTask?.content ?? lt.todoistId;
    const isBackground = lt.type === 'background';

    const handleCustomEstimate = (value: string) => {
        setCustomInput(value);
        const num = parseInt(value, 10);
        if (!isNaN(num) && num > 0) {
            const clamped = isBackground ? Math.min(num, BACKGROUND_MAX_MINUTES) : num;
            onSetEstimate(clamped);
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
                        {/* Categorization pills + habit toggle */}
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

                        {/* Time estimate */}
                        {lt.type !== 'unclassified' && (
                            <div className="space-y-1.5">
                                <span className="text-[10px] font-medium text-text-light uppercase tracking-wider">
                                    ⏱ Time estimate
                                </span>
                                <div className="flex items-center gap-1.5 flex-wrap">
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
                                            This task is over an hour. Consider breaking it into smaller parts using the task panel →
                                        </p>
                                    </div>
                                )}
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
