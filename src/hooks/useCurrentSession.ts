import { useMemo, useState, useEffect } from 'react';
import type { SessionSlot } from '../types';
import { timeToMinutes } from '../lib/time';

export function useCurrentSession(slots: SessionSlot[]) {
    const [tick, setTick] = useState(0);

    useEffect(() => {
        const id = setInterval(() => setTick((t) => t + 1), 60_000);
        return () => clearInterval(id);
    }, []);

    return useMemo(() => {
        void tick; // re-runs on each minute tick
        const now = new Date();
        const currentMinutes = now.getHours() * 60 + now.getMinutes();

        const currentSession = slots.find((s) => {
            const start = timeToMinutes(s.startTime);
            const end = timeToMinutes(s.endTime);
            return currentMinutes >= start && currentMinutes < end;
        });

        const remainingSessions = slots.filter(
            (s) => currentMinutes < timeToMinutes(s.endTime),
        );

        return { currentSession, remainingSessions };
    }, [slots, tick]);
}
