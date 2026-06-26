import { useEffect, useRef, useState } from 'react';
import type { AppSettings, DayPlan } from '../types';
import { useCurrentSession } from './useCurrentSession';
import { useNotifications } from './useNotifications';
import { engagementIdleState } from '../lib/engagement';
import { formatDuration } from '../lib/time';
import { DEFAULT_ENGAGEMENT_NUDGE_MINUTES, ENGAGEMENT_NUDGE_REPEAT_MINUTES } from '../lib/reminders';

const CHECK_INTERVAL_MS = 30_000;

export interface EngagementBanner {
    sessionName: string;
    minutes: number;
}

/** Resolve the configured idle threshold (minutes). `<= 0` means the nudge is disabled. */
function resolveThreshold(settings: AppSettings): number {
    return settings.engagementNudgeMinutes ?? DEFAULT_ENGAGEMENT_NUDGE_MINUTES;
}

/**
 * v7.8 (was `useFocusNudge`): fires the engagement nudge *notification* — an in-app banner plus a
 * background-only native fallback — when the user sits in an active session without engaging
 * anything (and the session still has incomplete work). Timing is anchored to the last engagement
 * boundary (see `engagementIdleState`), so stopping a task re-anchors the clock. Fires once at the
 * configured threshold (`settings.engagementNudgeMinutes`), then every 30 min while still idle.
 *
 * Headless: run app-wide by `NotificationBridge`. The persistent dashboard banner is a separate,
 * side-effect-free read (`useEngagementBanner`).
 */
export function useEngagementNudge(plan: DayPlan, settings: AppSettings) {
    const { currentSession } = useCurrentSession(plan.sessionSlots);
    const { sendNotification } = useNotifications();
    const trackedAnchorMs = useRef<number>(0);
    const lastFiredIndex = useRef<number>(-1);

    const threshold = resolveThreshold(settings);

    useEffect(() => {
        if (!plan.setupComplete) return;
        if (threshold <= 0) return; // disabled

        const check = () => {
            const state = engagementIdleState(plan, currentSession ?? null, Date.now());
            if (!state) {
                trackedAnchorMs.current = 0;
                lastFiredIndex.current = -1;
                return;
            }

            // A new anchor (engagement happened, or the session changed) re-arms the cadence.
            if (state.anchorMs !== trackedAnchorMs.current) {
                trackedAnchorMs.current = state.anchorMs;
                lastFiredIndex.current = -1;
            }

            if (state.elapsedMin < threshold) return;

            // Threshold index: 0 at `threshold`, 1 at `threshold + repeat`, …
            const idx = Math.floor((state.elapsedMin - threshold) / ENGAGEMENT_NUDGE_REPEAT_MINUTES);
            if (idx > lastFiredIndex.current) {
                lastFiredIndex.current = idx;
                sendNotification(
                    'Time to re-engage',
                    `It's been ${formatDuration(Math.round(state.elapsedMin))} since your last engagement in ${state.sessionName}. Press ▶ on a task to start one.`,
                    settings.notificationPreference,
                    { dedupeKey: 'engagement-nudge' },
                );
            }
        };

        check();
        const id = setInterval(check, CHECK_INTERVAL_MS);
        return () => clearInterval(id);
    }, [plan, currentSession, settings.notificationPreference, sendNotification, threshold]);
}

/**
 * v7.8: the persistent dashboard banner counterpart of the nudge. Returns the live idle state once
 * the user is past the configured threshold (and still idle with incomplete work) — so the banner
 * stays visible *beyond* the one-shot notification — or null. Pure read with a 30 s tick; no
 * notification side effects.
 */
export function useEngagementBanner(plan: DayPlan, settings: AppSettings): EngagementBanner | null {
    const { currentSession } = useCurrentSession(plan.sessionSlots);
    const [banner, setBanner] = useState<EngagementBanner | null>(null);
    const threshold = resolveThreshold(settings);

    useEffect(() => {
        const compute = () => {
            if (!plan.setupComplete || threshold <= 0) {
                setBanner(null);
                return;
            }
            const state = engagementIdleState(plan, currentSession ?? null, Date.now());
            if (!state || state.elapsedMin < threshold) {
                setBanner(null);
                return;
            }
            setBanner({ sessionName: state.sessionName, minutes: Math.round(state.elapsedMin) });
        };

        compute();
        const id = setInterval(compute, CHECK_INTERVAL_MS);
        return () => clearInterval(id);
    }, [plan, currentSession, threshold]);

    return banner;
}
