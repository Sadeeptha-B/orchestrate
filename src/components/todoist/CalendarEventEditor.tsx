import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../ui/Button';
import { inputClass, labelClass } from '../ui/formStyles';

/** What the editor is operating on. */
export interface EventEditorTarget {
    mode: 'create' | 'edit';
    /** Edit: the event's calendar. Create: the initially-selected writable calendar. */
    calendarId: string;
    /** Present in edit mode. */
    eventId?: string;
    title: string;
    start: Date;
    end: Date;
    /** All-day events allow title editing + delete only (no time fields — adjust dates in Google). */
    allDay?: boolean;
    /** The event's (or, for create, the calendar's) hex color — tints the popover's top edge. */
    color?: string;
    /** Viewport coords (the click/selection point) to anchor the popover near. */
    anchor?: { x: number; y: number };
}

export interface EventEditorSubmit {
    calendarId: string;
    title: string;
    startISO: string;
    endISO: string;
    /** All-day: patch the title only, leaving the date untouched. */
    summaryOnly: boolean;
}

interface CalendarEventEditorProps {
    /** The event being created/edited. Render this component **keyed by the target** so each open
     *  remounts with fresh initial state (no effect-driven re-seeding). */
    target: EventEditorTarget;
    /** Calendars the user can write to (owner/writer) — the create-mode calendar picker. */
    writableCalendars: { id: string; name: string; color?: string }[];
    onClose: () => void;
    /** Returns true on success (the editor then closes). */
    onSubmit: (vals: EventEditorSubmit) => Promise<boolean>;
    onDelete: (calendarId: string, eventId: string) => Promise<boolean>;
}

const pad = (n: number) => String(n).padStart(2, '0');
/** A Date → a `date` input value ("YYYY-MM-DD") in local time. */
const toDateInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** A Date → a `time` input value ("HH:mm") in local time. */
const toTimeInput = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
/** A "YYYY-MM-DD" value → a natural-language label, e.g. "Mon, Jun 23, 2026". */
const formatNaturalDate = (d: string) => {
    if (!d) return 'Pick a date';
    const dt = new Date(`${d}T00:00`);
    if (Number.isNaN(dt.getTime())) return d;
    return dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
};
/** Open the native date picker for a hidden `<input type="date">` (falls back to focus). */
const openDatePicker = (el: HTMLInputElement | null) => {
    if (!el) return;
    if (typeof el.showPicker === 'function') {
        try {
            el.showPicker();
            return;
        } catch {
            /* not allowed (no gesture) — fall through to focus */
        }
    }
    el.focus();
};

const POPOVER_W = 300;
const POPOVER_MAX_H = 420;
const MARGIN = 12;

/** Clamp the anchor point so the popover stays within the viewport (falls back to centered). */
function popoverPosition(anchor?: { x: number; y: number }): { left: number; top: number } {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (!anchor) {
        return { left: Math.max(MARGIN, (vw - POPOVER_W) / 2), top: Math.max(MARGIN, (vh - POPOVER_MAX_H) / 2) };
    }
    return {
        left: Math.min(Math.max(MARGIN, anchor.x), vw - POPOVER_W - MARGIN),
        top: Math.min(Math.max(MARGIN, anchor.y), vh - POPOVER_MAX_H - MARGIN),
    };
}

/**
 * Create/edit/delete a Google Calendar event in a small popover anchored near the click (no blocking
 * backdrop, so the calendar behind stays draggable). Start/end use separate date + time inputs; the
 * parent does the API call + refetch and reports success so the popover can close.
 */
export function CalendarEventEditor({
    target,
    writableCalendars,
    onClose,
    onSubmit,
    onDelete,
}: CalendarEventEditorProps) {
    // Initialized once per mount from `target`; the parent keys this component by target so each open
    // is a fresh mount (avoids re-seeding state inside an effect).
    const [title, setTitle] = useState(target.title);
    const [calendarId, setCalendarId] = useState(target.calendarId);
    const [startDate, setStartDate] = useState(() => toDateInput(target.start));
    const [startTime, setStartTime] = useState(() => toTimeInput(target.start));
    const [endDate, setEndDate] = useState(() => toDateInput(target.end));
    const [endTime, setEndTime] = useState(() => toTimeInput(target.end));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [confirmingDelete, setConfirmingDelete] = useState(false);

    const popRef = useRef<HTMLDivElement>(null);
    const startDateRef = useRef<HTMLInputElement>(null);
    const endDateRef = useRef<HTMLInputElement>(null);

    // Dismiss on outside click / Escape. No overlay element, so the calendar stays interactive.
    useEffect(() => {
        const onDown = (e: MouseEvent) => {
            if (popRef.current && !popRef.current.contains(e.target as Node)) onClose();
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [onClose]);

    const isEdit = target.mode === 'edit';
    const isAllDay = Boolean(target.allDay);
    const { left, top } = popoverPosition(target.anchor);
    // Accent the popover's top edge with the event's color (create: follows the picked calendar).
    const accent = isEdit ? target.color : writableCalendars.find((c) => c.id === calendarId)?.color;

    const handleSubmit = async () => {
        setError(null);
        let startISO = target.start.toISOString();
        let endISO = target.end.toISOString();
        if (!isAllDay) {
            const s = new Date(`${startDate}T${startTime}`);
            const e = new Date(`${endDate}T${endTime}`);
            if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) {
                setError('Enter a valid start and end.');
                return;
            }
            if (e <= s) {
                setError('End must be after start.');
                return;
            }
            startISO = s.toISOString();
            endISO = e.toISOString();
        }
        setBusy(true);
        const ok = await onSubmit({ calendarId, title: title.trim(), startISO, endISO, summaryOnly: isAllDay });
        setBusy(false);
        if (ok) onClose();
    };

    const handleDelete = async () => {
        if (!isEdit || !target.eventId) return;
        if (!confirmingDelete) {
            setConfirmingDelete(true);
            return;
        }
        setBusy(true);
        const ok = await onDelete(target.calendarId, target.eventId);
        setBusy(false);
        if (ok) onClose();
    };

    return createPortal(
        <div
            ref={popRef}
            className="fixed z-50 rounded-xl border border-border bg-card shadow-lg p-3 animate-in fade-in"
            style={{
                left,
                top,
                width: POPOVER_W,
                maxHeight: POPOVER_MAX_H,
                overflowY: 'auto',
                // Light color accent on the top edge for visual identity.
                ...(accent ? { borderTopColor: accent, borderTopWidth: 3 } : {}),
            }}
            role="dialog"
            aria-label={isEdit ? 'Edit event' : 'New event'}
        >
            <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold">{isEdit ? 'Edit event' : 'New event'}</h3>
                <button
                    onClick={onClose}
                    className="text-text-light hover:text-text transition-colors cursor-pointer text-base leading-none"
                    aria-label="Close"
                >
                    ✕
                </button>
            </div>

            <div className="space-y-2.5">
                <div>
                    <label className={labelClass} htmlFor="ev-title">Title</label>
                    <input
                        id="ev-title"
                        className={inputClass}
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="Event title"
                        autoFocus
                    />
                </div>

                {!isEdit && (
                    <div>
                        <label className={labelClass} htmlFor="ev-cal">Calendar</label>
                        <select
                            id="ev-cal"
                            className={inputClass}
                            value={calendarId}
                            onChange={(e) => setCalendarId(e.target.value)}
                        >
                            {writableCalendars.map((c) => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                        </select>
                    </div>
                )}

                {isAllDay ? (
                    <p className="text-xs text-text-light">
                        All-day event — only the title can be edited here. Adjust the date in Google Calendar.
                    </p>
                ) : (
                    <>
                        <div>
                            <label className={labelClass}>Start</label>
                            <div className="grid grid-cols-2 gap-2">
                                <div className="relative">
                                    <button
                                        type="button"
                                        className={`${inputClass} text-left cursor-pointer`}
                                        onClick={() => openDatePicker(startDateRef.current)}
                                    >
                                        {formatNaturalDate(startDate)}
                                    </button>
                                    <input
                                        ref={startDateRef}
                                        type="date"
                                        className="sr-only"
                                        tabIndex={-1}
                                        value={startDate}
                                        aria-label="Start date"
                                        onChange={(e) => setStartDate(e.target.value)}
                                    />
                                </div>
                                <input
                                    type="time"
                                    className={inputClass}
                                    value={startTime}
                                    aria-label="Start time"
                                    onChange={(e) => setStartTime(e.target.value)}
                                />
                            </div>
                        </div>
                        <div>
                            <label className={labelClass}>End</label>
                            <div className="grid grid-cols-2 gap-2">
                                <div className="relative">
                                    <button
                                        type="button"
                                        className={`${inputClass} text-left cursor-pointer`}
                                        onClick={() => openDatePicker(endDateRef.current)}
                                    >
                                        {formatNaturalDate(endDate)}
                                    </button>
                                    <input
                                        ref={endDateRef}
                                        type="date"
                                        className="sr-only"
                                        tabIndex={-1}
                                        value={endDate}
                                        aria-label="End date"
                                        onChange={(e) => setEndDate(e.target.value)}
                                    />
                                </div>
                                <input
                                    type="time"
                                    className={inputClass}
                                    value={endTime}
                                    aria-label="End time"
                                    onChange={(e) => setEndTime(e.target.value)}
                                />
                            </div>
                        </div>
                    </>
                )}

                {error && <p className="text-xs text-red-500">{error}</p>}

                <div className="flex items-center justify-between gap-2 pt-1">
                    <div>
                        {isEdit && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={handleDelete}
                                disabled={busy}
                                className="text-red-500 hover:text-red-600 hover:bg-red-500/10"
                            >
                                {confirmingDelete ? 'Confirm delete?' : 'Delete'}
                            </Button>
                        )}
                    </div>
                    <div className="flex gap-2">
                        <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
                            Cancel
                        </Button>
                        <Button size="sm" onClick={handleSubmit} disabled={busy}>
                            {busy ? 'Saving…' : isEdit ? 'Save' : 'Create'}
                        </Button>
                    </div>
                </div>
            </div>
        </div>,
        document.body,
    );
}
