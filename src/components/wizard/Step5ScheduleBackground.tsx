import { WizardLayout } from './WizardLayout';
import { Card } from '../ui/Card';
import { useDayPlan } from '../../context/DayPlanContext';
import { useCurrentSession } from '../../hooks/useCurrentSession';

export function Step5ScheduleBackground() {
    const { plan, settings, dispatch } = useDayPlan();
    const { remainingSessions } = useCurrentSession(settings.sessionSlots);

    const backgroundTasks = plan.tasks.filter((t) => t.type === 'background');

    const handleNext = () => {
        dispatch({ type: 'SET_WIZARD_STEP', step: 6 });
    };

    return (
        <WizardLayout onNext={handleNext}>
            <div className="space-y-6 mt-4">
                <div>
                    <h2 className="text-2xl font-semibold mb-2">Schedule background tasks</h2>
                    <p className="text-text-light text-sm">
                        Fill in the gaps with your recurring habits and smaller tasks. Main tasks are shown
                        for context.
                    </p>
                </div>

                {/* Unassigned background tasks */}
                {backgroundTasks.filter((t) => !t.assignedSession).length > 0 && (
                    <div>
                        <h3 className="text-sm font-medium text-text-light mb-2">Unassigned</h3>
                        <div className="flex flex-wrap gap-2">
                            {backgroundTasks
                                .filter((t) => !t.assignedSession)
                                .map((task) => (
                                    <span
                                        key={task.id}
                                        className="px-3 py-1.5 text-xs rounded-full bg-surface-dark text-text-light border border-border"
                                    >
                                        {task.title}
                                    </span>
                                ))}
                        </div>
                    </div>
                )}

                <div className="space-y-4">
                    {remainingSessions.map((session) => {
                        const assignedIds = plan.taskSessions[session.id] ?? [];
                        const mainInSession = plan.tasks.filter(
                            (t) => t.type === 'main' && assignedIds.includes(t.id),
                        );
                        const bgInSession = backgroundTasks.filter((t) => assignedIds.includes(t.id));
                        const unassigned = backgroundTasks.filter((t) => !t.assignedSession);

                        return (
                            <Card key={session.id}>
                                <div className="flex items-center justify-between mb-3">
                                    <h3 className="font-medium text-sm">{session.name}</h3>
                                    <span className="text-xs text-text-light">
                                        {session.startTime} – {session.endTime}
                                    </span>
                                </div>

                                {/* Main tasks (read-only context) */}
                                {mainInSession.length > 0 && (
                                    <div className="flex flex-wrap gap-2 mb-2">
                                        {mainInSession.map((task) => (
                                            <span
                                                key={task.id}
                                                className="px-3 py-1.5 text-xs rounded-full bg-accent/10 text-accent"
                                            >
                                                {task.title}
                                            </span>
                                        ))}
                                    </div>
                                )}

                                {/* Assigned background tasks */}
                                {bgInSession.length > 0 && (
                                    <div className="flex flex-wrap gap-2 mb-3">
                                        {bgInSession.map((task) => (
                                            <button
                                                key={task.id}
                                                onClick={() =>
                                                    dispatch({
                                                        type: 'UNASSIGN_TASK',
                                                        taskId: task.id,
                                                        sessionId: session.id,
                                                    })
                                                }
                                                className="px-3 py-1.5 text-xs rounded-full bg-text-light text-white cursor-pointer hover:bg-muted/80 transition-colors"
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

                                {mainInSession.length === 0 &&
                                    bgInSession.length === 0 &&
                                    unassigned.length === 0 && (
                                        <p className="text-xs text-text-light">Empty session</p>
                                    )}
                            </Card>
                        );
                    })}
                </div>

                {remainingSessions.length === 0 && (
                    <p className="text-sm text-text-light">
                        No sessions remaining today. You can still continue.
                    </p>
                )}
            </div>
        </WizardLayout>
    );
}
