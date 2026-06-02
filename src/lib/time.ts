import { format } from 'date-fns';

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
