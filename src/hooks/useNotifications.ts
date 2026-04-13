import { useCallback } from 'react';
import type { NotificationPreference } from '../types';

const ICON_PATH = `${import.meta.env.BASE_URL}favicon.svg`;

export function useNotifications() {
    const requestPermission = useCallback(async () => {
        if (!('Notification' in window)) return false;
        if (Notification.permission === 'granted') return true;
        const result = await Notification.requestPermission();
        return result === 'granted';
    }, []);

    const sendNotification = useCallback(
        async (title: string, body: string, preference: NotificationPreference) => {
            if (preference === 'in-app') return;
            if (!('Notification' in window)) return;

            if (Notification.permission !== 'granted') {
                const granted = await Notification.requestPermission();
                if (granted !== 'granted') return;
            }

            new Notification(title, { body, icon: ICON_PATH });
        },
        [],
    );

    return { requestPermission, sendNotification };
}
