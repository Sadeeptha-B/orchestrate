import { WizardLayout } from './WizardLayout';
import { EditableTaskList } from '../ui/EditableTaskList';
import { useDayPlan } from '../../context/DayPlanContext';
import type { Task } from '../../types';

const TYPE_OPTIONS: { value: Task['type']; label: string; description: string }[] = [
    { value: 'main', label: 'Main', description: 'Primary work thread for the day' },
    { value: 'background', label: 'Background', description: 'Recurring habit or small task' },
];

export function Step3Categorize() {
    const { plan, dispatch } = useDayPlan();

    const allCategorized = plan.tasks.every((t) => t.type !== 'unclassified');

    const handleNext = () => {
        dispatch({ type: 'SET_WIZARD_STEP', step: 4 });
    };

    return (
        <WizardLayout canAdvance={allCategorized} onNext={handleNext}>
            <div className="space-y-6 mt-4">
                <div>
                    <h2 className="text-2xl font-semibold mb-2">Categorize your tasks</h2>
                    <p className="text-text-light text-sm">
                        Main tasks are the primary work threads for the day (e.g., implementing a feature).
                        Background tasks are recurring habits (e.g., reading, exercises).
                    </p>
                </div>

                <EditableTaskList
                    tasks={plan.tasks}
                    renderRight={(task) => (
                        <div className="flex gap-1.5">
                            {TYPE_OPTIONS.map((opt) => (
                                <button
                                    key={opt.value}
                                    onClick={() =>
                                        dispatch({
                                            type: 'CATEGORIZE_TASK',
                                            taskId: task.id,
                                            taskType: opt.value,
                                        })
                                    }
                                    className={`px-2.5 py-1 text-xs rounded-full border transition-colors cursor-pointer ${task.type === opt.value
                                            ? 'bg-accent text-white border-accent'
                                            : 'border-border text-text-light hover:border-accent hover:text-accent'
                                        }`}
                                    title={opt.description}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                    )}
                />

                {!allCategorized && (
                    <p className="text-xs text-warning">
                        Categorize all tasks to continue.
                    </p>
                )}
            </div>
        </WizardLayout>
    );
}
