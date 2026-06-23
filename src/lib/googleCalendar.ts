import type { GoogleCalendarEntry } from '../types';

/** Where a connected calendar's events can surface. */
export type CalendarSurface = 'timeline' | 'calendar';

// v7.7: per-surface visibility, defaulting to visible when the flag is absent (entries saved before
// v7.7 carry neither flag and should keep showing on both surfaces).
export const isVisibleOnTimeline = (e: GoogleCalendarEntry): boolean => e.showOnTimeline ?? true;
export const isVisibleInCalendar = (e: GoogleCalendarEntry): boolean => e.showInCalendar ?? true;

/** Whether an entry is visible on the given surface. */
export function isVisibleOnSurface(e: GoogleCalendarEntry, surface: CalendarSurface): boolean {
    return surface === 'timeline' ? isVisibleOnTimeline(e) : isVisibleInCalendar(e);
}
