import { useState, type KeyboardEvent } from 'react';
import { WizardLayout } from './WizardLayout';
import { useDayPlan } from '../../context/DayPlanContext';
import { Button } from '../ui/Button';
import { EditableTaskList } from '../ui/EditableTaskList';
import { TodoistPanel } from '../todoist/TodoistPanel';

const CHECKLIST_ITEMS = [
    { key: 'reviewTodolist', label: 'I have reviewed my external todolist' },
    { key: 'createEvents', label: 'I have created / updated calendar events as needed' },
];

export function Step1Intentions() {
    const { plan, dispatch } = useDayPlan();
    const [input, setInput] = useState('');

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

    const allBrokenDown = plan.intentions.every((i) => i.brokenDown);

    const handleNext = () => {
        dispatch({ type: 'SET_WIZARD_STEP', step: 2 });
    };

    return (
        <WizardLayout canAdvance={plan.intentions.length > 0} onNext={handleNext} wide>
            <div className="flex flex-col lg:flex-row gap-6 mt-4" style={{ minHeight: '60vh' }}>
                {/* Left panel: intention entry + breakdown walkthrough */}
                <div className="lg:w-[40%] flex-shrink-0 space-y-5 overflow-y-auto">
                    <div>
                        <h2 className="text-2xl font-semibold mb-2">
                            Set &amp; map your intentions
                        </h2>
                        <p className="text-text-light text-sm">
                            Write down your specific goals for the day, then break each one
                            down into actionable tasks in your todolist.
                        </p>
                    </div>

                    {/* Add intention input */}
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Add an intention..."
                            className="flex-1 px-4 py-2 rounded-lg border border-border bg-card text-text text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-colors"
                        />
                        <Button onClick={addIntention} disabled={!input.trim()} size="md">
                            Add
                        </Button>
                    </div>

                    {/* Editable intention list */}
                    {plan.intentions.length > 0 && (
                        <EditableTaskList tasks={plan.intentions} />
                    )}

                    {/* Intention breakdown checklist */}
                    {plan.intentions.length > 0 && (
                        <div className="space-y-2 pt-2 border-t border-border">
                            <h3 className="text-xs font-medium text-text-light uppercase tracking-wider">
                                Break down into tasks
                            </h3>
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
                                                Break this down into actionable tasks →
                                            </p>
                                        )}
                                    </div>
                                </label>
                            ))}

                            {allBrokenDown && (
                                <p className="text-xs text-success font-medium">
                                    All intentions broken down — nice work!
                                </p>
                            )}
                        </div>
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

                {/* Right panel: Todoist task panel */}
                <div className="flex-1 min-w-0 flex flex-col">
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="text-sm font-medium text-text-light">Task Manager</h3>
                    </div>
                    <div className="flex-1 rounded-lg border border-border overflow-hidden bg-card" style={{ minHeight: 500 }}>
                        <TodoistPanel mode="full" />
                    </div>
                </div>
            </div>
        </WizardLayout>
    );
}
