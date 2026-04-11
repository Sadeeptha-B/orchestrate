import { WizardLayout } from './WizardLayout';
import { EditableTaskList } from '../ui/EditableTaskList';
import { useDayPlan } from '../../context/DayPlanContext';
import type { Intention } from '../../types';

const TYPE_OPTIONS: { value: Intention['type']; label: string; description: string }[] = [
    { value: 'main', label: 'Main', description: 'Primary work thread for the day' },
    { value: 'background', label: 'Background', description: 'Recurring habit or nudge task' },
];

export function Step3Categorize() {
    const { plan, dispatch } = useDayPlan();

    const allCategorized = plan.intentions.every((i) => i.type !== 'unclassified');

    const handleNext = () => {
        dispatch({ type: 'SET_WIZARD_STEP', step: 4 });
    };

    return (
        <WizardLayout canAdvance={allCategorized} onNext={handleNext}>
            <div className="space-y-6 mt-4">
                <div>
                    <h2 className="text-2xl font-semibold mb-2">Categorize your intentions</h2>
                    <p className="text-text-light text-sm">
                        Main intentions are the primary work threads for the day (e.g., implementing a feature).
                        Background intentions are recurring habits or smaller nudge tasks (e.g., reading, exercises).
                    </p>
                </div>

                <EditableTaskList
                    tasks={plan.intentions}
                    renderRight={(intention) => (
                        <div className="flex items-center gap-1.5">
                            {TYPE_OPTIONS.map((opt) => (
                                <button
                                    key={opt.value}
                                    onClick={() =>
                                        dispatch({
                                            type: 'CATEGORIZE_INTENTION',
                                            intentionId: intention.id,
                                            intentionType: opt.value,
                                        })
                                    }
                                    className={`px-2.5 py-1 text-xs rounded-full border transition-colors cursor-pointer ${intention.type === opt.value
                                        ? 'bg-accent text-white border-accent'
                                        : 'border-border text-text-light hover:border-accent hover:text-accent'
                                        }`}
                                    title={opt.description}
                                >
                                    {opt.label}
                                </button>
                            ))}
                            {intention.type === 'background' && (
                                <button
                                    onClick={() => dispatch({ type: 'TOGGLE_HABIT', intentionId: intention.id })}
                                    className={`px-2 py-1 text-xs rounded-full border transition-colors cursor-pointer ${intention.isHabit
                                            ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700'
                                            : 'border-border text-text-light hover:border-amber-400 hover:text-amber-600'
                                        }`}
                                    title={intention.isHabit ? 'Marked as habit — click to unmark' : 'Mark as recurring habit'}
                                >
                                    🔄 Habit
                                </button>
                            )}
                        </div>
                    )}
                />

                {!allCategorized && (
                    <p className="text-xs text-warning">
                        Categorize all intentions to continue.
                    </p>
                )}
            </div>
        </WizardLayout>
    );
}
