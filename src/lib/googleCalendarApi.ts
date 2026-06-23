// Thin Google Calendar REST v3 client. Direct browser `fetch` with a short-lived Bearer access token
// minted server-side by the Cloudflare Worker (see googleAuth.ts / GoogleCalendarContext) — Google's
// endpoints send CORS headers for browser Bearer requests, so the browser calls Google directly (no
// proxy), unlike Todoist whose token must stay server-side.

const CAL_API = 'https://www.googleapis.com/calendar/v3';

/** Thrown on HTTP 401 so the provider can route to an auth-failed / reconnect state. */
export class GoogleAuthError extends Error {
    readonly status = 401;
    constructor() {
        super('Google authentication failed');
        this.name = 'GoogleAuthError';
    }
}

async function calFetch<T>(token: string, path: string, opts?: RequestInit): Promise<T> {
    const res = await fetch(`${CAL_API}${path}`, {
        ...opts,
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...(opts?.headers ?? {}),
        },
    });
    if (res.status === 401) throw new GoogleAuthError();
    if (!res.ok) throw new Error(`Google Calendar API ${res.status}: ${res.statusText}`);
    if (res.status === 204) return undefined as unknown as T;
    return res.json();
}

export interface GoogleCalendarListEntry {
    id: string;
    name: string;
    /** Hex background color from Google (e.g. "#16a765"). */
    color?: string;
    primary: boolean;
    /** "owner" | "writer" | "reader" | "freeBusyReader" — write needs owner/writer. */
    accessRole?: string;
}

interface CalendarListResponse {
    items?: Array<{
        id: string;
        summary: string;
        summaryOverride?: string;
        backgroundColor?: string;
        primary?: boolean;
        accessRole?: string;
    }>;
}

/** List the user's calendars (requires the calendarlist.readonly scope). */
export async function listCalendars(token: string): Promise<GoogleCalendarListEntry[]> {
    const data = await calFetch<CalendarListResponse>(token, '/users/me/calendarList');
    return (data.items ?? []).map((c) => ({
        id: c.id,
        name: c.summaryOverride || c.summary,
        color: c.backgroundColor,
        primary: Boolean(c.primary),
        accessRole: c.accessRole,
    }));
}

/** An event instance from a calendar, normalized for the timeline overlay / rendered view. */
export interface CalendarEvent {
    id: string;
    /** The calendar this event came from — stamped by the caller for source/color attribution. */
    calendarId: string;
    summary: string;
    /** ISO dateTime for timed events, or a "YYYY-MM-DD" date for all-day events (see `allDay`). */
    start: string;
    end: string;
    /** Hex color, stamped by the caller from the calendar's entry (events have no color of their own here). */
    color?: string;
    /** v7.7: all-day (date-only) event. Shown in the rendered calendar's all-day row; the timeline
     *  overlay excludes these (they have no time-of-day position). */
    allDay?: boolean;
}

interface EventsListResponse {
    items?: Array<{
        id: string;
        status?: string;
        summary?: string;
        start?: { dateTime?: string; date?: string };
        end?: { dateTime?: string; date?: string };
    }>;
}

/**
 * List events on a calendar within [timeMin, timeMax) (RFC3339). Recurring events are expanded to
 * instances (`singleEvents=true`). Cancelled events are dropped. Both timed and all-day (date-only)
 * events are returned — all-day ones carry `allDay: true` with date-only `start`/`end` (Google's end
 * date is exclusive, which FullCalendar also expects). Requires the `calendar.events` scope.
 */
export async function listEvents(
    token: string,
    calendarId: string,
    timeMinISO: string,
    timeMaxISO: string,
): Promise<CalendarEvent[]> {
    const params = new URLSearchParams({
        timeMin: timeMinISO,
        timeMax: timeMaxISO,
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '250',
    });
    const data = await calFetch<EventsListResponse>(
        token,
        `/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
    );
    const out: CalendarEvent[] = [];
    for (const e of data.items ?? []) {
        if (e.status === 'cancelled') continue;
        const summary = e.summary || '(no title)';
        if (e.start?.dateTime && e.end?.dateTime) {
            out.push({ id: e.id, calendarId, summary, start: e.start.dateTime, end: e.end.dateTime });
        } else if (e.start?.date && e.end?.date) {
            out.push({ id: e.id, calendarId, summary, start: e.start.date, end: e.end.date, allDay: true });
        }
    }
    return out;
}

export interface CalendarEventInput {
    summary: string;
    description?: string;
    /** RFC3339, e.g. "2026-06-06T07:00:00-07:00" (or supply timeZone with a local dateTime). */
    start: { dateTime: string; timeZone?: string };
    end: { dateTime: string; timeZone?: string };
    colorId?: string;
}

export interface CalendarEventResult {
    id: string;
    htmlLink?: string;
}

/**
 * Create an event on a calendar (requires the calendar.events scope). Write plumbing — not yet
 * called by any feature; a later iteration writes engagement segments here.
 */
export async function createCalendarEvent(
    token: string,
    calendarId: string,
    event: CalendarEventInput,
): Promise<CalendarEventResult> {
    return calFetch<CalendarEventResult>(
        token,
        `/calendars/${encodeURIComponent(calendarId)}/events`,
        { method: 'POST', body: JSON.stringify(event) },
    );
}

/** Partial update for an event — only the supplied fields change (Google's PATCH semantics). */
export interface CalendarEventPatch {
    start?: { dateTime: string; timeZone?: string };
    end?: { dateTime: string; timeZone?: string };
    summary?: string;
}

/**
 * Patch an event's time (or summary) — used by the rendered calendar's drag-move / resize.
 * Requires the calendar.events scope.
 */
export async function patchCalendarEvent(
    token: string,
    calendarId: string,
    eventId: string,
    patch: CalendarEventPatch,
): Promise<CalendarEventResult> {
    return calFetch<CalendarEventResult>(
        token,
        `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
        { method: 'PATCH', body: JSON.stringify(patch) },
    );
}
