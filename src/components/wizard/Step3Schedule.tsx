import { useState, useMemo } from 'react';
import { WizardLayout } from './WizardLayout';
import { Button } from '../ui/Button';
import { SessionTimelineBar } from '../ui/SessionTimelineBar';
import { useDayPlan } from '../../context/DayPlanContext';
import { useCurrentSession } from '../../hooks/useCurrentSession';
import { useTodoist } from '../../hooks/useTodoist';
import { TodoistPanel } from '../todoist/TodoistPanel';
import { GoogleCalendarEmbed } from '../todoist/GoogleCalendarEmbed';
import type { LinkedTask } from '../../types';

export function Step3Schedule() {
    const { plan, settings, dispatch } = useDayPlan();
    const { remainingSessions } = useCurrentSession(settings.sessionSlots);
    const { taskMap } = useTodoist();
    const [phase, setPhase] = useState<'assign' | 'time'>('assign');
    const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
        () => remainingSessions[0]?.id ?? null,
    );

    const mainTasks = plan.linkedTasks.filter((lt) => lt.type === 'main');
    const backgroundTasks = plan.linkedTasks.filter((lt) => lt.type === 'background');

    // Project IDs that contain linked tasks — used to filter the Todoist panel in phase 2
    const linkedTaskIds = useMemo(
        () => new Set(plan.linkedTasks.map((lt) => lt.todoistId)),
        [plan.linkedTasks],
    );

    const intentionMap = useMemo(
        () => new Map(plan.intentions.map((i) => [i.id, i])),
        [plan.intentions],
    );

    const mainTasksByIntention = useMemo(() => {
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

    const getTaskLabel = (lt: LinkedTask) => {
        const title = getTaskTitle(lt.todoistId);
        if (lt.estimatedMinutes) {
            return `${title} — ${lt.estimatedMinutes >= 60 ? `${(lt.estimatedMinutes / 60).toFixed(lt.estimatedMinutes % 60 ? 1 : 0)}h` : `${lt.estimatedMinutes}m`}`;
        }
        return title;
    };

    const getSessionCapacity = (sessionId: string) => {
        const session = remainingSessions.find((s) => s.id === sessionId);
        if (!session) return null;
        const [sh, sm] = session.startTime.split(':').map(Number);
        const [eh, em] = session.endTime.split(':').map(Number);
        const totalMinutes = (eh * 60 + em) - (sh * 60 + sm);
        const assignedIds = plan.taskSessions[sessionId] ?? [];
        const estimatedTotal = assignedIds.reduce((sum, id) => {
            const lt = plan.linkedTasks.find((t) => t.todoistId === id);
            return sum + (lt?.estimatedMinutes ?? 0);
        }, 0);
        return { totalMinutes, estimatedTotal };
    };

    const formatDuration = (minutes: number) => {
        const h = Math.floor(minutes / 60);
        const m = minutes % 60;
        if (h === 0) return `${m}m`;
        if (m === 0) return `${h}h`;
        return `${h}h ${m}m`;
    };

    const hasAnyAssignment = Object.values(plan.taskSessions).some((ids) => ids.length > 0);

    const handleNext = () => {
        dispatch({ type: 'SET_WIZARD_STEP', step: 4 });
    };

    const selectedSession = remainingSessions.find((s) => s.id === selectedSessionId);

    return (
        <WizardLayout onNext={handleNext} wide hideNext={phase === 'assign'} canAdvance={phase === 'time'}>
            {phase === 'assign' ? (
                /* ── Phase 1: High-level session assignment ── */
                <div className="flex flex-col gap-5 mt-4" style={{ minHeight: '60vh' }}>
                    <div>
                        <h2 className="text-2xl font-semibold mb-2">Schedule tasks</h2>
                        <p className="text-text-light text-sm">
                            Assign tasks to sessions. Main tasks are exclusive to one session.
                            Nudges &amp; habits can appear in multiple sessions.
                        </p>
                    </div>

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
                                            title={intentionMap.get(lt.intentionId)?.title}
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
                            <h3 className="text-sm font-medium text-text-light mb-2">Your nudges</h3>
                            <div className="flex flex-wrap gap-2">
                                {backgroundTasks.map((lt) => (
                                    <span
                                        key={lt.todoistId}
                                        className="px-3 py-1.5 text-xs rounded-full bg-surface-dark text-text-light border border-border"
                                        title={intentionMap.get(lt.intentionId)?.title}
                                    >
                                        {lt.isHabit && '🔄 '}{getTaskLabel(lt)}
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
                    <SessionTimelineBar
                        sessions={remainingSessions}
                        taskSessions={plan.taskSessions}
                        linkedTasks={plan.linkedTasks}
                        taskMap={taskMap}
                        selectedSessionId={selectedSessionId}
                        onSelectSession={setSelectedSessionId}
                    />

                    {/* ── Selected session detail panel ── */}
                    {selectedSession && (() => {
                        const assignedIds = plan.taskSessions[selectedSession.id] ?? [];
                        const assignedMain = mainTasks.filter((lt) => assignedIds.includes(lt.todoistId));
                        const unassignedMain = mainTasks.filter((lt) => lt.assignedSessions.length === 0);
                        const assignedBg = backgroundTasks.filter((lt) => assignedIds.includes(lt.todoistId));
                        const unassignedBg = backgroundTasks.filter((lt) => !assignedIds.includes(lt.todoistId));

                        const assignedByIntention = new Map<string, LinkedTask[]>();
                        for (const lt of assignedMain) {
                            const list = assignedByIntention.get(lt.intentionId) ?? [];
                            list.push(lt);
                            assignedByIntention.set(lt.intentionId, list);
                        }

                        return (
                            <div className="rounded-lg border border-accent/30 bg-accent/[0.02] p-4 space-y-3">
                                <div className="flex items-baseline justify-between">
                                    <h3 className="font-medium text-sm">
                                        {selectedSession.name}
                                        <span className="ml-2 text-xs font-normal text-text-light">
                                            {selectedSession.startTime} – {selectedSession.endTime}
                                        </span>
                                    </h3>
                                    {(() => {
                                        const cap = getSessionCapacity(selectedSession.id);
                                        if (!cap || cap.estimatedTotal === 0) return null;
                                        const over = cap.estimatedTotal > cap.totalMinutes;
                                        return (
                                            <span className={`text-xs tabular-nums ${over ? 'text-amber-600 dark:text-amber-400' : 'text-text-light'}`}>
                                                {formatDuration(cap.estimatedTotal)} / {formatDuration(cap.totalMinutes)} scheduled
                                                {over && ' ⚠'}
                                            </span>
                                        );
                                    })()}
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

                                {/* Assigned background tasks */}
                                {assignedBg.length > 0 && (
                                    <div className="flex flex-wrap gap-2">
                                        {assignedBg.map((lt) => (
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
                                                {lt.isHabit && '🔄 '}{getTaskLabel(lt)} ×
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
                                            Add nudges
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
                                                    + {lt.isHabit && '🔄 '}{getTaskLabel(lt)}
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
                    <div className="flex gap-3 overflow-x-auto pb-1">
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
                                                {lt.isHabit && '🔄 '}{getTaskLabel(lt)}
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
                                <TodoistPanel mode="compact" filterToTaskIds={linkedTaskIds} />
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
