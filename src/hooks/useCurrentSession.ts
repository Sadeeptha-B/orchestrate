import { useMemo, useState, useEffect } from 'react';
import { format } from 'date-fns';
import type { SessionSlot } from '../types';

function timeToMinutes(time: string): number {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
}

export function useCurrentSession(slots: SessionSlot[]) {
    const [tick, setTick] = useState(0);

    useEffect(() => {
        const id = setInterval(() => setTick((t) => t + 1), 60_000);
        return () => clearInterval(id);
    }, []);

    return useMemo(() => {
        void tick;
        const now = new Date();
        const currentMinutes = now.getHours() * 60 + now.getMinutes();
        const today = format(now, 'yyyy-MM-dd');

        const currentSession = slots.find((s) => {
            const start = timeToMinutes(s.startTime);
            const end = timeToMinutes(s.endTime);
            return currentMinutes >= start && currentMinutes < end;
        });

        const remainingSessions = slots.filter((s) => {
            const end = timeToMinutes(s.endTime);
            return currentMinutes < end;
        });

        return { currentSession, remainingSessions, today };
    }, [slots, tick]);
}
