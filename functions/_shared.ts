// Shared helpers for Cloudflare Pages Functions: the single-shared-secret guard + a JSON helper.
//
// Used by the Todoist proxy + token endpoints (functions/api/todoist*). The Google OAuth functions
// predate this module and keep an equivalent copy in api/auth/google/_lib.ts; if that file is ever
// refactored, point it here too. Files prefixed `_` are modules, not routes.

/** Minimal env shape every guarded endpoint needs. */
export interface GuardEnv {
    APP_SHARED_SECRET: string;
}

/** Env for the Todoist proxy + token endpoints (shared secret guard + the KV holding the token). */
export interface TodoistEnv extends GuardEnv {
    OAUTH_KV: KVNamespace;
}

/** Env for the state-sync endpoints (shared secret guard + the D1 slice store). */
export interface StateEnv extends GuardEnv {
    SYNC_DB: D1Database;
}

/** The four persisted slices synced to D1 (mirror of the localStorage working store). */
export const SYNC_SLICE_KEYS = ['plan', 'settings', 'history', 'life'] as const;
export type SyncSliceKey = (typeof SYNC_SLICE_KEYS)[number];

/** Origin of the Todoist REST/Sync API the proxy forwards to. */
export const TODOIST_API = 'https://api.todoist.com';

/** KV key holding the single user's Todoist personal token. */
export const KV_TODOIST_TOKEN = 'todoist:token';

export function json(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
}

export function hasSharedSecret(env: GuardEnv): boolean {
    return typeof env.APP_SHARED_SECRET === 'string' && env.APP_SHARED_SECRET.length > 0;
}

/** True when the request carries the correct shared secret (X-App-Secret header). */
export function checkSecret(request: Request, env: GuardEnv): boolean {
    const provided = request.headers.get('X-App-Secret') ?? '';
    return provided.length > 0 && hasSharedSecret(env) && provided === env.APP_SHARED_SECRET;
}

export function requireAppSecret(request: Request, env: GuardEnv): Response | null {
    if (!hasSharedSecret(env)) return json({ error: 'server_not_configured' }, 500);
    return checkSecret(request, env) ? null : json({ error: 'unauthorized' }, 401);
}
