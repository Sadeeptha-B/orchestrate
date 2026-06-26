import { Link } from 'react-router-dom';
import type { AppNotification, NotificationKind } from '../../context/NotificationContext';

/**
 * v7.8: fixed, stacked toast banners for the in-app notification system. Styling mirrors the
 * existing in-app banners (accent for info/nudges, red for errors, amber for warnings) and works
 * in light + dark mode.
 */

const KIND_CLASSES: Record<NotificationKind, string> = {
    info: 'bg-accent/10 border-accent/30 text-accent',
    success: 'border-emerald-400/50 bg-emerald-50 text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200',
    warning: 'border-amber-400/50 bg-amber-50 text-amber-800 dark:bg-amber-900/20 dark:text-amber-200',
    error: 'border-red-400/50 bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-200',
};

const KIND_ICONS: Record<NotificationKind, string> = {
    info: '◎',
    success: '✓',
    warning: '⚠',
    error: '⚠',
};

interface Props {
    notifications: AppNotification[];
    onDismiss: (id: string) => void;
}

export function NotificationViewport({ notifications, onDismiss }: Props) {
    if (notifications.length === 0) return null;

    return (
        <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-[min(22rem,calc(100vw-2rem))] pointer-events-none">
            {notifications.map((n) => (
                <div
                    key={n.id}
                    role="status"
                    className={`pointer-events-auto rounded-lg border shadow-sm px-3 py-2.5 text-sm flex items-start gap-2.5 ${KIND_CLASSES[n.kind]}`}
                >
                    <span aria-hidden className="mt-0.5 text-base leading-none flex-shrink-0">
                        {KIND_ICONS[n.kind]}
                    </span>
                    <div className="min-w-0 flex-1">
                        <p className="font-medium">{n.title}</p>
                        {n.body && <p className="mt-0.5 text-[13px] opacity-90">{n.body}</p>}
                        {n.action && (
                            <Link
                                to={n.action.to}
                                onClick={() => onDismiss(n.id)}
                                className="mt-1.5 inline-block text-[13px] font-medium underline underline-offset-2 hover:opacity-80"
                            >
                                {n.action.label}
                            </Link>
                        )}
                    </div>
                    <button
                        onClick={() => onDismiss(n.id)}
                        className="flex-shrink-0 text-lg leading-none opacity-60 hover:opacity-100 transition-opacity cursor-pointer"
                        title="Dismiss"
                        aria-label="Dismiss notification"
                    >
                        &times;
                    </button>
                </div>
            ))}
        </div>
    );
}
