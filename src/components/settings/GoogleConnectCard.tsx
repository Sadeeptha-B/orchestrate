// Reusable Google Calendar connect/status card — OAuth kick-off, connected badge, callback-error
// and auth-failure banners. Mounted by the Settings integrations panel (which adds calendar
// visibility + Orchestrate-calendar config around it) and by the onboarding flow's encouraged
// Google Calendar step. It processes the OAuth callback redirect wherever it's mounted, via
// useGcalCallback — /login's `return` target decides which surface that is.

import type { ReactNode } from 'react';
import { useGcalCallback } from '../../hooks/useGcalCallback';
import { useGoogleCalendarData, useGoogleCalendarActions } from '../../hooks/useGoogleCalendar';
import type { ConnectReturnTarget } from '../../lib/googleAuth';
import { Button } from '../ui/Button';

interface GoogleConnectCardProps {
    /** Where the OAuth callback should land afterwards (default: the Settings integrations tab). */
    returnTo?: ConnectReturnTarget;
    /** Copy above the Connect button when disconnected. */
    description?: string;
    /** Extra controls rendered beside the Connected badge (Settings passes refresh + disconnect). */
    manageControls?: ReactNode;
}

export function GoogleConnectCard({ returnTo = 'settings', description, manageControls }: GoogleConnectCardProps) {
    const { isConnected, connecting, authFailed, error } = useGoogleCalendarData();
    const { connect } = useGoogleCalendarActions();
    const { callbackError } = useGcalCallback();

    return (
        <div className="space-y-3">
            {callbackError && (
                <div className="rounded-lg border border-red-400/50 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                    {callbackError}
                </div>
            )}

            {authFailed && (
                <div className="rounded-lg border border-red-400/50 bg-red-50 dark:bg-red-900/20 px-3 py-2.5 text-sm">
                    <p className="font-medium text-red-700 dark:text-red-300">
                        Google Calendar needs reconnecting
                    </p>
                    <p className="text-xs text-red-700/80 dark:text-red-300/80 mt-1">
                        Reconnect below — or if your session expired, reload the page to sign in again.
                    </p>
                </div>
            )}

            {isConnected ? (
                <div className="flex items-center gap-3">
                    <span className="text-sm text-success">Connected</span>
                    {manageControls}
                </div>
            ) : (
                <div className="space-y-2">
                    <p className="text-xs text-text-light">
                        {description
                            ?? 'Sign in with Google to list your calendars and overlay them. The connection is held securely on the server, so it persists across devices and browser sessions.'}
                    </p>
                    <Button size="sm" onClick={() => void connect(returnTo)} disabled={connecting}>
                        {connecting ? 'Connecting…' : 'Connect Google Calendar'}
                    </Button>
                </div>
            )}

            {error && !authFailed && <p className="text-xs text-red-500">{error}</p>}
        </div>
    );
}
