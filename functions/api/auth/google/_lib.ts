// Shared helpers for the Google Calendar OAuth Pages Functions.
//
// This is the *server-mediated* auth-code flow (engagement_record_strategy.md option E2),
// the successor to the browser-only GIS token client (E1). The Worker holds the client
// secret, performs the code→token exchange, and stores the long-lived refresh token in KV.
// The browser never sees the refresh token — it asks the Worker for a short-lived access
// token on demand. All guarded endpoints require the single shared secret.
//
// Files prefixed with `_` are treated as modules, not routes, by Pages Functions.

import { hasSharedSecret } from '../../../_shared';

export { json, requireAppSecret } from '../../../_shared';

export interface Env {
    /** KV namespace holding the refresh token + cached access token (single user). */
    OAUTH_KV: KVNamespace;
    /** Google OAuth "Web application" client ID. */
    GOOGLE_CLIENT_ID: string;
    /** Google OAuth client secret (server-only — never shipped to the browser). */
    GOOGLE_CLIENT_SECRET: string;
    /** The single shared secret guarding every browser→Worker request + signing OAuth state. */
    APP_SHARED_SECRET: string;
    /** Optional: force the public origin (defaults to the request origin). Must match the
        redirect URI registered in Google Cloud Console. */
    APP_ORIGIN?: string;
}

/**
 * calendarlist.readonly (auto-list calendars) + calendar.events (read/write events on any calendar)
 * + calendar.app.created (v7.7 Phase 3: create + manage the app's own "Orchestrate" calendar). Adding
 * a scope requires the user to reconnect — the flow uses prompt=consent so the new grant is requested.
 */
export const SCOPES =
    'https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.app.created';

const KV_REFRESH = 'google:refresh_token';
const KV_ACCESS = 'google:access_token'; // JSON: { access_token, expires_at }
const KV_SCOPE = 'google:scope';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

const STATE_TTL_SEC = 600; // OAuth state is valid for 10 minutes
const ACCESS_SKEW_MS = 60_000; // refresh a minute before the cached token expires

export class GoogleWorkerError extends Error {
    constructor(
        readonly status: number,
        readonly code: string,
        readonly disconnected = false,
    ) {
        super(code);
        this.name = 'GoogleWorkerError';
    }
}

export function isGoogleWorkerError(error: unknown): error is GoogleWorkerError {
    return error instanceof GoogleWorkerError;
}

function storageUnavailable(): GoogleWorkerError {
    return new GoogleWorkerError(503, 'storage_unavailable');
}

function googleUnreachable(): GoogleWorkerError {
    return new GoogleWorkerError(502, 'google_unreachable');
}

async function kvGet(env: Env, key: string): Promise<string | null> {
    try {
        return await env.OAUTH_KV.get(key);
    } catch {
        throw storageUnavailable();
    }
}

async function kvPut(
    env: Env,
    key: string,
    value: string,
    options?: KVNamespacePutOptions,
): Promise<void> {
    try {
        await env.OAUTH_KV.put(key, value, options);
    } catch {
        throw storageUnavailable();
    }
}

async function kvDelete(env: Env, key: string): Promise<void> {
    try {
        await env.OAUTH_KV.delete(key);
    } catch {
        throw storageUnavailable();
    }
}

export function hasGoogleOAuthConfig(env: Env): boolean {
    return hasSharedSecret(env) && Boolean(env.GOOGLE_CLIENT_ID) && Boolean(env.GOOGLE_CLIENT_SECRET);
}

export function appOrigin(request: Request, env: Env): string {
    return env.APP_ORIGIN || new URL(request.url).origin;
}

export function redirectUri(request: Request, env: Env): string {
    return `${appOrigin(request, env)}/api/auth/google/callback`;
}

// ── HMAC-signed OAuth state (stateless CSRF protection) ──────────────────────

async function hmacKey(secret: string): Promise<CryptoKey> {
    return crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    );
}

function toHex(buf: ArrayBuffer): string {
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sign(secret: string, message: string): Promise<string> {
    const key = await hmacKey(secret);
    return toHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
}

/** Produce a `<ts>.<nonce>.<sig>` state token tied to the shared secret. */
export async function signState(env: Env): Promise<string> {
    const ts = Math.floor(Date.now() / 1000).toString();
    const nonce = toHex(crypto.getRandomValues(new Uint8Array(16)).buffer);
    const sig = await sign(env.APP_SHARED_SECRET, `${ts}.${nonce}`);
    return `${ts}.${nonce}.${sig}`;
}

/** Verify a state token's signature and freshness. */
export async function verifyState(env: Env, state: string | null): Promise<boolean> {
    if (!state) return false;
    const parts = state.split('.');
    if (parts.length !== 3) return false;
    const [ts, nonce, sig] = parts;
    const expected = await sign(env.APP_SHARED_SECRET, `${ts}.${nonce}`);
    if (sig !== expected) return false;
    const age = Math.floor(Date.now() / 1000) - Number(ts);
    return Number.isFinite(age) && age >= 0 && age <= STATE_TTL_SEC;
}

// ── Google authorization URL ─────────────────────────────────────────────────

export function buildAuthUrl(request: Request, env: Env, state: string): string {
    const params = new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        redirect_uri: redirectUri(request, env),
        response_type: 'code',
        scope: SCOPES,
        access_type: 'offline', // ask for a refresh token
        prompt: 'consent', // force a refresh token even on re-consent
        include_granted_scopes: 'true',
        state,
    });
    return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

// ── Token exchange / refresh / revoke ────────────────────────────────────────

interface GoogleTokenResponse {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
}

export async function exchangeCode(
    request: Request,
    env: Env,
    code: string,
): Promise<GoogleTokenResponse> {
    let res: Response;
    try {
        res = await fetch(GOOGLE_TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code,
                client_id: env.GOOGLE_CLIENT_ID,
                client_secret: env.GOOGLE_CLIENT_SECRET,
                redirect_uri: redirectUri(request, env),
                grant_type: 'authorization_code',
            }),
        });
    } catch {
        throw googleUnreachable();
    }
    try {
        return await res.json();
    } catch {
        throw googleUnreachable();
    }
}

async function refreshTokens(env: Env, refreshToken: string): Promise<GoogleTokenResponse> {
    let res: Response;
    try {
        res = await fetch(GOOGLE_TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                refresh_token: refreshToken,
                client_id: env.GOOGLE_CLIENT_ID,
                client_secret: env.GOOGLE_CLIENT_SECRET,
                grant_type: 'refresh_token',
            }),
        });
    } catch {
        throw googleUnreachable();
    }
    try {
        return await res.json();
    } catch {
        throw googleUnreachable();
    }
}

export async function revokeToken(token: string): Promise<void> {
    try {
        await fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(token)}`, { method: 'POST' });
    } catch {
        // Best-effort — local state is cleared regardless.
    }
}

// ── KV-backed token storage ──────────────────────────────────────────────────

export async function storeConnection(env: Env, tokens: GoogleTokenResponse): Promise<void> {
    if (tokens.refresh_token) await kvPut(env, KV_REFRESH, tokens.refresh_token);
    if (tokens.scope) await kvPut(env, KV_SCOPE, tokens.scope);
    if (tokens.access_token && tokens.expires_in) {
        await cacheAccessToken(env, tokens.access_token, tokens.expires_in);
    }
}

async function cacheAccessToken(env: Env, accessToken: string, expiresIn: number): Promise<void> {
    const expiresAt = Date.now() + expiresIn * 1000;
    await kvPut(env, KV_ACCESS, JSON.stringify({ access_token: accessToken, expires_at: expiresAt }), {
        expirationTtl: Math.max(60, expiresIn),
    });
}

export async function isConnected(env: Env): Promise<{ connected: boolean; scope: string | null }> {
    const refresh = await kvGet(env, KV_REFRESH);
    const scope = await kvGet(env, KV_SCOPE);
    return { connected: Boolean(refresh), scope };
}

export type AccessTokenResult =
    | { ok: true; access_token: string; expires_in: number }
    | { ok: false; status: number; error: string; disconnected?: boolean };

/** Return a valid access token, using the KV cache and refreshing via the stored refresh token. */
export async function getAccessToken(env: Env): Promise<AccessTokenResult> {
    const cachedRaw = await kvGet(env, KV_ACCESS);
    if (cachedRaw) {
        try {
            const cached = JSON.parse(cachedRaw) as { access_token: string; expires_at: number };
            if (cached.expires_at - Date.now() > ACCESS_SKEW_MS) {
                return {
                    ok: true,
                    access_token: cached.access_token,
                    expires_in: Math.floor((cached.expires_at - Date.now()) / 1000),
                };
            }
        } catch {
            // fall through to a refresh
        }
    }

    const refresh = await kvGet(env, KV_REFRESH);
    if (!refresh) return { ok: false, status: 404, error: 'not_connected', disconnected: true };

    const tokens = await refreshTokens(env, refresh);
    if (!tokens.access_token || !tokens.expires_in) {
        // invalid_grant ⇒ the refresh token was revoked/expired; clear the connection.
        if (tokens.error === 'invalid_grant') {
            await clearConnection(env);
            return { ok: false, status: 401, error: 'invalid_grant', disconnected: true };
        }
        return { ok: false, status: 502, error: tokens.error || 'refresh_failed' };
    }
    await cacheAccessToken(env, tokens.access_token, tokens.expires_in);
    return { ok: true, access_token: tokens.access_token, expires_in: tokens.expires_in };
}

export async function clearConnection(env: Env): Promise<string | null> {
    const refresh = await kvGet(env, KV_REFRESH);
    await kvDelete(env, KV_REFRESH);
    await kvDelete(env, KV_ACCESS);
    await kvDelete(env, KV_SCOPE);
    return refresh;
}
