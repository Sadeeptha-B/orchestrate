/**
 * Shared geometry for laying external (Google) calendar events onto a percent-of-day timeline.
 * Extracted from `SessionTimelineBar` so both the read-only bar and the editable
 * `SessionEditorTimeline` position events with identical math (events are essential context when
 * deciding sessions, not just when viewing them).
 */
import { formatTimeOfDay, minutesOfDay } from './time';
import type { CalendarEvent } from './googleCalendarApi';

/** Local "HH:MM" of an ISO timestamp. */
export function isoLocalHHMM(iso: string): string {
    return formatTimeOfDay(new Date(iso));
}

/** "HH:MM–HH:MM" start–end range of an external calendar event (local time). */
export function eventTimeRange(e: CalendarEvent): string {
    return `${isoLocalHHMM(e.start)}–${isoLocalHHMM(e.end)}`;
}

export interface PlacedEvent {
    event: CalendarEvent;
    left: number;   // % from lane start
    width: number;  // % of the lane
    row: number;    // stacking row index
    startM: number; // clamped start (minutes since midnight)
    endM: number;   // clamped end (minutes since midnight)
}

/** Local minutes-of-day window an event occupies on the rendered date, clamped to [dayStart, dayEnd]. */
function eventWindowMinutes(
    event: CalendarEvent,
    windowStart: Date,
    windowEnd: Date,
    dayStart: number,
    dayEnd: number,
): [number, number] | null {
    const start = new Date(event.start);
    const end = new Date(event.end);
    const overlapStart = new Date(Math.max(start.getTime(), windowStart.getTime()));
    const overlapEnd = new Date(Math.min(end.getTime(), windowEnd.getTime()));
    if (overlapEnd <= overlapStart) return null;

    const clamp = (m: number) => Math.max(dayStart, Math.min(m, dayEnd));
    const startMinutes = clamp(minutesOfDay(overlapStart));
    const endMinutes = overlapEnd.getTime() === windowEnd.getTime()
        ? dayEnd
        : clamp(minutesOfDay(overlapEnd));
    return endMinutes > startMinutes ? [startMinutes, endMinutes] : null;
}

/** Position + greedily row-pack events so time-overlapping ones never share a row. */
export function packExternalEvents(
    events: CalendarEvent[],
    dateISO: string,
    dayStart: number,
    dayEnd: number,
    totalMinutes: number,
): { placed: PlacedEvent[]; rowCount: number } {
    const windowStart = new Date(`${dateISO}T00:00:00`);
    const windowEnd = new Date(windowStart);
    windowEnd.setDate(windowEnd.getDate() + 1);

    const items = events
        .filter((event) => !event.allDay) // all-day events have no time-of-day position on the bar
        .map((event) => {
            const window = eventWindowMinutes(event, windowStart, windowEnd, dayStart, dayEnd);
            return window ? { event, startM: window[0], endM: window[1] } : null;
        })
        .filter((it): it is { event: CalendarEvent; startM: number; endM: number } => it !== null)
        .sort((a, b) => a.startM - b.startM);

    const rowEnds: number[] = []; // last endM placed in each row
    const placed = items.map((it) => {
        let row = 0;
        while (row < rowEnds.length && rowEnds[row] > it.startM) row++;
        rowEnds[row] = it.endM;
        return {
            event: it.event,
            left: ((it.startM - dayStart) / totalMinutes) * 100,
            width: ((it.endM - it.startM) / totalMinutes) * 100,
            row,
            startM: it.startM,
            endM: it.endM,
        };
    });
    return { placed, rowCount: rowEnds.length };
}
