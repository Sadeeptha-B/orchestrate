// POST /api/todoist-auth/disconnect
// Identity-guarded. Clears the caller's stored Todoist token from KV. (Todoist personal tokens
// have no revoke endpoint — the user revokes from Todoist's Developer settings if desired.)

import { type TodoistEnv, json, requireUser, todoistTokenKey } from '../../_shared';

export const onRequestPost: PagesFunction<TodoistEnv> = async ({ request, env }) => {
    const auth = await requireUser(request, env);
    if (auth instanceof Response) return auth;

    try {
        await env.OAUTH_KV.delete(todoistTokenKey(auth.email));
    } catch {
        return json({ error: 'storage_unavailable' }, 503);
    }
    return json({ ok: true });
};
