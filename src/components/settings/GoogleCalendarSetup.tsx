import { useMemo } from 'react';
import { useDayPlan } from '../../hooks/useDayPlan';
import { useGoogleCalendarData, useGoogleCalendarActions } from '../../hooks/useGoogleCalendar';
import { Button } from '../ui/Button';
import type { GoogleCalendarEntry } from '../../types';

/**
 * Google Calendar OAuth (GIS) setup. Connect/disconnect plus an auto-listed calendar picker that
 * writes the selected subset into `settings.googleCalendarIds` (consumed by the embed). Replaces the
 * old manual calendar-ID entry. Write capability (createEvent) is wired in the provider but not yet
 * surfaced as a feature here.
 */
export function GoogleCalendarSetup() {
    const { settings, dispatch } = useDayPlan();
    const { isConfigured, isConnected, connecting, authFailed, availableCalendars, error } =
        useGoogleCalendarData();
    const { connect, disconnect, refreshCalendars } = useGoogleCalendarActions();

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

    return (
        <div>
            <h3 className="text-sm font-semibold mb-2">Google Calendar</h3>

            {!isConfigured ? (
                <p className="text-xs text-text-light">
                    Google Calendar sign-in isn't configured for this build. Set{' '}
                    <code className="text-xs bg-surface-dark px-1 py-0.5 rounded">VITE_GOOGLE_CLIENT_ID</code>{' '}
                    (an OAuth client ID) to enable connecting your calendars.
                </p>
            ) : (
                <div className="space-y-3">
                    {authFailed && (
                        <div className="rounded-lg border border-red-400/50 bg-red-50 dark:bg-red-900/20 px-3 py-2.5 text-sm">
                            <p className="font-medium text-red-700 dark:text-red-300">
                                Google Calendar session expired
                            </p>
                            <p className="text-xs text-red-700/80 dark:text-red-300/80 mt-1">
                                Reconnect to refresh access.
                            </p>
                        </div>
                    )}

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
                                Sign in with Google to list your calendars and overlay them. Stays signed in
                                while your browser session is active; nothing is stored beyond the connection flag.
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
