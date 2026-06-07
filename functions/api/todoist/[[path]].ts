// Catch-all proxy: /api/todoist/* → https://api.todoist.com/*
//
// Guarded by the shared secret. Reads the Todoist personal token from Workers KV and injects it as
// the Authorization header, so the token never reaches the browser (it used to live encrypted-but-
// recoverable in localStorage). The frontend calls this same-origin proxy in both dev and prod.

import { checkSecret, json } from '../../_shared';

interface Env {
    OAUTH_KV: KVNamespace;
    APP_SHARED_SECRET: string;
}

const TODOIST_API = 'https://api.todoist.com';
const KV_TODOIST_TOKEN = 'todoist:token';

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
    if (!checkSecret(request, env)) return json({ error: 'unauthorized' }, 401);

    const token = await env.OAUTH_KV.get(KV_TODOIST_TOKEN);
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
    const upstream = await fetch(target, {
        method: request.method,
        headers,
        body: hasBody ? await request.text() : undefined,
    });

    const respHeaders: Record<string, string> = { 'cache-control': 'no-store' };
    const respContentType = upstream.headers.get('content-type');
    if (respContentType) respHeaders['content-type'] = respContentType;

    if (upstream.status === 204) return new Response(null, { status: 204, headers: respHeaders });
    return new Response(await upstream.text(), { status: upstream.status, headers: respHeaders });
};
