import { useCallback, useEffect, useRef } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin, { type EventResizeDoneArg } from '@fullcalendar/interaction';
import type { EventInput, EventDropArg, EventSourceFuncArg } from '@fullcalendar/core';
import { useDayPlan } from '../../hooks/useDayPlan';
import { useGoogleCalendarActions, useGoogleCalendarData } from '../../hooks/useGoogleCalendar';
import { isVisibleInCalendar } from '../../lib/googleCalendar';
import type { CalendarViewMode } from '../../types';
import './renderedCalendar.css';

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
 * (the iframe could not show them). Events are editable: drag to move + resize writes back to Google
 * via events.patch. The SessionTimelineBar overlay stays read-only; editing lives here.
 */
export function RenderedCalendar({ className = '', height = 400, onSetup }: RenderedCalendarProps) {
    const { settings, dispatch } = useDayPlan();
    const { isConnected } = useGoogleCalendarData();
    const { listEventsInRange, patchEvent } = useGoogleCalendarActions();
    const calendarEntries = (settings.googleCalendarIds ?? []).filter(isVisibleInCalendar);
    const viewMode: CalendarViewMode = settings.calendarViewMode ?? 'week';
    const calendarRef = useRef<FullCalendar>(null);

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
                    events.map((e) => ({
                        id: `${e.calendarId}::${e.id}`,
                        title: e.summary,
                        start: e.start,
                        end: e.end,
                        allDay: e.allDay,
                        // All-day events render in the all-day row but aren't drag/resize-editable: a
                        // time patch would convert them to timed events. Timed events stay editable.
                        editable: e.allDay ? false : undefined,
                        backgroundColor: e.color,
                        borderColor: e.color,
                        extendedProps: { calendarId: e.calendarId, googleEventId: e.id },
                    })),
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

    // Re-run the event source for the current range (no time-based polling otherwise).
    const handleRefresh = () => calendarRef.current?.getApi().refetchEvents();

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
                    onClick={handleRefresh}
                    className="ml-auto text-xs text-text-light hover:text-accent transition-colors cursor-pointer inline-flex items-center gap-1"
                    title="Refresh calendar events"
                    aria-label="Refresh calendar events"
                >
                    <span aria-hidden>↻</span> Refresh
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
                    editable
                    eventStartEditable
                    eventDurationEditable
                    events={eventsSource}
                    eventDrop={handleEventChange}
                    eventResize={handleEventChange}
                />
            </div>
        </div>
    );
}
