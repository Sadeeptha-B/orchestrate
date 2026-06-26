import {
    createContext,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from 'react';
import { NotificationViewport } from '../components/ui/NotificationViewport';

/**
 * v7.8: Orchestrate's in-app notification banner system. Replaces native browser notifications as
 * the primary channel — toasts follow the app's visual language and surface app-wide (any route).
 * Native notifications survive only as a background fallback (see `useNotifications`).
 *
 * Two producers feed this: reminder hooks (engagement nudge, hourly check-in, focus transitions)
 * and the `NotificationBridge` that watches integration contexts (Todoist / Google Calendar /
 * habit reconciliation) and raises an error toast when a sync fails.
 */

export type NotificationKind = 'info' | 'success' | 'warning' | 'error';

export interface NotificationAction {
    label: string;
    /** In-app route to navigate to when the action is clicked, e.g. "/settings?tab=integrations". */
    to: string;
}

export interface NotificationInput {
    kind: NotificationKind;
    title: string;
    body?: string;
    /** Auto-dismiss delay in ms. Defaults: errors/warnings persist (0); info/success ~6s. */
    durationMs?: number;
    /**
     * Stable key for de-duplication. A `notify` with a key matching a still-live toast replaces it
     * rather than stacking — so a repeating sync error or re-fired nudge shows once, refreshed.
     */
    dedupeKey?: string;
    action?: NotificationAction;
}

export interface AppNotification extends NotificationInput {
    id: string;
    createdAt: number;
}

interface NotificationContextValue {
    notifications: AppNotification[];
    notify: (input: NotificationInput) => string;
    dismiss: (id: string) => void;
}

const DEFAULT_TRANSIENT_MS = 6000;

const NotificationContext = createContext<NotificationContextValue | null>(null);
export { NotificationContext };

export function NotificationProvider({ children }: { children: ReactNode }) {
    const [notifications, setNotifications] = useState<AppNotification[]>([]);
    const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

    const clearTimer = useCallback((id: string) => {
        const t = timers.current.get(id);
        if (t) {
            clearTimeout(t);
            timers.current.delete(id);
        }
    }, []);

    const dismiss = useCallback((id: string) => {
        clearTimer(id);
        setNotifications((list) => list.filter((n) => n.id !== id));
    }, [clearTimer]);

    const scheduleAutoDismiss = useCallback((n: AppNotification) => {
        // Errors/warnings persist until dismissed; info/success auto-clear.
        const ms = n.durationMs ?? (n.kind === 'error' || n.kind === 'warning' ? 0 : DEFAULT_TRANSIENT_MS);
        if (ms <= 0) return;
        clearTimer(n.id);
        timers.current.set(n.id, setTimeout(() => dismiss(n.id), ms));
    }, [clearTimer, dismiss]);

    const notify = useCallback((input: NotificationInput): string => {
        const id = crypto.randomUUID();
        const next: AppNotification = { ...input, id, createdAt: Date.now() };
        setNotifications((list) => {
            // De-dupe: replace any live toast sharing the dedupeKey (clear its timer first).
            if (input.dedupeKey) {
                for (const existing of list) {
                    if (existing.dedupeKey === input.dedupeKey) clearTimer(existing.id);
                }
                const filtered = list.filter((n) => n.dedupeKey !== input.dedupeKey);
                return [...filtered, next];
            }
            return [...list, next];
        });
        scheduleAutoDismiss(next);
        return id;
    }, [clearTimer, scheduleAutoDismiss]);

    // Clear all pending timers on unmount.
    useEffect(() => {
        const map = timers.current;
        return () => {
            for (const t of map.values()) clearTimeout(t);
            map.clear();
        };
    }, []);

    const value = useMemo(() => ({ notifications, notify, dismiss }), [notifications, notify, dismiss]);

    return (
        <NotificationContext.Provider value={value}>
            {children}
            <NotificationViewport notifications={notifications} onDismiss={dismiss} />
        </NotificationContext.Provider>
    );
}
