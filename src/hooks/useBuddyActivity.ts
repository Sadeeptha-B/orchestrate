import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useDayPlan } from './useDayPlan';
import { findActiveFocusTask } from '../lib/focus';
import { timeToMinutes } from '../lib/time';
import type { BuddyActivity } from '../components/buddy/animations';

const minuteOfDay = () => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
};

/**
 * Deterministic per-task pose so an engagement is either a gardening spell or a coding spell —
 * variety across tasks without flickering mid-engagement.
 */
const engagementPose = (todoistId: string): BuddyActivity => {
    let sum = 0;
    for (const ch of todoistId) sum += ch.charCodeAt(0);
    return sum % 2 === 0 ? 'water' : 'code';
};

/**
 * Which slice of life the ASCII buddy is living right now, derived from day state (top wins):
 *  - outside the configured day window (settings timeline bounds) → asleep
 *  - on /setup → planning pose (clipboard) alongside the wizard
 *  - a habit instance is engaged → working out
 *  - a task engagement is running → watering a plant or coding (per-task pick)
 *  - day set up but the clock sits in a gap between sessions → swimming (True Rest)
 *  - otherwise → idling (the widget layers occasional dance bursts on top)
 */
export function useBuddyActivity(): BuddyActivity {
    const { plan, settings } = useDayPlan();
    const { pathname } = useLocation();
    const [nowMinutes, setNowMinutes] = useState(minuteOfDay);

    useEffect(() => {
        const id = setInterval(() => setNowMinutes(minuteOfDay()), 30_000);
        return () => clearInterval(id);
    }, []);

    const dayStart = settings.timelineStartMinutes ?? 270;
    const dayEnd = settings.timelineEndMinutes ?? 1440;
    if (nowMinutes < dayStart || nowMinutes >= dayEnd) return 'sleep';
    if (pathname === '/setup') return 'plan';
    if (plan.todaysHabits.some((h) => h.status === 'engaged')) return 'workout';
    const engaged = findActiveFocusTask(plan);
    if (engaged) return engagementPose(engaged.todoistId);
    if (plan.setupComplete && plan.sessionSlots.length > 0) {
        const inSession = plan.sessionSlots.some((s) => {
            const start = timeToMinutes(s.startTime);
            const end = timeToMinutes(s.endTime);
            return nowMinutes >= start && nowMinutes < end;
        });
        if (!inSession) return 'swim';
    }
    return 'idle';
}
