// Worker-mediated Google OAuth client for the Google Calendar integration.
//
// This replaces the browser-only GIS token client (engagement_record_strategy.md option E1) with
// the server-mediated auth-code flow (option E2). The Cloudflare Pages Functions under
// `/api/auth/google` hold the client secret and the long-lived refresh token (in Workers KV); the
// browser only ever holds a single **shared secret** (entered once in Settings) and asks the Worker
// for short-lived access tokens on demand. See functions/api/auth/google/_lib.ts for the server side.

const API_BASE = '/api/auth/google';

/** localStorage key for the single shared secret guarding the Worker endpoints. */
const SECRET_KEY = 'orchestrate-cf-secret';

export function getStoredSecret(): string {
    try {
        return localStorage.getItem(SECRET_KEY) ?? '';
    } catch {
        return '';
    }
}

export function setStoredSecret(secret: string): void {
    try {
        if (secret) localStorage.setItem(SECRET_KEY, secret);
        else localStorage.removeItem(SECRET_KEY);
    } catch {
        // ignore storage failures (private mode, etc.)
    }
}

/** "Configured" now means the shared secret is set (the Worker + client config live server-side). */
export function isGoogleConfigured(): boolean {
    return getStoredSecret().length > 0;
}

function authHeaders(): HeadersInit {
    return { 'X-App-Secret': getStoredSecret() };
}

export interface ConnectionStatus {
    connected: boolean;
    scope: string | null;
}

/** Thrown when the Worker rejects the shared secret (so the UI can prompt to re-enter it). */
export class AppSecretError extends Error {
    constructor() {
        super('The app secret was rejected by the server.');
        this.name = 'AppSecretError';
    }
}

/** Whether the server currently holds a Google refresh token (i.e. connected). */
export async function fetchConnectionStatus(): Promise<ConnectionStatus> {
    const res = await fetch(`${API_BASE}/status`, { headers: authHeaders() });
    if (res.status === 401) throw new AppSecretError();
    if (!res.ok) throw new Error(`Status check failed (${res.status})`);
    return res.json();
}

/** Begin the interactive consent flow: fetch the Google consent URL, then navigate to it. */
export async function startGoogleLogin(): Promise<void> {
    const res = await fetch(`${API_BASE}/login`, { headers: authHeaders() });
    if (res.status === 401) throw new AppSecretError();
    if (!res.ok) throw new Error(`Could not start sign-in (${res.status})`);
    const { url } = (await res.json()) as { url: string };
    window.location.href = url;
}

export type AccessTokenOutcome =
    | { ok: true; accessToken: string; expiresInSec: number }
    | { ok: false; reason: 'unauthorized' | 'not_connected' | 'error'; message?: string };

/** Ask the Worker for a fresh access token (minted from the server-held refresh token). */
export async function fetchAccessToken(): Promise<AccessTokenOutcome> {
    let res: Response;
    try {
        res = await fetch(`${API_BASE}/token`, { headers: authHeaders() });
    } catch (e) {
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
    try {
        await fetch(`${API_BASE}/disconnect`, { method: 'POST', headers: authHeaders() });
    } catch {
        // best-effort; the UI clears local state regardless
    }
}
