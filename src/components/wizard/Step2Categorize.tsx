import { useState } from 'react';
import { WizardLayout } from './WizardLayout';
import { useDayPlan } from '../../context/DayPlanContext';
import { useTodoist } from '../../hooks/useTodoist';
import type { LinkedTask } from '../../types';

const TYPE_OPTIONS: { value: LinkedTask['type']; label: string; description: string }[] = [
    { value: 'main', label: 'Main', description: 'Primary work thread for the day' },
    { value: 'background', label: 'Background', description: 'Recurring habit or nudge task' },
];

export function Step2Categorize() {
    const { plan, dispatch } = useDayPlan();
    const { taskMap } = useTodoist();

    const allCategorized = plan.linkedTasks.length > 0 &&
        plan.linkedTasks.every((lt) => lt.type !== 'unclassified');

    const handleNext = () => {
        dispatch({ type: 'SET_WIZARD_STEP', step: 3 });
    };

    return (
        <WizardLayout canAdvance={allCategorized} onNext={handleNext}>
            <div className="space-y-6 mt-4">
                <div>
                    <h2 className="text-2xl font-semibold mb-2">Categorize your tasks</h2>
                    <p className="text-text-light text-sm">
                        Main tasks are the primary work threads for the day (e.g., implementing a feature).
                        Background tasks are recurring habits or smaller nudge tasks (e.g., reading, exercises)</p>
                </div>

                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-6">
                    <p className="text-sm text-blue-900 dark:text-blue-200">
                        <strong>💡 Tip:</strong> Anything that takes longer than 30 minutes is a main task
                    </p>
                </div>

                <div>
                    <h2 className="text-2xl font-semibold mb-2">Categorize your tasks</h2>
                    <p className="text-text-light text-sm">
                    </p>
                </div>

                {plan.intentions.map((intention) => (
                    <IntentionTaskGroup
                        key={intention.id}
                        intentionTitle={intention.title}
                        linkedTasks={plan.linkedTasks.filter((lt) => lt.intentionId === intention.id)}
                        taskMap={taskMap}
                        onCategorize={(todoistId, taskType) =>
                            dispatch({ type: 'CATEGORIZE_TASK', todoistId, taskType })
                        }
                        onToggleHabit={(todoistId) =>
                            dispatch({ type: 'TOGGLE_TASK_HABIT', todoistId })
                        }
                        onUnlink={(todoistId) =>
                            dispatch({ type: 'UNLINK_TASK', todoistId })
                        }
                    />
                ))}

                {plan.linkedTasks.length === 0 && (
                    <p className="text-xs text-text-light text-center py-4">
                        No tasks linked yet. Go back to Step 1 to link tasks to your intentions.
                    </p>
                )}

                {plan.linkedTasks.length > 0 && !allCategorized && (
                    <p className="text-xs text-warning">
                        Categorize all tasks to continue.
                    </p>
                )}
            </div>
        </WizardLayout>
    );
}

function IntentionTaskGroup({
    intentionTitle,
    linkedTasks,
    taskMap,
    onCategorize,
    onToggleHabit,
    onUnlink,
}: {
    intentionTitle: string;
    linkedTasks: LinkedTask[];
    taskMap: Map<string, { id: string; content: string }>;
    onCategorize: (todoistId: string, taskType: LinkedTask['type']) => void;
    onToggleHabit: (todoistId: string) => void;
    onUnlink: (todoistId: string) => void;
}) {
    const [collapsed, setCollapsed] = useState(false);

    return (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
            {/* Intention header */}
            <button
                onClick={() => setCollapsed((c) => !c)}
                className="w-full flex items-center gap-2 px-4 py-3 hover:bg-border/30 transition-colors cursor-pointer"
            >
                <span
                    className="text-[10px] text-text-light transition-transform w-3 flex-shrink-0"
                    style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}
                >
                    ▼
                </span>
                <span className="text-sm font-medium flex-1 text-left">{intentionTitle}</span>
                <span className="text-xs text-text-light tabular-nums">
                    {linkedTasks.length} task{linkedTasks.length !== 1 ? 's' : ''}
                </span>
            </button>

            {/* Tasks */}
            {!collapsed && (
                <div className="border-t border-border divide-y divide-border/50">
                    {linkedTasks.length === 0 && (
                        <p className="px-4 py-3 text-xs text-text-light">
                            No tasks linked to this intention.
                        </p>
                    )}
                    {linkedTasks.map((lt) => {
                        const todoistTask = taskMap.get(lt.todoistId);
                        const isStale = !todoistTask;
                        const title = todoistTask?.content ?? lt.todoistId;

                        return (
                            <div
                                key={lt.todoistId}
                                className={`flex items-center gap-3 px-4 py-2.5 ${isStale ? 'opacity-50' : ''}`}
                            >
                                {/* Task title */}
                                <span className={`text-sm flex-1 min-w-0 truncate ${isStale ? 'italic' : ''}`}>
                                    {isStale && <span className="mr-1" title="Task not found in Todoist">⚠</span>}
                                    {title}
                                </span>

                                {/* Stale: remove button */}
                                {isStale && (
                                    <button
                                        onClick={() => onUnlink(lt.todoistId)}
                                        className="text-xs text-red-500 hover:underline cursor-pointer flex-shrink-0"
                                    >
                                        Remove
                                    </button>
                                )}

                                {/* Categorization pills */}
                                {!isStale && (
                                    <div className="flex items-center gap-1.5 flex-shrink-0">
                                        {TYPE_OPTIONS.map((opt) => (
                                            <button
                                                key={opt.value}
                                                onClick={() => onCategorize(lt.todoistId, opt.value)}
                                                className={`px-2.5 py-1 text-xs rounded-full border transition-colors cursor-pointer ${lt.type === opt.value
                                                    ? 'bg-accent text-white border-accent'
                                                    : 'border-border text-text-light hover:border-accent hover:text-accent'
                                                    }`}
                                                title={opt.description}
                                            >
                                                {opt.label}
                                            </button>
                                        ))}
                                        {lt.type === 'background' && (
                                            <button
                                                onClick={() => onToggleHabit(lt.todoistId)}
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
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
