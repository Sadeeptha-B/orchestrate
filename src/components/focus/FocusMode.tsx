import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { useDayPlan } from '../../hooks/useDayPlan';
import { useTodoistData, useTodoistActions } from '../../hooks/useTodoist';
import { useTodoistGate } from '../../hooks/useTodoistGate';
import { useNotifications } from '../../hooks/useNotifications';
import { EngagementTimer } from '../dashboard/EngagementTimer';
import { MusicProvider, PlaylistSelector, SpotifyPlayer } from '../dashboard/MusicPanel';
import { SessionTimeline } from '../dashboard/SessionTimeline';
import { FocusSlotPlan } from './FocusSlotPlan';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Logo } from '../ui/Logo';
import { ThemeToggle } from '../ui/ThemeToggle';
import { computeFocusPlan, findActiveFocusTask, resolveBlockAt } from '../../lib/focus';
import { openSegment, formatClock } from '../../lib/engagement';
import { buildEngagementLog } from '../../lib/engagementLog';
import { computeReentryStats } from '../../lib/engagementHistory';
import { getTaskTitle } from '../../lib/tasks';
import { playChime } from '../../lib/sound';
import type { ContextNote, EngagementSegment, Intention, LinkedTask } from '../../types';

const POMODORO_KEY = 'orchestrate-focus-pomodoro';
const RAMP_MIN_KEY = 'orchestrate-focus-ramp-min';
const RAMP_PRESETS = [5, 10];

/**
 * v7.6 — Focus is an explicit state machine, surfaced 1:1 in the UI. Exactly one of these phases owns
 * the centre of the timer card at a time:
 *
 *   firstAction → ramp → working ⇄ stopping
 *
 *  - `firstAction` — strict-only entry gate: name the concrete first move (replaces the old dashboard
 *    modal). Committing the entry note advances to `ramp`.
 *  - `ramp` — the bounded activation warm-up and the **default entry phase** (we always ease in before
 *    the timer). The ramp countdown takes centre stage; Begin/Skip → `working`, Stop → `stopping`.
 *  - `working` — the task timer is centred; the day's engagement timeline sits alongside with this task's
 *    cards highlighted.
 *  - `stopping` — Stop swaps the centre for the next-step input. "Continue" returns without committing;
 *    "Stop" closes the segment.
 *
 * The card body (`TimerTaskList`) is the intention's **vertical task list**: the focused task expands to
 * host this state machine; the others are compact rows (click to switch focus). The header carries the
 * intention name, an **intention carousel** (prev/next — browse without engaging), and an **✎ Edit toggle**
 * that drops the list into a drag-to-reorder view (`REORDER_INTENTION_TASKS`) — reordering outside the stop
 * flow. The `PhaseStepper` is clickable to navigate the machine (back to re-contextualize, forward to advance).
 */
type FocusPhase = 'firstAction' | 'ramp' | 'working' | 'stopping';

/**
 * Distraction-free page shell — logo, optional inline controls (the strict toggle), a theme toggle (so
 * the user can flip dark mode without leaving Focus), and an Exit control supplied by the caller (plain
 * in the empty state, note-gated when a task is active). Keeps the chrome identical across states.
 */
function FocusShell({ back, headerExtra, exit, children }: { back?: ReactNode; headerExtra?: ReactNode; exit: ReactNode; children: ReactNode }) {
    return (
        <div className="min-h-screen bg-app text-text flex flex-col">
            <header className="px-6 py-4 border-b border-border">
                <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
                    <h1 className="text-xl font-semibold text-accent flex items-center gap-2">
                        {back}
                        <Logo />
                        Focus
                    </h1>
                    <div className="flex items-center gap-1.5">
                        {headerExtra}
                        <ThemeToggle />
                        {exit}
                    </div>
                </div>
            </header>
            <main className="flex-1 px-6 py-6">
                <div className="max-w-5xl mx-auto">{children}</div>
            </main>
        </div>
    );
}

const STEP_DEFS = [
    { key: 'firstAction', label: 'First move' },
    { key: 'ramp', label: 'Ease in' },
    { key: 'working', label: 'Focused' },
    { key: 'stopping', label: 'Wrap up' },
] as const;

/**
 * Slider-style indicator + control for the focus state machine. Steps are clickable to **navigate**: any
 * step backwards (re-contextualize) or forwards (e.g. ramp → Focused / Wrap up), except you can't skip
 * *out* of `firstAction` (its first-move note is a gate — commit it via the in-phase control).
 */
function PhaseStepper({ phase, strict, onJump }: { phase: FocusPhase; strict: boolean; onJump: (p: FocusPhase) => void }) {
    const steps = strict ? STEP_DEFS : STEP_DEFS.filter((s) => s.key !== 'firstAction');
    const activeIdx = steps.findIndex((s) => s.key === phase);
    return (
        <div className="flex items-center justify-center gap-1.5 select-none">
            {steps.map((s, i) => {
                const state = activeIdx === -1 ? 'todo' : i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'todo';
                const canJump = activeIdx !== -1 && i !== activeIdx && (i < activeIdx || phase !== 'firstAction');
                return (
                    <Fragment key={s.key}>
                        <button
                            type="button"
                            onClick={canJump ? () => onJump(s.key) : undefined}
                            disabled={!canJump}
                            title={canJump ? (i < activeIdx ? `Back to ${s.label}` : `Go to ${s.label}`) : undefined}
                            className={`flex items-center gap-1.5 ${canJump ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
                        >
                            <span
                                className={`w-1.5 h-1.5 rounded-full transition-colors ${state === 'active' ? 'bg-accent ring-2 ring-accent/30' : state === 'done' ? 'bg-accent/60' : 'bg-text-light/30'
                                    }`}
                            />
                            <span
                                className={`text-[10px] uppercase tracking-wider transition-colors ${state === 'active' ? 'text-accent font-medium' : 'text-text-light/70'
                                    }`}
                            >
                                {s.label}
                            </span>
                        </button>
                        {i < steps.length - 1 && (
                            <span className={`h-px w-6 ${i < activeIdx ? 'bg-accent/50' : 'bg-border'}`} />
                        )}
                    </Fragment>
                );
            })}
        </div>
    );
}

// ── Shared vertical timeline primitives (v7.6) ────────────────────────────────
// One visual language for both the per-task focus history and the day-wide engagement log.

const fmtTime = (iso: string) => format(parseISO(iso), 'h:mma').toLowerCase();
const segMinutes = (seg: EngagementSegment, now: number) =>
    Math.max(0, Math.round(((seg.endedAt ? Date.parse(seg.endedAt) : now) - Date.parse(seg.startedAt)) / 60000));

/** Legible duration: minutes broken into hours where it helps (e.g. 156 → "2h 36m", 60 → "1h", 7 → "7m"). */
function formatDurationMinutes(min: number): string {
    if (min < 1) return '<1m';
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (h === 0) return `${m}m`;
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** 24h hour index → "8 AM" / "12 PM" / "11 PM". */
function hourLabel(h: number): string {
    const hh = ((h % 24) + 24) % 24;
    const period = hh < 12 ? 'AM' : 'PM';
    const display = hh % 12 === 0 ? 12 : hh % 12;
    return `${display} ${period}`;
}

/**
 * Correlate a task's entry/exit notes to one of its segments by timestamp window `[segStart, nextStart)`.
 * The first segment also absorbs any pre-engagement (e.g. wizard-planned) entry note that predates it.
 * Latest matching note of each kind wins.
 */
function notesForSegment(trail: ContextNote[], segStart: string, nextStart: string | undefined, isFirst: boolean): { entry?: ContextNote; exit?: ContextNote } {
    let entry: ContextNote | undefined;
    let exit: ContextNote | undefined;
    for (const n of trail) {
        const inWindow = n.at >= segStart && (!nextStart || n.at < nextStart);
        if (n.kind === 'entry' && (inWindow || (isFirst && n.at < segStart))) entry = n;
        if (n.kind === 'exit' && inWindow) exit = n;
    }
    return { entry, exit };
}

/** An intention's linked tasks in `linkedTaskIds` order, with any unlisted (e.g. completed) ones appended. */
function orderedIntentionTasks(intention: Intention, linkedTasks: LinkedTask[]): LinkedTask[] {
    const order = intention.linkedTaskIds;
    const mine = linkedTasks.filter((lt) => lt.intentionId === intention.id);
    return [...mine].sort((a, b) => {
        const ai = order.indexOf(a.todoistId);
        const bi = order.indexOf(b.todoistId);
        return (ai === -1 ? Number.MAX_SAFE_INTEGER : ai) - (bi === -1 ? Number.MAX_SAFE_INTEGER : bi);
    });
}

function TimelineFrame({ title, right, subtitle, scroll, rows, empty, revision }: {
    title: string; right?: ReactNode; subtitle?: ReactNode; scroll?: boolean; rows: ReactNode[]; empty: string;
    /** Bumps when the underlying content changes, so the view re-anchors to the latest engagement. */
    revision?: number;
}) {
    // Transcript behaviour (v7.6): anchor to the latest engagement (a `[data-latest]` row) — for the
    // hourly view that's the current/last engaged hour, not the empty future. `stick` tracks whether
    // we're parked there; scrolling away reveals a "jump to latest" affordance.
    const listRef = useRef<HTMLOListElement>(null);
    const stick = useRef(true);
    const [showJump, setShowJump] = useState(false);

    const anchorToLatest = () => {
        const el = listRef.current;
        if (!el) return;
        const target = el.querySelector('[data-latest]') as HTMLElement | null;
        el.scrollTop = target ? Math.max(0, target.offsetTop - el.clientHeight / 2) : el.scrollHeight;
    };

    useEffect(() => {
        if (!scroll) return;
        if (stick.current) anchorToLatest();
    }, [scroll, revision, rows.length]);

    const onScroll = () => {
        const el = listRef.current;
        if (!el) return;
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        stick.current = atBottom;
        setShowJump(!atBottom);
    };
    const jumpToLatest = () => {
        anchorToLatest();
        stick.current = true;
        setShowJump(false);
    };

    return (
        <div className="relative rounded-2xl border border-border bg-card/40 px-4 py-4">
            <div className="flex items-baseline justify-between mb-1">
                <h3 className="text-[10px] font-semibold text-text-light uppercase tracking-wider">{title}</h3>
                {right}
            </div>
            {subtitle && <div className="mb-3">{subtitle}</div>}
            {!subtitle && <div className="mb-2" />}
            {rows.length > 0 ? (
                <ol
                    ref={listRef}
                    onScroll={scroll ? onScroll : undefined}
                    className={`relative space-y-2 ${scroll ? 'max-h-[420px] overflow-y-auto scrollbar-subtle pr-1' : ''}`}
                >
                    {rows}
                </ol>
            ) : (
                <p className="text-[11px] text-text-light">{empty}</p>
            )}
            {scroll && showJump && (
                <button
                    onClick={jumpToLatest}
                    className="absolute bottom-3 right-3 w-7 h-7 flex items-center justify-center rounded-full bg-accent text-white shadow-md hover:bg-accent/90 transition-colors cursor-pointer text-sm leading-none"
                    title="Jump to latest"
                    aria-label="Jump to latest engagement"
                >
                    ↓
                </button>
            )}
        </div>
    );
}

/** A deletable breadcrumb line with its own timestamp. */
function NoteLine({ text, at, kind, onDelete }: { text: string; at: string; kind: 'entry' | 'exit'; onDelete: () => void }) {
    return (
        <span className="group/note flex items-start gap-1.5">
            <span className="min-w-0 flex-1">
                <span className="text-[11px] text-text-light italic">{kind === 'entry' ? '▸' : '↩'} {text}</span>
                <span className="ml-1 text-[10px] text-text-light/60 tabular-nums">{fmtTime(at)}</span>
            </span>
            <button
                onClick={onDelete}
                className="flex-shrink-0 text-text-light/40 hover:text-red-500 transition-colors opacity-0 group-hover/note:opacity-100 cursor-pointer text-xs leading-none"
                title="Delete note"
                aria-label="Delete note"
            >
                ×
            </button>
        </span>
    );
}

/**
 * One engagement card in the timeline — a bordered task chip (intention · title · duration). Hovering
 * portals a popover (so the scroll container can't clip it) showing the intention and its tasks in order.
 */
function EngagementCard({ highlight, intentionTitle, title, startTime, endTime, duration, currentId, sibInfo }: {
    highlight: boolean; intentionTitle?: string; title: string; startTime: string; endTime?: string;
    duration: ReactNode; currentId: string; sibInfo: { id: string; title: string; completed: boolean }[];
}) {
    const ref = useRef<HTMLDivElement>(null);
    const [rect, setRect] = useState<DOMRect | null>(null);
    const canHover = sibInfo.length > 0;
    return (
        <div
            ref={ref}
            onMouseEnter={canHover ? () => { if (ref.current) setRect(ref.current.getBoundingClientRect()); } : undefined}
            onMouseLeave={() => setRect(null)}
            className={`rounded-lg border px-3 py-1.5 ${highlight ? 'border-accent bg-accent/5' : 'border-border bg-card'}`}
        >
            {/* Start time pinned to the top of the card; end time to the bottom — one engagement, one card. */}
            <span className="block text-[10px] text-text-light/70 tabular-nums">▸ {startTime}</span>
            {intentionTitle && (
                <span className="block text-[9px] font-medium text-text-light uppercase tracking-wider truncate mt-0.5">{intentionTitle}</span>
            )}
            <span className="block text-sm text-text truncate">{title}</span>
            <span className="block text-[11px] text-text-light tabular-nums">{duration}</span>
            <span className={`block text-[10px] tabular-nums ${endTime ? 'text-text-light/70' : 'text-accent'}`}>
                {endTime ? `■ ${endTime}` : '• in progress'}
            </span>
            {rect && createPortal(
                <div
                    style={{ position: 'fixed', top: rect.top, left: rect.left - 8, transform: 'translateX(-100%)' }}
                    className="w-60 z-50 rounded-lg border border-border bg-card shadow-lg px-3 py-2 pointer-events-none"
                >
                    {intentionTitle && (
                        <span className="block text-[10px] font-medium text-text-light uppercase tracking-wider truncate">{intentionTitle}</span>
                    )}
                    <ol className="mt-1 space-y-0.5">
                        {sibInfo.map((s) => {
                            const isThis = s.id === currentId;
                            return (
                                <li key={s.id} className="flex items-center gap-1.5 text-xs">
                                    <span className={`flex-shrink-0 text-[10px] ${s.completed ? 'text-success' : isThis ? 'text-accent' : 'text-text-light/50'}`}>
                                        {s.completed ? '✓' : isThis ? '▸' : '○'}
                                    </span>
                                    <span className={`min-w-0 truncate ${isThis ? 'text-text font-medium' : s.completed ? 'text-text-light/60 line-through' : 'text-text-light'}`}>
                                        {s.title}
                                    </span>
                                </li>
                            );
                        })}
                    </ol>
                </div>,
                document.body,
            )}
        </div>
    );
}

/**
 * Engagement timeline (v7.6) — the day's engagement record laid out as an **hourly grid** bounded by the
 * settings day-limits (`timelineStart/EndMinutes`). Each Start→Stop is one card placed in the hour it
 * started; entry/exit breadcrumbs (now accumulated per engagement) sit outside the card. Used on both the
 * picker and the timer surface; on the timer surface, the focused task's cards are **highlighted**.
 */
function EngagementTimeline({ highlightTaskId }: { highlightTaskId?: string }) {
    const { plan, settings, life, dispatch } = useDayPlan();
    const { taskMap } = useTodoistData();
    const [nowSnapshot] = useState(() => Date.now());
    const log = useMemo(() => buildEngagementLog(plan, taskMap), [plan, taskMap]);
    const taskById = useMemo(() => new Map(plan.linkedTasks.map((lt) => [lt.todoistId, lt])), [plan.linkedTasks]);
    const totalMinutes = log.reduce((acc, r) => (r.entryType === 'engagement' ? acc + segMinutes(r.segment, nowSnapshot) : acc), 0);
    // v7.4 Phase 2 re-entry metric, ported here from the old dashboard EngagementLogCard header.
    const reentry = computeReentryStats(life.engagementHistory, { windowDays: 7 });

    const deleteNote = (todoistId: string, at: string, kind: 'entry' | 'exit') =>
        dispatch({ type: 'DELETE_TASK_CONTEXT_NOTE', todoistId, at, kind });

    // Build one card per log entry, then bucket cards into the hour they started.
    const startHour = Math.floor((settings.timelineStartMinutes ?? 270) / 60);
    const endHour = Math.min(24, Math.ceil((settings.timelineEndMinutes ?? 1440) / 60));
    const clampHour = (h: number) => Math.min(endHour - 1, Math.max(startHour, h));
    const byHour = new Map<number, ReactNode[]>();
    const push = (h: number, node: ReactNode) => {
        const k = clampHour(h);
        (byHour.get(k) ?? byHour.set(k, []).get(k)!).push(node);
    };

    for (const r of log) {
        if (r.entryType === 'reschedule') {
            push(new Date(r.at).getHours(), (
                <div key={r.key} className="rounded-lg border border-border bg-card/60 px-3 py-1.5">
                    <span className="block text-[10px] text-text-light/70 tabular-nums">⌁ {fmtTime(r.at)}</span>
                    <span className="block text-sm text-text truncate">{r.title}</span>
                    <span className="block text-[11px] text-text-light">moved {r.fromTime ?? '—'} → {r.toTime ?? '—'}</span>
                </div>
            ));
            continue;
        }
        const open = !r.segment.endedAt;
        const lt = r.kind === 'task' ? taskById.get(r.sourceId) : undefined;
        const intention = lt?.intentionId ? plan.intentions.find((x) => x.id === lt.intentionId) : undefined;
        const siblings = intention ? orderedIntentionTasks(intention, plan.linkedTasks) : [];
        let entry: ContextNote | undefined;
        let exit: ContextNote | undefined;
        if (lt) {
            const sorted = [...(lt.segments ?? [])].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
            const segIdx = sorted.findIndex((s) => s.startedAt === r.segment.startedAt);
            const nextStart = segIdx >= 0 ? sorted[segIdx + 1]?.startedAt : undefined;
            ({ entry, exit } = notesForSegment(lt.contextTrail ?? [], r.segment.startedAt, nextStart, segIdx === 0));
        }
        const minutes = segMinutes(r.segment, nowSnapshot);
        push(new Date(r.segment.startedAt).getHours(), (
            <div key={r.key} className="space-y-1">
                {entry && (
                    <NoteLine text={entry.text} at={entry.at} kind="entry" onDelete={() => deleteNote(r.sourceId, entry!.at, 'entry')} />
                )}
                <EngagementCard
                    highlight={highlightTaskId != null && r.sourceId === highlightTaskId}
                    intentionTitle={intention?.title}
                    title={r.title}
                    startTime={fmtTime(r.segment.startedAt)}
                    endTime={r.segment.endedAt ? fmtTime(r.segment.endedAt) : undefined}
                    duration={<>{open ? <EngagementTimer segment={r.segment} /> : formatDurationMinutes(minutes)}{r.kind === 'habit' && <span> · habit</span>}</>}
                    currentId={r.sourceId}
                    sibInfo={siblings.map((s) => ({ id: s.todoistId, title: getTaskTitle(s.todoistId, plan.linkedTasks, taskMap), completed: !!s.completed }))}
                />
                {exit && (
                    <NoteLine text={exit.text} at={exit.at} kind="exit" onDelete={() => deleteNote(r.sourceId, exit!.at, 'exit')} />
                )}
            </div>
        ));
    }

    // The hour to anchor the transcript to: the last hour with engagements, else the current hour.
    let latestEngagedHour = -1;
    for (const h of byHour.keys()) if (h > latestEngagedHour) latestEngagedHour = h;
    const anchorHour = latestEngagedHour >= 0 ? latestEngagedHour : clampHour(new Date(nowSnapshot).getHours());

    // Render engaged hours as full rows; collapse runs of empty hours into one compact "gap" row.
    const rows: ReactNode[] = [];
    let emptyStart = -1;
    const flushGap = (endExclusive: number) => {
        if (emptyStart < 0) return;
        const from = emptyStart;
        const to = endExclusive - 1;
        rows.push(
            <li key={`gap-${from}`} className="flex gap-2">
                <span className="w-12 flex-shrink-0" />
                <div className="flex-1 min-w-0 border-l border-border/30 pl-3">
                    <span className="block text-[10px] text-text-light/40 py-1">
                        ⋯ {from === to ? hourLabel(from) : `${hourLabel(from)} – ${hourLabel(to)}`}
                    </span>
                </div>
            </li>,
        );
        emptyStart = -1;
    };
    for (let h = startHour; h < endHour; h++) {
        const cards = byHour.get(h);
        if (!cards) {
            if (emptyStart < 0) emptyStart = h;
            continue;
        }
        flushGap(h);
        rows.push(
            <li key={h} data-latest={h === anchorHour ? '' : undefined} className="flex gap-2">
                <span className="w-12 flex-shrink-0 text-right text-[10px] text-text-light/70 uppercase tracking-wider pt-1.5">{hourLabel(h)}</span>
                <div className="flex-1 min-w-0 border-l border-border pl-3 pb-1 space-y-2">
                    {cards}
                </div>
            </li>,
        );
    }
    flushGap(endHour);

    return (
        <TimelineFrame
            title="Today's engagement"
            right={totalMinutes >= 1 ? <span className="text-[10px] text-text-light tabular-nums">{formatDurationMinutes(Math.round(totalMinutes))} total</span> : undefined}
            subtitle={reentry.resumeCount > 0 ? (
                <span className="text-[10px] text-text-light tabular-nums">
                    Re-entry · ~{reentry.medianGapMinutes}m to resume · {reentry.resumeCount} {reentry.resumeCount === 1 ? 'resume' : 'resumes'} (7d)
                </span>
            ) : undefined}
            scroll
            rows={log.length > 0 ? rows : []}
            revision={log.length}
            empty="Nothing logged yet today — pick a task to start."
        />
    );
}

const GripIcon = () => (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor" aria-hidden className="flex-shrink-0">
        <circle cx="3.5" cy="2" r="1.2" /><circle cx="8.5" cy="2" r="1.2" />
        <circle cx="3.5" cy="6" r="1.2" /><circle cx="8.5" cy="6" r="1.2" />
        <circle cx="3.5" cy="10" r="1.2" /><circle cx="8.5" cy="10" r="1.2" />
    </svg>
);

/**
 * The timer card body (v7.6) — the focused task's intention as a **vertical task list**, with the
 * currently-focused task expanded to host the state machine (`children`). The header is an intention
 * **carousel** (prev/next browses intentions without engaging) plus an **edit toggle** (✎): edit mode
 * drops the list into a drag-to-reorder view (`REORDER_INTENTION_TASKS`) — reordering *outside the stop
 * flow*. Clicking a task switches focus (`onSwitch`, note-gated in strict). A task with no intention just
 * renders the state machine bare.
 */
function TimerTaskList({ focusedTaskId, focusedIntentionId, onSwitch, switchLocked, children }: {
    focusedTaskId: string; focusedIntentionId?: string; onSwitch: (todoistId: string) => void; switchLocked?: boolean; children: ReactNode;
}) {
    const { plan, dispatch } = useDayPlan();
    const { taskMap } = useTodoistData();
    const intentions = useMemo(
        () => plan.intentions.filter((i) => plan.linkedTasks.some((lt) => lt.intentionId === i.id)),
        [plan.intentions, plan.linkedTasks],
    );
    const focusedIdx = Math.max(0, intentions.findIndex((i) => i.id === focusedIntentionId));
    const [idx, setIdx] = useState(focusedIdx);
    const [editMode, setEditMode] = useState(false);
    const [dragId, setDragId] = useState<string | null>(null);

    // A task with no intention has no list to show — render the state machine on its own.
    if (intentions.length === 0) return <>{children}</>;

    const safeIdx = Math.min(idx, intentions.length - 1);
    const intention = intentions[safeIdx];
    const tasks = orderedIntentionTasks(intention, plan.linkedTasks);

    const handleDrop = (targetId: string) => {
        if (!dragId || dragId === targetId) { setDragId(null); return; }
        const ids = tasks.map((t) => t.todoistId);
        const from = ids.indexOf(dragId);
        const to = ids.indexOf(targetId);
        if (from < 0 || to < 0) { setDragId(null); return; }
        const next = [...ids];
        next.splice(from, 1);
        next.splice(to, 0, dragId);
        dispatch({ type: 'REORDER_INTENTION_TASKS', intentionId: intention.id, todoistIds: next });
        setDragId(null);
    };

    return (
        <div className="space-y-3">
            {/* Header — intention name + carousel + edit toggle */}
            <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-text-light uppercase tracking-wider truncate">{intention.title}</span>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                    {safeIdx !== focusedIdx && !editMode && (
                        <button
                            onClick={() => setIdx(focusedIdx)}
                            className="text-[10px] px-2 py-0.5 rounded-full bg-accent/10 text-accent hover:bg-accent/20 transition-colors cursor-pointer"
                            title="Back to the focused task's intention"
                        >
                            ↩ Focused
                        </button>
                    )}
                    {intentions.length > 1 && !editMode && (
                        <>
                            <button
                                onClick={() => setIdx((n) => Math.max(0, n - 1))}
                                disabled={safeIdx === 0}
                                className="w-6 h-6 flex items-center justify-center rounded text-text-light hover:text-text hover:bg-surface-dark transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer text-base leading-none"
                                aria-label="Previous intention"
                            >
                                ‹
                            </button>
                            <span className="text-xs tabular-nums text-text-light min-w-[2.5rem] text-center">
                                {safeIdx + 1} / {intentions.length}
                            </span>
                            <button
                                onClick={() => setIdx((n) => Math.min(intentions.length - 1, n + 1))}
                                disabled={safeIdx === intentions.length - 1}
                                className="w-6 h-6 flex items-center justify-center rounded text-text-light hover:text-text hover:bg-surface-dark transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer text-base leading-none"
                                aria-label="Next intention"
                            >
                                ›
                            </button>
                        </>
                    )}
                    <button
                        onClick={() => setEditMode((e) => !e)}
                        className={`px-2 py-0.5 rounded-full text-[11px] border transition-colors cursor-pointer ${editMode ? 'border-accent bg-accent/10 text-accent' : 'border-border text-text-light hover:text-accent hover:border-accent'
                            }`}
                        title={editMode ? 'Done reordering' : 'Reorder tasks'}
                    >
                        {editMode ? '✓ Done' : '✎ Edit'}
                    </button>
                </div>
            </div>

            {/* Task list — focused task expands to the state machine; edit mode is a drag-to-reorder view */}
            <ul className="space-y-1">
                {tasks.map((lt) => {
                    const isFocused = lt.todoistId === focusedTaskId;
                    const title = getTaskTitle(lt.todoistId, plan.linkedTasks, taskMap);
                    if (editMode) {
                        return (
                            <li
                                key={lt.todoistId}
                                draggable
                                onDragStart={() => setDragId(lt.todoistId)}
                                onDragOver={(e) => e.preventDefault()}
                                onDrop={() => handleDrop(lt.todoistId)}
                                onDragEnd={() => setDragId(null)}
                                className={`flex items-center gap-2 px-2 py-2 rounded-lg border border-border bg-card cursor-grab active:cursor-grabbing ${dragId === lt.todoistId ? 'opacity-40' : ''}`}
                            >
                                <span className="text-text-light/40"><GripIcon /></span>
                                <span className={`flex-shrink-0 text-[11px] ${lt.completed ? 'text-success' : isFocused ? 'text-accent' : 'text-text-light/50'}`}>
                                    {lt.completed ? '✓' : isFocused ? '▸' : '○'}
                                </span>
                                <span className={`min-w-0 truncate text-sm ${lt.completed ? 'line-through text-text-light/60' : 'text-text'}`}>{title}</span>
                            </li>
                        );
                    }
                    const disabled = isFocused || lt.completed || switchLocked;
                    const buttonTitle = isFocused
                        ? 'Currently focused'
                        : lt.completed
                            ? 'Completed'
                            : switchLocked
                                ? 'Finish or continue the current wrap-up first'
                                : 'Switch focus to this task';
                    return (
                        <li key={lt.todoistId}>
                            <button
                                onClick={isFocused ? undefined : () => onSwitch(lt.todoistId)}
                                disabled={disabled}
                                title={buttonTitle}
                                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors ${disabled
                                    ? 'cursor-default'
                                    : 'cursor-pointer hover:bg-accent-subtle/40'
                                    }`}
                            >
                                <span className={`flex-shrink-0 text-[11px] ${lt.completed ? 'text-success' : isFocused ? 'text-accent' : 'text-text-light/50'}`}>
                                    {lt.completed ? '✓' : isFocused ? '▸' : '○'}
                                </span>
                                <span className={`min-w-0 truncate ${isFocused ? 'text-base font-semibold text-text' : lt.completed ? 'text-sm line-through text-text-light/60' : 'text-sm text-text-light'
                                    }`}>
                                    {title}
                                </span>
                            </button>
                            {isFocused && <div className="mt-2 ml-1 border-l-2 border-accent/20 pl-4">{children}</div>}
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}

/**
 * Focus picker (v7.6) — the "what next?" surface shown when nothing is engaged (fresh entry, or right
 * after a Stop). Lists today's incomplete tasks grouped by intention; picking one engages it, which
 * makes it the active focus. When **peeking** (a task is engaged but the user navigated back to look),
 * the chooser is hidden — only the day context + engagement log show, with a "back to timer" control.
 */
function FocusPicker({ peekTask }: { peekTask?: LinkedTask }) {
    const { plan, dispatch } = useDayPlan();
    const { taskMap } = useTodoistData();
    const navigate = useNavigate();
    const [pinnedSessionId, setPinnedSessionId] = useState<string | null>(null);
    const [dragId, setDragId] = useState<string | null>(null);

    const byIntention = new Map<string | undefined, LinkedTask[]>();
    for (const lt of plan.linkedTasks.filter((lt) => !lt.completed)) {
        const list = byIntention.get(lt.intentionId) ?? [];
        list.push(lt);
        byIntention.set(lt.intentionId, list);
    }
    const groups = [...byIntention.entries()].map(([intentionId, tasks]) => {
        const intention = plan.intentions.find((i) => i.id === intentionId);
        const order = intention?.linkedTaskIds ?? [];
        const sorted = [...tasks].sort((a, b) =>
            ((order.indexOf(a.todoistId) + 1) || Number.MAX_SAFE_INTEGER) - ((order.indexOf(b.todoistId) + 1) || Number.MAX_SAFE_INTEGER));
        return {
            key: intentionId ?? 'anytime',
            intentionId,
            title: intention?.title ?? 'Anytime',
            tasks: sorted,
        };
    });

    const engage = (todoistId: string) =>
        dispatch({ type: 'START_TASK_ENGAGEMENT', todoistId, now: new Date().toISOString() });

    // Drag-to-reorder within an intention group (REORDER_INTENTION_TASKS). Cross-group drops no-op.
    const handleDrop = (intentionId: string | undefined, ids: string[], targetId: string) => {
        if (!intentionId || !dragId || dragId === targetId) { setDragId(null); return; }
        const from = ids.indexOf(dragId);
        const to = ids.indexOf(targetId);
        if (from < 0 || to < 0) { setDragId(null); return; }
        const next = [...ids];
        next.splice(from, 1);
        next.splice(to, 0, dragId);
        dispatch({ type: 'REORDER_INTENTION_TASKS', intentionId, todoistIds: next });
        setDragId(null);
    };

    const backToTimer = () => navigate('/focus');

    return (
        <FocusShell
            back={peekTask ? (
                <button
                    onClick={backToTimer}
                    className="text-text-light hover:text-accent transition-colors cursor-pointer text-lg leading-none mr-1"
                    title="Back to the timer"
                    aria-label="Back to the timer"
                >
                    ←
                </button>
            ) : undefined}
            exit={<Button variant="ghost" size="sm" onClick={() => navigate('/')}>Exit</Button>}
        >
            <div className="max-w-5xl mx-auto space-y-6">
                <div className="text-center">
                    {peekTask ? (
                        <>
                            <h2 className="text-2xl font-semibold">The day so far</h2>
                            <p className="text-sm text-text-light mt-1">
                                Still focused on <span className="text-accent font-medium">{getTaskTitle(peekTask.todoistId, plan.linkedTasks, taskMap)}</span> —{' '}
                                <button onClick={backToTimer} className="text-accent hover:underline cursor-pointer">back to the timer</button>.
                            </p>
                        </>
                    ) : (
                        <>
                            <h2 className="text-2xl font-semibold">What do you want to focus on?</h2>
                            <p className="text-sm text-text-light mt-1">Pick a task to start the timer.</p>
                        </>
                    )}
                </div>

                {/* Day's shape — the session timeline bar at the top, full width, so it frames the
                    choice (and isn't cramped in a column). */}
                <div className="space-y-1.5">
                    <span className="text-[10px] font-medium text-text-light uppercase tracking-wider px-1">Today's shape</span>
                    <div className="border border-border rounded-xl overflow-hidden px-4 py-1">
                        <SessionTimeline pinnedSessionId={pinnedSessionId} onSelectSession={setPinnedSessionId} />
                    </div>
                </div>

                <div className="grid lg:grid-cols-[1fr_320px] gap-6 items-start">
                    {/* Left: the chooser (hidden while peeking) */}
                    <div className="space-y-5 min-w-0">
                        {peekTask ? null : groups.length > 0 ? (
                            <div className="space-y-4">
                                {groups.map((g) => {
                                    const ids = g.tasks.map((t) => t.todoistId);
                                    return (
                                        <div key={g.key}>
                                            <span className="text-[10px] font-medium text-text-light uppercase tracking-wider px-1">{g.title}</span>
                                            <ul className="mt-1.5 space-y-1.5">
                                                {g.tasks.map((lt) => {
                                                    const last = lt.contextTrail?.at(-1);
                                                    return (
                                                        <li key={lt.todoistId}>
                                                            <button
                                                                draggable={!!g.intentionId}
                                                                onDragStart={() => setDragId(lt.todoistId)}
                                                                onDragOver={(e) => e.preventDefault()}
                                                                onDrop={() => handleDrop(g.intentionId, ids, lt.todoistId)}
                                                                onDragEnd={() => setDragId(null)}
                                                                onClick={() => engage(lt.todoistId)}
                                                                className={`w-full text-left px-3 py-2.5 rounded-xl border border-border bg-card hover:border-accent hover:bg-accent-subtle/40 transition-colors cursor-pointer flex items-center gap-3 ${dragId === lt.todoistId ? 'opacity-40' : ''}`}
                                                            >
                                                                <span className="text-accent text-sm flex-shrink-0">▶</span>
                                                                <span className="min-w-0 flex-1">
                                                                    <span className="block text-sm truncate">{getTaskTitle(lt.todoistId, plan.linkedTasks, taskMap)}</span>
                                                                    {last && <span className="block text-[11px] text-text-light truncate">↩ {last.text}</span>}
                                                                </span>
                                                                {lt.estimatedMinutes != null && (
                                                                    <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-surface-dark text-text-light tabular-nums">
                                                                        {lt.estimatedMinutes}m
                                                                    </span>
                                                                )}
                                                            </button>
                                                        </li>
                                                    );
                                                })}
                                            </ul>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <Card className="text-center py-10">
                                <p className="text-text-light mb-4">No open tasks to focus on right now.</p>
                                <Button variant="secondary" onClick={() => navigate('/')}>Back to dashboard</Button>
                            </Card>
                        )}
                    </div>

                    {/* Right rail: the day-wide engagement log */}
                    <EngagementTimeline />
                </div>
            </div>
        </FocusShell>
    );
}

export function FocusMode() {
    const { plan } = useDayPlan();
    const location = useLocation();
    // `state.pick` is the "peek at the picker while engaged" intent set by the back arrow.
    const peeking = (location.state as { pick?: boolean } | null)?.pick === true;

    const activeTask = useMemo(() => findActiveFocusTask(plan), [plan]);

    if (activeTask && !peeking) return <FocusActive key={activeTask.todoistId} task={activeTask} />;
    return <FocusPicker peekTask={activeTask ?? undefined} />;
}

function FocusActive({ task }: { task: LinkedTask }) {
    const { plan, settings, dispatch } = useDayPlan();
    const { taskMap } = useTodoistData();
    const { completeTask } = useTodoistActions();
    const { writesBlocked } = useTodoistGate();
    const { sendNotification } = useNotifications();
    const navigate = useNavigate();

    const title = getTaskTitle(task.todoistId, plan.linkedTasks, taskMap);
    const segment = openSegment(task.segments);
    const focusPlan = useMemo(() => computeFocusPlan(task.estimatedMinutes), [task.estimatedMinutes]);

    const trail = task.contextTrail ?? [];
    const strict = settings.focusStrict ?? true;
    // v7.6: entry notes accumulate per engagement (like exits), so the gate is *this engagement's* first
    // move — does the open segment already have an `entry` note? (committed at/after the segment start).
    const hasEntryThisEngagement = !!segment && trail.some((n) => n.kind === 'entry' && n.at >= segment.startedAt);

    // ── State machine ─────────────────────────────────────────────────────────
    // Strict entry with no first move *for this engagement* → capture it; otherwise ease in (v7.6).
    const [phase, setPhase] = useState<FocusPhase>(strict && !hasEntryThisEngagement ? 'firstAction' : 'ramp');

    // The in-Focus pill is the only way strictness flips while mounted; advance past the now-optional
    // `firstAction` gate in the same handler so the machine never strands on a step that no longer applies.
    const toggleStrict = () => {
        const next = !strict;
        dispatch({ type: 'UPDATE_SETTINGS', settings: { focusStrict: next } });
        if (!next && phase === 'firstAction') setPhase('ramp');
    };

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

    // ── Next-step note (v7.4 Phase 2) ─────────────────────────────────────────
    // The full re-entry trail now lives in the per-task timeline beside the timer, so the timer card
    // only owns the editable "where you're leaving off" draft.
    const [note, setNote] = useState(() => {
        const lastExit = [...(task.contextTrail ?? [])].reverse().find((n) => n.kind === 'exit');
        return lastExit?.text ?? '';
    });
    const [firstActionDraft, setFirstActionDraft] = useState('');

    // v7.5: in strict mode the next-step note is required to Stop or to leave Focus; in relaxed mode
    // it's optional (an empty note simply leaves no breadcrumb).
    const noteRequired = strict;
    const [exitBlocked, setExitBlocked] = useState(false);
    // v7.6: a deferred task-switch awaiting its required next-step note (strict mode only).
    const [pendingSwitchId, setPendingSwitchId] = useState<string | null>(null);

    const commitFirstAction = () => {
        const text = firstActionDraft.trim();
        if (!text) return;
        // v7.6: append (accumulate per engagement) rather than overwrite a single entry note.
        dispatch({ type: 'APPEND_TASK_ENTRY_NOTE', todoistId: task.todoistId, text, at: new Date().toISOString() });
        setPhase('ramp');
    };

    const addNote = () => {
        const text = note.trim();
        if (!text) return;
        dispatch({ type: 'APPEND_TASK_CONTEXT_NOTE', todoistId: task.todoistId, text, at: new Date().toISOString() });
        setPhase('working');
    };

    const handleStop = () => {
        if (noteRequired && !note.trim()) return; // Stop is gated on a next-step note
        dispatch({ type: 'STOP_TASK_ENGAGEMENT', todoistId: task.todoistId, now: new Date().toISOString(), exitNote: note });
    };

    const handleComplete = async () => {
        const completed = await completeTask(task.todoistId);
        if (!completed) return;
        dispatch({ type: 'TOGGLE_TASK_COMPLETE', todoistId: task.todoistId, titleSnapshot: title, exitNote: note });
        navigate('/');
    };

    // v7.5: patch the escape hatch — leaving Focus while a task is engaged no longer bypasses the note.
    const handleExit = () => {
        if (noteRequired && !note.trim()) {
            if (phase !== 'stopping') setPhase('stopping');
            setExitBlocked(true);
            return;
        }
        if (note.trim()) {
            dispatch({ type: 'APPEND_TASK_CONTEXT_NOTE', todoistId: task.todoistId, text: note.trim(), at: new Date().toISOString() });
        }
        navigate('/');
    };

    // v7.6: peek the selection surface (picker) without ending the engagement — the timer keeps running
    // in the background; "back to timer" returns. No note gate: nothing is being stopped or left.
    const peekPicker = () => navigate('/focus', { state: { pick: true } });

    // Close the current segment (so we don't pile up parallel engagements), committing the draft note,
    // then engage the target — it becomes the most-recent open segment and Focus remounts onto it.
    const performSwitch = (todoistId: string) => {
        if (segment) {
            dispatch({ type: 'STOP_TASK_ENGAGEMENT', todoistId: task.todoistId, now: new Date().toISOString(), exitNote: note });
        }
        dispatch({ type: 'START_TASK_ENGAGEMENT', todoistId, now: new Date().toISOString() });
        setPendingSwitchId(null);
    };

    // v7.6: switch focus to a sibling task by clicking a context chip. Strict blocks the switch until a
    // next-step note exists (switching closes the current segment, which is note-gated like Stop) —
    // it routes to `stopping` and remembers the target so the user can confirm once they've jotted one.
    const switchTo = (todoistId: string) => {
        if (todoistId === task.todoistId) return;
        if (strict && !note.trim()) {
            setPendingSwitchId(todoistId);
            setPhase('stopping');
            setExitBlocked(true);
            return;
        }
        performSwitch(todoistId);
    };

    // ── Bounded activation ramp (v7.4) ───────────────────────────────────────
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
    const endRamp = () => { setRampEndsAt(null); setPhase('working'); };
    // v7.6: shared Stop across phases (first move / ease-in / working) — cancel any ramp and go capture
    // the wrap-up note. The `stopping` phase owns the actual segment close.
    const goStop = () => { setRampEndsAt(null); setPhase('stopping'); };

    useEffect(() => {
        if (rampEndsAt == null) return;
        const id = setInterval(() => {
            const now = Date.now();
            if (now >= rampEndsAt) {
                setRampEndsAt(null);
                setPhase('working');
                playChime('work');
                sendNotification('Ramp over', 'Begin your work block.', settings.notificationPreference);
            } else {
                setRampNow(now);
            }
        }, 1000);
        return () => clearInterval(id);
    }, [rampEndsAt, sendNotification, settings.notificationPreference]);

    const rampRemaining = rampEndsAt != null ? Math.max(0, (rampEndsAt - rampNow) / 1000) : 0;
    const rampActive = rampEndsAt != null;

    const pomoActive = pomodoroOn && !focusPlan.singleSession;

    /** A small, muted "X on task" line — the broader timer kept visible but de-emphasised. */
    const taskTimerAside = segment && (
        <p className="text-sm text-text-light/80 tabular-nums">
            <EngagementTimer segment={segment} /> on task
        </p>
    );

    function renderCenter() {
        if (phase === 'firstAction') {
            return (
                <div className="w-full max-w-md space-y-3">
                    <p className="text-sm text-text-light">
                        Name the concrete first move — the specific entry point, not the whole task. You'll
                        see this when you return.
                    </p>
                    <input
                        autoFocus
                        type="text"
                        value={firstActionDraft}
                        onChange={(e) => setFirstActionDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && firstActionDraft.trim()) commitFirstAction(); }}
                        placeholder="e.g. open auth.ts, add the middleware stub"
                        className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-card focus:border-accent focus:outline-none transition-colors text-center"
                    />
                    <Button disabled={!firstActionDraft.trim()} onClick={commitFirstAction}>
                        Begin →
                    </Button>
                    {taskTimerAside}
                </div>
            );
        }

        if (phase === 'ramp') {
            if (rampActive) {
                return (
                    <div className="w-full space-y-2">
                        <div className="text-6xl font-light tracking-tight tabular-nums text-accent">
                            {formatClock(rampRemaining)}
                        </div>
                        <p className="text-xs uppercase tracking-wider text-text-light">Ramp — one video / tea, then begin</p>
                        <div className="pt-1">{taskTimerAside}</div>
                        <Button variant="secondary" size="sm" onClick={endRamp}>Begin now →</Button>
                    </div>
                );
            }
            return (
                <div className="w-full max-w-md space-y-3">
                    <p className="text-sm text-text-light">
                        Ease in with a bounded warm-up? It closes itself with a chime — the task timer keeps running.
                    </p>
                    <div className="flex items-center justify-center gap-2">
                        {RAMP_PRESETS.map((m) => (
                            <button
                                key={m}
                                onClick={() => startRamp(m)}
                                className={`px-3 py-1.5 text-sm rounded-full border transition-colors cursor-pointer ${m === rampMin
                                    ? 'border-accent text-accent'
                                    : 'border-border text-text-light hover:border-accent hover:text-accent'
                                    }`}
                            >
                                {m}m
                            </button>
                        ))}
                        <Button variant="ghost" size="sm" onClick={() => setPhase('working')}>Skip →</Button>
                    </div>
                    {taskTimerAside}
                </div>
            );
        }

        if (phase === 'stopping') {
            const switching = pendingSwitchId != null;
            const switchTitle = switching ? getTaskTitle(pendingSwitchId, plan.linkedTasks, taskMap) : '';
            return (
                <div className="w-full max-w-md space-y-3">
                    <span className="block text-[10px] font-medium text-text-light uppercase tracking-wider">
                        {switching ? `Wrap up before switching to “${switchTitle}”` : "Where you're leaving off"}
                    </span>
                    <input
                        autoFocus
                        type="text"
                        value={note}
                        onChange={(e) => { setNote(e.target.value); if (exitBlocked) setExitBlocked(false); }}
                        onKeyDown={(e) => {
                            if (e.key !== 'Enter') return;
                            if (switching) { if (note.trim()) performSwitch(pendingSwitchId); }
                            else handleStop();
                        }}
                        placeholder="e.g. wired the reducer, next: hook up the Focus input"
                        className={`w-full px-3 py-2 text-sm rounded-lg border bg-card focus:outline-none transition-colors text-center ${exitBlocked ? 'border-amber-500 focus:border-amber-500' : 'border-border focus:border-accent'
                            }`}
                    />
                    <div className="flex items-center justify-center gap-2">
                        <Button variant="ghost" size="sm" onClick={() => { setExitBlocked(false); setPendingSwitchId(null); setPhase('working'); }}>
                            ← Continue
                        </Button>
                        {switching ? (
                            <Button size="sm" disabled={!note.trim()} onClick={() => performSwitch(pendingSwitchId)}>
                                Switch →
                            </Button>
                        ) : (
                            <>
                                <Button variant="secondary" size="sm" disabled={!note.trim()} onClick={addNote}>
                                    + Add breadcrumb
                                </Button>
                                <Button size="sm" disabled={noteRequired && !note.trim()} onClick={handleStop}>
                                    ■ Stop
                                </Button>
                            </>
                        )}
                    </div>
                    <p className={`text-[11px] ${exitBlocked ? 'text-amber-600 dark:text-amber-400' : 'text-text-light'}`}>
                        {switching
                            ? 'Strict mode — note where you’re leaving this task before switching.'
                            : noteRequired
                                ? 'A next step is required to Stop or leave Focus.'
                                : 'Optional — leave a breadcrumb so you can pick this up cheaply later.'}
                    </p>
                </div>
            );
        }

        // working
        if (pomoActive) return <PomoTimerDisplay pos={pos} segment={segment} />;
        return (
            <>
                {segment ? (
                    <EngagementTimer segment={segment} className="text-7xl font-extralight tracking-tight" />
                ) : (
                    <span className="text-7xl font-extralight tracking-tight tabular-nums">0:00</span>
                )}
                <p className="text-xs text-text-light mt-2 uppercase tracking-wider">Time on task</p>
            </>
        );
    }

    return (
        <FocusShell
            back={
                <button
                    onClick={peekPicker}
                    className="text-text-light hover:text-accent transition-colors cursor-pointer text-lg leading-none mr-1"
                    title="Back to the task picker (timer keeps running)"
                    aria-label="Back to the task picker"
                >
                    ←
                </button>
            }
            headerExtra={
                <button
                    onClick={toggleStrict}
                    className={`hidden sm:inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full border transition-colors cursor-pointer ${strict ? 'border-accent bg-accent/10 text-accent' : 'border-border text-text-light hover:text-accent hover:border-accent'
                        }`}
                    title={strict
                        ? 'Strict: first-action and next-step notes are required. Click to relax.'
                        : 'Relaxed: notes are optional. Click to make them required.'}
                >
                    {strict ? '🔒 Strict' : '🔓 Relaxed'}
                </button>
            }
            exit={
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleExit}
                    title={noteRequired && !note.trim() ? 'Add a next step before leaving' : undefined}
                >
                    Exit
                </Button>
            }
        >
            <div className="space-y-6">
                {/* Music — compact, card-less, full width above the timer */}
                <MusicProvider>
                    <div className="space-y-2">
                        <PlaylistSelector />
                        <SpotifyPlayer />
                    </div>
                </MusicProvider>

                {/* Timer surface + the day's engagement timeline alongside it */}
                <div className="grid lg:grid-cols-[1fr_320px] gap-6 items-start">
                    {/* Ambient timer surface — the intention's task list; the focused task hosts the state machine */}
                    <div className="rounded-3xl bg-subtle/20 px-6 py-6">
                        <TimerTaskList
                            focusedTaskId={task.todoistId}
                            focusedIntentionId={task.intentionId}
                            onSwitch={switchTo}
                            switchLocked={phase === 'stopping'}
                        >
                            {/* ── State machine for the focused task ── */}
                            <PhaseStepper phase={phase} strict={strict} onJump={setPhase} />

                            {task.estimatedMinutes != null && (
                                <div className="mt-2 text-center">
                                    <span className="text-xs px-2 py-0.5 rounded-full bg-surface-dark text-text-light tabular-nums">
                                        est. {task.estimatedMinutes}m
                                    </span>
                                </div>
                            )}

                            {/* Centre stage — owned by the active phase */}
                            <div className="py-6 text-center min-h-[200px] flex flex-col items-center justify-center gap-1">
                                {renderCenter()}
                            </div>

                            {/* Pomodoro slot plan — only meaningful for multi-slot tasks while working */}
                            {phase === 'working' && pomoActive && (
                                <FocusSlotPlan plan={focusPlan} activeIndex={pos.index} done={pos.done} />
                            )}

                            {/* Bottom action bar — shared across first move / ease-in / working; `stopping` owns its own */}
                            {phase !== 'stopping' && (
                                <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
                                    {phase === 'working' ? (
                                        <button
                                            onClick={togglePomodoro}
                                            title={focusPlan.singleSession ? 'Task is too short to split into slots' : undefined}
                                            disabled={focusPlan.singleSession}
                                            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm transition-colors ${focusPlan.singleSession
                                                ? 'opacity-40 cursor-not-allowed border-border text-text-light'
                                                : pomodoroOn
                                                    ? 'bg-accent/10 border-accent/30 text-accent cursor-pointer'
                                                    : 'border-border text-text-light hover:text-text hover:border-text/20 cursor-pointer'
                                                }`}
                                        >
                                            <span className={`w-2 h-2 rounded-full flex-shrink-0 transition-colors ${pomodoroOn && !focusPlan.singleSession ? 'bg-accent' : 'bg-text-light/40'
                                                }`} />
                                            Pomodoro
                                        </button>
                                    ) : <span />}
                                    <div className="flex items-center gap-2">
                                        <Button variant="ghost" size="sm" onClick={goStop}>
                                            ■ Stop
                                        </Button>
                                        {phase !== 'firstAction' && (
                                            <Button
                                                size="sm"
                                                onClick={handleComplete}
                                                disabled={writesBlocked}
                                                title={writesBlocked ? 'Reconnect Todoist to complete tasks' : undefined}
                                            >
                                                ✓ Complete
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            )}
                        </TimerTaskList>
                    </div>

                    {/* Day-wide engagement timeline — current task's cards highlighted */}
                    <EngagementTimeline highlightTaskId={task.todoistId} />
                </div>
            </div>
        </FocusShell>
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
            <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium mb-5 ${isBreak
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
