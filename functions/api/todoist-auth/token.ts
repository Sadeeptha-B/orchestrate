// POST /api/todoist-auth/token  { token }
// Identity-guarded. Validates the Todoist personal token (against the projects endpoint) and, if
// valid, stores it under the caller's KV key. It never round-trips back to the browser afterward.

import { TODOIST_API, type TodoistEnv, json, requireUser, todoistTokenKey } from '../../_shared';

export const onRequestPost: PagesFunction<TodoistEnv> = async ({ request, env }) => {
    const auth = await requireUser(request, env);
    if (auth instanceof Response) return auth;

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
        await env.OAUTH_KV.put(todoistTokenKey(auth.email), token);
    } catch {
        return json({ error: 'storage_unavailable' }, 503);
    }
    return json({ ok: true });
};
