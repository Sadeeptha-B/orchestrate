import { createContext, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useDayPlan } from '../hooks/useDayPlan';
import { SessionExpiredError } from '../lib/identity';
import {
    disconnectGoogle,
    fetchAccessToken,
    fetchConnectionStatus,
    startGoogleLogin,
    type ConnectReturnTarget,
} from '../lib/googleAuth';
import {
    createCalendar,
    createCalendarEvent,
    deleteCalendarEvent,
    GoogleAuthError,
    hasOrchestrateMarker,
    listCalendars,
    listEvents,
    ORCHESTRATE_CALENDAR_DESCRIPTION,
    patchCalendar,
    patchCalendarEvent,
    type CalendarEvent,
    type CalendarEventInput,
    type CalendarEventPatch,
    type CalendarEventResult,
    type GoogleCalendarListEntry,
} from '../lib/googleCalendarApi';
import { isVisibleOnSurface, type CalendarSurface } from '../lib/googleCalendar';
import { useAccountFingerprint, type AccountMismatch } from '../hooks/useAccountFingerprint';
import type { ExternalAccountRef } from '../types';

// ─── Context shapes (mirrors the Todoist data/actions split) ───────────────────

export interface GoogleCalendarDataValue {
    /** The Worker is holding a Google refresh token (i.e. signed in). */
    isConnected: boolean;
    /** An interactive connect() is in flight. */
    connecting: boolean;
    /** Most recent request failed auth (expired Access session) — surface a reconnect affordance. */
    authFailed: boolean;
    /** The user's calendars from the Calendar API (for the setup picker). */
    availableCalendars: GoogleCalendarListEntry[];
    /** v7.7: the granted OAuth scope includes calendar creation (calendar.app.created / calendar).
     *  When false while connected, the user must reconnect to enable the Orchestrate calendar. */
    hasCalendarManageScope: boolean;
    /** v7.11: the connected Google account differs from the account this store's calendar
     *  references were minted against (`settings.googleAccount`) — the settings-prune and the
     *  Orchestrate-calendar auto-provision are gated off while set. The live identity is the
     *  primary calendar's id (which is the account email). */
    accountMismatch: AccountMismatch | null;
    error: string | null;
}

export interface GoogleCalendarActionsValue {
    /** Begin interactive consent (navigates to Google). `returnTo` picks where the callback lands. */
    connect: (returnTo?: ConnectReturnTarget) => Promise<void>;
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
    /** v7.11: stamp the currently connected Google account as this store's fingerprint, clearing
     *  the mismatch gate; the normal prune/provision machinery then resumes on the new account. */
    adoptCurrentAccount: () => void;
}

const GoogleCalendarDataContext = createContext<GoogleCalendarDataValue | null>(null);
const GoogleCalendarActionsContext = createContext<GoogleCalendarActionsValue | null>(null);

export { GoogleCalendarDataContext, GoogleCalendarActionsContext };

// ─── Provider ──────────────────────────────────────────────────────────────────

const EXPIRY_SKEW_MS = 60_000; // refresh a minute before the cached access token expires

export function GoogleCalendarProvider({ children }: { children: ReactNode }) {
    const { dispatch, settings } = useDayPlan();

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

    const calendarSettingsRef = useRef({
        googleCalendarIds: settings.googleCalendarIds,
        orchestrateCalendarId: settings.orchestrateCalendarId,
        googleAccount: settings.googleAccount,
    });
    useEffect(() => {
        calendarSettingsRef.current = {
            googleCalendarIds: settings.googleCalendarIds,
            orchestrateCalendarId: settings.orchestrateCalendarId,
            googleAccount: settings.googleAccount,
        };
    }, [settings.googleCalendarIds, settings.orchestrateCalendarId, settings.googleAccount]);

    // ── v7.11: account provenance — the shared stamp/compare/adopt cycle lives in
    // useAccountFingerprint. The live identity is the primary calendar's id (= the account
    // email); it exists exactly when the calendar list has loaded, so there is no separate
    // async "resolved" state. A mismatch gates the prune + auto-provision writers below.
    const currentAccount = useMemo<ExternalAccountRef | null>(() => {
        const primary = availableCalendars.find((c) => c.primary);
        return primary ? { id: primary.id, email: primary.id } : null;
    }, [availableCalendars]);
    const { mismatch: accountMismatch, adoptCurrentAccount } = useAccountFingerprint({
        key: 'googleAccount',
        current: currentAccount,
        resolved: currentAccount !== null,
        connected: isConnected,
    });

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
        if (e instanceof SessionExpiredError) {
            console.error('[GCal] session expired:', e);
            setAuthFailed(true);
            setError('Your session expired — reload the page to sign in again.');
            return;
        }
        console.error(`[GCal] ${fallback}:`, e);
        setError(e instanceof Error ? e.message : fallback);
    }, []);

    const applyDisconnectedState = useCallback((opts?: { clearError?: boolean; clearAuthFailed?: boolean }) => {
        tokenRef.current = null;
        setConnecting(false);
        setIsConnected(false);
        setAvailableCalendars([]);
        setGrantedScope(null);
        if (opts?.clearAuthFailed ?? true) setAuthFailed(false);
        if (opts?.clearError ?? true) setError(null);
        if (connectedFlagRef.current) {
            connectedFlagRef.current = false;
            dispatch({ type: 'UPDATE_SETTINGS', settings: { googleCalendarConnected: false } });
        }
    }, [dispatch]);

    const reconcileCalendarSettings = useCallback((calendars: GoogleCalendarListEntry[]) => {
        // v7.11 provenance gate: never prune stored calendar references against an account they
        // weren't minted in — an imported/foreign store would otherwise have its ids silently
        // stripped and replaced by fresh provisioning. (Computed from the passed list + ref, since
        // this runs with the fresh fetch before state settles.)
        const primary = calendars.find((c) => c.primary);
        const storedAccount = calendarSettingsRef.current.googleAccount;
        if (primary && storedAccount && storedAccount.id !== primary.id) return;

        const currentSelections = calendarSettingsRef.current.googleCalendarIds ?? [];
        const availableIds = new Set(calendars.map((cal) => cal.id));
        const nextSelections = currentSelections.filter((entry) => availableIds.has(entry.id));
        const nextOrchestrateId = calendarSettingsRef.current.orchestrateCalendarId;
        const hasOrchestrateId = typeof nextOrchestrateId === 'string' && nextOrchestrateId.length > 0;
        const keepOrchestrateId = hasOrchestrateId && availableIds.has(nextOrchestrateId);

        if (nextSelections.length === currentSelections.length && (keepOrchestrateId || !hasOrchestrateId)) {
            return;
        }

        dispatch({
            type: 'UPDATE_SETTINGS',
            settings: {
                googleCalendarIds: nextSelections.length > 0 ? nextSelections : undefined,
                orchestrateCalendarId: keepOrchestrateId ? nextOrchestrateId : undefined,
            },
        });
    }, [dispatch]);

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
                if (out.reason === 'unauthorized') {
                    tokenRef.current = null;
                    setIsConnected(false);
                    setAuthFailed(true);
                    setError('Your session expired — reload the page to sign in again.');
                } else if (out.reason === 'not_connected') {
                    applyDisconnectedState({ clearError: false });
                } else if (out.reason === 'error') {
                    tokenRef.current = null;
                    setIsConnected(false);
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
    }, [applyDisconnectedState]);

    const refreshCalendars = useCallback(async () => {
        const token = await getAccessToken();
        if (!token) return;
        try {
            const cals = await listCalendars(token);
            setAvailableCalendars(cals);
            reconcileCalendarSettings(cals);
            setError(null);
        } catch (e) {
            handleError(e, 'Failed to list calendars');
        }
    }, [getAccessToken, handleError, reconcileCalendarSettings]);

    const checkConnection = useCallback(async () => {
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
            } else {
                // Server has no refresh token. Clear the derived state so stale calendar metadata
                // does not survive a revoke or out-of-band disconnect.
                applyDisconnectedState({ clearError: false });
            }
        } catch (e) {
            handleError(e, 'Failed to check Google connection');
        }
    }, [dispatch, refreshCalendars, handleError, applyDisconnectedState]);

    const connect = useCallback(async (returnTo: ConnectReturnTarget = 'settings') => {
        setConnecting(true);
        setError(null);
        try {
            // Navigates the browser to Google's consent screen; nothing after this runs on success.
            await startGoogleLogin(returnTo);
        } catch (e) {
            setConnecting(false);
            handleError(e, 'Failed to start Google sign-in');
        }
    }, [handleError]);

    const disconnect = useCallback(async () => {
        try {
            await disconnectGoogle();
        } catch (e) {
            handleError(e, 'Failed to disconnect Google Calendar');
            return;
        }

        applyDisconnectedState();
    }, [handleError, applyDisconnectedState]);

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
                // v7.11 adoption ladder: stored id (above) → marker-carrying writable calendar →
                // same-named writable calendar → create fresh (needs the calendar.app.created
                // scope). The durable description marker IS the calendar's identity, so it
                // outranks a name match: a renamed Orchestrate calendar must win over a
                // coincidentally "Orchestrate"-named calendar the app never managed (adopting
                // the latter would double-stamp the marker and split the singleton). Name-only
                // matching remains the rung for pre-marker calendars.
                const isWritable = (c: GoogleCalendarListEntry) =>
                    c.accessRole === 'owner' || c.accessRole === 'writer';
                const byMarker = forceCreate
                    ? undefined
                    : availableCalendars.find((c) => hasOrchestrateMarker(c) && isWritable(c));
                const byName = forceCreate || byMarker
                    ? undefined
                    : availableCalendars.find((c) => c.name === name && isWritable(c));
                const match = byMarker ?? byName;
                const id = match?.id ?? (await createCalendar(token, name)).id;
                // Backfill the durable marker onto adopted calendars that predate it (created ones
                // carry it from birth). Best-effort: metadata patches on a calendar the app didn't
                // create can be denied under the narrow calendar.app.created scope.
                if (match && !hasOrchestrateMarker(match)) {
                    try {
                        await patchCalendar(token, match.id, { description: ORCHESTRATE_CALENDAR_DESCRIPTION });
                    } catch (e) {
                        console.warn('[GCal] could not stamp the managed-calendar marker:', e);
                    }
                }
                dispatch({
                    type: 'UPDATE_SETTINGS',
                    settings: {
                        orchestrateCalendarId: id,
                        // Marker adoption under a different name means the calendar was renamed
                        // elsewhere — the live name is the user's latest intent, so adopt it
                        // rather than renaming the calendar back to this store's stale default.
                        ...(byMarker && byMarker.name !== name
                            ? { orchestrateCalendarName: byMarker.name }
                            : {}),
                    },
                });
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
            // v7.11: the rename also (re-)stamps the durable marker description, backfilling
            // calendars that predate it.
            const token = await getAccessToken();
            if (!token) return id;
            try {
                await patchCalendar(token, id, { summary: name, description: ORCHESTRATE_CALENDAR_DESCRIPTION });
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

    // On load: ask the Worker whether this user's refresh token is held (auto-reconnect).
    useEffect(() => {
        void checkConnection();
    }, [checkConnection]);

    // v7.7: once connected with the creation scope, provision the Orchestrate calendar if missing.
    // Waits for the calendar list (so same-named reuse works) and skips when already provisioned.
    // v7.11: gated on account mismatch — never auto-create a calendar in an account the store's
    // references weren't minted against.
    const ensuringRef = useRef(false);
    useEffect(() => {
        if (!isConnected || !hasCalendarManageScope || availableCalendars.length === 0) return;
        if (accountMismatch) return;
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
        accountMismatch,
        settings.orchestrateCalendarId,
        settings.orchestrateCalendarName,
        ensureOrchestrateCalendar,
    ]);

    // v7.11: backfill the durable marker onto the *linked* calendar when it predates it — the
    // provisioning ladder only touches id-less stores, so without this a long-provisioned
    // calendar would carry no marker until its next rename. Once per session; best-effort
    // (metadata patches can be denied under the narrow calendar.app.created scope).
    const markerBackfillRef = useRef(false);
    useEffect(() => {
        if (markerBackfillRef.current) return;
        if (!isConnected || accountMismatch) return;
        const id = settings.orchestrateCalendarId;
        if (!id) return;
        const linked = availableCalendars.find((c) => c.id === id);
        if (!linked || hasOrchestrateMarker(linked)) return;
        markerBackfillRef.current = true;
        void (async () => {
            const token = await getAccessToken();
            if (!token) return;
            try {
                await patchCalendar(token, id, { description: ORCHESTRATE_CALENDAR_DESCRIPTION });
                await refreshCalendars();
            } catch (e) {
                console.warn('[GCal] could not stamp the managed-calendar marker:', e);
            }
        })();
    }, [isConnected, accountMismatch, settings.orchestrateCalendarId, availableCalendars, getAccessToken, refreshCalendars]);

    const dataValue = useMemo<GoogleCalendarDataValue>(
        () => ({ isConnected, connecting, authFailed, availableCalendars, hasCalendarManageScope, accountMismatch, error }),
        [isConnected, connecting, authFailed, availableCalendars, hasCalendarManageScope, accountMismatch, error],
    );

    const actionsValue = useMemo<GoogleCalendarActionsValue>(
        () => ({
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
            adoptCurrentAccount,
        }),
        [
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
            adoptCurrentAccount,
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
