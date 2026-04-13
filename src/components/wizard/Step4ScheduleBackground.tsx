import { useMemo } from 'react';
import { WizardLayout } from './WizardLayout';
import { Card } from '../ui/Card';
import { useDayPlan } from '../../context/DayPlanContext';
import { useCurrentSession } from '../../hooks/useCurrentSession';
import { useTodoist } from '../../hooks/useTodoist';
import { TodoistPanel } from '../todoist/TodoistPanel';
import { GoogleCalendarEmbed } from '../todoist/GoogleCalendarEmbed';

export function Step4ScheduleBackground() {
    const { plan, settings, dispatch } = useDayPlan();
    const { remainingSessions } = useCurrentSession(settings.sessionSlots);
    const { taskMap } = useTodoist();

    const backgroundTasks = plan.linkedTasks.filter((lt) => lt.type === 'background');
    const mainTasks = plan.linkedTasks.filter((lt) => lt.type === 'main');

    const intentionMap = useMemo(
        () => new Map(plan.intentions.map((i) => [i.id, i])),
        [plan.intentions],
    );

    const getTaskTitle = (todoistId: string) =>
        taskMap.get(todoistId)?.content ?? todoistId;

    const handleNext = () => {
        dispatch({ type: 'SET_WIZARD_STEP', step: 5 });
    };

    return (
        <WizardLayout onNext={handleNext} wide>
            <div className="flex flex-col gap-6 mt-4" style={{ minHeight: '60vh' }}>
                <div className="flex flex-col lg:flex-row gap-6 flex-1">
                    {/* Left panel: session scheduling */}
                    <div className="lg:w-1/2 flex-shrink-0 space-y-6 overflow-y-auto">
                        <div>
                            <h2 className="text-2xl font-semibold mb-2">Schedule nudges &amp; habits</h2>
                            <p className="text-text-light text-sm">
                                Background tasks appear as gentle nudges during your sessions. You can assign
                                each one to <strong>multiple sessions</strong> — they'll remind you throughout the day.
                            </p>
                        </div>

                        {/* Background tasks overview */}
                        {backgroundTasks.length > 0 && (
                            <div>
                                <h3 className="text-sm font-medium text-text-light mb-2">Your nudges</h3>
                                <div className="flex flex-wrap gap-2">
                                    {backgroundTasks.map((lt) => (
                                        <span
                                            key={lt.todoistId}
                                            className="px-3 py-1.5 text-xs rounded-full bg-surface-dark text-text-light border border-border"
                                            title={intentionMap.get(lt.intentionId)?.title}
                                        >
                                            {lt.isHabit && '🔄 '}{getTaskTitle(lt.todoistId)}
                                            {lt.assignedSessions.length > 0 && (
                                                <span className="ml-1 text-accent">
                                                    ({lt.assignedSessions.length} session{lt.assignedSessions.length !== 1 ? 's' : ''})
                                                </span>
                                            )}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="space-y-4">
                            {remainingSessions.map((session) => {
                                const assignedIds = plan.taskSessions[session.id] ?? [];
                                const mainInSession = mainTasks.filter((lt) => assignedIds.includes(lt.todoistId));
                                const bgInSession = backgroundTasks.filter((lt) => assignedIds.includes(lt.todoistId));
                                const notInThisSession = backgroundTasks.filter(
                                    (lt) => !assignedIds.includes(lt.todoistId),
                                );

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
                                                {mainInSession.map((lt) => (
                                                    <span
                                                        key={lt.todoistId}
                                                        className="px-3 py-1.5 text-xs rounded-full bg-accent/10 text-accent"
                                                    >
                                                        {getTaskTitle(lt.todoistId)}
                                                    </span>
                                                ))}
                                            </div>
                                        )}

                                        {/* Assigned background tasks */}
                                        {bgInSession.length > 0 && (
                                            <div className="flex flex-wrap gap-2 mb-3">
                                                {bgInSession.map((lt) => (
                                                    <button
                                                        key={lt.todoistId}
                                                        onClick={() =>
                                                            dispatch({
                                                                type: 'UNASSIGN_TASK',
                                                                todoistId: lt.todoistId,
                                                                sessionId: session.id,
                                                            })
                                                        }
                                                        className="px-3 py-1.5 text-xs rounded-full bg-text-light text-white cursor-pointer hover:bg-muted/80 transition-colors"
                                                        title="Click to remove from this session"
                                                    >
                                                        {lt.isHabit && '🔄 '}{getTaskTitle(lt.todoistId)} ×
                                                    </button>
                                                ))}
                                            </div>
                                        )}

                                        {/* Assign buttons — show all not-yet-in-this-session */}
                                        {notInThisSession.length > 0 && (
                                            <div className="flex flex-wrap gap-2">
                                                {notInThisSession.map((lt) => (
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
                                                        + {lt.isHabit && '🔄 '}{getTaskTitle(lt.todoistId)}
                                                    </button>
                                                ))}
                                            </div>
                                        )}

                                        {mainInSession.length === 0 &&
                                            bgInSession.length === 0 &&
                                            notInThisSession.length === 0 && (
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
