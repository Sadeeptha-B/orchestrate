import { Link } from 'react-router-dom';
import { useTodoistGate } from '../../hooks/useTodoistGate';

/**
 * App-wide connection-health bar for the Todoist requirement. Mounted once beside `AppRoutes` (inside
 * `TodoistProvider`), so it renders uniformly across Welcome, Dashboard, and the wizard — the gate is
 * no longer a single Welcome-hub CTA swap.
 *
 * Non-dismissable by design: Todoist is load-bearing (Orchestrate plans *from* it), so this is a
 * standing requirement, not a transient toast (those stay in `NotificationViewport`, bottom-right).
 * Rendered in normal document flow as the first child of the app shell, so it reserves space above
 * the routed page rather than overlaying it. Hidden entirely while connected.
 */
export function TodoistGateBanner() {
    const { writesBlocked, isConfigured } = useTodoistGate();
    if (!writesBlocked) return null;

    // `writesBlocked` with `isConfigured === true` means the token was revoked (authFailed).
    const revoked = isConfigured;
    const message = revoked
        ? 'Todoist disconnected — reconnect to keep your tasks in sync.'
        : 'Connect Todoist to plan your day — Orchestrate builds your plan from your Todoist tasks.';
    const cta = revoked ? 'Reconnect Todoist →' : 'Connect Todoist →';

    return (
        <div
            role="status"
            className="w-full border-b border-amber-400/50 bg-amber-50 text-amber-800 dark:bg-amber-900/20 dark:text-amber-200"
        >
            {/* pr-24 keeps the text clear of the fixed top-right HeaderControls cluster. */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 pr-24 text-sm">
                <span aria-hidden className="text-base leading-none flex-shrink-0">⚠</span>
                <span className="min-w-0 flex-1 font-medium">{message}</span>
                <Link
                    to="/settings?tab=integrations"
                    className="flex-shrink-0 font-semibold underline underline-offset-2 hover:opacity-80"
                >
                    {cta}
                </Link>
            </div>
        </div>
    );
}
