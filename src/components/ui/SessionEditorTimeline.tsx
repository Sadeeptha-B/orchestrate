import { useMemo, useRef, useState } from 'react';
import type { SessionSlot } from '../../types';
import { timeToMinutes } from '../../lib/time';
import {
    DEFAULT_TIMELINE_START_MINUTES,
    DEFAULT_TIMELINE_END_MINUTES,
    formatHour,
    minutesToClock,
    minutesToPct,
    pctToMinutes,
} from '../../lib/timeline';
import { eventTimeRange, packExternalEvents } from '../../lib/timelineEvents';
import type { CalendarEvent } from '../../lib/googleCalendarApi';
import './sessionTimelineBar.css';

const SNAP_MINUTES = 15;
const MIN_DURATION_MINUTES = 15;
/** Pixels of horizontal travel below which a pointer interaction counts as a click (open editor). */
const CLICK_SLOP_PX = 4;
/** Pixel height of one row in the calendar-event chip rail above the editor track. */
const EVENT_CHIP_ROW_H = 18;

interface SessionEditorTimelineProps {
    /** The session slots being edited (controlled). */
    slots: SessionSlot[];
    /** Commit a newly drawn session (id is stamped by the caller/reducer). */
    onAdd: (session: Omit<SessionSlot, 'id'>) => void;
    /** Commit a moved/resized/renamed session (id preserved). */
    onUpdate: (session: SessionSlot) => void;
    /** Remove a session by id. */
    onRemove: (sessionId: string) => void;
    /** Left edge of the day window (minutes since midnight). */
    timelineStartMinutes?: number;
    /** Right edge of the day window (minutes since midnight). */
    timelineEndMinutes?: number;
    /** v7.7: No Distraction blocklist suffixes the user can assign to a session (from settings). */
    blocklistOptions?: string[];
    /** v7.7: session ids whose blocklist is locked (confirmed at start, until the session ends). */
    lockedSessionIds?: Set<string>;
    /** v7.9: read-only external (Google) calendar events, shown as chips in a rail above the editable
     *  track so meetings inform where sessions go without overlapping the editing surface. Requires
     *  `dateISO` to resolve the day. */
    externalEvents?: CalendarEvent[];
    /** Local date being edited ("YYYY-MM-DD") — only needed to place `externalEvents`. */
    dateISO?: string;
}

/** In-flight pointer drag. Held in local state; only committed on pointer-up. */
type Drag =
    | { kind: 'create'; anchorPx: number; anchor: number; current: number }
    | { kind: 'move'; id: string; grab: number; start: number; end: number; duration: number; downPx: number; moved: boolean }
    | { kind: 'resize-l' | 'resize-r'; id: string; start: number; end: number; downPx: number };

function snap(m: number): number {
    return Math.round(m / SNAP_MINUTES) * SNAP_MINUTES;
}

/**
 * v7.1: drag-calendar editor for a day's session slots. Drag empty track to create, drag a block's
 * body to move, drag its edges to resize, click a block to rename/delete. Shares time⇆position
 * geometry with the read-only SessionTimelineBar via lib/timeline. Overlaps are allowed (tolerated
 * downstream) but tinted as a hint. Edits are committed only on pointer-up.
 */
export function SessionEditorTimeline({
    slots,
    onAdd,
    onUpdate,
    onRemove,
    timelineStartMinutes,
    timelineEndMinutes,
    blocklistOptions = [],
    lockedSessionIds,
    externalEvents,
    dateISO,
}: SessionEditorTimelineProps) {
    const dayStart = timelineStartMinutes ?? DEFAULT_TIMELINE_START_MINUTES;
    const dayEnd = timelineEndMinutes ?? DEFAULT_TIMELINE_END_MINUTES;
    const totalMinutes = dayEnd - dayStart;

    // Read-only calendar events placed by the same percent-of-day math as the read-only bar. They all
    // live in a chip rail *above* the editable track (row-packed so time-overlapping ones stack), so
    // nothing covers the editing surface and every meeting stays readable.
    const { placed: placedEvents, rowCount: eventRowCount } = useMemo(
        () => (dateISO && externalEvents?.length
            ? packExternalEvents(externalEvents, dateISO, dayStart, dayEnd, totalMinutes)
            : { placed: [], rowCount: 0 }),
        [externalEvents, dateISO, dayStart, dayEnd, totalMinutes],
    );

    const trackRef = useRef<HTMLDivElement>(null);
    const [drag, setDrag] = useState<Drag | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);

    const clamp = (m: number) => Math.max(dayStart, Math.min(dayEnd, m));

    const hourMarks = useMemo(() => {
        const marks: number[] = [];
        const firstHour = Math.ceil(dayStart / 60) * 60;
        for (let m = firstHour; m <= dayEnd; m += 60) marks.push(m);
        return marks;
    }, [dayStart, dayEnd]);

    // Ids that overlap at least one other slot — tinted as a (non-blocking) hint.
    const overlappingIds = useMemo(() => {
        const out = new Set<string>();
        for (let i = 0; i < slots.length; i++) {
            for (let j = i + 1; j < slots.length; j++) {
                const a = slots[i], b = slots[j];
                const aS = timeToMinutes(a.startTime), aE = timeToMinutes(a.endTime);
                const bS = timeToMinutes(b.startTime), bE = timeToMinutes(b.endTime);
                if (aS < bE && bS < aE) { out.add(a.id); out.add(b.id); }
            }
        }
        return out;
    }, [slots]);

    /** clientX → snapped, clamped minutes-since-midnight on the track. */
    const minutesAt = (clientX: number): number => {
        const rect = trackRef.current?.getBoundingClientRect();
        if (!rect || rect.width === 0) return dayStart;
        const pct = ((clientX - rect.left) / rect.width) * 100;
        return clamp(snap(pctToMinutes(pct, dayStart, totalMinutes)));
    };

    // Live geometry of a slot during a drag (falls back to its persisted times when not dragged).
    const liveRange = (slot: SessionSlot): { start: number; end: number } => {
        if (drag && 'id' in drag && drag.id === slot.id) return { start: drag.start, end: drag.end };
        return { start: timeToMinutes(slot.startTime), end: timeToMinutes(slot.endTime) };
    };

    const onTrackPointerDown = (e: React.PointerEvent) => {
        if (e.button !== 0) return;
        if (editingId) { setEditingId(null); return; }
        // Empty-track press → start drawing a new block.
        trackRef.current?.setPointerCapture(e.pointerId);
        const m = minutesAt(e.clientX);
        setDrag({ kind: 'create', anchorPx: e.clientX, anchor: m, current: m });
    };

    const onBlockPointerDown = (e: React.PointerEvent, slot: SessionSlot) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        trackRef.current?.setPointerCapture(e.pointerId);
        const start = timeToMinutes(slot.startTime);
        const end = timeToMinutes(slot.endTime);
        setDrag({ kind: 'move', id: slot.id, grab: minutesAt(e.clientX) - start, start, end, duration: end - start, downPx: e.clientX, moved: false });
    };

    const onHandlePointerDown = (e: React.PointerEvent, slot: SessionSlot, edge: 'l' | 'r') => {
        if (e.button !== 0) return;
        e.stopPropagation();
        trackRef.current?.setPointerCapture(e.pointerId);
        setDrag({ kind: edge === 'l' ? 'resize-l' : 'resize-r', id: slot.id, start: timeToMinutes(slot.startTime), end: timeToMinutes(slot.endTime), downPx: e.clientX });
    };

    const onPointerMove = (e: React.PointerEvent) => {
        if (!drag) return;
        const m = minutesAt(e.clientX);
        if (drag.kind === 'create') {
            setDrag({ ...drag, current: m });
        } else if (drag.kind === 'move') {
            let start = clamp(snap(m - drag.grab));
            if (start + drag.duration > dayEnd) start = dayEnd - drag.duration;
            if (start < dayStart) start = dayStart;
            const moved = drag.moved || Math.abs(e.clientX - drag.downPx) > CLICK_SLOP_PX;
            setDrag({ ...drag, start, end: start + drag.duration, moved });
        } else if (drag.kind === 'resize-l') {
            const start = Math.min(m, drag.end - MIN_DURATION_MINUTES);
            setDrag({ ...drag, start });
        } else if (drag.kind === 'resize-r') {
            const end = Math.max(m, drag.start + MIN_DURATION_MINUTES);
            setDrag({ ...drag, end });
        }
    };

    const commit = () => {
        if (!drag) return;
        if (drag.kind === 'create') {
            const start = Math.min(drag.anchor, drag.current);
            const end = Math.max(drag.anchor, drag.current);
            if (end - start >= MIN_DURATION_MINUTES) {
                onAdd({ name: 'Session', startTime: minutesToClock(start), endTime: minutesToClock(end) });
            }
        } else {
            const slot = slots.find((s) => s.id === drag.id);
            if (slot) {
                if (drag.kind === 'move' && !drag.moved) {
                    setEditingId(slot.id); // a click, not a drag → open rename/delete
                } else {
                    onUpdate({ ...slot, startTime: minutesToClock(drag.start), endTime: minutesToClock(drag.end) });
                }
            }
        }
        setDrag(null);
    };

    const editingSlot = editingId ? slots.find((s) => s.id === editingId) : undefined;

    return (
        <div className="relative space-y-1 pt-1 select-none">
            {/* Calendar-event rail — every external event surfaces here as a chip, kept entirely above
                the editable track so nothing overlaps the editing surface. Time-overlapping events
                stack onto separate rows; hover focuses a chip (raised + expanded + wrapped). */}
            {placedEvents.length > 0 && totalMinutes > 0 && (
                <div className="relative" style={{ height: eventRowCount * EVENT_CHIP_ROW_H }}>
                    {placedEvents.map(({ event, left, width, row }) => {
                        const swatch = event.color ?? '#6b7280';
                        return (
                            <div
                                key={`evchip-${event.calendarId}-${event.id}`}
                                className="tl-event-chip rounded-md overflow-hidden"
                                style={{
                                    top: row * EVENT_CHIP_ROW_H,
                                    zIndex: 2 + row, // later (more-overlapped) chips paint on top
                                    ['--ml' as string]: `${left}%`,
                                    ['--w' as string]: `${width}%`,
                                    ['--ev' as string]: swatch,
                                } as React.CSSProperties}
                                title={`${event.summary} · ${eventTimeRange(event)}`}
                            >
                                <span className="tl-event-label px-1 py-0.5 text-[9px] font-medium leading-tight">
                                    {event.summary}
                                    <span className="tl-event-time"> · {eventTimeRange(event)}</span>
                                </span>
                            </div>
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
                        style={{ left: `${minutesToPct(m, dayStart, totalMinutes)}%` }}
                    >
                        {formatHour(m)}
                    </span>
                ))}
            </div>

            {/* Editable track */}
            <div
                ref={trackRef}
                onPointerDown={onTrackPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={commit}
                className="relative h-24 rounded-lg bg-border/30 cursor-crosshair touch-none overflow-hidden"
            >
                {/* Hour gridlines */}
                {hourMarks.map((m) => (
                    <div
                        key={m}
                        className="absolute top-0 bottom-0 w-px bg-border/60"
                        style={{ left: `${minutesToPct(m, dayStart, totalMinutes)}%` }}
                    />
                ))}

                {/* Live "create" ghost */}
                {drag?.kind === 'create' && (() => {
                    const start = Math.min(drag.anchor, drag.current);
                    const end = Math.max(drag.anchor, drag.current);
                    return (
                        <div
                            className="absolute top-1 bottom-1 rounded-md border border-dashed border-accent bg-accent/20 pointer-events-none"
                            style={{ left: `${minutesToPct(start, dayStart, totalMinutes)}%`, width: `${((end - start) / totalMinutes) * 100}%` }}
                        />
                    );
                })()}

                {/* Session blocks */}
                {slots.map((slot) => {
                    const { start, end } = liveRange(slot);
                    const left = minutesToPct(start, dayStart, totalMinutes);
                    const width = ((end - start) / totalMinutes) * 100;
                    const overlapping = overlappingIds.has(slot.id);
                    return (
                        <div
                            key={slot.id}
                            onPointerDown={(e) => onBlockPointerDown(e, slot)}
                            className={[
                                'absolute top-1 bottom-1 rounded-md border px-1.5 py-1 cursor-grab active:cursor-grabbing overflow-hidden',
                                overlapping
                                    ? 'border-amber-400 bg-amber-100/70 dark:bg-amber-900/40'
                                    : 'border-accent/60 bg-accent/15',
                            ].join(' ')}
                            style={{ left: `${left}%`, width: `${width}%` }}
                            title={`${slot.name} · ${minutesToClock(start)}–${minutesToClock(end)} — drag to move, edges to resize, click to edit`}
                        >
                            {/* Resize handles */}
                            <div
                                onPointerDown={(e) => onHandlePointerDown(e, slot, 'l')}
                                className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize"
                            />
                            <div
                                onPointerDown={(e) => onHandlePointerDown(e, slot, 'r')}
                                className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize"
                            />
                            <div className="text-[10px] font-medium text-accent truncate leading-tight pointer-events-none">
                                {slot.name}
                            </div>
                            <div className="text-[9px] text-text-light tabular-nums leading-tight pointer-events-none">
                                {minutesToClock(start)}–{minutesToClock(end)}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Rename / delete / blocklist popover */}
            {editingSlot && (
                <div className="rounded-lg border border-border bg-card p-2 space-y-2">
                    <div className="flex items-center gap-2">
                        <input
                            autoFocus
                            value={editingSlot.name}
                            onChange={(e) => onUpdate({ ...editingSlot, name: e.target.value })}
                            onKeyDown={(e) => { if (e.key === 'Enter') setEditingId(null); }}
                            placeholder="Session name"
                            className="flex-1 min-w-0 rounded-md border border-border bg-card px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
                        />
                        <span className="text-[11px] text-text-light tabular-nums whitespace-nowrap">
                            {editingSlot.startTime}–{editingSlot.endTime}
                        </span>
                        <button
                            type="button"
                            onClick={() => { onRemove(editingSlot.id); setEditingId(null); }}
                            className="text-xs px-2 py-1 rounded-md border border-border text-text-light hover:text-red-400 hover:border-red-400/50"
                        >
                            Delete
                        </button>
                        <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="text-xs px-2 py-1 rounded-md border border-border text-text-light hover:border-accent"
                        >
                            Done
                        </button>
                    </div>
                    {blocklistOptions.length > 0 && (() => {
                        const locked = lockedSessionIds?.has(editingSlot.id) ?? false;
                        return (
                            <div className="flex items-center gap-2">
                                <label className="text-[11px] text-text-light whitespace-nowrap" htmlFor="session-blocklist">
                                    Blocklist
                                </label>
                                <select
                                    id="session-blocklist"
                                    value={editingSlot.blocklist ?? ''}
                                    disabled={locked}
                                    onChange={(e) => onUpdate({ ...editingSlot, blocklist: e.target.value || undefined })}
                                    className="flex-1 min-w-0 rounded-md border border-border bg-card px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent disabled:opacity-60 disabled:cursor-not-allowed"
                                >
                                    <option value="">None</option>
                                    {blocklistOptions.map((b) => (
                                        <option key={b} value={b}>{b}</option>
                                    ))}
                                </select>
                                {locked && (
                                    <span className="text-[10px] text-text-light whitespace-nowrap" title="Locked until the session ends">
                                        🔒 locked
                                    </span>
                                )}
                            </div>
                        );
                    })()}
                </div>
            )}

            <p className="text-[10px] text-text-light">
                Drag an empty area to add a session · drag a block to move · drag its edges to resize · click to rename or delete
                {placedEvents.length > 0 && ' · hover the calendar events above to read them'}
            </p>
        </div>
    );
}
