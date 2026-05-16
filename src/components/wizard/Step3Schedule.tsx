import { useState, useMemo } from 'react';
import { WizardLayout } from './WizardLayout';
import { Button } from '../ui/Button';
import { SessionTimelineBar } from '../ui/SessionTimelineBar';
import { SessionCapacityBanner } from '../dashboard/SessionCapacityBanner';
import { SessionCapacityBadge } from '../dashboard/SessionCapacityBadge';
import { useDayPlan } from '../../hooks/useDayPlan';
import { useCurrentSession } from '../../hooks/useCurrentSession';
import { useTodoistData } from '../../hooks/useTodoist';
import { TodoistPanel } from '../todoist/TodoistPanel';
import { GoogleCalendarEmbed } from '../todoist/GoogleCalendarEmbed';
import { formatDuration } from '../../lib/time';
import { computeAllSessionCapacities } from '../../lib/capacity';
import { getTaskTitle } from '../../lib/tasks';
import { isHabitDerivedTask } from '../../lib/habits';
import type { LinkedTask } from '../../types';

export function Step3Schedule() {
    const { plan, settings, dispatch } = useDayPlan();
    const { remainingSessions } = useCurrentSession(settings.sessionSlots);
    const { taskMap } = useTodoistData();
    const [phase, setPhase] = useState<'assign' | 'time'>('assign');
    const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
        () => remainingSessions[0]?.id ?? null,
    );

    const mainTasks = plan.linkedTasks.filter((lt) => lt.type === 'main' && !lt.completed);
    const backgroundTasks = plan.linkedTasks.filter((lt) => lt.type === 'background' && !lt.completed);
    const completedTasks = plan.linkedTasks.filter((lt) => lt.completed);

    const intentionMap = useMemo(
        () => new Map(plan.intentions.map((i) => [i.id, i])),
        [plan.intentions],
    );

    const mainTasksByIntention = useMemo(() => {
        const groups = new Map<string, LinkedTask[]>();
        for (const lt of mainTasks) {
            if (lt.intentionId === undefined) continue;
            const list = groups.get(lt.intentionId) ?? [];
            list.push(lt);
            groups.set(lt.intentionId, list);
        }
        return groups;
    }, [mainTasks]);

    /** v6.1: orphan habit-tasks not yet assigned to any session live in this tray. */
    const unassignedHabitTasks = useMemo(
        () => plan.linkedTasks.filter(
            (lt) => isHabitDerivedTask(lt) && !lt.completed && !lt.skippedForToday && lt.assignedSessions.length === 0,
        ),
        [plan.linkedTasks],
    );

    const titleFor = (todoistId: string) => getTaskTitle(todoistId, plan.linkedTasks, taskMap);

    const getTaskLabel = (lt: LinkedTask) => {
        const title = titleFor(lt.todoistId);
        return lt.estimatedMinutes ? `${title} — ${formatDuration(lt.estimatedMinutes)}` : title;
    };

    // v6: per-session capacity for the timeline (advisory; banner only triggers when over 150%).
    const capacities = useMemo(
        () => computeAllSessionCapacities(remainingSessions, plan.taskSessions, plan.linkedTasks, settings),
        [remainingSessions, plan.taskSessions, plan.linkedTasks, settings],
    );

    const hasAnyAssignment = Object.values(plan.taskSessions).some((ids) => ids.length > 0);
    const allTasksCompleted = plan.linkedTasks.length > 0 && plan.linkedTasks.every((lt) => lt.completed);

    const handleNext = () => {
        dispatch({ type: 'SET_WIZARD_STEP', step: 4 });
    };

    const selectedSession = remainingSessions.find((s) => s.id === selectedSessionId);

    return (
        <WizardLayout onNext={handleNext} wide hideNext={phase === 'assign' && !allTasksCompleted} canAdvance={phase === 'time' || allTasksCompleted}>
            {phase === 'assign' ? (
                /* ── Phase 1: High-level session assignment ── */
                <div className="flex flex-col gap-5 mt-4" style={{ minHeight: '60vh' }}>
                    <div>
                        <h2 className="text-2xl font-semibold mb-2">Schedule tasks</h2>
                        <p className="text-text-light text-sm">
                            Assign tasks to sessions. Main tasks are exclusive to one session.
                            Background tasks can appear in multiple sessions.
                        </p>
                    </div>

                    {/* Completed tasks summary */}
                    {completedTasks.length > 0 && (
                        <div>
                            <h3 className="text-sm font-medium text-text-light mb-2">Completed</h3>
                            <div className="flex flex-wrap gap-2">
                                {completedTasks.map((lt) => (
                                    <span
                                        key={lt.todoistId}
                                        className="px-3 py-1.5 text-xs rounded-full bg-success/10 text-text-light border border-success/20 line-through"
                                        title={lt.intentionId ? intentionMap.get(lt.intentionId)?.title : 'Habit'}
                                    >
                                        🎉 {titleFor(lt.todoistId)}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Unassigned main tasks */}
                    {mainTasks.filter((lt) => lt.assignedSessions.length === 0).length > 0 && (
                        <div>
                            <h3 className="text-sm font-medium text-text-light mb-2">Unassigned main tasks</h3>
                            <div className="flex flex-wrap gap-2">
                                {mainTasks
                                    .filter((lt) => lt.assignedSessions.length === 0)
                                    .map((lt) => (
                                        <span
                                            key={lt.todoistId}
                                            className="px-3 py-1.5 text-xs rounded-full bg-accent-subtle text-accent border border-accent/20"
                                            title={lt.intentionId ? intentionMap.get(lt.intentionId)?.title : undefined}
                                        >
                                            {getTaskLabel(lt)}
                                        </span>
                                    ))}
                            </div>
                        </div>
                    )}

                    {/* v6.1: Unassigned habit-tasks tray (orphan tasks with no session yet) */}
                    {unassignedHabitTasks.length > 0 && (
                        <div className="rounded-lg border border-accent/20 bg-accent-subtle/30 px-3 py-2">
                            <h3 className="text-xs font-medium text-text-light mb-1.5 flex items-center gap-1">
                                <span aria-hidden>🔁</span>
                                <span>Unassigned habits — pick a session to drop them in</span>
                            </h3>
                            <div className="flex flex-wrap gap-1.5">
                                {unassignedHabitTasks.map((lt) => (
                                    <span
                                        key={lt.todoistId}
                                        className="px-2.5 py-1 text-xs rounded-full bg-accent-subtle text-accent border border-accent/30"
                                    >
                                        {getTaskLabel(lt)}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Background tasks overview */}
                    {backgroundTasks.length > 0 && (
                        <div>
                            <h3 className="text-sm font-medium text-text-light mb-2">Background tasks</h3>
                            <div className="flex flex-wrap gap-2">
                                {backgroundTasks.map((lt) => (
                                    <span
                                        key={lt.todoistId}
                                        className="px-3 py-1.5 text-xs rounded-full bg-surface-dark text-text-light border border-border"
                                        title={lt.intentionId ? intentionMap.get(lt.intentionId)?.title : 'Habit'}
                                    >
                                        {isHabitDerivedTask(lt) && '🔁 '}{getTaskLabel(lt)}
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

                    {/* ── Timeline ── */}
                    <SessionCapacityBanner sessions={remainingSessions} capacities={capacities} />
                    <SessionTimelineBar
                        sessions={remainingSessions}
                        taskSessions={plan.taskSessions}
                        linkedTasks={plan.linkedTasks}
                        taskMap={taskMap}
                        selectedSessionId={selectedSessionId}
                        onSelectSession={setSelectedSessionId}
                        capacities={capacities}
                    />

                    {/* ── Selected session detail panel ── */}
                    {selectedSession && (() => {
                        const assignedIds = plan.taskSessions[selectedSession.id] ?? [];
                        const assignedMain = mainTasks.filter((lt) => assignedIds.includes(lt.todoistId));
                        const unassignedMain = mainTasks.filter((lt) => lt.assignedSessions.length === 0);
                        const assignedBg = backgroundTasks.filter((lt) => assignedIds.includes(lt.todoistId));
                        // v6.1: split assigned background by source — habit-derived render under a 🔁 Habits group.
                        const assignedHabitBg = assignedBg.filter(isHabitDerivedTask);
                        const assignedManualBg = assignedBg.filter((lt) => !isHabitDerivedTask(lt));
                        const unassignedBg = backgroundTasks.filter((lt) => !assignedIds.includes(lt.todoistId));

                        const assignedByIntention = new Map<string, LinkedTask[]>();
                        for (const lt of assignedMain) {
                            if (lt.intentionId === undefined) continue;
                            const list = assignedByIntention.get(lt.intentionId) ?? [];
                            list.push(lt);
                            assignedByIntention.set(lt.intentionId, list);
                        }

                        return (
                            <div className="rounded-lg border border-accent/30 bg-accent/[0.02] p-4 space-y-3">
                                <div className="flex items-baseline justify-between gap-3">
                                    <h3 className="font-medium text-sm">
                                        {selectedSession.name}
                                        <span className="ml-2 text-xs font-normal text-text-light">
                                            {selectedSession.startTime} – {selectedSession.endTime}
                                        </span>
                                    </h3>
                                    {capacities[selectedSession.id]?.assignedMinutes ? (
                                        <SessionCapacityBadge capacity={capacities[selectedSession.id]} />
                                    ) : null}
                                </div>

                                {/* Assigned main tasks grouped by intention */}
                                {assignedByIntention.size > 0 && (
                                    <div className="space-y-2">
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
                                                                    sessionId: selectedSession.id,
                                                                })
                                                            }
                                                            className="px-3 py-1.5 text-xs rounded-full bg-accent text-white cursor-pointer hover:bg-accent/80 transition-colors"
                                                            title="Click to unassign"
                                                        >
                                                            {getTaskLabel(lt)} ×
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Assigned habit-derived background tasks (🔁 Habits group) */}
                                {assignedHabitBg.length > 0 && (
                                    <div>
                                        <span className="text-[10px] font-medium text-text-light uppercase tracking-wider">
                                            🔁 Habits
                                        </span>
                                        <div className="flex flex-wrap gap-1.5 mt-1">
                                            {assignedHabitBg.map((lt) => (
                                                <button
                                                    key={lt.todoistId}
                                                    onClick={() =>
                                                        dispatch({
                                                            type: 'UNASSIGN_TASK',
                                                            todoistId: lt.todoistId,
                                                            sessionId: selectedSession.id,
                                                        })
                                                    }
                                                    className="px-3 py-1.5 text-xs rounded-full bg-accent text-white cursor-pointer hover:bg-accent/80 transition-colors"
                                                    title="Click to remove from this session"
                                                >
                                                    {getTaskLabel(lt)} ×
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Assigned manual background tasks */}
                                {assignedManualBg.length > 0 && (
                                    <div className="flex flex-wrap gap-2">
                                        {assignedManualBg.map((lt) => (
                                            <button
                                                key={lt.todoistId}
                                                onClick={() =>
                                                    dispatch({
                                                        type: 'UNASSIGN_TASK',
                                                        todoistId: lt.todoistId,
                                                        sessionId: selectedSession.id,
                                                    })
                                                }
                                                className="px-3 py-1.5 text-xs rounded-full bg-text-light text-white cursor-pointer hover:bg-muted/80 transition-colors"
                                                title="Click to remove from this session"
                                            >
                                                {getTaskLabel(lt)} ×
                                            </button>
                                        ))}
                                    </div>
                                )}

                                {/* Unassigned main tasks grouped by intention */}
                                {unassignedMain.length > 0 && (
                                    <div className="space-y-2 border-t border-border/50 pt-3">
                                        <span className="text-[10px] font-medium text-text-light uppercase tracking-wider">
                                            Add main tasks
                                        </span>
                                        {[...mainTasksByIntention.entries()]
                                            .filter(([, tasks]) => tasks.some((lt) => lt.assignedSessions.length === 0))
                                            .map(([intId, tasks]) => {
                                                const unassigned = tasks.filter((lt) => lt.assignedSessions.length === 0);
                                                if (unassigned.length === 0) return null;
                                                return (
                                                    <div key={intId}>
                                                        <span className="text-[10px] text-text-light">
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
                                                                            sessionId: selectedSession.id,
                                                                        })
                                                                    }
                                                                    className="px-3 py-1.5 text-xs rounded-full border border-dashed border-border text-text-light hover:border-accent hover:text-accent cursor-pointer transition-colors"
                                                                >
                                                                    + {getTaskLabel(lt)}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                    </div>
                                )}

                                {/* Unassigned background tasks */}
                                {unassignedBg.length > 0 && (
                                    <div className="space-y-2 border-t border-border/50 pt-3">
                                        <span className="text-[10px] font-medium text-text-light uppercase tracking-wider">
                                            Add background tasks
                                        </span>
                                        <div className="flex flex-wrap gap-1.5">
                                            {unassignedBg.map((lt) => (
                                                <button
                                                    key={lt.todoistId}
                                                    onClick={() =>
                                                        dispatch({
                                                            type: 'ASSIGN_TASK',
                                                            todoistId: lt.todoistId,
                                                            sessionId: selectedSession.id,
                                                        })
                                                    }
                                                    className="px-3 py-1.5 text-xs rounded-full border border-dashed border-border text-text-light hover:border-accent hover:text-accent cursor-pointer transition-colors"
                                                >
                                                    + {isHabitDerivedTask(lt) && '🔁 '}{getTaskLabel(lt)}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {assignedMain.length === 0 && unassignedMain.length === 0 &&
                                    assignedBg.length === 0 && unassignedBg.length === 0 && (
                                        <p className="text-xs text-text-light">No tasks to assign</p>
                                    )}
                            </div>
                        );
                    })()}

                    {remainingSessions.length === 0 && (
                        <p className="text-sm text-text-light">
                            No sessions remaining today. You can still continue to the next step.
                        </p>
                    )}

                    <div className="flex justify-end pt-2">
                        <Button onClick={() => setPhase('time')} disabled={!hasAnyAssignment}>
                            Schedule times →
                        </Button>
                    </div>
                </div>
            ) : (
                /* ── Phase 2: Time scheduling with Todoist + Calendar ── */
                <div className="flex flex-col gap-6 mt-4" style={{ minHeight: '60vh' }}>
                    {/* Header with back link */}
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-2xl font-semibold mb-1">Schedule times</h2>
                            <p className="text-text-light text-sm">
                                Use your Todoist tasks and calendar to schedule specific times for each session.
                            </p>
                        </div>
                        <button
                            onClick={() => setPhase('assign')}
                            className="text-sm text-accent hover:underline cursor-pointer flex-shrink-0"
                        >
                            ← Edit assignments
                        </button>
                    </div>

                    {/* Horizontal session summary */}
                    <div className="flex gap-3 overflow-x-auto scrollbar-subtle pb-1">
                        {remainingSessions.map((session) => {
                            const assignedIds = plan.taskSessions[session.id] ?? [];
                            const sessionMain = mainTasks.filter((lt) => assignedIds.includes(lt.todoistId));
                            const sessionBg = backgroundTasks.filter((lt) => assignedIds.includes(lt.todoistId));

                            return (
                                <div
                                    key={session.id}
                                    className="flex-shrink-0 w-64 rounded-lg border border-border bg-card px-3 py-2 flex items-start gap-3"
                                >
                                    <div className="flex-shrink-0">
                                        <h4 className="font-medium text-xs leading-tight">{session.name}</h4>
                                        <span className="text-[10px] text-text-light">
                                            {session.startTime} – {session.endTime}
                                        </span>
                                    </div>
                                    <div className="flex flex-wrap gap-1 min-w-0">
                                        {sessionMain.map((lt) => (
                                            <span
                                                key={lt.todoistId}
                                                className="px-2 py-0.5 text-[10px] rounded-full bg-accent/10 text-accent"
                                            >
                                                {getTaskLabel(lt)}
                                            </span>
                                        ))}
                                        {sessionBg.map((lt) => (
                                            <span
                                                key={lt.todoistId}
                                                className="px-2 py-0.5 text-[10px] rounded-full bg-surface-dark text-text-light"
                                            >
                                                {isHabitDerivedTask(lt) && '🔁 '}{getTaskLabel(lt)}
                                            </span>
                                        ))}
                                        {sessionMain.length === 0 && sessionBg.length === 0 && (
                                            <span className="text-[10px] text-text-light">No tasks</span>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Todoist + Calendar side by side */}
                    <div className="flex flex-col lg:flex-row gap-6 flex-1">
                        <div className="lg:w-2/5 flex-shrink-0 flex flex-col">
                            <h3 className="text-sm font-medium text-text-light mb-2">Tasks</h3>
                            <div className="rounded-lg border border-border overflow-hidden bg-card flex-1" style={{ minHeight: 500 }}>
                                <TodoistPanel mode="compact" showFilterToggle defaultFiltered />
                            </div>
                        </div>
                        <div className="flex-1 min-w-0 flex flex-col">
                            <h3 className="text-sm font-medium text-text-light mb-2">Calendar</h3>
                            <GoogleCalendarEmbed height={500} />
                        </div>
                    </div>
                </div>
            )}
        </WizardLayout>
    );
}
