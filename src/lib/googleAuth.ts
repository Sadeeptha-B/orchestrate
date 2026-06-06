// Google Identity Services (GIS) token-client wrapper for the Google Calendar integration.
//
// This is the *browser-only* OAuth path (engagement_record_strategy.md option E1): a build-time
// client ID, no client secret, no backend. The GIS token client returns short-lived (~1 hr) access
// tokens directly and *no* refresh token — renewal is just another `requestAccessToken({ prompt })`,
// which is silent for an already-consented user with a live Google session. Tokens are held in
// memory by the caller and never persisted.

/** Scopes: read the user's calendar list (auto-discovery) + read/write events (write plumbing). */
export const GCAL_SCOPES =
    'https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events';

/** OAuth client ID injected at build time. Empty when unconfigured (UI shows a "not configured" note). */
export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';

export function isGoogleConfigured(): boolean {
    return GOOGLE_CLIENT_ID.length > 0;
}

/** `''` → silent for consented users, consent UI on first run (use from a user gesture). `'none'` → never shows UI; errors if interaction would be required (use for silent refresh). */
export type TokenPrompt = '' | 'none' | 'consent' | 'select_account';

export interface TokenResult {
    accessToken: string;
    /** Seconds until the access token expires (Google returns ~3600). */
    expiresInSec: number;
    /** Space-delimited granted scopes. */
    scope: string;
}

// ── Minimal GIS typings (the `google.accounts.oauth2` surface we use) ──

interface GisTokenResponse {
    access_token?: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
    error?: string;
    error_description?: string;
}

interface GisTokenClient {
    requestAccessToken: (overrides?: { prompt?: TokenPrompt }) => void;
}

interface GisOAuth2 {
    initTokenClient: (config: {
        client_id: string;
        scope: string;
        prompt?: TokenPrompt;
        callback: (resp: GisTokenResponse) => void;
        error_callback?: (err: { type?: string; message?: string }) => void;
    }) => GisTokenClient;
    revoke: (accessToken: string, done?: () => void) => void;
}

declare global {
    interface Window {
        google?: { accounts?: { oauth2?: GisOAuth2 } };
    }
}

// ── GIS script readiness ──

let gisPromise: Promise<void> | null = null;

/** Resolves once the async-loaded GIS script has populated `window.google.accounts.oauth2`. */
export function loadGis(): Promise<void> {
    if (gisPromise) return gisPromise;
    gisPromise = new Promise<void>((resolve, reject) => {
        const start = Date.now();
        const check = () => {
            if (window.google?.accounts?.oauth2) return resolve();
            if (Date.now() - start > 10_000) {
                gisPromise = null; // allow a later retry
                return reject(new Error('Google Identity Services failed to load'));
            }
            setTimeout(check, 100);
        };
        check();
    });
    return gisPromise;
}

// ── Token client (one shared client; one request in flight at a time) ──

let tokenClient: GisTokenClient | null = null;
let pending: { resolve: (r: TokenResult) => void; reject: (e: Error) => void } | null = null;

async function ensureClient(): Promise<GisTokenClient> {
    await loadGis();
    if (!isGoogleConfigured()) throw new Error('Google client ID is not configured');
    if (tokenClient) return tokenClient;
    tokenClient = window.google!.accounts!.oauth2!.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: GCAL_SCOPES,
        callback: (resp) => {
            const p = pending;
            pending = null;
            if (!p) return;
            if (resp.error || !resp.access_token) {
                p.reject(new Error(resp.error_description || resp.error || 'Token request failed'));
            } else {
                p.resolve({
                    accessToken: resp.access_token,
                    expiresInSec: resp.expires_in ?? 3600,
                    scope: resp.scope ?? '',
                });
            }
        },
        error_callback: (err) => {
            const p = pending;
            pending = null;
            if (!p) return;
            p.reject(new Error(err?.type || err?.message || 'Token request failed'));
        },
    });
    return tokenClient;
}

/**
 * Request an access token. `prompt: ''` from a user gesture (interactive connect); `prompt: 'none'`
 * for silent refresh / auto-reconnect. Rejects if a request is already in flight.
 */
export async function requestToken(prompt: TokenPrompt): Promise<TokenResult> {
    const client = await ensureClient();
    if (pending) throw new Error('A Google token request is already in progress');
    return new Promise<TokenResult>((resolve, reject) => {
        pending = { resolve, reject };
        client.requestAccessToken({ prompt });
    });
}

/** Revoke an access token (best-effort) on disconnect. */
export async function revokeToken(accessToken: string): Promise<void> {
    try {
        await loadGis();
    } catch {
        return;
    }
    const oauth2 = window.google?.accounts?.oauth2;
    if (!oauth2) return;
    await new Promise<void>((resolve) => oauth2.revoke(accessToken, () => resolve()));
}
