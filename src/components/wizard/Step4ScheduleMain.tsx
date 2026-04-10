import { WizardLayout } from './WizardLayout';
import { Card } from '../ui/Card';
import { useDayPlan } from '../../context/DayPlanContext';
import { useCurrentSession } from '../../hooks/useCurrentSession';

export function Step4ScheduleMain() {
    const { plan, settings, dispatch } = useDayPlan();
    const { remainingSessions } = useCurrentSession(settings.sessionSlots);

    const mainTasks = plan.tasks.filter((t) => t.type === 'main');

    const handleNext = () => {
        dispatch({ type: 'SET_WIZARD_STEP', step: 5 });
    };

    return (
        <WizardLayout onNext={handleNext}>
            <div className="space-y-6 mt-4">
                <div>
                    <h2 className="text-2xl font-semibold mb-2">Schedule main tasks</h2>
                    <p className="text-text-light text-sm">
                        Assign your main tasks to the remaining sessions for today. Click a task to assign
                        it to a session.
                    </p>
                </div>

                {/* Unassigned main tasks */}
                {mainTasks.filter((t) => !t.assignedSession).length > 0 && (
                    <div>
                        <h3 className="text-sm font-medium text-text-light mb-2">Unassigned</h3>
                        <div className="flex flex-wrap gap-2">
                            {mainTasks
                                .filter((t) => !t.assignedSession)
                                .map((task) => (
                                    <span
                                        key={task.id}
                                        className="px-3 py-1.5 text-xs rounded-full bg-accent-subtle text-accent border border-accent/20"
                                    >
                                        {task.title}
                                    </span>
                                ))}
                        </div>
                    </div>
                )}

                {/* Session slots */}
                <div className="space-y-4">
                    {remainingSessions.map((session) => {
                        const assignedIds = plan.taskSessions[session.id] ?? [];
                        const assigned = mainTasks.filter((t) => assignedIds.includes(t.id));
                        const unassigned = mainTasks.filter((t) => !t.assignedSession);

                        return (
                            <Card key={session.id}>
                                <div className="flex items-center justify-between mb-3">
                                    <h3 className="font-medium text-sm">{session.name}</h3>
                                    <span className="text-xs text-text-light">
                                        {session.startTime} – {session.endTime}
                                    </span>
                                </div>

                                {/* Assigned tasks */}
                                {assigned.length > 0 && (
                                    <div className="flex flex-wrap gap-2 mb-3">
                                        {assigned.map((task) => (
                                            <button
                                                key={task.id}
                                                onClick={() =>
                                                    dispatch({
                                                        type: 'UNASSIGN_TASK',
                                                        taskId: task.id,
                                                        sessionId: session.id,
                                                    })
                                                }
                                                className="px-3 py-1.5 text-xs rounded-full bg-accent text-white cursor-pointer hover:bg-accent/80 transition-colors"
                                                title="Click to unassign"
                                            >
                                                {task.title} ×
                                            </button>
                                        ))}
                                    </div>
                                )}

                                {/* Assign buttons */}
                                {unassigned.length > 0 && (
                                    <div className="flex flex-wrap gap-2">
                                        {unassigned.map((task) => (
                                            <button
                                                key={task.id}
                                                onClick={() =>
                                                    dispatch({
                                                        type: 'ASSIGN_TASK',
                                                        taskId: task.id,
                                                        sessionId: session.id,
                                                    })
                                                }
                                                className="px-3 py-1.5 text-xs rounded-full border border-dashed border-border text-text-light hover:border-accent hover:text-accent cursor-pointer transition-colors"
                                            >
                                                + {task.title}
                                            </button>
                                        ))}
                                    </div>
                                )}

                                {assigned.length === 0 && unassigned.length === 0 && (
                                    <p className="text-xs text-text-light">No main tasks to assign</p>
                                )}
                            </Card>
                        );
                    })}
                </div>

                {remainingSessions.length === 0 && (
                    <p className="text-sm text-text-light">
                        No sessions remaining today. You can still continue to the next step.
                    </p>
                )}
            </div>
        </WizardLayout>
    );
}
