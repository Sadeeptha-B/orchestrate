// Todoist client config + connection management.
//
// All Todoist traffic goes through the same-origin Cloudflare Pages Function at /api/todoist/*, which
// injects the caller's personal token (held server-side in Workers KV, per user) — so the token never
// lives in the browser. Requests are authenticated by the Cloudflare Access session cookie. This
// works in dev only under `wrangler pages dev`; plain `npm run dev` doesn't run Functions (see
// deployment.md Part D).

import { apiFetch } from './identity';

/** Same-origin proxy base (dev + prod). The proxy forwards to https://api.todoist.com/api/v1. */
export const API_BASE = '/api/todoist/api/v1';

const AUTH_BASE = '/api/todoist-auth';

/** Thrown on HTTP 401 (no stored Todoist token, or it was rejected) so callers can route to a re-auth banner. */
export class TodoistAuthError extends Error {
    readonly status = 401;
    constructor() {
        super('Todoist authentication failed');
        this.name = 'TodoistAuthError';
    }
}

/** Whether the Worker is holding a Todoist token (i.e. connected). Throws `TodoistAuthError` on 401. */
export async function getTodoistStatus(): Promise<{ configured: boolean }> {
    const res = await apiFetch(`${AUTH_BASE}/status`);
    if (res.status === 401) throw new TodoistAuthError();
    if (!res.ok) throw new Error(`Todoist status check failed (${res.status})`);
    return res.json();
}

/** Validate + store a Todoist token server-side. Returns `{ ok }` or an error code (`invalid_token` | …). */
export async function storeTodoistToken(token: string): Promise<{ ok: boolean; error?: string }> {
    const res = await apiFetch(`${AUTH_BASE}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
    });
    if (res.status === 401) return { ok: false, error: 'unauthorized' };
    if (!res.ok) {
        let error = 'request_failed';
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
export async function disconnectTodoist(): Promise<{ ok: boolean; error?: string }> {
    const res = await apiFetch(`${AUTH_BASE}/disconnect`, { method: 'POST' });
    if (res.status === 401) return { ok: false, error: 'unauthorized' };
    if (!res.ok) {
        let error = 'disconnect_failed';
        try {
            error = ((await res.json()) as { error?: string }).error ?? error;
        } catch {
            // non-JSON error
        }
        return { ok: false, error };
    }
    return { ok: true };
}
