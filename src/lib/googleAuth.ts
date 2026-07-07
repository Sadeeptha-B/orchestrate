// Worker-mediated Google OAuth client for the Google Calendar integration.
//
// The Cloudflare Pages Functions under `/api/auth/google` hold the client secret and the long-lived
// refresh token (in Workers KV, namespaced per user); the browser asks the Worker for short-lived
// access tokens on demand. Requests are authenticated by the Cloudflare Access session cookie that
// rides every same-origin fetch — there is no in-app credential. See functions/api/auth/google/_lib.ts
// for the server side.

import { SessionExpiredError, apiFetch } from './identity';

const API_BASE = '/api/auth/google';

export interface ConnectionStatus {
    connected: boolean;
    scope: string | null;
}

/** Where the OAuth callback should land the browser afterwards (allowlisted server-side). */
export type ConnectReturnTarget = 'settings' | 'home';

/** Whether the server currently holds a Google refresh token (i.e. connected). */
export async function fetchConnectionStatus(): Promise<ConnectionStatus> {
    const res = await apiFetch(`${API_BASE}/status`);
    if (res.status === 401) throw new SessionExpiredError();
    if (!res.ok) throw new Error(`Status check failed (${res.status})`);
    return res.json();
}

/** Begin the interactive consent flow: fetch the Google consent URL, then navigate to it. */
export async function startGoogleLogin(returnTo: ConnectReturnTarget = 'settings'): Promise<void> {
    const res = await apiFetch(`${API_BASE}/login?return=${returnTo}`);
    if (res.status === 401) throw new SessionExpiredError();
    if (!res.ok) throw new Error(`Could not start sign-in (${res.status})`);
    const { url } = (await res.json()) as { url: string };
    window.location.href = url;
}

export type AccessTokenOutcome =
    | { ok: true; accessToken: string; expiresInSec: number }
    | { ok: false; reason: 'unauthorized' | 'not_connected' | 'error'; message?: string };

const GOOGLE_DISCONNECT_ERRORS: Record<string, string> = {
    server_not_configured: 'The Cloudflare worker is missing its Google OAuth configuration.',
    storage_unavailable: 'Cloudflare KV is unavailable right now. Please try again shortly.',
    unauthorized: 'Your session expired — reload the page and try again.',
};

/** Ask the Worker for a fresh access token (minted from the server-held refresh token). */
export async function fetchAccessToken(): Promise<AccessTokenOutcome> {
    let res: Response;
    try {
        res = await apiFetch(`${API_BASE}/token`);
    } catch (e) {
        if (e instanceof SessionExpiredError) return { ok: false, reason: 'unauthorized' };
        return { ok: false, reason: 'error', message: e instanceof Error ? e.message : 'Network error' };
    }
    if (res.ok) {
        const data = (await res.json()) as { access_token: string; expires_in: number };
        return { ok: true, accessToken: data.access_token, expiresInSec: data.expires_in };
    }
    let body: { error?: string; connected?: boolean } = {};
    try {
        body = await res.json();
    } catch {
        // non-JSON error
    }
    if (res.status === 401 && body.error === 'unauthorized') return { ok: false, reason: 'unauthorized' };
    if (res.status === 404 || body.connected === false || body.error === 'invalid_grant') {
        return { ok: false, reason: 'not_connected' };
    }
    return { ok: false, reason: 'error', message: body.error };
}

/** Revoke + clear the server-held refresh token. */
export async function disconnectGoogle(): Promise<void> {
    const res = await apiFetch(`${API_BASE}/disconnect`, { method: 'POST' });
    if (res.status === 401) throw new SessionExpiredError();
    if (res.ok) return;

    let error = 'disconnect_failed';
    try {
        error = ((await res.json()) as { error?: string }).error ?? error;
    } catch {
        // non-JSON error
    }
    throw new Error(GOOGLE_DISCONNECT_ERRORS[error] ?? 'Google Calendar could not be disconnected right now.');
}
