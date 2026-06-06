import { useEffect, useMemo, useState } from 'react';
import { formatTimeOfDay, minutesOfDay, timeToMinutes } from '../../lib/time';
import {
    DEFAULT_TIMELINE_START_MINUTES,
    DEFAULT_TIMELINE_END_MINUTES,
    formatHour,
} from '../../lib/timeline';
import { getTaskTitle } from '../../lib/tasks';
import { openSegment, segmentSeconds, totalEngagedSeconds } from '../../lib/engagement';
import type { EngagementSegment, LinkedTask, SessionSlot, TodaysHabitInstance } from '../../types';
import type { SessionCapacity } from '../../lib/capacity';
import { SessionCapacityBadge } from '../dashboard/SessionCapacityBadge';

/** v6.4: rounded engaged minutes across a habit instance's segments (glance badge — not live). */
function engagedMinutes(i: TodaysHabitInstance): number {
    return Math.round(totalEngagedSeconds(i.segments, Date.now()) / 60);
}

/** Local time-of-day (minutes since midnight) of an ISO timestamp. */
function isoLocalMinutes(iso: string): number {
    return minutesOfDay(new Date(iso));
}

/** Local "HH:MM" of an ISO timestamp. */
function isoLocalHHMM(iso: string): string {
    return formatTimeOfDay(new Date(iso));
}

function nowInMinutes(): number {
    return minutesOfDay(new Date());
}

/**
 * v6.8: status used for *display* — the real instance status plus a derived `'missed'` for a
 * strict, timed habit whose window has elapsed (see `isHabitInstanceMissed`). Not a persisted status.
 */
type DisplayStatus = TodaysHabitInstance['status'] | 'missed';

/**
 * v6.3 / v6.4: status → pill styling for habit instances rendered in the lane / anytime cluster.
 * Combines border style (solid/dashed) + bg fill + text color to make each state
 * distinguishable at a glance, even when the pill is too narrow for the title.
 */
function habitPillClass(status: DisplayStatus): string {
    switch (status) {
        case 'engaged':
            return 'border-2 border-amber-400 bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 animate-pulse';
        case 'completed':
            return 'border border-success/40 bg-success/15 text-emerald-700 dark:text-success';
        case 'skipped':
            return 'border border-dashed border-text-light/40 bg-surface-dark/30 text-text-light/50 line-through';
        case 'missed':
            // v6.8: greyed + dashed (no strike-through — it's still actionable), distinct from skipped.
            return 'border border-dashed border-text-light/40 bg-surface-dark/20 text-text-light/60';
        case 'planned':
        default:
            return 'border border-accent/40 bg-accent-subtle text-accent';
    }
}

/**
 * v6.4: state icon prefix. Distinct icons make the pill readable when the title is
 * truncated — the user can tell what state a habit is in from the icon alone.
 */
function habitPillIcon(status: DisplayStatus): string {
    switch (status) {
        case 'engaged':    return '⏵';   // playing
        case 'completed':  return '🎉';
        case 'skipped':    return '⤼';
        case 'missed':     return '⏰';   // v6.8: window elapsed
        case 'planned':
        default:           return '🔁';
    }
}

/** v6.4: human-readable status word for the pill tooltip. */
function habitStatusLabel(status: DisplayStatus): string {
    switch (status) {
        case 'engaged':    return 'engaged';
        case 'completed':  return 'completed';
        case 'skipped':    return 'skipped';
        case 'missed':     return 'missed';
        case 'planned':
        default:           return 'planned';
    }
}

/**
 * v6.4: full tooltip line for a habit pill. Includes title, target time, planned duration,
 * status, and (when applicable) engaged minutes — covers the "I can't read the truncated
 * pill" case without growing the pill itself. `displayStatus` defaults to the real status but
 * lets a caller pass the derived `'missed'` (v6.8).
 */
function habitPillTooltip(i: TodaysHabitInstance, displayStatus: DisplayStatus = i.status): string {
    const parts = [i.titleSnapshot];
    if (i.targetTime) parts.push(i.targetTime);
    parts.push(`${i.durationMinutes}m`);
    parts.push(habitStatusLabel(displayStatus));
    const engaged = engagedMinutes(i);
    if (engaged > 0) parts.push(`${engaged}m engaged`);
    return parts.join(' · ');
}

// ── v6.4: habit-lane markers ───────────────────────────────────────────────
// A single instance can plot several marks on the lane:
//   • scheduled — at the current targetTime, status-styled (the plan).
//   • ghost     — at each prior scheduled time (rescheduleHistory.fromTime), greyed.
//   • engagement — at the actual start time of an *off-schedule* segment (live while open,
//                  a logged dot once closed). On-schedule engagement is shown by the
//                  scheduled marker's "engaged" styling instead of a duplicate mark.

type LaneMarkerKind = 'scheduled' | 'ghost' | 'engagement';

interface LaneMarker {
    key: string;
    instance: TodaysHabitInstance;
    atMinutes: number;
    kind: LaneMarkerKind;
    segment?: EngagementSegment;
    live?: boolean;
    fromTime?: string;
}

/**
 * Status the *scheduled* marker should display. When the habit is engaged off-schedule, the
 * scheduled slot reads as `planned` (the live state is carried by a separate engagement marker);
 * an on-schedule open segment makes the scheduled slot itself read `engaged`.
 */
function scheduledDisplayStatus(i: TodaysHabitInstance, isMissed: boolean): DisplayStatus {
    if (i.status === 'completed' || i.status === 'skipped') return i.status;
    if (isMissed) return 'missed'; // v6.8: strict, timed, past-window planned instance
    if (i.status === 'engaged' && i.targetTime) {
        const open = openSegment(i.segments);
        if (open) {
            const segM = isoLocalMinutes(open.startedAt);
            const tM = timeToMinutes(i.targetTime);
            if (segM >= tM && segM <= tM + i.durationMinutes) return 'engaged';
        }
        return 'planned';
    }
    return i.status === 'engaged' ? 'engaged' : 'planned';
}

/** Derive every lane marker (scheduled + ghosts + off-schedule engagements) for the day's habits. */
function buildLaneMarkers(habits: TodaysHabitInstance[]): LaneMarker[] {
    const out: LaneMarker[] = [];
    for (const i of habits) {
        if (i.targetTime) {
            out.push({ key: `sch-${i.id}`, instance: i, atMinutes: timeToMinutes(i.targetTime), kind: 'scheduled' });
        }
        for (const [idx, ev] of (i.rescheduleHistory ?? []).entries()) {
            if (!ev.fromTime) continue;
            out.push({ key: `gh-${i.id}-${idx}`, instance: i, atMinutes: timeToMinutes(ev.fromTime), kind: 'ghost', fromTime: ev.fromTime });
        }
        const tM = i.targetTime ? timeToMinutes(i.targetTime) : null;
        for (const [idx, seg] of (i.segments ?? []).entries()) {
            const segM = isoLocalMinutes(seg.startedAt);
            const onSchedule = tM != null && segM >= tM && segM <= tM + i.durationMinutes;
            if (onSchedule) continue;
            out.push({ key: `eng-${i.id}-${idx}`, instance: i, atMinutes: segM, kind: 'engagement', segment: seg, live: !seg.endedAt });
        }
    }
    return out;
}

function markerIcon(m: LaneMarker, isMissed: boolean): string {
    if (m.kind === 'ghost') return '🔁';
    if (m.kind === 'engagement') return m.live ? '⏵' : '⏺';
    return habitPillIcon(scheduledDisplayStatus(m.instance, isMissed));
}

function markerClass(m: LaneMarker, isMissed: boolean): string {
    if (m.kind === 'ghost') {
        return 'border border-dashed border-text-light/30 bg-card text-text-light/40';
    }
    if (m.kind === 'engagement') {
        return m.live
            ? 'border-2 border-amber-400 bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 animate-pulse'
            : 'border border-amber-400/50 bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300';
    }
    return habitPillClass(scheduledDisplayStatus(m.instance, isMissed));
}

function markerTooltip(m: LaneMarker, isMissed: boolean): string {
    const i = m.instance;
    if (m.kind === 'ghost') return `${i.titleSnapshot} · was scheduled ${m.fromTime} (moved)`;
    if (m.kind === 'engagement' && m.segment) {
        const start = isoLocalHHMM(m.segment.startedAt);
        const end = m.segment.endedAt ? isoLocalHHMM(m.segment.endedAt) : 'now';
        const mins = Math.round(segmentSeconds(m.segment, Date.now()) / 60);
        return `${i.titleSnapshot} · engaged ${start}–${end} · ${mins}m${m.live ? ' (running)' : ''}`;
    }
    return habitPillTooltip(i, scheduledDisplayStatus(i, isMissed));
}

/** Min horizontal spacing (% of the lane) before two markers stack onto separate rows. */
const LANE_MIN_GAP_PCT = 3;
/** Pixel height of one packed lane row. */
const LANE_ROW_H = 22;

interface PlacedMarker {
    marker: LaneMarker;
    left: number;          // % from lane start
    row: number;           // stacking row index
    maxWidthPct: number;   // room to the next marker in this row (bounds the inline label)
}

/**
 * Greedy interval row-packing: markers within `LANE_MIN_GAP_PCT` of each other go on separate
 * rows so each stays individually visible. Each marker's `maxWidthPct` is the gap to the next
 * marker in its row, which bounds its inline name label (icon stays fixed-width and never clips).
 */
function packLaneMarkers(markers: LaneMarker[], dayStart: number, totalMinutes: number): { placed: PlacedMarker[]; rowCount: number } {
    const sorted = markers
        .map((marker) => ({ marker, left: ((marker.atMinutes - dayStart) / totalMinutes) * 100 }))
        .filter((p) => p.left >= 0 && p.left <= 100)
        .sort((a, b) => a.left - b.left);

    const rowsLastLeft: number[] = [];
    const rowItems: { marker: LaneMarker; left: number }[][] = [];
    const assigned: { marker: LaneMarker; left: number; row: number }[] = [];

    for (const p of sorted) {
        let row = 0;
        while (row < rowsLastLeft.length && rowsLastLeft[row] + LANE_MIN_GAP_PCT > p.left) row++;
        rowsLastLeft[row] = p.left;
        (rowItems[row] ??= []).push(p);
        assigned.push({ ...p, row });
    }

    const placed: PlacedMarker[] = assigned.map((a) => {
        const row = rowItems[a.row];
        const idx = row.findIndex((r) => r.marker.key === a.marker.key);
        const next = row[idx + 1];
        const maxWidthPct = next ? next.left - a.left : 100 - a.left;
        return { marker: a.marker, left: a.left, row: a.row, maxWidthPct };
    });

    return { placed, rowCount: rowsLastLeft.length };
}

// Re-exported for callers that historically imported these from here (e.g. CapacitySettings).
export { DEFAULT_TIMELINE_START_MINUTES, DEFAULT_TIMELINE_END_MINUTES };

interface SessionTimelineBarProps {
    /** Session slots to display on the timeline. */
    sessions: SessionSlot[];
    /** Map of sessionId → assigned todoist task IDs. */
    taskSessions: Record<string, string[]>;
    /** All linked tasks (used to resolve type). */
    linkedTasks: LinkedTask[];
    /** Todoist task lookup: id → { content }. */
    taskMap: Map<string, { id: string; content: string }>;
    /** Interactive mode: ID of the currently selected session. */
    selectedSessionId?: string | null;
    /** Interactive mode: callback when a session block is clicked. */
    onSelectSession?: (sessionId: string) => void;
    /** Dashboard mode: ID of the currently active session (shows pulse indicator). */
    currentSessionId?: string | null;
    /** v6: optional per-session capacity data. When provided, each block shows a capacity badge. */
    capacities?: Record<string, SessionCapacity>;
    /** Optional sort index (todoistId → order) for tasks within a session block. Honours the
     * intention + task ordering set in Step 1. Tasks absent from the map sort last (stable). */
    taskOrder?: Map<string, number>;
    /** v6.3: stabilizer habit instances for today. Timed ones render in the habit lane above
     * the session blocks; untimed ones cluster as "Anytime today" chips above the timeline. */
    todaysHabits?: TodaysHabitInstance[];
    /** v6.8: ids of instances presenting as "missed" (strict + past window). Their scheduled
     * lane markers render greyed. Computed by the caller (which holds the parent habits). */
    missedInstanceIds?: Set<string>;
    /** Minutes since midnight for the left edge of the timeline. Defaults to DEFAULT_TIMELINE_START_MINUTES. */
    timelineStartMinutes?: number;
    /** Minutes since midnight for the right edge of the timeline. Defaults to DEFAULT_TIMELINE_END_MINUTES. */
    timelineEndMinutes?: number;
}

export function SessionTimelineBar({
    sessions,
    taskSessions,
    linkedTasks,
    taskMap,
    selectedSessionId,
    onSelectSession,
    currentSessionId,
    capacities,
    taskOrder,
    todaysHabits,
    missedInstanceIds,
    timelineStartMinutes,
    timelineEndMinutes,
}: SessionTimelineBarProps) {
    const mainTasks = useMemo(
        () => linkedTasks.filter((lt) => lt.type === 'main'),
        [linkedTasks],
    );
    const backgroundTasks = useMemo(
        () => linkedTasks.filter((lt) => lt.type === 'background'),
        [linkedTasks],
    );

    // Current-time indicator — re-render once per minute.
    const [now, setNow] = useState(nowInMinutes);
    useEffect(() => {
        const id = setInterval(() => setNow(nowInMinutes()), 60_000);
        return () => clearInterval(id);
    }, []);

    // View toggle: 'full' = the whole configured day; 'remaining' = zoom to what's left. The
    // remaining view's left edge is the start of the in-progress session (so the current session
    // is fully shown even though it began before now), or `now` when no session is active.
    const [viewMode, setViewMode] = useState<'full' | 'remaining'>('full');

    // Configured day bounds (caller-provided or default 4:30 am – midnight).
    const fullStart = timelineStartMinutes ?? DEFAULT_TIMELINE_START_MINUTES;
    const fullEnd = timelineEndMinutes ?? DEFAULT_TIMELINE_END_MINUTES;

    const remainingStart = useMemo(() => {
        const containingStarts = sessions
            .map((s) => ({ start: timeToMinutes(s.startTime), end: timeToMinutes(s.endTime) }))
            .filter((s) => s.start <= now && now < s.end)
            .map((s) => s.start);
        const raw = containingStarts.length > 0 ? Math.min(...containingStarts) : now;
        return Math.max(fullStart, Math.min(raw, fullEnd));
    }, [sessions, now, fullStart, fullEnd]);

    // Only offer the remaining view while there's still day left to show.
    const canShowRemaining = remainingStart < fullEnd;
    const useRemaining = viewMode === 'remaining' && canShowRemaining;

    const dayStart = useRemaining ? remainingStart : fullStart;
    const dayEnd = fullEnd;
    const totalMinutes = dayEnd - dayStart;

    const hourMarks = useMemo(() => {
        const marks: number[] = [];
        const firstHour = Math.ceil(dayStart / 60) * 60;
        for (let m = firstHour; m <= dayEnd; m += 60) marks.push(m);
        return marks;
    }, [dayStart, dayEnd]);

    // In the remaining view, drop sessions that have fully elapsed relative to the window edge.
    const visibleSessions = useRemaining
        ? sessions.filter((s) => timeToMinutes(s.endTime) > dayStart)
        : sessions;

    const slotPosition = (slot: SessionSlot) => {
        const start = timeToMinutes(slot.startTime);
        const end = timeToMinutes(slot.endTime);
        return {
            left: ((start - dayStart) / totalMinutes) * 100,
            width: ((end - start) / totalMinutes) * 100,
        };
    };

    const titleFor = (todoistId: string) => getTaskTitle(todoistId, linkedTasks, taskMap);

    const isInteractive = onSelectSession !== undefined;

    const nowPercent =
        visibleSessions.length > 0 && now >= dayStart && now <= dayEnd
            ? ((now - dayStart) / totalMinutes) * 100
            : null;

    // v6.4: untimed habits stay in the "Anytime" cluster above the axis (their status home).
    // The lane plots positioned markers: timed habits' scheduled slots, ghost markers at prior
    // scheduled times, and engagement markers at the actual time of off-schedule segments — so an
    // untimed habit that gets engaged appears in both the cluster (status) and the lane (when).
    const anytimeHabits = (todaysHabits ?? []).filter((i) => !i.targetTime);
    const { placed: laneMarkers, rowCount: laneRowCount } =
        packLaneMarkers(buildLaneMarkers(todaysHabits ?? []), dayStart, totalMinutes);

    return (
        <div className="relative space-y-1 pt-5">
            {/* View toggle: full day ⇆ remaining part of the day. */}
            {canShowRemaining && (
                <button
                    type="button"
                    onClick={() => setViewMode((m) => (m === 'remaining' ? 'full' : 'remaining'))}
                    className="absolute top-0 right-0 z-20 text-[10px] px-2 py-0.5 rounded-full border border-border bg-card text-text-light hover:text-accent hover:border-accent transition-colors cursor-pointer inline-flex items-center gap-1"
                    title={useRemaining ? 'Switch to the full-day view' : 'Switch to the remaining part of the day'}
                >
                    <span aria-hidden>⇆</span>
                    {useRemaining ? 'Remaining' : 'Full day'}
                </button>
            )}

            {/* v6.3: "Anytime today" cluster — untimed habit instances surface above the time-axis. */}
            {anytimeHabits.length > 0 && (
                <div className="flex flex-wrap items-center gap-1 mb-1">
                    <span className="text-[9px] uppercase tracking-wider text-text-light/70 mr-1">Anytime</span>
                    {anytimeHabits.map((i) => {
                        const engaged = engagedMinutes(i);
                        const showEngagedBadge = i.status === 'engaged' && engaged > 0;
                        return (
                            <span
                                key={i.id}
                                className={`px-1.5 py-0.5 text-[9px] rounded-full leading-tight inline-flex items-center gap-1 ${habitPillClass(i.status)}`}
                                title={habitPillTooltip(i)}
                            >
                                <span aria-hidden>{habitPillIcon(i.status)}</span>
                                <span className="truncate">{i.titleSnapshot}</span>
                                {showEngagedBadge && (
                                    <span className="px-1 rounded bg-amber-200/70 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200 tabular-nums">
                                        {engaged}m
                                    </span>
                                )}
                            </span>
                        );
                    })}
                </div>
            )}

            {/* Hour labels */}
            <div className="relative h-5">
                {hourMarks.map((m) => (
                    <span
                        key={m}
                        className="absolute text-[10px] text-text-light -translate-x-1/2"
                        style={{ left: `${((m - dayStart) / totalMinutes) * 100}%` }}
                    >
                        {formatHour(m)}
                    </span>
                ))}
            </div>

            {/* Timeline track */}
            <div className="relative h-2 rounded-full bg-border/40">
                {hourMarks.map((m) => (
                    <div
                        key={m}
                        className="absolute top-0 bottom-0 w-px bg-border"
                        style={{ left: `${((m - dayStart) / totalMinutes) * 100}%` }}
                    />
                ))}
            </div>

            {/* v6.4: Habit lane — icon-only chips positioned by time. A habit can plot several
                markers: its scheduled slot, greyed "ghost" markers at prior scheduled times
                (reschedules), and engagement markers at the actual time of off-schedule segments
                (live while running, a logged dot once stopped). Overlapping markers stack onto
                separate rows so each stays individually visible/hoverable. The icon is fixed-width
                and never truncates; the name shows inline only when there's room (bounded by the
                gap to the next marker in its row) and is always available on hover. */}
            {laneMarkers.length > 0 && totalMinutes > 0 && (
                <div className="relative" style={{ minHeight: laneRowCount * LANE_ROW_H }}>
                    {laneMarkers.map(({ marker, left, row, maxWidthPct }) => {
                        const isMissed = marker.kind === 'scheduled'
                            && (missedInstanceIds?.has(marker.instance.id) ?? false);
                        return (
                            <div
                                key={marker.key}
                                className={`absolute h-5 px-1 rounded-full text-[9px] leading-none inline-flex items-center gap-1 overflow-hidden ${markerClass(marker, isMissed)}`}
                                style={{ left: `${left}%`, top: row * LANE_ROW_H, maxWidth: `${maxWidthPct}%` }}
                                title={markerTooltip(marker, isMissed)}
                            >
                                <span aria-hidden className="flex-shrink-0 w-3 text-center">{markerIcon(marker, isMissed)}</span>
                                <span className="truncate">{marker.instance.titleSnapshot}</span>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Session blocks — single-cell grid so the cell auto-sizes to the tallest block.
                Each block layers in the same cell via grid-area, positioned horizontally by margin-left/width. */}
            <div className="grid items-start" style={{ gridTemplateColumns: '1fr', minHeight: 80 }}>
                {visibleSessions.map((session) => {
                    const { left, width } = slotPosition(session);
                    const isSelected = selectedSessionId === session.id;
                    const isCurrent = currentSessionId === session.id;
                    const assignedIds = taskSessions[session.id] ?? [];
                    const orderOf = (lt: LinkedTask) => taskOrder?.get(lt.todoistId) ?? Number.MAX_SAFE_INTEGER;
                    const byOrder = (a: LinkedTask, b: LinkedTask) => orderOf(a) - orderOf(b);
                    const sessionMain = mainTasks.filter((lt) => assignedIds.includes(lt.todoistId)).sort(byOrder);
                    const sessionBg = backgroundTasks.filter((lt) => assignedIds.includes(lt.todoistId)).sort(byOrder);

                    const blockClasses = [
                        'rounded-lg border p-2 text-left overflow-hidden transition-colors',
                        isSelected
                            ? 'border-accent bg-accent/5 ring-1 ring-accent/30'
                            : isCurrent
                                ? 'border-accent/40 bg-accent/5 ring-2 ring-accent/30'
                                : 'border-border bg-card',
                        isInteractive ? 'cursor-pointer hover:border-accent/40' : '',
                    ].join(' ');

                    const content = (
                        <>
                            <div className="flex items-baseline justify-between gap-1 mb-1.5">
                                <span className="text-[11px] font-medium truncate flex items-center gap-1.5">
                                    {isCurrent && (
                                        <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse flex-shrink-0" />
                                    )}
                                    {session.name}
                                </span>
                                <span className="text-[9px] text-text-light flex-shrink-0">
                                    {session.startTime}–{session.endTime}
                                </span>
                            </div>
                            {capacities?.[session.id] && (
                                <div className="mb-1.5">
                                    <SessionCapacityBadge capacity={capacities[session.id]} />
                                </div>
                            )}
                            <div className="flex flex-wrap gap-1">
                                {sessionMain.map((lt) => (
                                    <span
                                        key={lt.todoistId}
                                        className={`px-1.5 py-0.5 text-[9px] rounded-full leading-tight ${lt.completed ? 'bg-success/10 text-text-light line-through' : 'bg-accent/15 text-accent'}`}
                                    >
                                        {lt.completed && '🎉 '}{titleFor(lt.todoistId)}
                                    </span>
                                ))}
                                {sessionBg.map((lt) => (
                                    <span
                                        key={lt.todoistId}
                                        className={`px-1.5 py-0.5 text-[9px] rounded-full leading-tight ${lt.completed ? 'bg-success/10 text-text-light line-through' : 'bg-surface-dark text-text-light'}`}
                                    >
                                        {lt.completed && '🎉 '}{titleFor(lt.todoistId)}
                                    </span>
                                ))}
                                {sessionMain.length === 0 && sessionBg.length === 0 && (
                                    <span className="text-[9px] text-text-light">Empty</span>
                                )}
                            </div>
                        </>
                    );

                    const blockStyle = {
                        gridArea: '1 / 1',
                        marginLeft: `${left}%`,
                        width: `${width}%`,
                        minHeight: 70,
                    } as const;

                    return isInteractive ? (
                        <button
                            key={session.id}
                            onClick={() => onSelectSession(session.id)}
                            className={blockClasses}
                            style={blockStyle}
                        >
                            {content}
                        </button>
                    ) : (
                        <div
                            key={session.id}
                            className={blockClasses}
                            style={blockStyle}
                        >
                            {content}
                        </div>
                    );
                })}
            </div>

            {/* Current-time indicator: time label, dot, vertical line spanning the bar */}
            {nowPercent != null && (
                <div
                    className="absolute top-0 bottom-0 pointer-events-none z-10"
                    style={{ left: `${nowPercent}%` }}
                >
                    <span className="absolute top-0 -translate-x-1/2 text-[10px] font-semibold text-accent whitespace-nowrap leading-none">
                        {formatHour(now)}
                    </span>
                    <div className="absolute top-4 bottom-0 w-px bg-accent -translate-x-1/2" />
                    <div className="absolute top-4 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-accent" />
                </div>
            )}
        </div>
    );
}
