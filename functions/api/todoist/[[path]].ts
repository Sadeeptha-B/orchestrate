// Catch-all proxy: /api/todoist/* → https://api.todoist.com/*
//
// Guarded by the shared secret. Reads the Todoist personal token from Workers KV and injects it as
// the Authorization header, so the token never reaches the browser (it used to live encrypted-but-
// recoverable in localStorage). The frontend calls this same-origin proxy in both dev and prod.

import { KV_TODOIST_TOKEN, TODOIST_API, type TodoistEnv, json, requireAppSecret } from '../../_shared';

export const onRequest: PagesFunction<TodoistEnv> = async ({ request, env }) => {
    const authError = requireAppSecret(request, env);
    if (authError) return authError;

    let token: string | null;
    try {
        token = await env.OAUTH_KV.get(KV_TODOIST_TOKEN);
    } catch {
        return json({ error: 'storage_unavailable' }, 503);
    }
    if (!token) return json({ error: 'not_connected' }, 401);

    // Strip the /api/todoist/ prefix; everything after it is the real Todoist path (e.g. api/v1/tasks).
    const url = new URL(request.url);
    const upstreamPath = url.pathname.replace(/^\/api\/todoist\//, '');
    const target = `${TODOIST_API}/${upstreamPath}${url.search}`;

    const headers = new Headers();
    const contentType = request.headers.get('content-type');
    if (contentType) headers.set('content-type', contentType);
    headers.set('authorization', `Bearer ${token}`);

    const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
    let upstream: Response;
    try {
        upstream = await fetch(target, {
            method: request.method,
            headers,
            body: hasBody ? await request.text() : undefined,
        });
    } catch {
        return json({ error: 'todoist_unreachable' }, 502);
    }

    const respHeaders: Record<string, string> = { 'cache-control': 'no-store' };
    const respContentType = upstream.headers.get('content-type');
    if (respContentType) respHeaders['content-type'] = respContentType;

    if (upstream.status === 204) return new Response(null, { status: 204, headers: respHeaders });
    return new Response(await upstream.text(), { status: upstream.status, headers: respHeaders });
};
