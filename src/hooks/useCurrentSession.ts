import { useMemo } from 'react';
import { format } from 'date-fns';
import type { SessionSlot } from '../types';

function timeToMinutes(time: string): number {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
}

export function useCurrentSession(slots: SessionSlot[]) {
    return useMemo(() => {
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
    }, [slots]);
}
