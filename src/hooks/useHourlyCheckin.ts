import { useEffect, useRef, useState, useCallback } from 'react';
import type { SessionSlot, NotificationPreference } from '../types';
import { useNotifications } from './useNotifications';

function timeToMinutes(time: string): number {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
}

function isWithinAnySession(slots: SessionSlot[]): boolean {
    const now = new Date();
    const mins = now.getHours() * 60 + now.getMinutes();
    return slots.some(
        (s) => mins >= timeToMinutes(s.startTime) && mins < timeToMinutes(s.endTime),
    );
}

export function useHourlyCheckin(
    slots: SessionSlot[],
    setupComplete: boolean,
    notificationPreference: NotificationPreference,
) {
    const [showCheckin, setShowCheckin] = useState(false);
    const { sendNotification } = useNotifications();
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const dismiss = useCallback(() => setShowCheckin(false), []);

    useEffect(() => {
        if (!setupComplete) return;

        const check = () => {
            if (isWithinAnySession(slots)) {
                setShowCheckin(true);
                if (notificationPreference !== 'in-app') {
                    sendNotification(
                        'Orchestrate Check-In',
                        "How's your session going? Time to recontextualize.",
                        notificationPreference,
                    );
                }
            }
        };

        // Fire on the next whole hour, then every 60 min
        const now = new Date();
        const msToNextHour =
            (60 - now.getMinutes()) * 60_000 - now.getSeconds() * 1000 - now.getMilliseconds();

        const timeout = setTimeout(() => {
            check();
            intervalRef.current = setInterval(check, 60 * 60_000);
        }, msToNextHour);

        return () => {
            clearTimeout(timeout);
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [setupComplete, slots, notificationPreference, sendNotification]);

    return { showCheckin, dismiss };
}
