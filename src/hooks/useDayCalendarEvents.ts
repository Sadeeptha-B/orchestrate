import { useCallback, useEffect, useRef, useState } from 'react';
import { useGoogleCalendarData, useGoogleCalendarActions } from './useGoogleCalendar';
import type { CalendarEvent } from '../lib/googleCalendarApi';

/**
 * Fetch the selected calendars' timed events for a single local day ("YYYY-MM-DD"), for the
 * read-only timeline overlay. Re-fetches when the date or connection changes (and when the selected
 * calendars change, since `listDayEvents`'s identity tracks `settings.googleCalendarIds`) — the
 * dep-gated effect is what keeps this from re-fetching on every render. A `seq` ref discards
 * out-of-order responses; `refetch` lets a caller refresh on demand.
 */
export function useDayCalendarEvents(dateISO: string): {
    events: CalendarEvent[];
    loading: boolean;
    refetch: () => void;
} {
    const { isConnected } = useGoogleCalendarData();
    const { listDayEvents } = useGoogleCalendarActions();
    const [events, setEvents] = useState<CalendarEvent[]>([]);
    const [loading, setLoading] = useState(false);
    const seq = useRef(0);

    const load = useCallback(async () => {
        if (!isConnected) {
            seq.current += 1;
            setEvents([]);
            setLoading(false);
            return;
        }
        const ticket = ++seq.current;
        setLoading(true);
        try {
            const result = await listDayEvents(dateISO);
            if (ticket === seq.current) setEvents(result);
        } finally {
            if (ticket === seq.current) setLoading(false);
        }
    }, [dateISO, isConnected, listDayEvents]);

    useEffect(() => {
        void load();
    }, [load]);

    return { events, loading, refetch: () => void load() };
}
