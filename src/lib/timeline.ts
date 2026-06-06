// v7.1: shared time ⇆ horizontal-position geometry for the timeline surfaces.
// Both the read-only SessionTimelineBar and the interactive SessionEditorTimeline use
// these so there is a single source of truth for how minutes-since-midnight map to a
// percentage along the day track (and back).

export const DEFAULT_TIMELINE_START_MINUTES = 4 * 60 + 30; // 4:30 am
export const DEFAULT_TIMELINE_END_MINUTES = 24 * 60;        // midnight (end of day)

/** Format minutes since midnight to a short label like "6am", "2:30pm". Handles 1440 (midnight) as "12am". */
export function formatHour(minutes: number): string {
    const h = Math.floor(minutes / 60) % 24;
    const m = minutes % 60;
    const suffix = h >= 12 ? 'pm' : 'am';
    const display = h > 12 ? h - 12 : h === 0 ? 12 : h;
    return m === 0 ? `${display}${suffix}` : `${display}:${String(m).padStart(2, '0')}${suffix}`;
}

/** Position of a minute mark as a percentage (0–100) along a [dayStart, dayStart+totalMinutes] window. */
export function minutesToPct(minutes: number, dayStart: number, totalMinutes: number): number {
    return ((minutes - dayStart) / totalMinutes) * 100;
}

/** Inverse of {@link minutesToPct}: a percentage (0–100) back to minutes since midnight. */
export function pctToMinutes(pct: number, dayStart: number, totalMinutes: number): number {
    return dayStart + (pct / 100) * totalMinutes;
}

/**
 * Minutes since midnight → "HH:mm", WITHOUT wrapping at 24h. Midnight-end (1440) serializes
 * as "24:00" so a session ending at end-of-day round-trips through `timeToMinutes` as 1440
 * rather than 0 (which would render a negative-width block). Use this for session-slot times.
 */
export function minutesToClock(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
