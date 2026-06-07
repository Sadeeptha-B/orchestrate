// POST /api/todoist-auth/token  { token }
// Guarded by the shared secret. Validates the Todoist personal token (against the projects endpoint)
// and, if valid, stores it in Workers KV. The token never round-trips back to the browser afterward.

import { KV_TODOIST_TOKEN, TODOIST_API, type TodoistEnv, json, requireAppSecret } from '../../_shared';

export const onRequestPost: PagesFunction<TodoistEnv> = async ({ request, env }) => {
    const authError = requireAppSecret(request, env);
    if (authError) return authError;

    let token = '';
    try {
        token = ((await request.json()) as { token?: string }).token?.trim() ?? '';
    } catch {
        // non-JSON body
    }
    if (!token) return json({ error: 'missing_token' }, 400);

    let res: Response;
    try {
        res = await fetch(`${TODOIST_API}/api/v1/projects`, {
            headers: { Authorization: `Bearer ${token}` },
        });
    } catch {
        return json({ error: 'todoist_unreachable' }, 502);
    }
    if (res.status === 401 || res.status === 403) return json({ error: 'invalid_token' }, 400);
    if (!res.ok) return json({ error: 'todoist_unreachable' }, 502);

    try {
        await env.OAUTH_KV.put(KV_TODOIST_TOKEN, token);
    } catch {
        return json({ error: 'storage_unavailable' }, 503);
    }
    return json({ ok: true });
};
