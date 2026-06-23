import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin, { type EventResizeDoneArg } from '@fullcalendar/interaction';
import type { EventInput, EventDropArg, EventSourceFuncArg, EventClickArg, DateSelectArg } from '@fullcalendar/core';
import { useDayPlan } from '../../hooks/useDayPlan';
import { useGoogleCalendarActions, useGoogleCalendarData } from '../../hooks/useGoogleCalendar';
import { isVisibleInCalendar } from '../../lib/googleCalendar';
import { useSessionCalendarSync } from '../../hooks/useSessionCalendarSync';
import type { CalendarViewMode } from '../../types';
import { CalendarEventEditor, type EventEditorTarget, type EventEditorSubmit } from './CalendarEventEditor';
import './renderedCalendar.css';

const DEFAULT_EVENT_MS = 60 * 60 * 1000; // fallback duration when an event has no end / for all-day create

/** 24-hour time format shared by the slot axis and event labels (matches the app's HH:mm convention). */
const TIME_24H = { hour: '2-digit', minute: '2-digit', hour12: false } as const;

const VIEW_MODE_LABELS: Record<CalendarViewMode, string> = {
    week: 'Week',
    month: 'Month',
    agenda: 'Agenda',
};

/** Orchestrate's view-mode vocabulary → FullCalendar view names. */
const FC_VIEW: Record<CalendarViewMode, string> = {
    week: 'timeGridWeek',
    month: 'dayGridMonth',
    agenda: 'listWeek',
};

interface RenderedCalendarProps {
    className?: string;
    height?: number;
    onSetup?: () => void;
}

/**
 * OAuth-rendered calendar (replaces the public-iframe embed). Fetches the selected calendars' events
 * via the Calendar API over FullCalendar's visible range, so **private/imported calendars render**
 * (the iframe could not show them). Fully editable: drag-move + resize patch the time/duration, clicking
 * an event opens an editor (title/time, or delete), and dragging an empty slot creates a new event on a
 * writable calendar — all written back to Google. The SessionTimelineBar overlay stays read-only.
 */
export function RenderedCalendar({ className = '', height = 400, onSetup }: RenderedCalendarProps) {
    const { settings, dispatch } = useDayPlan();
    const { isConnected, availableCalendars } = useGoogleCalendarData();
    const { listEventsInRange, patchEvent, createEvent, deleteEvent } = useGoogleCalendarActions();
    const { sync } = useSessionCalendarSync();
    const calendarEntries = (settings.googleCalendarIds ?? []).filter(isVisibleInCalendar);
    const viewMode: CalendarViewMode = settings.calendarViewMode ?? 'week';
    const calendarRef = useRef<FullCalendar>(null);
    const [editor, setEditor] = useState<EventEditorTarget | null>(null);

    // Calendars the user can write to — the create-mode picker, and the gate on whether to allow
    // creating at all. Default new events to the writable primary, else the first writable calendar.
    const writableCalendars = useMemo(
        () => availableCalendars
            .filter((c) => c.accessRole === 'owner' || c.accessRole === 'writer')
            .map((c) => ({ id: c.id, name: c.name, color: c.color })),
        [availableCalendars],
    );
    const defaultCreateCalendarId = useMemo(() => {
        const primary = availableCalendars.find(
            (c) => c.primary && (c.accessRole === 'owner' || c.accessRole === 'writer'),
        );
        return primary?.id ?? writableCalendars[0]?.id ?? '';
    }, [availableCalendars, writableCalendars]);

    // FullCalendar event source: it re-runs this on navigation / view change, handing us the visible
    // range. `listEventsInRange` re-identifies when the selected calendars change (it closes over
    // `settings.googleCalendarIds`), so this source — and thus a refetch — follows selection changes.
    const eventsSource = useCallback(
        async (
            info: EventSourceFuncArg,
            success: (events: EventInput[]) => void,
            failure: (error: Error) => void,
        ) => {
            try {
                const events = await listEventsInRange(info.startStr, info.endStr);
                success(
                    events.map((e) => {
                        const input: EventInput = {
                            id: `${e.calendarId}::${e.id}`,
                            title: e.summary,
                            start: e.start,
                            end: e.end,
                            allDay: e.allDay,
                            backgroundColor: e.color,
                            borderColor: e.color,
                            extendedProps: { calendarId: e.calendarId, googleEventId: e.id },
                        };
                        // Only all-day events are pinned non-editable (a time patch would convert them
                        // to timed). Timed events must OMIT `editable` entirely — FullCalendar refines it
                        // with Boolean(), so `editable: undefined` would resolve to false (no drag/resize).
                        if (e.allDay) input.editable = false;
                        return input;
                    }),
                );
            } catch (err) {
                failure(err instanceof Error ? err : new Error(String(err)));
            }
        },
        [listEventsInRange],
    );

    // Keep FullCalendar's view in sync with the persisted view-mode toggle.
    useEffect(() => {
        calendarRef.current?.getApi().changeView(FC_VIEW[viewMode]);
    }, [viewMode]);

    useEffect(() => {
        calendarRef.current?.getApi().refetchEvents();
    }, [eventsSource]);

    const handleViewChange = (mode: CalendarViewMode) => {
        dispatch({ type: 'UPDATE_SETTINGS', settings: { calendarViewMode: mode } });
    };

    // Sync: write the day's sessions to the Orchestrate calendar, then re-run the event source
    // (no time-based polling otherwise). Sync no-ops when not connected / no creation scope.
    const handleSync = async () => {
        await sync();
        calendarRef.current?.getApi().refetchEvents();
    };

    // Persist a drag-move / resize back to Google; revert the visual change if the write fails.
    const handleEventChange = async (arg: EventDropArg | EventResizeDoneArg) => {
        const { event, revert } = arg;
        const calendarId = event.extendedProps.calendarId as string | undefined;
        const googleEventId = event.extendedProps.googleEventId as string | undefined;
        if (!calendarId || !googleEventId || !event.start || !event.end) {
            revert();
            return;
        }
        const result = await patchEvent(calendarId, googleEventId, {
            start: { dateTime: event.start.toISOString() },
            end: { dateTime: event.end.toISOString() },
        });
        if (!result) revert();
    };

    const closeEditor = useCallback(() => {
        setEditor(null);
        calendarRef.current?.getApi().unselect();
    }, []);

    // Click an event → edit it (title always; time/duration for timed events, title-only for all-day).
    const handleEventClick = (arg: EventClickArg) => {
        const { event } = arg;
        const calendarId = event.extendedProps.calendarId as string | undefined;
        const googleEventId = event.extendedProps.googleEventId as string | undefined;
        if (!calendarId || !googleEventId || !event.start) return;
        setEditor({
            mode: 'edit',
            calendarId,
            eventId: googleEventId,
            title: event.title,
            start: event.start,
            end: event.end ?? new Date(event.start.getTime() + DEFAULT_EVENT_MS),
            allDay: event.allDay,
            color: event.backgroundColor || undefined,
            anchor: { x: arg.jsEvent.clientX, y: arg.jsEvent.clientY },
        });
    };

    // Drag/click an empty slot → create. All-day (month) selections have no time, so default to a
    // one-hour slot at 09:00 on the chosen day (the user adjusts in the editor).
    const handleSelect = (arg: DateSelectArg) => {
        if (writableCalendars.length === 0) {
            calendarRef.current?.getApi().unselect();
            return;
        }
        let start = arg.start;
        let end = arg.end;
        if (arg.allDay) {
            start = new Date(arg.start);
            start.setHours(9, 0, 0, 0);
            end = new Date(start.getTime() + DEFAULT_EVENT_MS);
        }
        const anchor = arg.jsEvent ? { x: arg.jsEvent.clientX, y: arg.jsEvent.clientY } : undefined;
        const color = writableCalendars.find((c) => c.id === defaultCreateCalendarId)?.color;
        setEditor({ mode: 'create', calendarId: defaultCreateCalendarId, title: '', start, end, anchor, color });
    };

    const handleEditorSubmit = async (vals: EventEditorSubmit): Promise<boolean> => {
        if (!editor) return false;
        let ok = false;
        if (editor.mode === 'create') {
            const res = await createEvent(vals.calendarId, {
                summary: vals.title || '(no title)',
                start: { dateTime: vals.startISO },
                end: { dateTime: vals.endISO },
            });
            ok = res !== null;
        } else if (editor.eventId) {
            const patch = vals.summaryOnly
                ? { summary: vals.title }
                : { summary: vals.title, start: { dateTime: vals.startISO }, end: { dateTime: vals.endISO } };
            const res = await patchEvent(editor.calendarId, editor.eventId, patch);
            ok = res !== null;
        }
        if (ok) calendarRef.current?.getApi().refetchEvents();
        return ok;
    };

    const handleEditorDelete = async (calendarId: string, eventId: string): Promise<boolean> => {
        const ok = await deleteEvent(calendarId, eventId);
        if (ok) calendarRef.current?.getApi().refetchEvents();
        return ok;
    };

    if (!isConnected) {
        return (
            <div
                className={`flex flex-col items-center justify-center border border-border rounded-lg bg-card text-center p-6 ${className}`}
                style={{ height }}
            >
                <p className="text-sm text-text-light mb-2">Google Calendar is not connected.</p>
                {onSetup ? (
                    <button
                        onClick={onSetup}
                        className="text-sm text-accent hover:underline cursor-pointer"
                    >
                        Connect Google Calendar →
                    </button>
                ) : (
                    <p className="text-xs text-text-light">
                        Connect Google Calendar in Settings → Integrations to load your calendars.
                    </p>
                )}
            </div>
        );
    }

    if (calendarEntries.length === 0) {
        return (
            <div
                className={`flex flex-col items-center justify-center border border-border rounded-lg bg-card text-center p-6 ${className}`}
                style={{ height }}
            >
                <p className="text-sm text-text-light mb-2">No calendars selected for the calendar view yet.</p>
                {onSetup ? (
                    <button
                        onClick={onSetup}
                        className="text-sm text-accent hover:underline cursor-pointer"
                    >
                        Connect Google Calendar →
                    </button>
                ) : (
                    <p className="text-xs text-text-light">
                        Connect Google Calendar in Settings → Integrations to choose calendars.
                    </p>
                )}
            </div>
        );
    }

    return (
        <div className={className}>
            {/* View mode tabs + open link */}
            <div className="flex items-center gap-1 mb-2">
                {(Object.keys(VIEW_MODE_LABELS) as CalendarViewMode[]).map((mode) => (
                    <button
                        key={mode}
                        onClick={() => handleViewChange(mode)}
                        className={`px-2.5 py-1 text-xs rounded-md transition-colors cursor-pointer ${viewMode === mode
                            ? 'bg-accent text-white'
                            : 'text-text-light hover:bg-surface-dark'
                            }`}
                    >
                        {VIEW_MODE_LABELS[mode]}
                    </button>
                ))}
                <button
                    type="button"
                    onClick={handleSync}
                    className="ml-auto text-xs text-text-light hover:text-accent transition-colors cursor-pointer inline-flex items-center gap-1"
                    title="Write the day's sessions to the Orchestrate calendar and refresh"
                    aria-label="Sync sessions to calendar"
                >
                    <span aria-hidden>↻</span> Sync
                </button>
                <a
                    href="https://calendar.google.com/calendar/r"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-accent hover:underline"
                >
                    Open in Google Calendar ↗
                </a>
            </div>
            <div className="rendered-calendar rounded-lg border border-border overflow-hidden bg-card" style={{ height }}>
                <FullCalendar
                    ref={calendarRef}
                    plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
                    initialView={FC_VIEW[viewMode]}
                    headerToolbar={{ left: 'prev,next today', center: 'title', right: '' }}
                    height="100%"
                    nowIndicator
                    expandRows
                    dayMaxEvents
                    slotLabelFormat={TIME_24H}
                    eventTimeFormat={TIME_24H}
                    dayHeaderFormat={{ weekday: 'short', month: 'short', day: 'numeric' }}
                    titleFormat={{ month: 'long', day: 'numeric', year: 'numeric' }}
                    editable
                    eventStartEditable
                    eventDurationEditable
                    selectable
                    selectMirror
                    events={eventsSource}
                    eventDrop={handleEventChange}
                    eventResize={handleEventChange}
                    eventClick={handleEventClick}
                    select={handleSelect}
                />
            </div>

            {editor && (
                <CalendarEventEditor
                    key={`${editor.mode}:${editor.eventId ?? 'new'}:${editor.start.getTime()}`}
                    target={editor}
                    writableCalendars={writableCalendars}
                    onClose={closeEditor}
                    onSubmit={handleEditorSubmit}
                    onDelete={handleEditorDelete}
                />
            )}
        </div>
    );
}
