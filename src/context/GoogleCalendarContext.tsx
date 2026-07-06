import { createContext, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useDayPlan } from '../hooks/useDayPlan';
import { useAppSecret } from '../hooks/useAppSecret';
import {
    AppSecretError,
    disconnectGoogle,
    fetchAccessToken,
    fetchConnectionStatus,
    setStoredSecret,
    startGoogleLogin,
} from '../lib/googleAuth';
import {
    createCalendar,
    createCalendarEvent,
    deleteCalendarEvent,
    GoogleAuthError,
    listCalendars,
    listEvents,
    patchCalendar,
    patchCalendarEvent,
    type CalendarEvent,
    type CalendarEventInput,
    type CalendarEventPatch,
    type CalendarEventResult,
    type GoogleCalendarListEntry,
} from '../lib/googleCalendarApi';
import { isVisibleOnSurface, type CalendarSurface } from '../lib/googleCalendar';

// ─── Context shapes (mirrors the Todoist data/actions split) ───────────────────

export interface GoogleCalendarDataValue {
    /** The shared app secret is set. When false, the UI prompts to enter it. */
    isConfigured: boolean;
    /** The Worker is holding a Google refresh token (i.e. signed in). */
    isConnected: boolean;
    /** An interactive connect() is in flight. */
    connecting: boolean;
    /** Most recent request failed auth (bad secret or expired session) — surface a reconnect affordance. */
    authFailed: boolean;
    /** The user's calendars from the Calendar API (for the setup picker). */
    availableCalendars: GoogleCalendarListEntry[];
    /** v7.7: the granted OAuth scope includes calendar creation (calendar.app.created / calendar).
     *  When false while connected, the user must reconnect to enable the Orchestrate calendar. */
    hasCalendarManageScope: boolean;
    error: string | null;
}

export interface GoogleCalendarActionsValue {
    /** Store/replace the shared secret guarding the Worker endpoints, then re-check connection. */
    setAppSecret: (secret: string) => void;
    /** Begin interactive consent (navigates to Google). */
    connect: () => Promise<void>;
    /** Revoke the server-held refresh token + clear local state. */
    disconnect: () => Promise<void>;
    /** Re-check whether the server is connected; refreshes the calendar list when it is. */
    checkConnection: () => Promise<void>;
    /** Re-fetch the calendar list (mints a fresh access token via the Worker). */
    refreshCalendars: () => Promise<void>;
    /** Write plumbing: create an event. Returns null on failure (logged + authFailed routed). */
    createEvent: (calendarId: string, event: CalendarEventInput) => Promise<CalendarEventResult | null>;
    /**
     * Read plumbing: list timed events for a local day ("YYYY-MM-DD") across the calendars visible on
     * the **timeline** surface, each stamped with its calendar's color. Returns [] when not connected /
     * no timeline-visible calendars.
     */
    listDayEvents: (dateISO: string) => Promise<CalendarEvent[]>;
    /** Like listDayEvents but for an explicit [timeMin, timeMax) range (RFC3339), filtered to the
     *  calendars visible on the given surface (defaults to 'calendar' — the rendered view). */
    listEventsInRange: (timeMinISO: string, timeMaxISO: string, surface?: CalendarSurface) => Promise<CalendarEvent[]>;
    /** Patch an event's time/summary (rendered-view drag/resize + editor). Returns null on failure. */
    patchEvent: (
        calendarId: string,
        eventId: string,
        patch: CalendarEventPatch,
    ) => Promise<CalendarEventResult | null>;
    /** Delete an event (rendered-view editor). Returns true on success. */
    deleteEvent: (calendarId: string, eventId: string) => Promise<boolean>;
    /**
     * v7.7: ensure the app-managed "Orchestrate" calendar exists and return its id (reusing the stored
     * id or a same-named writable calendar, else creating one). Returns null when not connected / no
     * creation scope / on failure. Persists the id into settings.
     */
    ensureOrchestrateCalendar: (name: string) => Promise<string | null>;
    /** Force creation of a fresh app-managed calendar, ignoring the stored id / same-named reuse. */
    recreateOrchestrateCalendar: (name: string) => Promise<string | null>;
    /**
     * v7.8: persist a new Orchestrate calendar name and reconcile it with Google. When a calendar is
     * already linked, this **always renames that calendar in place** (`patchCalendar`) — it never
     * switches to another same-named calendar (same-named *reuse* is a creation-time concern only).
     * When nothing is linked yet, it just stores the name (used as the default at creation). Returns
     * the linked id (or null).
     */
    renameOrchestrateCalendar: (name: string) => Promise<string | null>;
}

const GoogleCalendarDataContext = createContext<GoogleCalendarDataValue | null>(null);
const GoogleCalendarActionsContext = createContext<GoogleCalendarActionsValue | null>(null);

export { GoogleCalendarDataContext, GoogleCalendarActionsContext };

// ─── Provider ──────────────────────────────────────────────────────────────────

const EXPIRY_SKEW_MS = 60_000; // refresh a minute before the cached access token expires

export function GoogleCalendarProvider({ children }: { children: ReactNode }) {
    const { dispatch, settings } = useDayPlan();
    const { secret, hasSecret: isConfigured } = useAppSecret();

    const [isConnected, setIsConnected] = useState(false);
    const [connecting, setConnecting] = useState(false);
    const [authFailed, setAuthFailed] = useState(false);
    const [availableCalendars, setAvailableCalendars] = useState<GoogleCalendarListEntry[]>([]);
    const [grantedScope, setGrantedScope] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    // v7.7: does the granted scope allow creating/managing the app's own calendar?
    const hasCalendarManageScope = useMemo(() => {
        const scopes = (grantedScope ?? '').split(/\s+/);
        return scopes.includes('https://www.googleapis.com/auth/calendar')
            || scopes.includes('https://www.googleapis.com/auth/calendar.app.created');
    }, [grantedScope]);

    // Mirror the persisted connected flag in a ref so checkConnection can skip a redundant
    // UPDATE_SETTINGS (and its localStorage write) when the value hasn't actually changed —
    // without taking `settings` as a dep, which would re-fire the auto-check effect.
    const connectedFlagRef = useRef(settings.googleCalendarConnected);
    useEffect(() => {
        connectedFlagRef.current = settings.googleCalendarConnected;
    }, [settings.googleCalendarConnected]);

    // In-memory access-token cache (the refresh token lives server-side; this is just a short-lived
    // access token, re-minted by the Worker).
    const tokenRef = useRef<{ accessToken: string; expiresAt: number } | null>(null);
    // Dedup concurrent token fetches.
    const refreshInflight = useRef<Promise<string | null> | null>(null);

    const handleError = useCallback((e: unknown, fallback: string) => {
        if (e instanceof GoogleAuthError) {
            console.error('[GCal] calendar API auth failed (401):', e);
            setAuthFailed(true);
            setError('Google Calendar authentication failed — reconnect in Settings.');
            return;
        }
        if (e instanceof AppSecretError) {
            console.error('[GCal] app secret rejected:', e);
            setAuthFailed(true);
            setError('App secret was rejected — re-enter it in Settings.');
            return;
        }
        console.error(`[GCal] ${fallback}:`, e);
        setError(e instanceof Error ? e.message : fallback);
    }, []);

    /** Return a valid access token from the Worker, caching it in memory until near expiry. */
    const getAccessToken = useCallback(async (): Promise<string | null> => {
        const current = tokenRef.current;
        if (current && current.expiresAt - Date.now() > EXPIRY_SKEW_MS) return current.accessToken;
        if (refreshInflight.current) return refreshInflight.current;

        const promise = (async () => {
            try {
                const out = await fetchAccessToken();
                if (out.ok) {
                    tokenRef.current = { accessToken: out.accessToken, expiresAt: Date.now() + out.expiresInSec * 1000 };
                    setAuthFailed(false);
                    setIsConnected(true);
                    return out.accessToken;
                }
                tokenRef.current = null;
                setIsConnected(false);
                if (out.reason === 'unauthorized') {
                    setAuthFailed(true);
                    setError('App secret was rejected — re-enter it in Settings.');
                } else if (out.reason === 'error') {
                    setError(out.message ?? 'Failed to get a Google access token');
                }
                // 'not_connected' is a normal signed-out state — no error surfaced.
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

    const checkConnection = useCallback(async () => {
        if (!isConfigured) return;
        try {
            const status = await fetchConnectionStatus();
            setIsConnected(status.connected);
            setGrantedScope(status.scope);
            if (status.connected) {
                setAuthFailed(false);
                if (!connectedFlagRef.current) {
                    dispatch({ type: 'UPDATE_SETTINGS', settings: { googleCalendarConnected: true } });
                }
                await refreshCalendars();
            } else if (connectedFlagRef.current) {
                // Server has no refresh token (revoked / expired). Clear the persisted flag so the
                // app's state matches reality and auto-reconnect stops re-checking on every load.
                dispatch({ type: 'UPDATE_SETTINGS', settings: { googleCalendarConnected: false } });
            }
        } catch (e) {
            handleError(e, 'Failed to check Google connection');
        }
    }, [dispatch, isConfigured, refreshCalendars, handleError]);

    const setAppSecret = useCallback(
        (secret: string) => {
            setStoredSecret(secret);
            setError(null);
            setAuthFailed(false);
            tokenRef.current = null;
        },
        [],
    );

    const connect = useCallback(async () => {
        if (!isConfigured) return;
        setConnecting(true);
        setError(null);
        try {
            // Navigates the browser to Google's consent screen; nothing after this runs on success.
            await startGoogleLogin();
        } catch (e) {
            setConnecting(false);
            handleError(e, 'Failed to start Google sign-in');
        }
    }, [handleError, isConfigured]);

    const disconnect = useCallback(async () => {
        tokenRef.current = null;
        setIsConnected(false);
        setAuthFailed(false);
        setAvailableCalendars([]);
        setGrantedScope(null);
        setError(null);
        dispatch({ type: 'UPDATE_SETTINGS', settings: { googleCalendarConnected: false } });
        await disconnectGoogle();
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

    const listEventsInRange = useCallback(
        async (timeMinISO: string, timeMaxISO: string, surface: CalendarSurface = 'calendar'): Promise<CalendarEvent[]> => {
            const calendars = (settings.googleCalendarIds ?? []).filter((c) => isVisibleOnSurface(c, surface));
            if (calendars.length === 0) return [];
            const token = await getAccessToken();
            if (!token) return [];
            try {
                const perCalendar = await Promise.all(
                    calendars.map(async (cal) => {
                        const events = await listEvents(token, cal.id, timeMinISO, timeMaxISO);
                        return events.map((e) => ({ ...e, color: cal.color }));
                    }),
                );
                setError(null);
                return perCalendar.flat();
            } catch (e) {
                handleError(e, 'Failed to list calendar events');
                return [];
            }
        },
        [settings.googleCalendarIds, getAccessToken, handleError],
    );

    const listDayEvents = useCallback(
        (dateISO: string): Promise<CalendarEvent[]> => {
            // Local day bounds → RFC3339 (UTC). `new Date("YYYY-MM-DDT00:00:00")` is parsed as local time.
            const dayStart = new Date(`${dateISO}T00:00:00`);
            const dayEnd = new Date(dayStart);
            dayEnd.setDate(dayEnd.getDate() + 1);
            return listEventsInRange(dayStart.toISOString(), dayEnd.toISOString(), 'timeline');
        },
        [listEventsInRange],
    );

    const patchEvent = useCallback(
        async (
            calendarId: string,
            eventId: string,
            patch: CalendarEventPatch,
        ): Promise<CalendarEventResult | null> => {
            const token = await getAccessToken();
            if (!token) return null;
            try {
                return await patchCalendarEvent(token, calendarId, eventId, patch);
            } catch (e) {
                handleError(e, 'Failed to update calendar event');
                return null;
            }
        },
        [getAccessToken, handleError],
    );

    const deleteEvent = useCallback(
        async (calendarId: string, eventId: string): Promise<boolean> => {
            const token = await getAccessToken();
            if (!token) return false;
            try {
                await deleteCalendarEvent(token, calendarId, eventId);
                return true;
            } catch (e) {
                handleError(e, 'Failed to delete calendar event');
                return false;
            }
        },
        [getAccessToken, handleError],
    );

    const provisionOrchestrateCalendar = useCallback(
        async (name: string, forceCreate: boolean): Promise<string | null> => {
            // Already provisioned and still present in the account → reuse.
            const existingId = settings.orchestrateCalendarId;
            if (!forceCreate && existingId && availableCalendars.some((c) => c.id === existingId)) return existingId;
            const token = await getAccessToken();
            if (!token) return null;
            try {
                // Reuse a same-named writable calendar (avoids duplicates across reconnects/devices),
                // else create a fresh secondary calendar (needs the calendar.app.created scope).
                const match = forceCreate
                    ? undefined
                    : availableCalendars.find(
                        (c) => c.name === name && (c.accessRole === 'owner' || c.accessRole === 'writer'),
                    );
                const id = match?.id ?? (await createCalendar(token, name)).id;
                dispatch({ type: 'UPDATE_SETTINGS', settings: { orchestrateCalendarId: id } });
                await refreshCalendars();
                return id;
            } catch (e) {
                handleError(e, 'Failed to create the Orchestrate calendar');
                return null;
            }
        },
        [settings.orchestrateCalendarId, availableCalendars, getAccessToken, dispatch, refreshCalendars, handleError],
    );

    const ensureOrchestrateCalendar = useCallback(
        (name: string): Promise<string | null> => provisionOrchestrateCalendar(name, false),
        [provisionOrchestrateCalendar],
    );

    const recreateOrchestrateCalendar = useCallback(
        (name: string): Promise<string | null> => provisionOrchestrateCalendar(name, true),
        [provisionOrchestrateCalendar],
    );

    const renameOrchestrateCalendar = useCallback(
        async (rawName: string): Promise<string | null> => {
            const name = rawName.trim();
            if (!name) return settings.orchestrateCalendarId ?? null;
            // Always persist the chosen name (it's the default at creation time when nothing's linked).
            if (name !== settings.orchestrateCalendarName) {
                dispatch({ type: 'UPDATE_SETTINGS', settings: { orchestrateCalendarName: name } });
            }
            const id = settings.orchestrateCalendarId;
            // Nothing linked yet, or the linked id has vanished → leave provisioning to ensureOrchestrateCalendar.
            if (!id || !availableCalendars.some((c) => c.id === id)) return id ?? null;
            // Already named that → nothing to do against Google.
            if (availableCalendars.find((c) => c.id === id)?.name === name) return id;
            // Always rename the linked calendar in place — never switch to another same-named calendar.
            // (Same-named *reuse* only applies at creation time, in provisionOrchestrateCalendar.)
            const token = await getAccessToken();
            if (!token) return id;
            try {
                await patchCalendar(token, id, name);
                await refreshCalendars();
                return id;
            } catch (e) {
                handleError(e, 'Failed to rename the Orchestrate calendar');
                return id;
            }
        },
        [
            settings.orchestrateCalendarId,
            settings.orchestrateCalendarName,
            availableCalendars,
            dispatch,
            getAccessToken,
            refreshCalendars,
            handleError,
        ],
    );

    useEffect(() => {
        tokenRef.current = null;
        setConnecting(false);
        if (!isConfigured) {
            setIsConnected(false);
            setAuthFailed(false);
            setAvailableCalendars([]);
            return;
        }
        void checkConnection();
    }, [secret, isConfigured, checkConnection]);

    // v7.7: once connected with the creation scope, provision the Orchestrate calendar if missing.
    // Waits for the calendar list (so same-named reuse works) and skips when already provisioned.
    const ensuringRef = useRef(false);
    useEffect(() => {
        if (!isConnected || !hasCalendarManageScope || availableCalendars.length === 0) return;
        const id = settings.orchestrateCalendarId;
        if (id && availableCalendars.some((c) => c.id === id)) return;
        if (ensuringRef.current) return;
        ensuringRef.current = true;
        void ensureOrchestrateCalendar(settings.orchestrateCalendarName ?? 'Orchestrate').finally(() => {
            ensuringRef.current = false;
        });
    }, [
        isConnected,
        hasCalendarManageScope,
        availableCalendars,
        settings.orchestrateCalendarId,
        settings.orchestrateCalendarName,
        ensureOrchestrateCalendar,
    ]);

    const dataValue = useMemo<GoogleCalendarDataValue>(
        () => ({ isConfigured, isConnected, connecting, authFailed, availableCalendars, hasCalendarManageScope, error }),
        [isConfigured, isConnected, connecting, authFailed, availableCalendars, hasCalendarManageScope, error],
    );

    const actionsValue = useMemo<GoogleCalendarActionsValue>(
        () => ({
            setAppSecret,
            connect,
            disconnect,
            checkConnection,
            refreshCalendars,
            createEvent,
            listDayEvents,
            listEventsInRange,
            patchEvent,
            deleteEvent,
            ensureOrchestrateCalendar,
            recreateOrchestrateCalendar,
            renameOrchestrateCalendar,
        }),
        [
            setAppSecret,
            connect,
            disconnect,
            checkConnection,
            refreshCalendars,
            createEvent,
            listDayEvents,
            listEventsInRange,
            patchEvent,
            deleteEvent,
            ensureOrchestrateCalendar,
            recreateOrchestrateCalendar,
            renameOrchestrateCalendar,
        ],
    );

    return (
        <GoogleCalendarDataContext.Provider value={dataValue}>
            <GoogleCalendarActionsContext.Provider value={actionsValue}>
                {children}
            </GoogleCalendarActionsContext.Provider>
        </GoogleCalendarDataContext.Provider>
    );
}
