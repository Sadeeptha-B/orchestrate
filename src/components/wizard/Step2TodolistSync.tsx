import { WizardLayout } from './WizardLayout';
import { useDayPlan } from '../../context/DayPlanContext';

const CHECKLIST_ITEMS = [
    { key: 'reviewTodolist', label: 'I have reviewed my external todolist' },
    { key: 'createEvents', label: 'I have created / updated calendar events as needed' },
    { key: 'breakDownTasks', label: 'I have broken down any large tasks' },
];

export function Step2TodolistSync() {
    const { plan, dispatch } = useDayPlan();

    const handleNext = () => {
        dispatch({ type: 'SET_WIZARD_STEP', step: 3 });
    };

    return (
        <WizardLayout onNext={handleNext}>
            <div className="space-y-6 mt-4">
                <div>
                    <h2 className="text-2xl font-semibold mb-2">
                        Sync with your todolist and calendar
                    </h2>
                    <p className="text-text-light text-sm">
                        Compare the tasks you just entered against your external todolist and calendar.
                        Make sure everything is consistent before you continue.
                    </p>
                </div>

                <div className="bg-white rounded-lg border border-border p-4">
                    <h3 className="text-sm font-medium text-text-light mb-3">Your tasks so far</h3>
                    <ul className="space-y-1.5 mb-4">
                        {plan.tasks.map((task) => (
                            <li key={task.id} className="text-sm pl-4 relative before:content-['•'] before:absolute before:left-0 before:text-accent">
                                {task.title}
                            </li>
                        ))}
                    </ul>
                </div>

                <div className="space-y-3">
                    <h3 className="text-sm font-medium">Quick checklist</h3>
                    {CHECKLIST_ITEMS.map((item) => (
                        <label
                            key={item.key}
                            className="flex items-center gap-3 px-4 py-3 bg-white rounded-lg border border-border cursor-pointer hover:bg-surface-dark/50 transition-colors"
                        >
                            <input
                                type="checkbox"
                                checked={plan.syncChecklist[item.key] ?? false}
                                onChange={() => dispatch({ type: 'TOGGLE_SYNC_ITEM', key: item.key })}
                                className="w-4 h-4 rounded border-border text-accent focus:ring-accent/30 accent-accent"
                            />
                            <span className="text-sm">{item.label}</span>
                        </label>
                    ))}
                </div>

                <p className="text-xs text-text-light">
                    You can skip items — this is just a gentle nudge to stay consistent.
                </p>
            </div>
        </WizardLayout>
    );
}
