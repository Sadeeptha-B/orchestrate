import { useCallback } from 'react';
import { useDayPlan } from './useDayPlan';
import { useGoogleCalendarData, useGoogleCalendarActions } from './useGoogleCalendar';
import { effectiveBlocklist, sessionEventName, sessionEventTimes } from '../lib/sessionCalendar';

/**
 * v7.7 Phase 3: reconcile the day's sessions to the Orchestrate calendar. Creates events for new
 * sessions, patches name/time for existing ones, and deletes events whose session was removed —
 * persisting the sessionId→eventId map. No-ops gracefully when not connected or the creation scope
 * is missing. Returns true when a sync ran. The caller refetches the calendar afterwards.
 */
export function useSessionCalendarSync(): { sync: () => Promise<boolean> } {
    const { plan, settings, dispatch } = useDayPlan();
    const { isConnected, hasCalendarManageScope } = useGoogleCalendarData();
    const { ensureOrchestrateCalendar, createEvent, patchEvent, deleteEvent } = useGoogleCalendarActions();

    const sync = useCallback(async (): Promise<boolean> => {
        if (!isConnected || !hasCalendarManageScope) return false;
        const calId = await ensureOrchestrateCalendar(settings.orchestrateCalendarName ?? 'Orchestrate');
        if (!calId) return false;

        const existing = plan.sessionCalendarEventIds ?? {};
        const nextMap: Record<string, string> = { ...existing };
        const activeSessionIds = new Set(plan.sessionSlots.map((session) => session.id));
        let hadFailure = false;

        for (const session of plan.sessionSlots) {
            const suffix = effectiveBlocklist(session, plan.sessionStarts);
            const { start, end } = sessionEventTimes(plan.date, session);
            const body = {
                summary: sessionEventName(session, suffix),
                start: { dateTime: start.toISOString() },
                end: { dateTime: end.toISOString() },
            };
            const existingId = existing[session.id];
            if (existingId) {
                const patched = await patchEvent(calId, existingId, body);
                if (!patched) hadFailure = true;
                nextMap[session.id] = existingId;
            } else {
                const res = await createEvent(calId, body);
                if (res) nextMap[session.id] = res.id;
                else hadFailure = true;
            }
        }

        // Delete events whose session no longer exists.
        for (const [sessionId, eventId] of Object.entries(existing)) {
            if (activeSessionIds.has(sessionId)) continue;
            const deleted = await deleteEvent(calId, eventId);
            if (deleted) delete nextMap[sessionId];
            else hadFailure = true;
        }

        dispatch({ type: 'SET_SESSION_EVENT_IDS', eventIds: nextMap });
        return !hadFailure;
    }, [
        isConnected,
        hasCalendarManageScope,
        ensureOrchestrateCalendar,
        settings.orchestrateCalendarName,
        plan.sessionCalendarEventIds,
        plan.sessionSlots,
        plan.sessionStarts,
        plan.date,
        createEvent,
        patchEvent,
        deleteEvent,
        dispatch,
    ]);

    return { sync };
}
