import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDayPlan } from '../../hooks/useDayPlan';
import { useTodoistData, useTodoistActions } from '../../hooks/useTodoist';
import { useNotifications } from '../../hooks/useNotifications';
import { EngagementTimer } from '../dashboard/EngagementTimer';
import { MusicProvider, PlaylistSelector, SpotifyPlayer } from '../dashboard/MusicPanel';
import { InsightCard } from '../dashboard/InsightCard';
import { FocusSlotPlan } from './FocusSlotPlan';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Logo } from '../ui/Logo';
import { computeFocusPlan, findActiveFocusTask, resolveBlockAt } from '../../lib/focus';
import { openSegment, formatClock } from '../../lib/engagement';
import { lastEndedFor } from '../../lib/engagementHistory';
import { getTaskTitle } from '../../lib/tasks';
import { playChime } from '../../lib/sound';
import type { LinkedTask } from '../../types';

const POMODORO_KEY = 'orchestrate-focus-pomodoro';
const RAMP_MIN_KEY = 'orchestrate-focus-ramp-min';
const RAMP_PRESETS = [5, 10];

/** Compact "time since" for the re-entry hint: minutes → hours → days. */
function formatAgo(minutes: number): string {
    if (minutes < 60) return `${minutes}m ago`;
    const h = Math.round(minutes / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.round(h / 24)}d ago`;
}

export function FocusMode() {
    const { plan } = useDayPlan();
    const navigate = useNavigate();

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
                <div className="max-w-5xl mx-auto">
                    {activeTask ? (
                        <FocusActive key={activeTask.todoistId} task={activeTask} />
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
    const { plan, settings, life, dispatch } = useDayPlan();
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
        try { return localStorage.getItem(POMODORO_KEY) === '1'; } catch { return false; }
    });
    const [startedAt, setStartedAt] = useState<number | null>(() => (pomodoroOn ? Date.now() : null));
    const [nowMs, setNowMs] = useState(() => Date.now());
    const lastBoundary = useRef<number>(0);

    const togglePomodoro = () => {
        setPomodoroOn((on) => {
            const next = !on;
            try { localStorage.setItem(POMODORO_KEY, next ? '1' : '0'); } catch { /* ignore */ }
            if (next) { setStartedAt(Date.now()); lastBoundary.current = 0; }
            else { setStartedAt(null); }
            return next;
        });
    };

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

    useEffect(() => {
        if (!pomodoroOn || focusPlan.singleSession) return;
        if (pos.done) {
            if (lastBoundary.current !== -1) {
                lastBoundary.current = -1;
                playChime('work');
                sendNotification('Focus session complete', 'Nice work — all your slots are done.', settings.notificationPreference);
            }
            return;
        }
        if (pos.index !== lastBoundary.current) {
            lastBoundary.current = pos.index;
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

    // ── Re-entry context trail (v7.4 Phase 2) ────────────────────────────────
    // The trail is the task's cumulative breadcrumb history (read live from the prop). The "Next
    // step" input holds a draft (seeded from the last exit note); "+ Add" appends a breadcrumb
    // mid-session, and Stop/Complete commits the current draft as one exit note (deduped).
    const trail = task.contextTrail ?? [];
    // Re-entry moment: how long since this task was last worked (problem-statement §15 P5).
    const [lastWorkedMinutes] = useState<number | null>(() => {
        const prevEnd = lastEndedFor(life.engagementHistory, task.todoistId);
        if (!prevEnd) return null;
        const mins = Math.round((Date.now() - Date.parse(prevEnd)) / 60000);
        return mins >= 1 ? mins : null;
    });
    const [note, setNote] = useState(() => {
        const lastExit = [...(task.contextTrail ?? [])].reverse().find((n) => n.kind === 'exit');
        return lastExit?.text ?? '';
    });

    const addNote = () => {
        const text = note.trim();
        if (!text) return;
        dispatch({ type: 'APPEND_TASK_CONTEXT_NOTE', todoistId: task.todoistId, text, at: new Date().toISOString() });
    };

    const handleStop = () => {
        if (!note.trim()) return; // Stop is gated on a next-step note
        dispatch({ type: 'STOP_TASK_ENGAGEMENT', todoistId: task.todoistId, now: new Date().toISOString(), exitNote: note });
    };

    const handleComplete = () => {
        dispatch({ type: 'TOGGLE_TASK_COMPLETE', todoistId: task.todoistId, titleSnapshot: title, exitNote: note });
        completeTask(task.todoistId);
        navigate('/');
    };

    const pomoActive = pomodoroOn && !focusPlan.singleSession;

    // ── Bounded activation ramp (v7.4) ───────────────────────────────────────
    // A deliberate, *closing* pre-work window — engagement keeps running alongside.
    const [rampMin, setRampMin] = useState(() => {
        try {
            const v = parseInt(localStorage.getItem(RAMP_MIN_KEY) ?? '', 10);
            return RAMP_PRESETS.includes(v) ? v : RAMP_PRESETS[0];
        } catch { return RAMP_PRESETS[0]; }
    });
    const [rampEndsAt, setRampEndsAt] = useState<number | null>(null);
    const [rampNow, setRampNow] = useState(() => Date.now());

    const startRamp = (minutes: number) => {
        setRampMin(minutes);
        try { localStorage.setItem(RAMP_MIN_KEY, String(minutes)); } catch { /* ignore */ }
        const now = new Date().getTime();
        setRampNow(now);
        setRampEndsAt(now + minutes * 60_000);
    };
    const cancelRamp = () => setRampEndsAt(null);

    useEffect(() => {
        if (rampEndsAt == null) return;
        const id = setInterval(() => {
            const now = Date.now();
            if (now >= rampEndsAt) {
                setRampEndsAt(null);
                playChime('work');
                sendNotification('Ramp over', 'Begin your work block.', settings.notificationPreference);
            } else {
                setRampNow(now);
            }
        }, 1000);
        return () => clearInterval(id);
    }, [rampEndsAt, sendNotification, settings.notificationPreference]);

    const rampRemaining = rampEndsAt != null ? Math.max(0, (rampEndsAt - rampNow) / 1000) : 0;

    return (
        <div className="grid lg:grid-cols-[1fr_260px] gap-6 items-start">
            {/* Left column: task card + music */}
            <div className="space-y-5">
                <Card className="space-y-6">
                    {/* Task header */}
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

                    {/* Re-entry context trail (v7.4 Phase 2) */}
                    <div className="space-y-2">
                        {(trail.length > 0 || lastWorkedMinutes != null) && (
                            <div className="rounded-lg border border-accent/30 bg-accent/[0.04] px-3 py-2 space-y-1.5">
                                <span className="text-[10px] font-medium text-accent uppercase tracking-wider">
                                    Re-entry context
                                    {lastWorkedMinutes != null && (
                                        <span className="normal-case font-normal text-text-light">
                                            {' '}· last worked {formatAgo(lastWorkedMinutes)}
                                        </span>
                                    )}
                                </span>
                                {trail.length > 0 ? (
                                    <ul className="space-y-1">
                                        {trail.map((n, i) => (
                                            <li
                                                key={`${n.at}-${i}`}
                                                className={`flex gap-1.5 text-sm ${i === trail.length - 1 ? 'text-text' : 'text-text-light'}`}
                                            >
                                                <span aria-hidden className="flex-shrink-0">{n.kind === 'entry' ? '▸' : '↩'}</span>
                                                <span className="min-w-0">{n.text}</span>
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <p className="text-sm text-text-light">No notes yet — add your first step below.</p>
                                )}
                            </div>
                        )}
                        <label className="block">
                            <span className="text-[10px] font-medium text-text-light uppercase tracking-wider">
                                Next step — where you're leaving off
                            </span>
                            <div className="mt-1 flex gap-2">
                                <input
                                    type="text"
                                    value={note}
                                    onChange={(e) => setNote(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter' && note.trim()) addNote(); }}
                                    placeholder="e.g. wired the reducer, next: hook up the Focus input"
                                    className="flex-1 px-3 py-2 text-sm rounded-lg border border-border bg-card focus:border-accent focus:outline-none transition-colors"
                                />
                                <Button variant="secondary" size="sm" disabled={!note.trim()} onClick={addNote}>
                                    + Add
                                </Button>
                            </div>
                            <span className="block text-[11px] text-text-light mt-1">
                                Committed on Stop / Complete. Use “+ Add” to drop a breadcrumb mid-session.
                            </span>
                        </label>
                    </div>

                    {/* Timer zone */}
                    <div className="py-8 text-center">
                        {pomoActive ? (
                            <PomoTimerDisplay
                                pos={pos}
                                segment={segment}
                            />
                        ) : (
                            <>
                                {segment ? (
                                    <EngagementTimer segment={segment} className="text-6xl font-light tracking-tight" />
                                ) : (
                                    <span className="text-6xl font-light tracking-tight tabular-nums">0:00</span>
                                )}
                                <p className="text-xs text-text-light mt-2 uppercase tracking-wider">Time on task</p>
                            </>
                        )}
                    </div>

                    {/* Ramp (v7.4): a bounded, closing pre-work window */}
                    <div className="rounded-lg border border-border bg-subtle/30 px-3 py-2 flex items-center gap-3 flex-wrap">
                        {rampEndsAt != null ? (
                            <>
                                <span className="inline-flex items-center gap-1.5 text-sm text-accent tabular-nums">
                                    <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" aria-hidden />
                                    Ramp {formatClock(rampRemaining)}
                                </span>
                                <span className="text-xs text-text-light">one video / tea, then begin</span>
                                <button
                                    onClick={cancelRamp}
                                    className="ml-auto text-xs text-text-light hover:text-text cursor-pointer"
                                >
                                    End now
                                </button>
                            </>
                        ) : (
                            <>
                                <span className="text-xs text-text-light">Ramp in:</span>
                                {RAMP_PRESETS.map((m) => (
                                    <button
                                        key={m}
                                        onClick={() => startRamp(m)}
                                        className={`px-2.5 py-1 text-xs rounded-full border transition-colors cursor-pointer ${
                                            m === rampMin
                                                ? 'border-accent text-accent'
                                                : 'border-border text-text-light hover:border-accent hover:text-accent'
                                        }`}
                                    >
                                        {m}m
                                    </button>
                                ))}
                                <span className="text-[11px] text-text-light">Bounded warm-up; the timer keeps running.</span>
                            </>
                        )}
                    </div>

                    {/* Bottom bar: pomo toggle + actions */}
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                        <button
                            onClick={togglePomodoro}
                            title={focusPlan.singleSession ? 'Task is too short to split into slots' : undefined}
                            disabled={focusPlan.singleSession}
                            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm transition-colors ${
                                focusPlan.singleSession
                                    ? 'opacity-40 cursor-not-allowed border-border text-text-light'
                                    : pomodoroOn
                                        ? 'bg-accent/10 border-accent/30 text-accent cursor-pointer'
                                        : 'border-border text-text-light hover:text-text hover:border-text/20 cursor-pointer'
                            }`}
                        >
                            <span className={`w-2 h-2 rounded-full flex-shrink-0 transition-colors ${
                                pomodoroOn && !focusPlan.singleSession ? 'bg-accent' : 'bg-text-light/40'
                            }`} />
                            Pomodoro
                        </button>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="ghost"
                                size="sm"
                                disabled={!note.trim()}
                                onClick={handleStop}
                                title={!note.trim() ? 'Add a next step before stopping' : undefined}
                            >
                                ■ Stop
                            </Button>
                            <Button size="sm" onClick={handleComplete}>
                                ✓ Complete
                            </Button>
                        </div>
                    </div>
                </Card>

                {/* Music — always visible */}
                <MusicProvider>
                    <div className="rounded-xl border border-border bg-subtle/30 p-5 space-y-4">
                        <h3 className="text-xs font-semibold text-text-light uppercase tracking-wider">Music</h3>
                        <PlaylistSelector />
                        <SpotifyPlayer />
                    </div>
                </MusicProvider>
            </div>

            {/* Right sidebar: slot plan + tips */}
            <div className="space-y-4">
                {!focusPlan.singleSession && (
                    <Card>
                        <FocusSlotPlan
                            plan={focusPlan}
                            activeIndex={pomodoroOn ? pos.index : -1}
                            done={pomodoroOn && pos.done}
                        />
                    </Card>
                )}
                <InsightCard />
            </div>
        </div>
    );
}

interface PomoTimerDisplayProps {
    pos: ReturnType<typeof resolveBlockAt>;
    segment: ReturnType<typeof openSegment>;
}

function PomoTimerDisplay({ pos, segment }: PomoTimerDisplayProps) {
    if (pos.done) {
        return (
            <>
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-success/10 text-success text-xs font-medium mb-5">
                    All slots done
                </div>
                <p className="text-4xl font-light text-text-light">Great work.</p>
                {segment && (
                    <p className="mt-4 text-sm text-text-light tabular-nums">
                        <EngagementTimer segment={segment} /> on task
                    </p>
                )}
            </>
        );
    }

    const isBreak = pos.kind === 'break';
    return (
        <>
            <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium mb-5 ${
                isBreak
                    ? 'bg-amber-400/15 text-amber-700 dark:text-amber-300'
                    : 'bg-accent/10 text-accent'
            }`}>
                {isBreak ? 'Break' : 'Work'}
            </div>
            <div className="text-6xl font-light tracking-tight tabular-nums">
                {formatClock(pos.blockRemainingSeconds)}
            </div>
            <p className="text-xs text-text-light mt-2 uppercase tracking-wider">Remaining in block</p>
            {segment && (
                <p className="mt-4 text-sm text-text-light tabular-nums">
                    <EngagementTimer segment={segment} /> on task
                </p>
            )}
        </>
    );
}
