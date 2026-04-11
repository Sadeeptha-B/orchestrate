import { WizardLayout } from './WizardLayout';
import { useDayPlan } from '../../context/DayPlanContext';

const TREVOR_URL = 'https://app.trevorai.com/app/';

const CHECKLIST_ITEMS = [
    { key: 'reviewTodolist', label: 'I have reviewed my external todolist' },
    { key: 'createEvents', label: 'I have created / updated calendar events as needed' },
];

export function Step2TodolistSync() {
    const { plan, dispatch } = useDayPlan();

    const allBrokenDown = plan.intentions.every((i) => i.brokenDown);

    const handleNext = () => {
        dispatch({ type: 'SET_WIZARD_STEP', step: 3 });
    };

    return (
        <WizardLayout onNext={handleNext} wide>
            <div className="flex flex-col lg:flex-row gap-6 mt-4" style={{ minHeight: '60vh' }}>
                {/* Left panel: intentions walkthrough */}
                <div className="lg:w-[40%] flex-shrink-0 space-y-5 overflow-y-auto">
                    <div>
                        <h2 className="text-2xl font-semibold mb-2">
                            Map intentions to your todolist
                        </h2>
                        <p className="text-text-light text-sm">
                            Loop through each intention and break it down into actionable tasks
                            in your todolist. Check off each one as you go.
                        </p>
                    </div>

                    {/* Intention breakdown list */}
                    <div className="space-y-2">
                        {plan.intentions.map((intention) => (
                            <label
                                key={intention.id}
                                className={`flex items-start gap-3 px-4 py-3 rounded-lg border cursor-pointer transition-colors ${intention.brokenDown
                                        ? 'bg-accent-subtle/40 border-accent/20'
                                        : 'bg-card border-border hover:border-accent/30'
                                    }`}
                            >
                                <input
                                    type="checkbox"
                                    checked={intention.brokenDown}
                                    onChange={() =>
                                        dispatch({
                                            type: 'MARK_BROKEN_DOWN',
                                            intentionId: intention.id,
                                            brokenDown: !intention.brokenDown,
                                        })
                                    }
                                    className="w-4 h-4 mt-0.5 rounded border-border text-accent focus:ring-accent/30 accent-accent flex-shrink-0"
                                />
                                <div className="min-w-0">
                                    <span className={`text-sm font-medium ${intention.brokenDown ? 'line-through text-text-light' : ''}`}>
                                        {intention.title}
                                    </span>
                                    {!intention.brokenDown && (
                                        <p className="text-xs text-text-light mt-0.5">
                                            Break this down into actionable tasks in your todolist →
                                        </p>
                                    )}
                                </div>
                            </label>
                        ))}
                    </div>

                    {allBrokenDown && plan.intentions.length > 0 && (
                        <p className="text-xs text-success font-medium">
                            All intentions broken down — nice work!
                        </p>
                    )}

                    {/* Secondary sync checklist */}
                    <div className="space-y-2 pt-2 border-t border-border">
                        <h3 className="text-xs font-medium text-text-light uppercase tracking-wider">
                            Quick checks
                        </h3>
                        {CHECKLIST_ITEMS.map((item) => (
                            <label
                                key={item.key}
                                className="flex items-center gap-3 px-4 py-2.5 bg-card rounded-lg border border-border cursor-pointer hover:bg-surface-dark/50 transition-colors"
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
                </div>

                {/* Right panel: Trevor AI iframe */}
                <div className="flex-1 min-w-0 flex flex-col">
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="text-sm font-medium text-text-light">Task Manager</h3>
                        <a
                            href={TREVOR_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-accent hover:underline"
                        >
                            Open in new tab ↗
                        </a>
                    </div>
                    <div className="flex-1 rounded-lg border border-border overflow-hidden bg-white" style={{ minHeight: 500 }}>
                        <iframe
                            src={TREVOR_URL}
                            title="Trevor AI — Task Manager"
                            className="w-full h-full border-0"
                            style={{ minHeight: 500 }}
                            sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
                        />
                    </div>
                </div>
            </div>
        </WizardLayout>
    );
}
