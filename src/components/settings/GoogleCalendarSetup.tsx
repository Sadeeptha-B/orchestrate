import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAppSecret } from '../../hooks/useAppSecret';
import { useDayPlan } from '../../hooks/useDayPlan';
import { useGoogleCalendarData, useGoogleCalendarActions } from '../../hooks/useGoogleCalendar';
import { Button } from '../ui/Button';
import { inputClass } from '../ui/formStyles';
import { isVisibleInCalendar, isVisibleOnTimeline, type CalendarSurface } from '../../lib/googleCalendar';
import type { GoogleCalendarEntry } from '../../types';
import type { GoogleCalendarListEntry } from '../../lib/googleCalendarApi';

const GCAL_CALLBACK_ERRORS: Record<string, string> = {
    access_denied: 'Google sign-in was cancelled.',
    exchange_failed: 'Google sign-in could not be completed. Please try again.',
    google_unreachable: 'Google could not be reached right now. Please try again shortly.',
    no_code: 'Google sign-in did not return an authorization code.',
    server_not_configured: 'The Cloudflare worker is missing its Google OAuth configuration.',
    state: 'The Google sign-in session expired or was invalid. Please try again.',
    storage_unavailable: 'Cloudflare KV is unavailable right now. Please try again shortly.',
};

/**
 * Google Calendar OAuth setup (server-mediated, option E2). The browser holds only a single shared
 * secret; the Cloudflare Worker holds the client secret + refresh token. Flow: enter the shared
 * secret → Connect (redirects to Google) → callback redirects back to /settings?gcal=connected.
 * Per-calendar visibility writes into `settings.googleCalendarIds` with independent `showOnTimeline` /
 * `showInCalendar` flags (consumed by the SessionTimelineBar overlay and the RenderedCalendar view).
 */
export function GoogleCalendarSetup() {
    const { settings, dispatch } = useDayPlan();
    const { secret: storedSecret } = useAppSecret();
    const { isConfigured, isConnected, connecting, authFailed, availableCalendars, hasCalendarManageScope, error } =
        useGoogleCalendarData();
    const { setAppSecret, connect, disconnect, refreshCalendars, checkConnection, ensureOrchestrateCalendar, recreateOrchestrateCalendar, renameOrchestrateCalendar } =
        useGoogleCalendarActions();

    const orchestrateName = settings.orchestrateCalendarName ?? 'Orchestrate';
    const orchestrateCalendar = settings.orchestrateCalendarId
        ? availableCalendars.find((c) => c.id === settings.orchestrateCalendarId)
        : undefined;

    const [secretDraft, setSecretDraft] = useState('');
    const [editingSecret, setEditingSecret] = useState(false);
    const hasSecret = isConfigured;

    // The name is a local draft so we don't hit the Google API on every keystroke; committing it
    // (blur / Enter) renames the linked calendar in place (or relinks to a same-named one).
    const [nameDraft, setNameDraft] = useState(orchestrateName);
    useEffect(() => {
        setNameDraft(orchestrateName);
    }, [orchestrateName]);
    const commitName = () => {
        const next = nameDraft.trim();
        if (!next || next === orchestrateName) return;
        void renameOrchestrateCalendar(next);
    };

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

    const callbackErrorCode = searchParams.get('gcal') === 'error' ? searchParams.get('reason') : null;
    const callbackError = callbackErrorCode
        ? (GCAL_CALLBACK_ERRORS[callbackErrorCode] ?? 'Sign-in failed. Please try connecting again.')
        : null;

    const entriesById = useMemo(
        () => new Map((settings.googleCalendarIds ?? []).map((c) => [c.id, c] as const)),
        [settings.googleCalendarIds],
    );

    // A calendar is "visible on a surface" only if it's tracked (in googleCalendarIds) AND its flag
    // for that surface isn't explicitly off. Untracked calendars are off everywhere.
    const isOn = (cal: GoogleCalendarListEntry, surface: CalendarSurface): boolean => {
        const entry = entriesById.get(cal.id);
        if (!entry) return false;
        return surface === 'timeline' ? isVisibleOnTimeline(entry) : isVisibleInCalendar(entry);
    };

    // Flip one surface's visibility for a calendar. Adds the entry on first enable; drops it once both
    // surfaces are off, so googleCalendarIds stays "the calendars I show somewhere".
    const setSurface = (cal: GoogleCalendarListEntry, surface: CalendarSurface, on: boolean) => {
        const list = settings.googleCalendarIds ?? [];
        const existing = entriesById.get(cal.id);
        // Fresh metadata from the live list; a brand-new entry starts with the other surface off.
        const prevTimeline = existing ? isVisibleOnTimeline(existing) : false;
        const prevCalendar = existing ? isVisibleInCalendar(existing) : false;
        const next: GoogleCalendarEntry = {
            id: cal.id,
            name: cal.name,
            color: cal.color,
            primary: cal.primary,
            showOnTimeline: surface === 'timeline' ? on : prevTimeline,
            showInCalendar: surface === 'calendar' ? on : prevCalendar,
        };
        const keep = isVisibleOnTimeline(next) || isVisibleInCalendar(next);
        let updated: GoogleCalendarEntry[];
        if (existing) {
            updated = list
                .map((c) => (c.id === cal.id ? next : c))
                .filter((c) => isVisibleOnTimeline(c) || isVisibleInCalendar(c));
        } else {
            updated = keep ? [...list, next] : list;
        }
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
                    {callbackError}
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
                            placeholder={storedSecret ? '••••••••  (set — enter to replace)' : 'App secret'}
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
                                    Choose where each calendar appears — as faded context on the{' '}
                                    <strong>Timeline</strong> bar, in the full <strong>Calendar</strong> view, or both.
                                </p>
                                {availableCalendars.length === 0 ? (
                                    <p className="text-xs text-text-light">No calendars found.</p>
                                ) : (
                                    <ul className="space-y-1">
                                        {/* Column headings for the two surface toggles. */}
                                        <li className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-text-light/70 pr-1">
                                            <span className="flex-1" />
                                            <span className="w-16 text-center">Timeline</span>
                                            <span className="w-16 text-center">Calendar</span>
                                        </li>
                                        {availableCalendars.map((cal) => (
                                            <li key={cal.id} className="flex items-center gap-2 text-sm">
                                                <span
                                                    className="w-3 h-3 rounded-sm flex-shrink-0 border border-border"
                                                    style={{ backgroundColor: cal.color ?? 'transparent' }}
                                                />
                                                <span className="flex-1 min-w-0 truncate" title={cal.id}>
                                                    {cal.name}
                                                    {cal.primary && (
                                                        <span className="ml-1.5 text-[10px] text-text-light">(primary)</span>
                                                    )}
                                                </span>
                                                <span className="w-16 flex justify-center">
                                                    <input
                                                        type="checkbox"
                                                        aria-label={`Show ${cal.name ?? 'calendar'} on the timeline`}
                                                        checked={isOn(cal, 'timeline')}
                                                        onChange={(e) => setSurface(cal, 'timeline', e.target.checked)}
                                                        className="cursor-pointer accent-accent"
                                                    />
                                                </span>
                                                <span className="w-16 flex justify-center">
                                                    <input
                                                        type="checkbox"
                                                        aria-label={`Show ${cal.name ?? 'calendar'} in the calendar view`}
                                                        checked={isOn(cal, 'calendar')}
                                                        onChange={(e) => setSurface(cal, 'calendar', e.target.checked)}
                                                        className="cursor-pointer accent-accent"
                                                    />
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>

                            {/* v7.7: dedicated app-managed calendar for written-back sessions. */}
                            <div className="pt-3 border-t border-border">
                                <label className={`block text-xs font-medium text-text mb-1`} htmlFor="orch-cal-name">
                                    Orchestrate calendar
                                </label>
                                <p className="text-xs text-text-light mb-2">
                                    Sessions are written back to this dedicated calendar (with any No Distraction
                                    blocklist suffix appended). Use <strong>Sync</strong> on the timeline / calendar to push them.
                                </p>
                                <input
                                    id="orch-cal-name"
                                    type="text"
                                    value={nameDraft}
                                    onChange={(e) => setNameDraft(e.target.value)}
                                    onBlur={commitName}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            e.currentTarget.blur();
                                        } else if (e.key === 'Escape') {
                                            setNameDraft(orchestrateName);
                                        }
                                    }}
                                    placeholder="Orchestrate"
                                    className={inputClass}
                                />
                                <div className="mt-2 text-xs">
                                    {!hasCalendarManageScope ? (
                                        <span className="text-amber-600 dark:text-amber-400">
                                            Reconnect to grant calendar-creation access, then the calendar is created automatically.{' '}
                                            <button
                                                type="button"
                                                onClick={() => void connect()}
                                                className="underline hover:text-accent cursor-pointer"
                                            >
                                                Reconnect
                                            </button>
                                        </span>
                                    ) : orchestrateCalendar ? (
                                        <span className="text-success">
                                            Created — “{orchestrateCalendar.name}” is linked.
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    void recreateOrchestrateCalendar(nameDraft.trim() || orchestrateName);
                                                }}
                                                className="ml-2 text-text-light underline hover:text-accent cursor-pointer"
                                            >
                                                Recreate
                                            </button>
                                        </span>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={() => void ensureOrchestrateCalendar(nameDraft.trim() || orchestrateName)}
                                            className="text-accent underline hover:text-accent/80 cursor-pointer"
                                        >
                                            Create the Orchestrate calendar now
                                        </button>
                                    )}
                                </div>
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
