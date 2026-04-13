import { useState, useRef, useCallback, useMemo, type KeyboardEvent } from 'react';
import { WizardLayout } from './WizardLayout';
import { useDayPlan } from '../../context/DayPlanContext';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { EditableTaskList } from '../ui/EditableTaskList';
import { TodoistPanel } from '../todoist/TodoistPanel';
import { TodoistSetup } from '../todoist/TodoistSetup';

export function Step1Intentions() {
    const { plan, settings, dispatch } = useDayPlan();
    const [input, setInput] = useState('');
    const [showSetup, setShowSetup] = useState(false);
    const [mappingStarted, setMappingStarted] = useState(
        () => plan.intentions.some((i) => i.brokenDown || i.linkedTaskIds.length > 0),
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
        const current = plan.intentions.find((i) => !i.brokenDown);
        if (trimmed && current && current.title !== trimmed) {
            dispatch({ type: 'UPDATE_INTENTION', intention: { ...current, title: trimmed } });
        }
        setEditingTitle(false);
        setEditValue('');
    }, [editValue, plan.intentions, dispatch]);

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

    const todoistConfigured = Boolean(
        settings.todoistToken && settings.todoistTokenIV && settings.todoistTokenKey,
    );
    const calendarConfigured = Boolean(
        settings.googleCalendarIds && settings.googleCalendarIds.length > 0,
    );
    const fullyConfigured = todoistConfigured && calendarConfigured;
    const [bannerDismissed, setBannerDismissed] = useState(false);

    // Build intention title lookup for linking mode
    const intentionTitleMap = useMemo(
        () => Object.fromEntries(plan.intentions.map((i) => [i.id, i.title])),
        [plan.intentions],
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

    const currentMappingIntention = plan.intentions.find((i) => !i.brokenDown);
    const brokenDownCount = plan.intentions.filter((i) => i.brokenDown).length;
    const allBrokenDown = plan.intentions.length > 0 && plan.intentions.every((i) => i.brokenDown);
    const upcomingCount = currentMappingIntention
        ? plan.intentions.filter((i) => !i.brokenDown && i.id !== currentMappingIntention.id).length
        : 0;

    const handleNext = () => {
        dispatch({ type: 'SET_WIZARD_STEP', step: 2 });
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
            {/* Onboarding banner when integrations are not configured */}
            {!fullyConfigured && !bannerDismissed && (
                <div className="mb-4 rounded-lg border border-accent/30 bg-accent-subtle/20 px-5 py-4 flex items-start gap-4">
                    <span className="text-2xl leading-none mt-0.5">🔗</span>
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-text">
                            Orchestrate works best with Todoist and Google Calendar
                        </p>
                        <p className="text-xs text-text-light mt-1">
                            {!todoistConfigured && !calendarConfigured
                                ? 'Connect your Todoist account and add your Google Calendar to get the full planning experience.'
                                : !todoistConfigured
                                    ? 'Connect your Todoist account to manage tasks directly from here.'
                                    : 'Add your Google Calendar to see your schedule alongside your tasks.'}
                        </p>
                        <div className="flex gap-2 mt-3">
                            <Button size="sm" variant="primary" onClick={() => setShowSetup(true)}>
                                Set up integrations
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setBannerDismissed(true)}>
                                Dismiss
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            <div className="flex flex-col lg:flex-row gap-6 mt-4" style={{ minHeight: '60vh' }}>
                {/* Left panel */}
                <div className="lg:w-[40%] flex-shrink-0 space-y-5 overflow-y-auto">
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

                            {/* Already mapped */}
                            {brokenDownCount > 0 && (
                                <div className="space-y-1">
                                    {plan.intentions
                                        .filter((i) => i.brokenDown)
                                        .map((intention) => (
                                            <button
                                                key={intention.id}
                                                onClick={() => dispatch({ type: 'MARK_BROKEN_DOWN', intentionId: intention.id, brokenDown: false })}
                                                className="flex items-center gap-2 px-3 py-1.5 text-sm text-text-light w-full text-left rounded-lg hover:bg-surface-dark/50 transition-colors cursor-pointer group"
                                                title="Click to remap this intention"
                                            >
                                                <svg
                                                    className="w-4 h-4 text-success flex-shrink-0"
                                                    fill="none"
                                                    viewBox="0 0 24 24"
                                                    stroke="currentColor"
                                                    strokeWidth={2}
                                                >
                                                    <path
                                                        strokeLinecap="round"
                                                        strokeLinejoin="round"
                                                        d="M5 13l4 4L19 7"
                                                    />
                                                </svg>
                                                <span className="line-through flex-1">{intention.title}</span>
                                                <span className="text-[11px] text-text-light/0 group-hover:text-text-light/60 transition-colors">
                                                    remap
                                                </span>
                                            </button>
                                        ))}
                                </div>
                            )}

                            {/* Current intention to map */}
                            {currentMappingIntention && (
                                <div className="bg-card rounded-lg border-2 border-accent/30 p-5 space-y-3">
                                    <div>
                                        <span className="text-xs font-medium text-accent uppercase tracking-wider">
                                            Current
                                        </span>
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
                                            Break this down into actionable tasks and link them using the checkboxes →
                                        </p>
                                        {currentMappingIntention.linkedTaskIds.length > 0 && (
                                            <p className="text-xs text-accent mt-1">
                                                {currentMappingIntention.linkedTaskIds.length} task{currentMappingIntention.linkedTaskIds.length !== 1 ? 's' : ''} linked
                                            </p>
                                        )}
                                    </div>
                                    <Button onClick={markCurrentBrokenDown} size="sm">
                                        Done — {upcomingCount > 0 ? 'next' : 'finish'}
                                    </Button>
                                </div>
                            )}

                            {/* Upcoming count */}
                            {upcomingCount > 0 && (
                                <p className="text-xs text-text-light">
                                    {upcomingCount} more intention{upcomingCount !== 1 ? 's' : ''} after this
                                </p>
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

                            {/* Restart mapping link — always visible during Phase 2 */}
                            <button
                                onClick={restartMapping}
                                className="text-xs text-text-light hover:text-accent transition-colors cursor-pointer"
                            >
                                Want to start over? Restart mapping
                            </button>
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
                            onSetup={() => setShowSetup(true)}
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

            {/* Integrations setup modal */}
            <Modal open={showSetup} onClose={() => setShowSetup(false)} title="Integrations">
                <TodoistSetup />
            </Modal>
        </WizardLayout>
    );
}
