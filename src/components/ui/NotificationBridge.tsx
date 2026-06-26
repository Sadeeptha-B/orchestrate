import { useEffect, useRef } from 'react';
import { useDayPlan } from '../../hooks/useDayPlan';
import { useTodoistData } from '../../hooks/useTodoist';
import { useGoogleCalendarData } from '../../hooks/useGoogleCalendar';
import { useHabitReconciliation } from '../../hooks/useHabitReconciliation';
import { useEngagementNudge } from '../../hooks/useEngagementNudge';
import { useNotify } from '../../hooks/useNotify';

const INTEGRATIONS_ROUTE = '/settings?tab=integrations';

/**
 * v7.8: headless bridge mounted under all providers. It (1) runs the engagement nudge app-wide and
 * (2) watches the integration contexts (Todoist, Google Calendar, habit reconciliation) and raises
 * an Orchestrate error banner when a sync fails — on the null→error transition only, de-duped per
 * source so a repeating error shows once rather than stacking.
 */
export function NotificationBridge() {
    const { plan, settings } = useDayPlan();
    const { notify } = useNotify();

    // Engagement nudge (replaces the old dashboard-only focus banner).
    useEngagementNudge(plan, settings);

    const todoist = useTodoistData();
    const calendar = useGoogleCalendarData();
    const reconciliation = useHabitReconciliation();

    useSyncErrorToast('todoist-sync', 'Todoist sync failed', todoist.error, todoist.authFailed, notify);
    useSyncErrorToast('calendar-sync', 'Google Calendar sync failed', calendar.error, calendar.authFailed, notify);
    useSyncErrorToast('habit-sync', 'Habit sync failed', reconciliation.lastError, false, notify);

    return null;
}

/** Fire an error toast when `error` becomes non-null (or changes), de-duped by `dedupeKey`. */
function useSyncErrorToast(
    dedupeKey: string,
    title: string,
    error: string | null,
    authFailed: boolean,
    notify: ReturnType<typeof useNotify>['notify'],
) {
    const prev = useRef<string | null>(null);
    useEffect(() => {
        if (error && error !== prev.current) {
            notify({
                kind: 'error',
                title,
                body: authFailed ? `${error} — reconnect in Integrations.` : error,
                dedupeKey,
                action: { label: 'Open Integrations', to: INTEGRATIONS_ROUTE },
            });
        }
        prev.current = error;
    }, [error, authFailed, title, dedupeKey, notify]);
}
