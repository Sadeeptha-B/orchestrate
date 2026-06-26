import { useState, useMemo, useCallback, useEffect } from 'react';
import { WizardLayout } from './WizardLayout';
import { useDayPlan } from '../../hooks/useDayPlan';
import { useTodoistData } from '../../hooks/useTodoist';
import { TodoistPanel } from '../todoist/TodoistPanel';
import { TodoistSetup } from '../todoist/TodoistSetup';
import { Modal } from '../ui/Modal';
import { ConfirmModal } from '../ui/ConfirmModal';
import { useConfirmModal } from '../../hooks/useConfirmModal';
import { useIntentionRemoval } from '../../hooks/useIntentionRemoval';
import { DEFAULT_TASK_CAPS } from '../../lib/capacity';
import type { Intention, LinkedTask } from '../../types';

type Phase = 'overview' | 'scheduling';

/**
 * Task-manager panel state. `auto` defers to the long-task heuristic so the panel
 * pops open when an estimate first exceeds 60min. Once the user explicitly opens
 * or closes the panel, their intent sticks for the rest of the Refine step.
 */
type PanelIntent = 'auto' | 'open' | 'closed';

const TYPE_OPTIONS: { value: LinkedTask['type']; label: string; description: string }[] = [
    { value: 'main', label: 'Main', description: 'Primary work thread for the day' },
    { value: 'background', label: 'Background', description: 'Recurring habit or nudge task' },
];

const ESTIMATE_PRESETS = [15, 30, 45, 60];

/** Threshold (minutes) above which a non-background task triggers the "consider breaking down" nudge. */
const LONG_TASK_THRESHOLD = 60;

export function Step3Refine() {
    const { plan, settings, dispatch } = useDayPlan();
    const { taskMap } = useTodoistData();
    const [phase, setPhase] = useState<Phase>('overview');
    const [selectedIntentionId, setSelectedIntentionId] = useState<string | null>(null);
    const [showSetup, setShowSetup] = useState(false);
    const [panelIntent, setPanelIntent] = useState<PanelIntent>('auto');

    const { moveToBacklog, removeIntention } = useIntentionRemoval();
    const confirmDelete = useConfirmModal<Intention>();

    const intentions = plan.intentions;

    // v6.1: the Refine step only refines tasks attached to user intentions. Orphan habit-tasks
    // arrive pre-typed/estimated from injection and bypass this step entirely.
    const manualLinkedTasks = useMemo(
        () => plan.linkedTasks.filter((lt) => lt.intentionId !== undefined),
        [plan.linkedTasks],
    );

    // Manually-categorized backgrounds use the manualBackground cap.
    const backgroundCap = (settings.taskCapDefaults ?? DEFAULT_TASK_CAPS).manualBackground;

    const intentionTitleMap = useMemo(
        () => Object.fromEntries(plan.intentions.map((i) => [i.id, i.title])),
        [plan.intentions],
    );

    const canAdvanceStep =
        manualLinkedTasks.length > 0 &&
        manualLinkedTasks.every(
            (lt) => lt.completed || (lt.type !== 'unclassified' && lt.estimatedMinutes !== null),
        );

    const getIntentionTasks = useCallback(
        (intentionId: string) => plan.linkedTasks.filter((lt) => lt.intentionId === intentionId),
        [plan.linkedTasks],
    );

    const isIntentionComplete = useCallback(
        (intentionId: string) => {
            const tasks = getIntentionTasks(intentionId);
            return (
                tasks.length > 0 &&
                tasks.every(
                    (lt) => lt.completed || (lt.type !== 'unclassified' && lt.estimatedMinutes !== null),
                )
            );
        },
        [getIntentionTasks],
    );

    const completedIntentionCount = useMemo(
        () => intentions.filter((i) => isIntentionComplete(i.id)).length,
        [intentions, isIntentionComplete],
    );

    const selectedIntention = intentions.find((i) => i.id === selectedIntentionId) ?? null;
    const selectedTasks = selectedIntention ? getIntentionTasks(selectedIntention.id) : [];

    // Auto-open task panel when any non-background task in selected intention exceeds 1hr,
    // unless the user has explicitly opened or closed it.
    const hasLongTask = selectedTasks.some(
        (lt) =>
            !lt.completed &&
            lt.type !== 'background' &&
            lt.estimatedMinutes !== null &&
            lt.estimatedMinutes > LONG_TASK_THRESHOLD,
    );
    const taskPanelOpen = panelIntent === 'open' || (panelIntent === 'auto' && hasLongTask);

    const openTaskPanel = useCallback(() => setPanelIntent('open'), []);
    const closeTaskPanel = useCallback(() => setPanelIntent('closed'), []);

    const enterScheduling = (intentionId: string) => {
        setSelectedIntentionId(intentionId);
        setPhase('scheduling');
        setPanelIntent('open');
    };

    const startScheduling = () => {
        const firstUncategorized = intentions.find((i) => !isIntentionComplete(i.id));
        enterScheduling(firstUncategorized?.id ?? intentions[0]?.id ?? '');
    };

    const handleToggle = (intentionId: string) => {
        setSelectedIntentionId((prev) => (prev === intentionId ? null : intentionId));
    };

    // Collapse the current intention and auto-open the next uncategorized one.
    const handleDone = (intentionId: string) => {
        const next = intentions.find((i) => i.id !== intentionId && !isIntentionComplete(i.id));
        setSelectedIntentionId(next?.id ?? null);
    };

    const handleNext = () => {
        dispatch({ type: 'SET_WIZARD_STEP', step: 4 });
    };

    if (intentions.length === 0) {
        return (
            <WizardLayout canAdvance onNext={handleNext}>
                <div className="space-y-4 mt-4">
                    <h2 className="text-2xl font-semibold">Categorize your tasks</h2>
                    <p className="text-text-light text-sm">
                        No intentions found. Go back to the Intentions step to create intentions and link tasks.
                    </p>
                </div>
            </WizardLayout>
        );
    }

    return (
        <WizardLayout canAdvance={canAdvanceStep} onNext={handleNext} wide>
            {phase === 'overview' ? (
                /* ── Phase 1: Overview — click any intention to jump straight in ── */
                <div className="space-y-5 mt-4 max-w-2xl">
                    <div>
                        <h2 className="text-2xl font-semibold mb-1">Categorize &amp; estimate</h2>
                        <p className="text-text-light text-sm">
                            You have {intentions.length} intention{intentions.length !== 1 ? 's' : ''} to work through.
                            For each one, you'll set tasks as main or background and estimate how long they'll take.
                        </p>
                    </div>

                    <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                        <p className="text-xs text-blue-900 dark:text-blue-200">
                            <strong>💡 Tip:</strong> Main tasks are primary work threads (30+ min).
                            Background tasks are small nudges with a short cap — they can be scheduled across multiple sessions.
                        </p>
                    </div>

                    <div className="space-y-2">
                        {intentions.map((intention) => {
                            const tasks = getIntentionTasks(intention.id);
                            return (
                                <button
                                    key={intention.id}
                                    onClick={() => enterScheduling(intention.id)}
                                    className="w-full rounded-lg border border-border bg-card px-4 py-3 flex items-center gap-3 text-left hover:border-accent/50 hover:bg-accent/[0.02] transition-colors cursor-pointer group"
                                >
                                    <span className="text-text-light text-sm flex-shrink-0 group-hover:text-accent transition-colors">▸</span>
                                    <span className="text-sm font-medium flex-1 min-w-0 truncate">
                                        {intention.title}
                                    </span>
                                    <span className="text-xs text-text-light flex-shrink-0 tabular-nums">
                                        {tasks.length} task{tasks.length !== 1 ? 's' : ''}
                                    </span>
                                </button>
                            );
                        })}
                    </div>

                    <button
                        onClick={startScheduling}
                        className="px-5 py-2.5 bg-accent text-white text-sm rounded-lg hover:bg-accent/90 transition-colors cursor-pointer"
                    >
                        Start categorizing →
                    </button>
                </div>
            ) : (
                /* ── Phase 2: Free-form accordion — any intention can be opened at any time ── */
                <div className="flex flex-col lg:flex-row gap-6 mt-4" style={{ minHeight: '60vh' }}>
                    {/* Left panel */}
                    <div
                        className={`flex-shrink-0 space-y-3 overflow-y-auto scrollbar-subtle transition-all ${taskPanelOpen ? 'lg:w-[40%]' : 'w-full max-w-3xl'
                            }`}
                    >
                        {/* Back to overview */}
                        <div className="flex justify-end">
                            <button
                                onClick={() => setPhase('overview')}
                                className="text-xs text-text-light hover:text-accent transition-colors cursor-pointer"
                            >
                                ← Restart
                            </button>
                        </div>

                        {/* Progress bar */}
                        <div className="mb-1">
                            <div className="flex justify-between text-xs text-text-light mb-1.5">
                                <span>Categorization progress</span>
                                <span className="tabular-nums">{completedIntentionCount}/{intentions.length}</span>
                            </div>
                            <div className="h-1.5 bg-surface-dark rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-accent rounded-full transition-all duration-500 ease-out"
                                    style={{
                                        width: intentions.length > 0
                                            ? `${(completedIntentionCount / intentions.length) * 100}%`
                                            : '0%',
                                    }}
                                />
                            </div>
                        </div>

                        {/* Accordion: all intentions, freely openable */}
                        {intentions.map((intention) => {
                            const tasks = getIntentionTasks(intention.id);
                            const complete = isIntentionComplete(intention.id);
                            const isSelected = selectedIntentionId === intention.id;
                            const canDone = tasks.length > 0 && tasks.every(
                                (lt) => lt.completed || (lt.type !== 'unclassified' && lt.estimatedMinutes !== null),
                            );

                            return (
                                <div
                                    key={intention.id}
                                    className={`rounded-lg border overflow-hidden transition-colors ${isSelected
                                        ? 'border-accent/40 bg-card'
                                        : complete
                                            ? 'border-success/30 bg-success/5'
                                            : 'border-border bg-card'
                                        }`}
                                >
                                    {/* Header row — always visible */}
                                    <div className="flex items-center gap-1 px-3 py-2.5">
                                        <button
                                            onClick={() => handleToggle(intention.id)}
                                            className="flex items-center gap-2 flex-1 min-w-0 text-left cursor-pointer"
                                        >
                                            <span className="w-4 text-center flex-shrink-0">
                                                {complete && !isSelected ? (
                                                    <svg className="w-4 h-4 text-success inline" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                                    </svg>
                                                ) : (
                                                    <svg
                                                        className={`w-3 h-3 text-text-light transition-transform ${isSelected ? 'rotate-90' : ''}`}
                                                        fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                                                    >
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                                    </svg>
                                                )}
                                            </span>
                                            <span className={`text-sm font-medium flex-1 min-w-0 truncate ${complete && !isSelected ? 'text-text-light' : ''}`}>
                                                {intention.title}
                                            </span>
                                            <span className="text-[10px] text-text-light flex-shrink-0 tabular-nums mr-1">
                                                {tasks.length} task{tasks.length !== 1 ? 's' : ''}
                                                {complete ? ' · done' : ''}
                                            </span>
                                        </button>
                                        <button
                                            onClick={() => void moveToBacklog(intention.id)}
                                            className="flex-shrink-0 px-1.5 py-0.5 rounded text-text-light hover:bg-surface-dark hover:text-accent transition-colors text-sm cursor-pointer"
                                            title="Move to backlog"
                                        >
                                            📥
                                        </button>
                                        <button
                                            onClick={() => confirmDelete.open(intention)}
                                            className="flex-shrink-0 px-1.5 py-0.5 rounded text-text-light hover:bg-surface-dark hover:text-red-400 transition-colors text-sm cursor-pointer"
                                            title="Delete"
                                        >
                                            🗑
                                        </button>
                                    </div>

                                    {/* Expanded content */}
                                    {isSelected && (
                                        <div className="border-t border-border/50 px-4 pb-4 pt-3 space-y-3">
                                            {/* Task cards */}
                                            <div className="space-y-3">
                                                {tasks.length === 0 && (
                                                    <p className="text-xs text-text-light py-4 text-center">
                                                        No tasks linked to this intention.{' '}
                                                        <button
                                                            onClick={openTaskPanel}
                                                            className="text-accent hover:underline cursor-pointer"
                                                        >
                                                            Open the task manager
                                                        </button>{' '}
                                                        to create and link tasks.
                                                    </p>
                                                )}
                                                {tasks.map((lt) => (
                                                    <TaskCard
                                                        key={lt.todoistId}
                                                        linkedTask={lt}
                                                        taskMap={taskMap}
                                                        horizontal={!taskPanelOpen}
                                                        backgroundCap={backgroundCap}
                                                        onCategorize={(taskType) =>
                                                            dispatch({ type: 'CATEGORIZE_TASK', todoistId: lt.todoistId, taskType })
                                                        }
                                                        onSetEstimate={(minutes) =>
                                                            dispatch({ type: 'SET_TASK_ESTIMATE', todoistId: lt.todoistId, minutes })
                                                        }
                                                        onSetFirstAction={(value) =>
                                                            dispatch({ type: 'APPEND_TASK_ENTRY_NOTE', todoistId: lt.todoistId, text: value, at: new Date().toISOString() })
                                                        }
                                                        onUnlink={() =>
                                                            dispatch({ type: 'UNLINK_TASK', todoistId: lt.todoistId })
                                                        }
                                                        onOpenTaskPanel={openTaskPanel}
                                                    />
                                                ))}
                                            </div>

                                            <div className="flex items-center justify-end pt-1">
                                                <button
                                                    onClick={() => handleDone(intention.id)}
                                                    disabled={!canDone}
                                                    className={`px-4 py-2 text-sm rounded-lg transition-colors cursor-pointer ${canDone
                                                        ? 'bg-accent text-white hover:bg-accent/90'
                                                        : 'bg-border text-text-light cursor-not-allowed'
                                                        }`}
                                                >
                                                    Done →
                                                </button>
                                            </div>

                                            {!canDone && tasks.length > 0 && (
                                                <p className="text-xs text-warning">
                                                    Categorize and estimate all tasks to continue.
                                                </p>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {/* Right panel: Todoist task panel */}
                    {taskPanelOpen && selectedIntention ? (
                        <div className="flex-1 min-w-0 flex flex-col">
                            <div className="flex items-center justify-between mb-2">
                                <h3 className="text-sm font-medium text-text-light">Task Manager</h3>
                                <div className="flex items-center gap-3">
                                    <span className="text-xs text-accent">
                                        Link tasks to: {selectedIntention.title}
                                    </span>
                                    <button
                                        onClick={closeTaskPanel}
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
                                        linkingIntentionId: selectedIntention.id,
                                        linkedTaskIds: selectedIntention.linkedTaskIds,
                                        allLinkedTasks: plan.linkedTasks,
                                        intentionTitles: intentionTitleMap,
                                        onLinkTask: (todoistId) =>
                                            dispatch({ type: 'LINK_TASK', intentionId: selectedIntention.id, todoistId }),
                                        onUnlinkTask: (todoistId) =>
                                            dispatch({ type: 'UNLINK_TASK', todoistId }),
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
            )}

            {/* Integrations setup modal */}
            <Modal open={showSetup} onClose={() => setShowSetup(false)} title="Integrations">
                <TodoistSetup />
            </Modal>

            <ConfirmModal
                open={confirmDelete.value !== null}
                onClose={confirmDelete.close}
                onConfirm={() =>
                    confirmDelete.value
                        ? removeIntention(confirmDelete.value.id)
                        : Promise.resolve()
                }
                title="Delete intention permanently?"
                confirmLabel="Delete"
            >
                <p className="text-sm text-text-light mb-4">
                    <strong>{confirmDelete.value?.title}</strong> will be removed from today.
                    Any linked tasks that are scheduled will be unscheduled.
                    To park it for later instead, cancel and click 📥.
                </p>
            </ConfirmModal>
        </WizardLayout>
    );
}

// ─── Task Card ───────────────────────────────────────────────────────────────

function TaskCard({
    linkedTask: lt,
    taskMap,
    horizontal,
    backgroundCap,
    onCategorize,
    onSetEstimate,
    onSetFirstAction,
    onUnlink,
    onOpenTaskPanel,
}: {
    linkedTask: LinkedTask;
    taskMap: Map<string, { id: string; content: string }>;
    horizontal?: boolean;
    backgroundCap: number;
    onCategorize: (taskType: LinkedTask['type']) => void;
    onSetEstimate: (minutes: number) => void;
    onSetFirstAction: (value: string) => void;
    onUnlink: () => void;
    onOpenTaskPanel: () => void;
}) {
    const [customInput, setCustomInput] = useState('');
    // v7.6: entry notes accumulate (APPEND_TASK_ENTRY_NOTE) — seed from the latest so re-edits dedup-no-op.
    const entryNote = [...(lt.contextTrail ?? [])].reverse().find((n) => n.kind === 'entry')?.text ?? '';
    const [firstActionInput, setFirstActionInput] = useState(entryNote);
    const todoistTask = taskMap.get(lt.todoistId);
    const isStale = !todoistTask && !lt.completed;
    const title = todoistTask?.content ?? lt.titleSnapshot ?? lt.todoistId;

    useEffect(() => {
        setFirstActionInput(entryNote);
    }, [entryNote]);

    const commitFirstAction = useCallback(() => {
        if (firstActionInput === entryNote) return;
        onSetFirstAction(firstActionInput);
    }, [entryNote, firstActionInput, onSetFirstAction]);
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
            const clamped = isBackground ? Math.min(num, backgroundCap) : num;
            setCustomInput(String(clamped));
            onSetEstimate(clamped);
        } else {
            setCustomInput(value);
        }
    };

    const handlePreset = (minutes: number) => {
        if (isBackground && minutes > backgroundCap) return;
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
        </div>
    );

    const estimateSection = lt.type !== 'unclassified' && (
        <div className="space-y-1.5">
            {!horizontal && (
                <span className="text-[10px] font-medium text-text-light uppercase tracking-wider">
                    ⏱ Time estimate
                </span>
            )}

            {/* Static proactive tip: shown in the full (non-horizontal) card for main tasks */}
            {!isBackground && !horizontal && (
                <p className="text-[10px] text-text-light">
                    Need more than 60 min?{' '}
                    <button
                        onClick={onOpenTaskPanel}
                        className="text-accent hover:underline cursor-pointer"
                    >
                        Split it into a new task in the task manager →
                    </button>
                </p>
            )}

            <div className="flex items-center gap-1.5 flex-wrap">
                {horizontal && (
                    <span className="text-[10px] font-medium text-text-light uppercase tracking-wider mr-1">
                        ⏱
                    </span>
                )}
                {ESTIMATE_PRESETS.map((minutes) => {
                    const disabled = isBackground && minutes > backgroundCap;
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
                    max={isBackground ? backgroundCap : undefined}
                    placeholder="min"
                    value={isCustom && customInput === '' ? lt.estimatedMinutes ?? '' : customInput}
                    onChange={(e) => handleCustomEstimate(e.target.value)}
                    className={`w-16 px-2 py-1 text-xs rounded-lg border text-center transition-colors ${isCustom ? 'border-accent bg-accent/5' : 'border-border'
                        }`}
                />
            </div>

            {/* Background cap message */}
            {isBackground && (
                <p className="text-[10px] text-text-light">
                    Capped at {backgroundCap} min per scheduling (can be scheduled multiple times/day)
                </p>
            )}

            {/* Over 1hr nudge — stronger confirmation once the value is already set */}
            {lt.estimatedMinutes !== null && lt.estimatedMinutes > LONG_TASK_THRESHOLD && !isBackground && (
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

    // v7.4: optional concrete entry point for main tasks — seeds the Focus Mode re-entry breadcrumb.
    // Strictly optional: never gates advancing the wizard.
    const firstActionSection = lt.type === 'main' && (
        <label className="block space-y-1">
            <span className="text-[10px] font-medium text-text-light uppercase tracking-wider">
                ▸ First concrete action <span className="normal-case font-normal">(optional)</span>
            </span>
            <input
                type="text"
                value={firstActionInput}
                onChange={(e) => setFirstActionInput(e.target.value)}
                onBlur={commitFirstAction}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                }}
                placeholder="e.g. open auth.ts, add the middleware stub"
                className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-border bg-card focus:border-accent focus:outline-none transition-colors"
            />
        </label>
    );

    if (horizontal) {
        return (
            <div
                className={`rounded-lg border bg-card overflow-hidden ${isStale ? 'opacity-50 border-border' : 'border-border'
                    }`}
            >
                <div className="px-4 py-3 flex items-center gap-4 flex-wrap">
                    <span className={`text-sm font-medium min-w-0 truncate ${isStale ? 'italic' : ''}`}>
                        {isStale && (
                            <span className="mr-1" title="Task not found in Todoist">
                                ⚠
                            </span>
                        )}
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
                            {firstActionSection && (
                                <>
                                    <div className="h-4 w-px bg-border flex-shrink-0" />
                                    <div className="min-w-[12rem] flex-1">{firstActionSection}</div>
                                </>
                            )}
                        </>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div
            className={`rounded-lg border bg-card overflow-hidden ${isStale ? 'opacity-50 border-border' : 'border-border'
                }`}
        >
            <div className="px-4 py-3 space-y-2.5">
                <div className="flex items-center gap-2">
                    <span
                        className={`text-sm font-medium flex-1 min-w-0 truncate ${isStale ? 'italic' : ''}`}
                    >
                        {isStale && (
                            <span className="mr-1" title="Task not found in Todoist">
                                ⚠
                            </span>
                        )}
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
                        {firstActionSection}
                    </>
                )}
            </div>
        </div>
    );
}
