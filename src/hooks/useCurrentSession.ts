import { useMemo, useState, useEffect } from 'react';
import type { SessionSlot } from '../types';
import { minutesOfDay, timeToMinutes } from '../lib/time';

export function useCurrentSession(slots: SessionSlot[]) {
    const [tick, setTick] = useState(0);

    useEffect(() => {
        const id = setInterval(() => setTick((t) => t + 1), 60_000);
        return () => clearInterval(id);
    }, []);

    return useMemo(() => {
        void tick; // re-runs on each minute tick
        const currentMinutes = minutesOfDay(new Date());

        const currentSession = slots.find((s) => {
            const start = timeToMinutes(s.startTime);
            const end = timeToMinutes(s.endTime);
            return currentMinutes >= start && currentMinutes < end;
        });

        const remainingSessions = slots.filter(
            (s) => currentMinutes < timeToMinutes(s.endTime),
        );

        /** v6: the next session that hasn't started yet, or undefined. */
        const nextSession = slots
            .filter((s) => timeToMinutes(s.startTime) > currentMinutes)
            .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime))[0];

        /**
         * v6: true when no session is currently active AND the next session
         * starts within `minutes` minutes. Used to surface the True Rest banner
         * between sessions (default 60 min lookahead).
         */
        const nextSessionStartsWithin = (minutes: number): boolean => {
            if (currentSession || !nextSession) return false;
            return timeToMinutes(nextSession.startTime) - currentMinutes <= minutes;
        };

        return { currentSession, remainingSessions, nextSession, nextSessionStartsWithin };
    }, [slots, tick]);
}
