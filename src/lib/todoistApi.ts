// Todoist client config + connection management.
//
// All Todoist traffic goes through the same-origin Cloudflare Pages Function at /api/todoist/*, which
// injects the personal token (held server-side in Workers KV) — so the token never lives in the
// browser. The browser only sends the shared `X-App-Secret`. This works in dev only under
// `wrangler pages dev`; plain `npm run dev` doesn't run Functions (see deployment.md Part D).

import { getStoredSecret } from './appSecret';

/** Same-origin proxy base (dev + prod). The proxy forwards to https://api.todoist.com/api/v1. */
export const API_BASE = '/api/todoist/api/v1';

const AUTH_BASE = '/api/todoist-auth';

/** Thrown on HTTP 401 (bad app secret, or the stored Todoist token was rejected) so callers can route to a re-auth banner. */
export class TodoistAuthError extends Error {
    readonly status = 401;
    constructor() {
        super('Todoist authentication failed');
        this.name = 'TodoistAuthError';
    }
}

export function appSecretHeaders(extra?: HeadersInit): HeadersInit {
    return { 'X-App-Secret': getStoredSecret(), ...extra };
}

/** Whether the Worker is holding a Todoist token (i.e. connected). Throws `TodoistAuthError` on a bad secret. */
export async function getTodoistStatus(): Promise<{ configured: boolean }> {
    const res = await fetch(`${AUTH_BASE}/status`, { headers: appSecretHeaders() });
    if (res.status === 401) throw new TodoistAuthError();
    if (!res.ok) throw new Error(`Todoist status check failed (${res.status})`);
    return res.json();
}

/** Validate + store a Todoist token server-side. Returns `{ ok }` or an error code (`app_secret` | `invalid_token` | …). */
export async function storeTodoistToken(token: string): Promise<{ ok: boolean; error?: string }> {
    const res = await fetch(`${AUTH_BASE}/token`, {
        method: 'POST',
        headers: appSecretHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ token }),
    });
    if (res.status === 401) return { ok: false, error: 'app_secret' };
    if (!res.ok) {
        let error = 'invalid_token';
        try {
            error = ((await res.json()) as { error?: string }).error ?? error;
        } catch {
            // non-JSON error
        }
        return { ok: false, error };
    }
    return { ok: true };
}

/** Clear the server-held Todoist token (best-effort). */
export async function disconnectTodoist(): Promise<void> {
    try {
        await fetch(`${AUTH_BASE}/disconnect`, { method: 'POST', headers: appSecretHeaders() });
    } catch {
        // best-effort; the UI clears local state regardless
    }
}
