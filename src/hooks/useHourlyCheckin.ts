import { useEffect, useRef, useState, useCallback } from 'react';
import type { SessionSlot, NotificationPreference } from '../types';
import { useNotifications } from './useNotifications';
import { minutesOfDay, timeToMinutes } from '../lib/time';
import { DEFAULT_RECONTEXT_CADENCE_MINUTES } from '../lib/reminders';

function msUntilNextCadenceBoundary(now: Date, cadenceMinutes: number): number {
    const cadenceMs = cadenceMinutes * 60_000;
    const elapsedTodayMs =
        minutesOfDay(now) * 60_000 + now.getSeconds() * 1000 + now.getMilliseconds();
    return (cadenceMs - (elapsedTodayMs % cadenceMs)) % cadenceMs;
}

function isWithinAnySession(slots: SessionSlot[]): boolean {
    const mins = minutesOfDay(new Date());
    return slots.some(
        (s) => mins >= timeToMinutes(s.startTime) && mins < timeToMinutes(s.endTime),
    );
}

export function useHourlyCheckin(
    slots: SessionSlot[],
    setupComplete: boolean,
    notificationPreference: NotificationPreference,
    cadenceMinutes: number = DEFAULT_RECONTEXT_CADENCE_MINUTES,
) {
    const [showCheckin, setShowCheckin] = useState(false);
    const { sendNotification } = useNotifications();
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const dismiss = useCallback(() => setShowCheckin(false), []);

    useEffect(() => {
        if (!setupComplete) return;
        // A non-positive cadence disables the check-in entirely.
        if (!Number.isFinite(cadenceMinutes) || cadenceMinutes <= 0) return;

        const check = () => {
            if (isWithinAnySession(slots)) {
                setShowCheckin(true);
                if (notificationPreference !== 'in-app') {
                    sendNotification(
                        'Orchestrate Check-In',
                        "How's your session going? Time to recontextualize.",
                        notificationPreference,
                        { dedupeKey: 'recontextualize-checkin' },
                    );
                }
            }
        };

        // Fire on the next cadence boundary (aligned to minutes-since-midnight so e.g. a 30-min
        // cadence lands on :00/:30 and a 60-min cadence keeps firing on the hour), then repeat.
        const now = new Date();
        const msToBoundary = msUntilNextCadenceBoundary(now, cadenceMinutes);

        const timeout = setTimeout(() => {
            check();
            intervalRef.current = setInterval(check, cadenceMinutes * 60_000);
        }, msToBoundary);

        return () => {
            clearTimeout(timeout);
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [setupComplete, slots, notificationPreference, sendNotification, cadenceMinutes]);

    return { showCheckin, dismiss };
}
