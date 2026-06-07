// POST /api/todoist-auth/token  { token }
// Guarded by the shared secret. Validates the Todoist personal token (against the projects endpoint)
// and, if valid, stores it in Workers KV. The token never round-trips back to the browser afterward.

import { checkSecret, json } from '../../_shared';

interface Env {
    OAUTH_KV: KVNamespace;
    APP_SHARED_SECRET: string;
}

const TODOIST_API = 'https://api.todoist.com';
const KV_TODOIST_TOKEN = 'todoist:token';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
    if (!checkSecret(request, env)) return json({ error: 'unauthorized' }, 401);

    let token = '';
    try {
        token = ((await request.json()) as { token?: string }).token?.trim() ?? '';
    } catch {
        // non-JSON body
    }
    if (!token) return json({ error: 'missing_token' }, 400);

    const res = await fetch(`${TODOIST_API}/api/v1/projects`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return json({ error: 'invalid_token' }, 400);

    await env.OAUTH_KV.put(KV_TODOIST_TOKEN, token);
    return json({ ok: true });
};
