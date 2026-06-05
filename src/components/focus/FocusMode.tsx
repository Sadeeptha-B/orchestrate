import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDayPlan } from '../../hooks/useDayPlan';
import { useTodoistData, useTodoistActions } from '../../hooks/useTodoist';
import { useNotifications } from '../../hooks/useNotifications';
import { SessionTimeline } from '../dashboard/SessionTimeline';
import { EngagementTimer } from '../dashboard/EngagementTimer';
import { FocusSlotPlan } from './FocusSlotPlan';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Logo } from '../ui/Logo';
import { computeFocusPlan, findActiveFocusTask, resolveBlockAt } from '../../lib/focus';
import { openSegment, formatClock } from '../../lib/engagement';
import { getTaskTitle } from '../../lib/tasks';
import { playChime } from '../../lib/sound';
import type { LinkedTask } from '../../types';

const POMODORO_KEY = 'orchestrate-focus-pomodoro';

/**
 * v7: Focus Mode page (`/focus`). Strips the screen to the day timeline, the one task you're engaged
 * with, and a large timer. Opened automatically when you press ▶ Start on a task. Optional Pomodoro
 * engine paces the work into slots with chime + notification at each boundary.
 */
export function FocusMode() {
    const { plan } = useDayPlan();
    const navigate = useNavigate();

    // Derived from engagement state so the page survives reloads and reflects Stop/Complete instantly.
    const activeTask = useMemo(() => findActiveFocusTask(plan), [plan]);

    return (
        <div className="min-h-screen bg-app text-text flex flex-col">
            <header className="px-6 py-4 border-b border-border">
                <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
                    <h1 className="text-xl font-semibold text-accent flex items-center gap-2">
                        <Logo />
                        Focus
                    </h1>
                    <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
                        Exit
                    </Button>
                </div>
            </header>

            <main className="flex-1 px-6 py-8">
                <div className="max-w-5xl mx-auto space-y-8">
                    {/* Day context */}
                    <SessionTimeline pinnedSessionId={null} onSelectSession={() => {}} />

                    {activeTask ? (
                        <FocusActive task={activeTask} />
                    ) : (
                        <Card className="text-center py-12">
                            <p className="text-text-light mb-4">No task is being focused right now.</p>
                            <Button variant="secondary" onClick={() => navigate('/')}>
                                Back to dashboard
                            </Button>
                        </Card>
                    )}
                </div>
            </main>
        </div>
    );
}

function FocusActive({ task }: { task: LinkedTask }) {
    const { plan, settings, dispatch } = useDayPlan();
    const { taskMap } = useTodoistData();
    const { completeTask } = useTodoistActions();
    const { sendNotification } = useNotifications();
    const navigate = useNavigate();

    const title = getTaskTitle(task.todoistId, plan.linkedTasks, taskMap);
    const intentionTitle = plan.intentions.find((i) => i.id === task.intentionId)?.title;
    const segment = openSegment(task.segments);
    const focusPlan = useMemo(() => computeFocusPlan(task.estimatedMinutes), [task.estimatedMinutes]);

    // ── Pomodoro engine ──────────────────────────────────────────────────────
    const [pomodoroOn, setPomodoroOn] = useState(() => {
        try {
            return localStorage.getItem(POMODORO_KEY) === '1';
        } catch {
            return false;
        }
    });
    const [startedAt, setStartedAt] = useState<number | null>(() => (pomodoroOn ? Date.now() : null));
    const [nowMs, setNowMs] = useState(() => Date.now());
    const lastBoundary = useRef<number>(0);

    const togglePomodoro = () => {
        setPomodoroOn((on) => {
            const next = !on;
            try {
                localStorage.setItem(POMODORO_KEY, next ? '1' : '0');
            } catch {
                /* ignore */
            }
            if (next) {
                setStartedAt(Date.now());
                lastBoundary.current = 0;
            } else {
                setStartedAt(null);
            }
            return next;
        });
    };

    // 1s tick while the engine runs (same cadence as EngagementTimer).
    useEffect(() => {
        if (!pomodoroOn || focusPlan.singleSession) return;
        const id = setInterval(() => setNowMs(Date.now()), 1000);
        return () => clearInterval(id);
    }, [pomodoroOn, focusPlan.singleSession]);

    const elapsedSeconds = startedAt != null ? (nowMs - startedAt) / 1000 : 0;
    const pos = useMemo(
        () => resolveBlockAt(focusPlan.blocks, elapsedSeconds),
        [focusPlan.blocks, elapsedSeconds],
    );

    // Fire chime + notification once per block transition (and on completion).
    useEffect(() => {
        if (!pomodoroOn || focusPlan.singleSession) return;
        if (pos.done) {
            if (lastBoundary.current !== -1) {
                lastBoundary.current = -1;
                playChime('work');
                sendNotification(
                    'Focus session complete',
                    'Nice work — all your slots are done.',
                    settings.notificationPreference,
                );
            }
            return;
        }
        if (pos.index !== lastBoundary.current) {
            lastBoundary.current = pos.index;
            // index 0 is the initial block (entered when the engine starts) — don't chime for it.
            if (pos.index > 0) {
                playChime(pos.kind);
                sendNotification(
                    pos.kind === 'break' ? 'Break time' : 'Back to work',
                    pos.kind === 'break' ? 'Step away for a few minutes.' : 'Resume your focus block.',
                    settings.notificationPreference,
                );
            }
        }
    }, [pomodoroOn, focusPlan.singleSession, pos.index, pos.done, pos.kind, sendNotification, settings.notificationPreference]);

    const handleStop = () => {
        dispatch({ type: 'STOP_TASK_ENGAGEMENT', todoistId: task.todoistId, now: new Date().toISOString() });
    };

    const handleComplete = () => {
        dispatch({ type: 'TOGGLE_TASK_COMPLETE', todoistId: task.todoistId, titleSnapshot: title });
        completeTask(task.todoistId);
        navigate('/');
    };

    return (
        <div className="grid lg:grid-cols-[1fr_280px] gap-6 items-start">
            {/* Current task + timer */}
            <Card className="space-y-6">
                <div>
                    {intentionTitle && (
                        <span className="text-[11px] font-medium text-text-light uppercase tracking-wider">
                            {intentionTitle}
                        </span>
                    )}
                    <h2 className="text-2xl font-semibold mt-1">{title}</h2>
                    {task.estimatedMinutes != null && (
                        <span className="inline-block mt-2 text-xs px-2 py-0.5 rounded-full bg-surface-dark text-text-light tabular-nums">
                            est. {task.estimatedMinutes}m
                        </span>
                    )}
                </div>

                {/* Large engaged-time readout */}
                <div className="text-center py-6">
                    {segment ? (
                        <EngagementTimer segment={segment} className="text-6xl font-light tracking-tight" />
                    ) : (
                        <span className="text-6xl font-light tracking-tight tabular-nums">0:00</span>
                    )}
                    <p className="text-xs text-text-light mt-2 uppercase tracking-wider">Time on task</p>
                </div>

                {/* Pomodoro live phase */}
                {pomodoroOn && !focusPlan.singleSession && (
                    <div
                        className={`rounded-lg px-4 py-3 text-center ${
                            pos.done
                                ? 'bg-success/10 text-success'
                                : pos.kind === 'break'
                                    ? 'bg-amber-400/15 text-amber-700 dark:text-amber-300'
                                    : 'bg-accent/10 text-accent'
                        }`}
                    >
                        {pos.done ? (
                            <span className="text-sm font-medium">All slots complete 🎉</span>
                        ) : (
                            <>
                                <span className="text-sm font-medium">
                                    {pos.kind === 'break' ? 'Break' : 'Work'}
                                </span>
                                <span className="ml-2 text-lg font-semibold tabular-nums">
                                    {formatClock(pos.blockRemainingSeconds)}
                                </span>
                            </>
                        )}
                    </div>
                )}

                <div className="flex items-center justify-between gap-3 flex-wrap">
                    <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                        <input
                            type="checkbox"
                            checked={pomodoroOn}
                            onChange={togglePomodoro}
                            className="accent-accent w-4 h-4 cursor-pointer"
                        />
                        Pomodoro mode
                    </label>
                    <div className="flex items-center gap-2">
                        <Button variant="ghost" size="sm" onClick={handleStop}>
                            ■ Stop
                        </Button>
                        <Button size="sm" onClick={handleComplete}>
                            ✓ Complete
                        </Button>
                    </div>
                </div>
            </Card>

            {/* Slot plan */}
            <Card>
                <FocusSlotPlan
                    plan={focusPlan}
                    activeIndex={pomodoroOn ? pos.index : -1}
                    done={pomodoroOn && pos.done}
                />
            </Card>
        </div>
    );
}
