import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useDayPlan } from '../../hooks/useDayPlan';
import { useGoogleCalendarData, useGoogleCalendarActions } from '../../hooks/useGoogleCalendar';
import { getStoredSecret } from '../../lib/googleAuth';
import { Button } from '../ui/Button';
import { inputClass } from '../ui/formStyles';
import type { GoogleCalendarEntry } from '../../types';

/**
 * Google Calendar OAuth setup (server-mediated, option E2). The browser holds only a single shared
 * secret; the Cloudflare Worker holds the client secret + refresh token. Flow: enter the shared
 * secret → Connect (redirects to Google) → callback redirects back to /settings?gcal=connected.
 * Picking calendars writes the selected subset into `settings.googleCalendarIds` (consumed by the embed).
 */
export function GoogleCalendarSetup() {
    const { settings, dispatch } = useDayPlan();
    const { isConfigured, isConnected, connecting, authFailed, availableCalendars, error } =
        useGoogleCalendarData();
    const { setAppSecret, connect, disconnect, refreshCalendars, checkConnection } =
        useGoogleCalendarActions();

    const [secretDraft, setSecretDraft] = useState('');
    const [editingSecret, setEditingSecret] = useState(false);
    const hasSecret = isConfigured;

    const [searchParams, setSearchParams] = useSearchParams();

    // Handle the OAuth callback redirect (…/settings?gcal=connected | error).
    useEffect(() => {
        const gcal = searchParams.get('gcal');
        if (!gcal) return;
        if (gcal === 'connected') {
            void checkConnection();
        }
        // Strip the one-shot params so a refresh doesn't re-trigger.
        const next = new URLSearchParams(searchParams);
        next.delete('gcal');
        next.delete('reason');
        setSearchParams(next, { replace: true });
    }, [searchParams, setSearchParams, checkConnection]);

    const callbackError = searchParams.get('gcal') === 'error' ? searchParams.get('reason') : null;

    const selectedIds = useMemo(
        () => new Set((settings.googleCalendarIds ?? []).map((c) => c.id)),
        [settings.googleCalendarIds],
    );

    const toggleCalendar = (entry: GoogleCalendarEntry) => {
        const selected = settings.googleCalendarIds ?? [];
        const updated = selectedIds.has(entry.id)
            ? selected.filter((c) => c.id !== entry.id)
            : [...selected, entry];
        dispatch({
            type: 'UPDATE_SETTINGS',
            settings: { googleCalendarIds: updated.length > 0 ? updated : undefined },
        });
    };

    const saveSecret = () => {
        setAppSecret(secretDraft.trim());
        setSecretDraft('');
        setEditingSecret(false);
    };

    return (
        <div>
            <h3 className="text-sm font-semibold mb-2">Google Calendar</h3>

            {callbackError && (
                <div className="mb-3 rounded-lg border border-red-400/50 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                    Sign-in failed ({callbackError}). Please try connecting again.
                </div>
            )}

            {/* Shared-secret entry — required before anything else works. */}
            {(!hasSecret || editingSecret) ? (
                <div className="space-y-2">
                    <p className="text-xs text-text-light">
                        Enter the <strong>app secret</strong> (the <code className="text-xs bg-surface-dark px-1 py-0.5 rounded">APP_SHARED_SECRET</code>{' '}
                        you set on the Cloudflare deployment). It's stored on this device and authorizes calendar access.
                    </p>
                    <div className="flex items-center gap-2">
                        <input
                            type="password"
                            value={secretDraft}
                            onChange={(e) => setSecretDraft(e.target.value)}
                            placeholder={getStoredSecret() ? '••••••••  (set — enter to replace)' : 'App secret'}
                            className={inputClass}
                        />
                        <Button size="sm" onClick={saveSecret} disabled={!secretDraft.trim()}>
                            Save
                        </Button>
                        {hasSecret && (
                            <Button variant="ghost" size="sm" onClick={() => setEditingSecret(false)}>
                                Cancel
                            </Button>
                        )}
                    </div>
                </div>
            ) : (
                <div className="space-y-3">
                    {authFailed && (
                        <div className="rounded-lg border border-red-400/50 bg-red-50 dark:bg-red-900/20 px-3 py-2.5 text-sm">
                            <p className="font-medium text-red-700 dark:text-red-300">
                                Google Calendar needs reconnecting
                            </p>
                            <p className="text-xs text-red-700/80 dark:text-red-300/80 mt-1">
                                Reconnect, or re-enter the app secret if it changed.
                            </p>
                        </div>
                    )}

                    <div className="flex items-center gap-3 text-xs">
                        <span className="text-text-light">App secret saved.</span>
                        <button
                            type="button"
                            onClick={() => setEditingSecret(true)}
                            className="text-text-light hover:text-accent cursor-pointer"
                        >
                            Change
                        </button>
                    </div>

                    {isConnected ? (
                        <>
                            <div className="flex items-center gap-3">
                                <span className="text-sm text-success">Connected</span>
                                <button
                                    type="button"
                                    onClick={refreshCalendars}
                                    className="text-xs text-text-light hover:text-accent cursor-pointer"
                                    title="Re-fetch your calendar list"
                                >
                                    ↻ Refresh calendars
                                </button>
                                <Button variant="ghost" size="sm" onClick={() => void disconnect()}>
                                    Disconnect
                                </Button>
                            </div>

                            <div>
                                <p className="text-xs text-text-light mb-2">
                                    Choose which calendars to overlay in the weekly view.
                                </p>
                                {availableCalendars.length === 0 ? (
                                    <p className="text-xs text-text-light">No calendars found.</p>
                                ) : (
                                    <ul className="space-y-1.5">
                                        {availableCalendars.map((cal) => (
                                            <li key={cal.id} className="flex items-center gap-2 text-sm">
                                                <input
                                                    type="checkbox"
                                                    id={`gcal-${cal.id}`}
                                                    checked={selectedIds.has(cal.id)}
                                                    onChange={() =>
                                                        toggleCalendar({
                                                            id: cal.id,
                                                            name: cal.name,
                                                            color: cal.color,
                                                            primary: cal.primary,
                                                        })
                                                    }
                                                    className="cursor-pointer accent-accent"
                                                />
                                                <span
                                                    className="w-3 h-3 rounded-sm flex-shrink-0 border border-border"
                                                    style={{ backgroundColor: cal.color ?? 'transparent' }}
                                                />
                                                <label
                                                    htmlFor={`gcal-${cal.id}`}
                                                    className="flex-1 min-w-0 truncate cursor-pointer"
                                                    title={cal.id}
                                                >
                                                    {cal.name}
                                                    {cal.primary && (
                                                        <span className="ml-1.5 text-[10px] text-text-light">(primary)</span>
                                                    )}
                                                </label>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        </>
                    ) : (
                        <div className="space-y-2">
                            <p className="text-xs text-text-light">
                                Sign in with Google to list your calendars and overlay them. The connection is held
                                securely on the server, so it persists across devices and browser sessions.
                            </p>
                            <Button size="sm" onClick={() => void connect()} disabled={connecting}>
                                {connecting ? 'Connecting…' : 'Connect Google Calendar'}
                            </Button>
                        </div>
                    )}

                    {error && !authFailed && <p className="text-xs text-red-500">{error}</p>}
                </div>
            )}
        </div>
    );
}
