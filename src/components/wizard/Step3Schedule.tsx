import { useState, useMemo } from 'react';
import { WizardLayout } from './WizardLayout';
import { Button } from '../ui/Button';
import { ConfirmModal } from '../ui/ConfirmModal';
import { useConfirmModal } from '../../hooks/useConfirmModal';
import { SessionTimelineBar } from '../ui/SessionTimelineBar';
import { SessionCapacityBanner } from '../dashboard/SessionCapacityBanner';
import { SessionCapacityBadge } from '../dashboard/SessionCapacityBadge';
import { useDayPlan } from '../../hooks/useDayPlan';
import { useCurrentSession } from '../../hooks/useCurrentSession';
import { useTodoistData } from '../../hooks/useTodoist';
import { TodoistPanel } from '../todoist/TodoistPanel';
import { GoogleCalendarEmbed } from '../todoist/GoogleCalendarEmbed';
import { formatDuration, minutesOfDay, timeToMinutes } from '../../lib/time';
import { computeAllSessionCapacities } from '../../lib/capacity';
import { compareHabitInstancesByTime, getMissedInstanceIds, habitKindOf, isHabitInstanceMissed } from '../../lib/habits';
import { getTaskTitle } from '../../lib/tasks';
import { useIntentionRemoval } from '../../hooks/useIntentionRemoval';
import { useHabitReschedule } from '../../hooks/useHabitReschedule';
import { useCompleteHabitInstance } from '../../hooks/useCompleteHabitInstance';
import { HabitTimeEditor } from '../dashboard/HabitTimeEditor';
import type { Intention, LinkedTask, SessionSlot } from '../../types';

export function Step3Schedule() {
    const { plan, life, settings, dispatch } = useDayPlan();
    // v6.7: only 'habit'-kind instances belong on the timeline; micro-gaps are off-timeline.
    const timelineHabits = plan.todaysHabits.filter((i) => habitKindOf(life, i) === 'habit');
    // v6.8: strict habits whose window has elapsed render greyed ("missed") but stay actionable.
    const missedInstanceIds = getMissedInstanceIds(life, timelineHabits, new Date());
    const { remainingSessions } = useCurrentSession(plan.sessionSlots);
    // Whole-day session list so the timeline shows past sessions too (greyed, left of the
    // now-line). Past sessions stay visible for reference and as a source to move tasks from.
    const allSessions = plan.sessionSlots;
    const nowMinutes = minutesOfDay(new Date());
    const isPastSession = (s: SessionSlot) => timeToMinutes(s.endTime) <= nowMinutes;
    const { taskMap } = useTodoistData();
    const { moveToBacklog, removeIntention } = useIntentionRemoval();
    const [phase, setPhase] = useState<'assign' | 'time'>('assign');
    const [intentionsOpen, setIntentionsOpen] = useState(true);
    const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
        () => remainingSessions[0]?.id ?? null,
    );
    const confirmDelete = useConfirmModal<Intention>();

    const mainTasks = plan.linkedTasks.filter((lt) => lt.type === 'main' && !lt.completed);
    const backgroundTasks = plan.linkedTasks.filter((lt) => lt.type === 'background' && !lt.completed);
    const completedTasks = plan.linkedTasks.filter((lt) => lt.completed);

    const intentionMap = useMemo(
        () => new Map(plan.intentions.map((i) => [i.id, i])),
        [plan.intentions],
    );

    // Global task sort index honouring Step 1's ordering: intentions in their plan order, and
    // within each intention the `linkedTaskIds` order. Drives task placement inside timeline
    // session cards so they read the same way they were arranged during mapping.
    const taskOrder = useMemo(() => {
        const order = new Map<string, number>();
        let idx = 0;
        for (const intention of plan.intentions) {
            for (const todoistId of intention.linkedTaskIds) {
                if (!order.has(todoistId)) order.set(todoistId, idx++);
            }
        }
        return order;
    }, [plan.intentions]);

    // Sort linked tasks by Step 1's sequencing (intention order, then `linkedTaskIds` order).
    const compareByTaskOrder = (a: LinkedTask, b: LinkedTask) =>
        (taskOrder.get(a.todoistId) ?? Number.MAX_SAFE_INTEGER) -
        (taskOrder.get(b.todoistId) ?? Number.MAX_SAFE_INTEGER);

    // Main tasks grouped by intention, with both the groups (plan order) and the tasks within
    // each group (linkedTaskIds order) following Step 1's sequence.
    const mainTasksByIntention = useMemo(() => {
        const orderOf = (lt: LinkedTask) => taskOrder.get(lt.todoistId) ?? Number.MAX_SAFE_INTEGER;
        return plan.intentions
            .map((i) => [i.id, mainTasks.filter((lt) => lt.intentionId === i.id).sort((a, b) => orderOf(a) - orderOf(b))] as const)
            .filter(([, list]) => list.length > 0);
    }, [plan.intentions, mainTasks, taskOrder]);

    const titleFor = (todoistId: string) => getTaskTitle(todoistId, plan.linkedTasks, taskMap);

    const getTaskLabel = (lt: LinkedTask) => {
        const title = titleFor(lt.todoistId);
        return lt.estimatedMinutes ? `${title} — ${formatDuration(lt.estimatedMinutes)}` : title;
    };

    // v6: per-session capacity for the timeline (advisory; banner only triggers when over 150%).
    // Computed across all sessions so past session blocks still show their load.
    const capacities = useMemo(
        () => computeAllSessionCapacities(allSessions, plan.taskSessions, plan.linkedTasks, settings),
        [allSessions, plan.taskSessions, plan.linkedTasks, settings],
    );

    // Move an assigned task from one session to another (used to pull tasks out of past
    // sessions). UNASSIGN then ASSIGN handles both main (exclusive) and background tasks.
    const moveTaskToSession = (todoistId: string, fromSessionId: string, toSessionId: string) => {
        dispatch({ type: 'UNASSIGN_TASK', todoistId, sessionId: fromSessionId });
        dispatch({ type: 'ASSIGN_TASK', todoistId, sessionId: toSessionId });
    };

    const hasAnyAssignment = Object.values(plan.taskSessions).some((ids) => ids.length > 0);
    const allTasksCompleted = plan.linkedTasks.length > 0 && plan.linkedTasks.every((lt) => lt.completed);

    const handleNext = () => {
        dispatch({ type: 'SET_WIZARD_STEP', step: 5 });
    };

    const selectedSession = allSessions.find((s) => s.id === selectedSessionId);

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

                    {/* Intentions — compact reference strip */}
                    {plan.intentions.length > 0 && (
                        <div>
                            <button
                                onClick={() => setIntentionsOpen((o) => !o)}
                                className="flex items-center gap-1.5 text-xs font-medium text-text-light uppercase tracking-wider mb-1.5 cursor-pointer hover:text-text transition-colors"
                            >
                                <span className={`transition-transform duration-150 ${intentionsOpen ? 'rotate-90' : ''}`}>›</span>
                                Today&apos;s intentions ({plan.intentions.length})
                            </button>
                            {intentionsOpen && <div className="rounded-md border border-border/50 divide-y divide-border/30">
                                {plan.intentions.map((intention) => {
                                    const intentionMain = mainTasks.filter((lt) => lt.intentionId === intention.id);
                                    const intentionBg = backgroundTasks.filter((lt) => lt.intentionId === intention.id);
                                    return (
                                        <div key={intention.id} className="flex items-center gap-3 px-3 py-1.5 group">
                                            <span className="text-sm font-medium shrink-0 max-w-44 truncate">
                                                {intention.title}
                                            </span>
                                            <div className="flex flex-wrap gap-1 flex-1 min-w-0">
                                                {intentionMain.map((lt) => (
                                                    <span
                                                        key={lt.todoistId}
                                                        className="px-1.5 py-0.5 text-[10px] rounded bg-accent/10 text-accent/80"
                                                    >
                                                        {getTaskLabel(lt)}
                                                    </span>
                                                ))}
                                                {intentionBg.map((lt) => (
                                                    <span
                                                        key={lt.todoistId}
                                                        className="px-1.5 py-0.5 text-[10px] rounded bg-surface-dark text-text-light/70"
                                                    >
                                                        {getTaskLabel(lt)}
                                                    </span>
                                                ))}
                                                {intentionMain.length === 0 && intentionBg.length === 0 && (
                                                    <span className="text-[10px] text-text-light/50">No tasks</span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                                <button
                                                    onClick={() => void moveToBacklog(intention.id)}
                                                    className="w-6 h-6 flex items-center justify-center rounded text-text-light hover:bg-surface-dark hover:text-accent transition-colors text-sm cursor-pointer"
                                                    title="Move to backlog"
                                                    aria-label={`Move ${intention.title} to backlog`}
                                                >
                                                    📥
                                                </button>
                                                <button
                                                    onClick={() => confirmDelete.open(intention)}
                                                    className="w-6 h-6 flex items-center justify-center rounded text-text-light hover:bg-surface-dark hover:text-red-400 transition-colors text-sm cursor-pointer"
                                                    title="Delete"
                                                    aria-label={`Delete ${intention.title}`}
                                                >
                                                    ×
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>}
                        </div>
                    )}

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

                    {/* ── Timeline ── */}
                    <SessionCapacityBanner sessions={remainingSessions} capacities={capacities} />
                    <SessionTimelineBar
                        sessions={allSessions}
                        taskSessions={plan.taskSessions}
                        linkedTasks={plan.linkedTasks}
                        taskMap={taskMap}
                        selectedSessionId={selectedSessionId}
                        onSelectSession={setSelectedSessionId}
                        capacities={capacities}
                        taskOrder={taskOrder}
                        todaysHabits={timelineHabits}
                        missedInstanceIds={missedInstanceIds}
                        timelineStartMinutes={settings.timelineStartMinutes}
                        timelineEndMinutes={settings.timelineEndMinutes}
                    />

                    {/* v6.3: Habit instances panel — reschedule is available from planning. */}
                    <Step3HabitsPanel />

                    {/* ── Selected session detail panel ── */}
                    {selectedSession && (() => {
                        const assignedIds = plan.taskSessions[selectedSession.id] ?? [];
                        const assignedMain = mainTasks.filter((lt) => assignedIds.includes(lt.todoistId));
                        const unassignedMain = mainTasks.filter((lt) => lt.assignedSessions.length === 0);
                        const assignedBg = backgroundTasks.filter((lt) => assignedIds.includes(lt.todoistId)).sort(compareByTaskOrder);
                        const unassignedBg = backgroundTasks.filter((lt) => !assignedIds.includes(lt.todoistId)).sort(compareByTaskOrder);

                        // Assigned main tasks grouped by intention, honouring Step 1's ordering for
                        // both the groups (plan order) and the tasks within each (linkedTaskIds order).
                        const assignedByIntention = plan.intentions
                            .map((i) => [i.id, assignedMain.filter((lt) => lt.intentionId === i.id).sort(compareByTaskOrder)] as const)
                            .filter(([, list]) => list.length > 0);

                        // Past sessions are read-only for new assignments, but their tasks can be
                        // moved forward to a current/upcoming session.
                        const isPast = isPastSession(selectedSession);
                        const moveTargets = remainingSessions.filter((s) => s.id !== selectedSession.id);

                        // Move dropdown shown next to each assigned task in a past session.
                        const renderMove = (lt: LinkedTask) =>
                            moveTargets.length > 0 ? (
                                <select
                                    value=""
                                    onChange={(e) => {
                                        if (e.target.value) moveTaskToSession(lt.todoistId, selectedSession.id, e.target.value);
                                    }}
                                    className="text-[10px] rounded-full border border-border bg-card text-text-light px-2 py-1 cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent/30"
                                    title="Move to a current or upcoming session"
                                    aria-label={`Move ${titleFor(lt.todoistId)} to another session`}
                                >
                                    <option value="">Move to…</option>
                                    {moveTargets.map((s) => (
                                        <option key={s.id} value={s.id}>{s.name}</option>
                                    ))}
                                </select>
                            ) : (
                                <span className="text-[10px] text-text-light/60">No upcoming session</span>
                            );

                        return (
                            <div className={`rounded-lg border p-4 space-y-3 ${isPast ? 'border-border bg-surface-dark/20' : 'border-accent/30 bg-accent/[0.02]'}`}>
                                <div className="flex items-baseline justify-between gap-3">
                                    <h3 className="font-medium text-sm flex items-center gap-2">
                                        {selectedSession.name}
                                        <span className="text-xs font-normal text-text-light">
                                            {selectedSession.startTime} – {selectedSession.endTime}
                                        </span>
                                        {isPast && (
                                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-dark text-text-light/70 font-normal">
                                                past
                                            </span>
                                        )}
                                    </h3>
                                    {capacities[selectedSession.id]?.assignedMinutes ? (
                                        <SessionCapacityBadge capacity={capacities[selectedSession.id]} />
                                    ) : null}
                                </div>

                                {isPast && (
                                    <p className="text-xs text-text-light">
                                        This session has passed — you can&apos;t assign new tasks to it, but you can move
                                        its tasks to a current or upcoming session.
                                    </p>
                                )}

                                {/* Assigned main tasks grouped by intention */}
                                {assignedByIntention.length > 0 && (
                                    <div className="space-y-2">
                                        {assignedByIntention.map(([intId, tasks]) => (
                                            <div key={intId}>
                                                <span className="text-[10px] font-medium text-text-light uppercase tracking-wider">
                                                    {intentionMap.get(intId)?.title ?? 'Unknown'}
                                                </span>
                                                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                                    {tasks.map((lt) => (
                                                        isPast ? (
                                                            <span
                                                                key={lt.todoistId}
                                                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full bg-accent/10 text-accent"
                                                            >
                                                                {getTaskLabel(lt)}
                                                                {renderMove(lt)}
                                                            </span>
                                                        ) : (
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
                                                        )
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Assigned background tasks */}
                                {assignedBg.length > 0 && (
                                    <div className="flex flex-wrap items-center gap-2">
                                        {assignedBg.map((lt) => (
                                            isPast ? (
                                                <span
                                                    key={lt.todoistId}
                                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full bg-surface-dark text-text-light"
                                                >
                                                    {getTaskLabel(lt)}
                                                    {renderMove(lt)}
                                                </span>
                                            ) : (
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
                                            )
                                        ))}
                                    </div>
                                )}

                                {/* Unassigned main tasks grouped by intention — assignment only for non-past sessions */}
                                {!isPast && unassignedMain.length > 0 && (
                                    <div className="space-y-2 border-t border-border/50 pt-3">
                                        <span className="text-[10px] font-medium text-text-light uppercase tracking-wider">
                                            Add main tasks
                                        </span>
                                        {mainTasksByIntention
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
                                {!isPast && unassignedBg.length > 0 && (
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
                                                    + {getTaskLabel(lt)}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {assignedMain.length === 0 && assignedBg.length === 0 && (
                                    isPast
                                        ? <p className="text-xs text-text-light">No tasks were assigned to this session.</p>
                                        : unassignedMain.length === 0 && unassignedBg.length === 0
                                            ? <p className="text-xs text-text-light">No tasks to assign</p>
                                            : null
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
                                                {getTaskLabel(lt)}
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

                    {/* v6.3: Habit instances panel — reschedule remains available. */}
                    <Step3HabitsPanel />

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

            <ConfirmModal
                open={confirmDelete.value !== null}
                onClose={confirmDelete.close}
                onConfirm={() => confirmDelete.value ? removeIntention(confirmDelete.value.id) : Promise.resolve()}
                title="Delete intention permanently?"
                confirmLabel="Delete"
            >
                <p className="text-sm text-text-light mb-4">
                    <strong>{confirmDelete.value?.title}</strong> will be removed from today.
                    Any of its linked Todoist tasks that are currently scheduled will be unscheduled.
                    To park it for later instead, cancel and click 📥.
                </p>
            </ConfirmModal>
        </WizardLayout>
    );
}

/**
 * v6.3: Step 3 habits panel — lists today's active habit instances (planned + engaged).
 * Each row exposes a Reschedule affordance unconditionally (Step 3 IS the planning step,
 * so the user should be able to set/change times here without waiting for the target
 * window to elapse). v6.8: strict habits past their window now appear here too (tagged
 * "missed") instead of being filtered out — rescheduling one to a future time un-misses it.
 * Rendered in both Phase 1 and Phase 2.
 */
function Step3HabitsPanel() {
    const { plan, life } = useDayPlan();
    const reschedule = useHabitReschedule();
    const completeHabit = useCompleteHabitInstance();
    const now = new Date();

    // v6.7: timeline-habits only; micro-gaps aren't scheduled.
    const active = plan.todaysHabits
        .filter((i) => habitKindOf(life, i) === 'habit' && (i.status === 'planned' || i.status === 'engaged'))
        .sort(compareHabitInstancesByTime);
    const habitById = new Map(life.habits.map((h) => [h.id, h]));

    if (active.length === 0) return null;

    return (
        <div className="rounded-lg border border-border bg-card px-4 py-3">
            <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
                <span aria-hidden>🔁</span>
                Today&apos;s habits
                <span className="text-xs font-normal text-text-light">({active.length})</span>
            </h3>
            <ul className="space-y-1.5">
                {active.map((i) => {
                    const isRescheduling = reschedule.reschedulingId === i.id;
                    const isMissed = isHabitInstanceMissed(habitById.get(i.habitId), i, now);
                    return (
                        <li key={i.id} className={`flex items-center gap-2 text-sm ${isMissed ? 'opacity-60' : ''}`}>
                            <span className="flex-1 truncate">{i.titleSnapshot}</span>
                            {isMissed && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-dark text-text-light/70 inline-flex items-center gap-1">
                                    <span aria-hidden>⏰</span>missed
                                </span>
                            )}
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent/10 text-accent tabular-nums">
                                {i.targetTime ?? 'anytime'}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-dark text-text-light tabular-nums">
                                {i.durationMinutes}m
                            </span>
                            {i.status === 'engaged' && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 capitalize">
                                    engaged
                                </span>
                            )}
                            {isRescheduling ? (
                                <HabitTimeEditor
                                    value={reschedule.time}
                                    onChange={reschedule.setTime}
                                    onSave={() => reschedule.save(i)}
                                    onCancel={reschedule.cancel}
                                />
                            ) : (
                                <>
                                    <button
                                        onClick={() => completeHabit(i)}
                                        className="text-[10px] px-2 py-0.5 rounded bg-success/10 text-success hover:bg-success/20 cursor-pointer"
                                        title="Mark this habit done for today"
                                    >
                                        ✓ Done
                                    </button>
                                    <button
                                        onClick={() => reschedule.open(i)}
                                        className="text-[10px] px-2 py-0.5 rounded bg-accent/10 text-accent hover:bg-accent/20 cursor-pointer"
                                        title="Set or change time for this habit today"
                                    >
                                        ⤴ Reschedule
                                    </button>
                                </>
                            )}
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
