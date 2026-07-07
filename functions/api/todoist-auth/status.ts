// GET /api/todoist-auth/status
// Identity-guarded. Reports whether the caller's Todoist token is held in KV (drives isConfigured).

import { type TodoistEnv, json, requireUser, todoistTokenKey } from '../../_shared';

export const onRequestGet: PagesFunction<TodoistEnv> = async ({ request, env }) => {
    const auth = await requireUser(request, env);
    if (auth instanceof Response) return auth;

    let token: string | null;
    try {
        token = await env.OAUTH_KV.get(todoistTokenKey(auth.email));
    } catch {
        return json({ error: 'storage_unavailable' }, 503);
    }
    return json({ configured: Boolean(token) });
};
