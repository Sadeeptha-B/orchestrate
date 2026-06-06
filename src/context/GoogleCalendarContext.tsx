import { createContext, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useDayPlan } from '../hooks/useDayPlan';
import { isGoogleConfigured, requestToken, revokeToken } from '../lib/googleAuth';
import {
    createCalendarEvent,
    GoogleAuthError,
    listCalendars,
    type CalendarEventInput,
    type CalendarEventResult,
    type GoogleCalendarListEntry,
} from '../lib/googleCalendarApi';

// ─── Context shapes (mirrors the Todoist data/actions split) ───────────────────

export interface GoogleCalendarDataValue {
    /** Build-time client ID present. When false, the UI shows a "not configured" note. */
    isConfigured: boolean;
    /** A live, non-expired access token is held in memory. */
    isConnected: boolean;
    /** An interactive connect() is in flight. */
    connecting: boolean;
    /** Most recent token request / API call failed auth — surface a reconnect affordance. */
    authFailed: boolean;
    /** The user's calendars from the Calendar API (for the setup picker). */
    availableCalendars: GoogleCalendarListEntry[];
    error: string | null;
}

export interface GoogleCalendarActionsValue {
    /** Interactive consent/token request (call from a user gesture). */
    connect: () => Promise<void>;
    /** Revoke + clear in-memory token and the connected flag. */
    disconnect: () => Promise<void>;
    /** Re-fetch the calendar list (silently refreshes the token if needed). */
    refreshCalendars: () => Promise<void>;
    /** Write plumbing: create an event. Returns null on failure (logged + authFailed routed). */
    createEvent: (calendarId: string, event: CalendarEventInput) => Promise<CalendarEventResult | null>;
}

const GoogleCalendarDataContext = createContext<GoogleCalendarDataValue | null>(null);
const GoogleCalendarActionsContext = createContext<GoogleCalendarActionsValue | null>(null);

export { GoogleCalendarDataContext, GoogleCalendarActionsContext };

// ─── Provider ──────────────────────────────────────────────────────────────────

const EXPIRY_SKEW_MS = 60_000; // refresh a minute before the token actually expires

export function GoogleCalendarProvider({ children }: { children: ReactNode }) {
    const { settings, dispatch } = useDayPlan();

    const isConfigured = isGoogleConfigured();

    const [isConnected, setIsConnected] = useState(false);
    const [connecting, setConnecting] = useState(false);
    const [authFailed, setAuthFailed] = useState(false);
    const [availableCalendars, setAvailableCalendars] = useState<GoogleCalendarListEntry[]>([]);
    const [error, setError] = useState<string | null>(null);

    // In-memory token only — never persisted, never encrypted (expires within the hour).
    const tokenRef = useRef<{ accessToken: string; expiresAt: number } | null>(null);
    // Dedup concurrent silent refreshes (GIS allows only one token request in flight).
    const refreshInflight = useRef<Promise<string | null> | null>(null);

    const handleError = useCallback((e: unknown, fallback: string) => {
        if (e instanceof GoogleAuthError) {
            console.error('[GCal] auth failed (401):', e);
            setAuthFailed(true);
            setError('Google Calendar authentication failed — reconnect in Settings.');
            return;
        }
        console.error(`[GCal] ${fallback}:`, e);
        setError(e instanceof Error ? e.message : fallback);
    }, []);

    /** Return a valid access token, silently refreshing via `prompt: 'none'` when expired/missing. */
    const getAccessToken = useCallback(async (): Promise<string | null> => {
        const current = tokenRef.current;
        if (current && current.expiresAt - Date.now() > EXPIRY_SKEW_MS) return current.accessToken;
        if (refreshInflight.current) return refreshInflight.current;

        const promise = (async () => {
            try {
                const res = await requestToken('none');
                tokenRef.current = { accessToken: res.accessToken, expiresAt: Date.now() + res.expiresInSec * 1000 };
                setAuthFailed(false);
                setIsConnected(true);
                return res.accessToken;
            } catch (e) {
                console.error('[GCal] silent token refresh failed:', e);
                tokenRef.current = null;
                setIsConnected(false);
                setAuthFailed(true);
                return null;
            } finally {
                refreshInflight.current = null;
            }
        })();
        refreshInflight.current = promise;
        return promise;
    }, []);

    const refreshCalendars = useCallback(async () => {
        const token = await getAccessToken();
        if (!token) return;
        try {
            const cals = await listCalendars(token);
            setAvailableCalendars(cals);
            setError(null);
        } catch (e) {
            handleError(e, 'Failed to list calendars');
        }
    }, [getAccessToken, handleError]);

    const connect = useCallback(async () => {
        if (!isConfigured) return;
        setConnecting(true);
        setError(null);
        try {
            // Empty prompt: silent for already-consented users, consent UI on first run.
            const res = await requestToken('');
            tokenRef.current = { accessToken: res.accessToken, expiresAt: Date.now() + res.expiresInSec * 1000 };
            setIsConnected(true);
            setAuthFailed(false);
            dispatch({ type: 'UPDATE_SETTINGS', settings: { googleCalendarConnected: true } });
            // Fetch the calendar list right away for the picker.
            try {
                const cals = await listCalendars(res.accessToken);
                setAvailableCalendars(cals);
            } catch (e) {
                handleError(e, 'Failed to list calendars');
            }
        } catch (e) {
            handleError(e, 'Failed to connect Google Calendar');
            setIsConnected(false);
        } finally {
            setConnecting(false);
        }
    }, [isConfigured, dispatch, handleError]);

    const disconnect = useCallback(async () => {
        const token = tokenRef.current?.accessToken;
        tokenRef.current = null;
        setIsConnected(false);
        setAuthFailed(false);
        setAvailableCalendars([]);
        setError(null);
        dispatch({ type: 'UPDATE_SETTINGS', settings: { googleCalendarConnected: false } });
        if (token) await revokeToken(token);
    }, [dispatch]);

    const createEvent = useCallback(
        async (calendarId: string, event: CalendarEventInput): Promise<CalendarEventResult | null> => {
            const token = await getAccessToken();
            if (!token) return null;
            try {
                return await createCalendarEvent(token, calendarId, event);
            } catch (e) {
                handleError(e, 'Failed to create calendar event');
                return null;
            }
        },
        [getAccessToken, handleError],
    );

    // ── Auto-reconnect on load: if previously connected, silently re-acquire a token ──
    const autoTried = useRef(false);
    useEffect(() => {
        if (autoTried.current) return;
        if (!isConfigured || !settings.googleCalendarConnected) return;
        autoTried.current = true;
        void refreshCalendars();
    }, [isConfigured, settings.googleCalendarConnected, refreshCalendars]);

    const dataValue = useMemo<GoogleCalendarDataValue>(
        () => ({ isConfigured, isConnected, connecting, authFailed, availableCalendars, error }),
        [isConfigured, isConnected, connecting, authFailed, availableCalendars, error],
    );

    const actionsValue = useMemo<GoogleCalendarActionsValue>(
        () => ({ connect, disconnect, refreshCalendars, createEvent }),
        [connect, disconnect, refreshCalendars, createEvent],
    );

    return (
        <GoogleCalendarDataContext.Provider value={dataValue}>
            <GoogleCalendarActionsContext.Provider value={actionsValue}>
                {children}
            </GoogleCalendarActionsContext.Provider>
        </GoogleCalendarDataContext.Provider>
    );
}
