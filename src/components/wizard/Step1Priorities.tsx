import { useState, type KeyboardEvent } from 'react';
import { WizardLayout } from './WizardLayout';
import { Button } from '../ui/Button';
import { EditableTaskList } from '../ui/EditableTaskList';
import { useDayPlan } from '../../context/DayPlanContext';

export function Step1Priorities() {
    const { plan, dispatch } = useDayPlan();
    const [input, setInput] = useState('');

    const addTask = () => {
        const title = input.trim();
        if (!title) return;
        dispatch({ type: 'ADD_TASK', title });
        setInput('');
    };

    const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addTask();
        }
    };

    const handleNext = () => {
        dispatch({ type: 'SET_WIZARD_STEP', step: 2 });
    };

    return (
        <WizardLayout canAdvance={plan.tasks.length > 0} onNext={handleNext}>
            <div className="space-y-6 mt-4">
                <div>
                    <h2 className="text-2xl font-semibold mb-2">
                        What are the main things on your mind today?
                    </h2>
                    <p className="text-text-light text-sm">
                        Write down your priorities — tasks, projects, anything you need to get done.
                        Click a task to edit it, drag to reorder.
                    </p>
                </div>

                <div className="flex gap-2">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Add a task..."
                        className="flex-1 px-4 py-2 rounded-lg border border-border bg-card text-text text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-colors"
                    />
                    <Button onClick={addTask} disabled={!input.trim()} size="md">
                        Add
                    </Button>
                </div>

                <EditableTaskList tasks={plan.tasks} />
            </div>
        </WizardLayout>
    );
}
