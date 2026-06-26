import { useContext } from 'react';
import { NotificationContext } from '../context/NotificationContext';

/** Access the in-app notification banner system. Throws if used outside `NotificationProvider`. */
export function useNotify() {
    const ctx = useContext(NotificationContext);
    if (!ctx) throw new Error('useNotify must be used within NotificationProvider');
    return ctx;
}
