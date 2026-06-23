// Pure helpers for writing the day's sessions to the Orchestrate calendar (v7.7 Phase 3) and for the
// No Distraction blocklist lock. Shared by the Sync routine, the session editor, and the start modal.

import { minutesOfDay, timeToMinutes } from './time';
import type { DayPlan, SessionSlot } from '../types';

export type SessionStarts = NonNullable<DayPlan['sessionStarts']>;

/**
 * The blocklist suffix that should be on a session's calendar event: the value locked in at
 * confirmation if the session has been started, otherwise the planned `session.blocklist`. Returns
 * null for "no blocklist".
 */
export function effectiveBlocklist(session: SessionSlot, sessionStarts: SessionStarts | undefined): string | null {
    const started = sessionStarts?.[session.id];
    if (started) return started.blocklist;
    const planned = session.blocklist?.trim();
    return planned ? planned : null;
}

/** A confirmed session is locked (blocklist unchangeable) until its end time has passed. */
export function isSessionLocked(
    session: SessionSlot,
    sessionStarts: SessionStarts | undefined,
    now: Date = new Date(),
): boolean {
    if (!sessionStarts?.[session.id]) return false;
    const startMin = timeToMinutes(session.startTime);
    let endMin = timeToMinutes(session.endTime);
    if (endMin <= startMin) endMin = 24 * 60; // ends at/after midnight → hold the lock through the day
    return minutesOfDay(now) < endMin;
}

/** Calendar event title for a session — appends the No Distraction suffix when present. */
export function sessionEventName(session: SessionSlot, suffix: string | null): string {
    return suffix ? `${session.name} ${suffix}` : session.name;
}

/** Local start/end `Date`s for a session on a given day ("YYYY-MM-DD"); handles a midnight end. */
export function sessionEventTimes(dateISO: string, session: SessionSlot): { start: Date; end: Date } {
    const startMin = timeToMinutes(session.startTime);
    let endMin = timeToMinutes(session.endTime);
    if (endMin <= startMin) endMin += 24 * 60; // crosses midnight → next day
    const start = new Date(`${dateISO}T00:00:00`);
    start.setMinutes(startMin);
    const end = new Date(`${dateISO}T00:00:00`);
    end.setMinutes(endMin); // Date normalizes >1440 minutes into the next day
    return { start, end };
}
