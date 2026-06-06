// Thin Google Calendar REST v3 client. Direct browser `fetch` with a Bearer access token from the
// GIS token client (see googleAuth.ts) — Google's endpoints send CORS headers for browser Bearer
// requests, so no dev proxy is needed (unlike Todoist).

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
