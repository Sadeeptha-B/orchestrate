// Shared helpers for Cloudflare Pages Functions: the single-shared-secret guard + a JSON helper.
//
// Used by the Todoist proxy + token endpoints (functions/api/todoist*). The Google OAuth functions
// predate this module and keep an equivalent copy in api/auth/google/_lib.ts; if that file is ever
// refactored, point it here too. Files prefixed `_` are modules, not routes.

/** Minimal env shape every guarded endpoint needs. */
export interface GuardEnv {
    APP_SHARED_SECRET: string;
}

export function json(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
}

/** True when the request carries the correct shared secret (X-App-Secret header). */
export function checkSecret(request: Request, env: GuardEnv): boolean {
    const provided = request.headers.get('X-App-Secret') ?? '';
    return provided.length > 0 && provided === env.APP_SHARED_SECRET;
}
