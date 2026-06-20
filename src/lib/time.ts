import { format } from 'date-fns';
import type { SessionSlot } from '../types';

/** Convert "HH:mm" to total minutes since midnight. */
export function timeToMinutes(time: string): number {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
}

/** Local time-of-day of a Date as minutes since midnight. */
export function minutesOfDay(d: Date): number {
    return d.getHours() * 60 + d.getMinutes();
}

/** Local time-of-day of a Date formatted as "HH:mm" (24h). */
export function formatTimeOfDay(d: Date): string {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Today's date as a "YYYY-MM-DD" string in local time. */
export function todayISO(): string {
    return format(new Date(), 'yyyy-MM-dd');
}

/** Convert total minutes since midnight back to "HH:mm" (24h, wraps past midnight). */
export function minutesToTime(minutes: number): string {
    const h = Math.floor(minutes / 60) % 24;
    const m = minutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Add a duration in minutes to an "HH:mm" string, returning "HH:mm". */
export function addMinutesToTime(start: string, deltaMinutes: number): string {
    return minutesToTime(timeToMinutes(start) + deltaMinutes);
}

/** Format a duration in minutes as "1h 30m" / "2h" / "45m". */
export function formatDuration(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
}

/**
 * v7.4: pick the best session to drop a Quick Start task into, given the current time-of-day
 * (`nowMinutes` = minutes since midnight). Pure — mirrors `useCurrentSession` selection logic so
 * the reducer can call it. Prefers the session whose [start, end) window contains now; else the
 * nearest upcoming session; else the first session. Returns undefined for an empty slot list.
 */
export function pickSessionIdForTime(slots: SessionSlot[], nowMinutes: number): string | undefined {
    if (slots.length === 0) return undefined;
    const current = slots.find(
        (s) => nowMinutes >= timeToMinutes(s.startTime) && nowMinutes < timeToMinutes(s.endTime),
    );
    if (current) return current.id;
    const upcoming = slots
        .filter((s) => timeToMinutes(s.startTime) > nowMinutes)
        .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime))[0];
    if (upcoming) return upcoming.id;
    return slots[0].id;
}
