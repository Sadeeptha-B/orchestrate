import { useCallback } from 'react';
import type { NotificationPreference } from '../types';
import { useNotify } from './useNotify';
import type { NotificationInput } from '../context/NotificationContext';

const ICON_PATH = `${import.meta.env.BASE_URL}favicon.svg`;

/**
 * v7.8: notifications now flow through Orchestrate's in-app banner system as the primary channel.
 * Native browser notifications are a *background-only fallback* — fired only when the tab is hidden
 * (`document.hidden`) and the user's preference allows the browser channel — so you still get
 * pinged when Orchestrate is in the background, without breaking the app's visual language while
 * it's on screen.
 */
export function useNotifications() {
    const { notify } = useNotify();

    const requestPermission = useCallback(async () => {
        if (!('Notification' in window)) return false;
        if (Notification.permission === 'granted') return true;
        const result = await Notification.requestPermission();
        return result === 'granted';
    }, []);

    const sendNotification = useCallback(
        (
            title: string,
            body: string,
            preference: NotificationPreference,
            opts?: Partial<Pick<NotificationInput, 'kind' | 'durationMs' | 'dedupeKey' | 'action'>>,
        ) => {
            // Primary channel: always show the in-app banner.
            notify({ kind: opts?.kind ?? 'info', title, body, ...opts });

            // Background fallback: native notification only when the tab is hidden and allowed.
            const browserAllowed = preference === 'browser' || preference === 'both';
            if (!browserAllowed) return;
            if (typeof document !== 'undefined' && !document.hidden) return;
            if (!('Notification' in window)) return;

            void (async () => {
                if (Notification.permission !== 'granted') {
                    const granted = await Notification.requestPermission();
                    if (granted !== 'granted') return;
                }

                new Notification(title, { body, icon: ICON_PATH });
            })();
        },
        [notify],
    );

    return { requestPermission, sendNotification };
}
