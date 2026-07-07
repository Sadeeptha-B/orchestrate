// The authenticated user, as resolved by Cloudflare Access at the edge.
//
// The browser never authenticates in-app: Access gates the whole origin (Google SSO against the
// email allowlist) and same-origin fetches carry the session cookie automatically. The client's
// only identity jobs are (1) remembering which user this browser profile last synced as — so a
// different account signing in on the same machine doesn't merge into the previous user's
// localStorage (the identity-switch guard in cloudSync) — and (2) detecting an expired Access
// session, which surfaces as an edge redirect to the login page instead of JSON from our API.

const USER_KEY = 'orchestrate-user';

/** The email this browser profile last synced as ('' when never synced). */
export function getStoredUser(): string {
    try {
        return localStorage.getItem(USER_KEY) ?? '';
    } catch {
        return '';
    }
}

export function setStoredUser(email: string): void {
    try {
        if (email) localStorage.setItem(USER_KEY, email.toLowerCase());
        else localStorage.removeItem(USER_KEY);
    } catch {
        // ignore storage failures (private mode, etc.)
    }
}

/** Thrown when a fetch to our API hit the Access login redirect — the session expired. */
export class SessionExpiredError extends Error {
    constructor() {
        super('Your session has expired — reload the page to sign in again.');
        this.name = 'SessionExpiredError';
    }
}

/**
 * fetch() for our same-origin /api/* endpoints, with expired-session detection. Our API never
 * redirects fetches, so `redirect: 'manual'` turns the Access login redirect (the one thing that
 * does) into an unambiguous opaque-redirect response → SessionExpiredError.
 */
export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
    const res = await fetch(input, { ...init, redirect: 'manual' });
    if (res.type === 'opaqueredirect' || res.status === 0) throw new SessionExpiredError();
    return res;
}

/** The authenticated identity, from GET /api/me. Returns null when it can't be resolved. */
export async function fetchIdentity(): Promise<string | null> {
    try {
        const res = await apiFetch('/api/me');
        if (!res.ok) return null;
        const body = (await res.json()) as { email?: string };
        return typeof body.email === 'string' && body.email ? body.email.toLowerCase() : null;
    } catch {
        return null;
    }
}
