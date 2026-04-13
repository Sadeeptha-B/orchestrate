import { useMemo } from 'react';
import { WizardLayout } from './WizardLayout';
import { Card } from '../ui/Card';
import { useDayPlan } from '../../context/DayPlanContext';
import { useCurrentSession } from '../../hooks/useCurrentSession';
import { useTodoist } from '../../hooks/useTodoist';
import { TodoistPanel } from '../todoist/TodoistPanel';
import { GoogleCalendarEmbed } from '../todoist/GoogleCalendarEmbed';
import type { LinkedTask } from '../../types';

export function Step3ScheduleMain() {
    const { plan, settings, dispatch } = useDayPlan();
    const { remainingSessions } = useCurrentSession(settings.sessionSlots);
    const { taskMap } = useTodoist();

    const mainTasks = plan.linkedTasks.filter((lt) => lt.type === 'main');

    // Group main tasks by parent intention
    const intentionMap = useMemo(
        () => new Map(plan.intentions.map((i) => [i.id, i])),
        [plan.intentions],
    );

    const tasksByIntention = useMemo(() => {
        const groups = new Map<string, LinkedTask[]>();
        for (const lt of mainTasks) {
            const list = groups.get(lt.intentionId) ?? [];
            list.push(lt);
            groups.set(lt.intentionId, list);
        }
        return groups;
    }, [mainTasks]);

    const getTaskTitle = (todoistId: string) =>
        taskMap.get(todoistId)?.content ?? todoistId;

    const handleNext = () => {
        dispatch({ type: 'SET_WIZARD_STEP', step: 4 });
    };

    return (
        <WizardLayout onNext={handleNext} wide>
            <div className="flex flex-col gap-6 mt-4" style={{ minHeight: '60vh' }}>
                <div className="flex flex-col lg:flex-row gap-6 flex-1">
                    {/* Left panel: session scheduling */}
                    <div className="lg:w-1/2 flex-shrink-0 space-y-5 overflow-y-auto">
                        <div>
                            <h2 className="text-2xl font-semibold mb-2">Schedule main tasks</h2>
                            <p className="text-text-light text-sm">
                                Assign your main tasks to sessions. Each main task is exclusive to one session.
                            </p>
                        </div>

                        {/* Unassigned main tasks */}
                        {mainTasks.filter((lt) => lt.assignedSessions.length === 0).length > 0 && (
                            <div>
                                <h3 className="text-sm font-medium text-text-light mb-2">Unassigned</h3>
                                <div className="flex flex-wrap gap-2">
                                    {mainTasks
                                        .filter((lt) => lt.assignedSessions.length === 0)
                                        .map((lt) => (
                                            <span
                                                key={lt.todoistId}
                                                className="px-3 py-1.5 text-xs rounded-full bg-accent-subtle text-accent border border-accent/20"
                                                title={intentionMap.get(lt.intentionId)?.title}
                                            >
                                                {getTaskTitle(lt.todoistId)}
                                            </span>
                                        ))}
                                </div>
                            </div>
                        )}

                        {/* Session slots */}
                        <div className="space-y-4">
                            {remainingSessions.map((session) => {
                                const assignedIds = plan.taskSessions[session.id] ?? [];
                                const assignedMain = mainTasks.filter((lt) => assignedIds.includes(lt.todoistId));
                                const unassignedMain = mainTasks.filter((lt) => lt.assignedSessions.length === 0);

                                // Group assigned tasks by intention
                                const assignedByIntention = new Map<string, LinkedTask[]>();
                                for (const lt of assignedMain) {
                                    const list = assignedByIntention.get(lt.intentionId) ?? [];
                                    list.push(lt);
                                    assignedByIntention.set(lt.intentionId, list);
                                }

                                return (
                                    <Card key={session.id}>
                                        <div className="flex items-center justify-between mb-3">
                                            <h3 className="font-medium text-sm">{session.name}</h3>
                                            <span className="text-xs text-text-light">
                                                {session.startTime} – {session.endTime}
                                            </span>
                                        </div>

                                        {/* Assigned tasks grouped by intention */}
                                        {assignedByIntention.size > 0 && (
                                            <div className="space-y-2 mb-3">
                                                {[...assignedByIntention.entries()].map(([intId, tasks]) => (
                                                    <div key={intId}>
                                                        <span className="text-[10px] font-medium text-text-light uppercase tracking-wider">
                                                            {intentionMap.get(intId)?.title ?? 'Unknown'}
                                                        </span>
                                                        <div className="flex flex-wrap gap-1.5 mt-1">
                                                            {tasks.map((lt) => (
                                                                <button
                                                                    key={lt.todoistId}
                                                                    onClick={() =>
                                                                        dispatch({
                                                                            type: 'UNASSIGN_TASK',
                                                                            todoistId: lt.todoistId,
                                                                            sessionId: session.id,
                                                                        })
                                                                    }
                                                                    className="px-3 py-1.5 text-xs rounded-full bg-accent text-white cursor-pointer hover:bg-accent/80 transition-colors"
                                                                    title="Click to unassign"
                                                                >
                                                                    {getTaskTitle(lt.todoistId)} ×
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        {/* Unassigned tasks grouped by intention */}
                                        {unassignedMain.length > 0 && (
                                            <div className="space-y-2">
                                                {[...tasksByIntention.entries()]
                                                    .filter(([, tasks]) => tasks.some((lt) => lt.assignedSessions.length === 0))
                                                    .map(([intId, tasks]) => {
                                                        const unassigned = tasks.filter((lt) => lt.assignedSessions.length === 0);
                                                        if (unassigned.length === 0) return null;
                                                        return (
                                                            <div key={intId}>
                                                                <span className="text-[10px] font-medium text-text-light uppercase tracking-wider">
                                                                    {intentionMap.get(intId)?.title ?? 'Unknown'}
                                                                </span>
                                                                <div className="flex flex-wrap gap-1.5 mt-1">
                                                                    {unassigned.map((lt) => (
                                                                        <button
                                                                            key={lt.todoistId}
                                                                            onClick={() =>
                                                                                dispatch({
                                                                                    type: 'ASSIGN_TASK',
                                                                                    todoistId: lt.todoistId,
                                                                                    sessionId: session.id,
                                                                                })
                                                                            }
                                                                            className="px-3 py-1.5 text-xs rounded-full border border-dashed border-border text-text-light hover:border-accent hover:text-accent cursor-pointer transition-colors"
                                                                        >
                                                                            + {getTaskTitle(lt.todoistId)}
                                                                        </button>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                            </div>
                                        )}

                                        {assignedMain.length === 0 && unassignedMain.length === 0 && (
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

                    {/* Right panel: Todoist */}
                    <div className="flex-1 min-w-0 flex flex-col">
                        <h3 className="text-sm font-medium text-text-light mb-2">Tasks</h3>
                        <div className="rounded-lg border border-border overflow-hidden bg-card" style={{ height: 500 }}>
                            <TodoistPanel mode="compact" />
                        </div>
                    </div>
                </div>

                {/* Full-width calendar below */}
                <div>
                    <h3 className="text-sm font-medium text-text-light mb-2">Calendar</h3>
                    <GoogleCalendarEmbed height={450} />
                </div>
            </div>
        </WizardLayout>
    );
}
