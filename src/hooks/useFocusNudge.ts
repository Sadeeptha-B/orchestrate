import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppSettings, DayPlan } from '../types';
import { useCurrentSession } from './useCurrentSession';
import { useNotifications } from './useNotifications';
import { openSegment } from '../lib/engagement';
import { minutesOfDay, timeToMinutes } from '../lib/time';

const FIRST_NUDGE_MIN = 10;
const REPEAT_MIN = 30;

export interface FocusNudge {
    sessionName: string;
    minutes: number;
}

/** True when any task or habit instance currently has an open engagement segment (user is focusing). */
function isAnythingEngaged(plan: DayPlan): boolean {
    const taskEngaged = plan.linkedTasks.some((lt) => lt.status === 'engaged' && openSegment(lt.segments));
    const habitEngaged = plan.todaysHabits.some((h) => h.status === 'engaged' && openSegment(h.segments));
    return taskEngaged || habitEngaged;
}

/**
 * v7: nudges the user to start a focus block if they're sitting in an active session without engaging
 * anything. Fires once the current session has been active ≥10 min, then every 30 min while still idle
 * — but only when the session has incomplete assigned work (no nagging with nothing to do). Timing is
 * anchored to the session's start time, so focusing then stopping doesn't reset the clock. Returns the
 * current nudge (for an in-app banner) plus a `dismiss`; browser notifications respect the preference.
 */
export function useFocusNudge(plan: DayPlan, settings: AppSettings) {
    const { currentSession } = useCurrentSession(settings.sessionSlots);
    const { sendNotification } = useNotifications();
    const [nudge, setNudge] = useState<FocusNudge | null>(null);
    const trackedSessionId = useRef<string | null>(null);
    const lastFiredIndex = useRef<number>(-1);

    const dismiss = useCallback(() => setNudge(null), []);

    useEffect(() => {
        if (!plan.setupComplete) return;

        const check = () => {
            // Reset per-session tracking whenever the active session changes (or ends).
            if ((currentSession?.id ?? null) !== trackedSessionId.current) {
                trackedSessionId.current = currentSession?.id ?? null;
                lastFiredIndex.current = -1;
                setNudge(null);
            }
            if (!currentSession) return;
            if (isAnythingEngaged(plan)) {
                setNudge(null);
                return;
            }

            const ids = plan.taskSessions[currentSession.id] ?? [];
            const hasIncompleteWork = ids.some((id) => {
                const lt = plan.linkedTasks.find((t) => t.todoistId === id);
                return lt && !lt.completed;
            });
            if (!hasIncompleteWork) return;

            const elapsedMin = minutesOfDay(new Date()) - timeToMinutes(currentSession.startTime);
            if (elapsedMin < FIRST_NUDGE_MIN) return;

            // Threshold index: 0 at 10 min, 1 at 40 min, 2 at 70 min, …
            const idx = Math.floor((elapsedMin - FIRST_NUDGE_MIN) / REPEAT_MIN);
            if (idx > lastFiredIndex.current) {
                lastFiredIndex.current = idx;
                const minutes = Math.round(elapsedMin);
                setNudge({ sessionName: currentSession.name, minutes });
                sendNotification(
                    'Time to focus',
                    `You're ${minutes} min into ${currentSession.name} without a focus block. Start one?`,
                    settings.notificationPreference,
                );
            }
        };

        check();
        const id = setInterval(check, 30_000);
        return () => clearInterval(id);
    }, [plan, currentSession, settings.notificationPreference, sendNotification]);

    return { nudge, dismiss };
}
