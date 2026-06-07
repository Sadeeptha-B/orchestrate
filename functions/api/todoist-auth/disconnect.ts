// POST /api/todoist-auth/disconnect
// Guarded by the shared secret. Clears the stored Todoist token from KV. (Todoist personal tokens
// have no revoke endpoint — the user revokes from Todoist's Developer settings if desired.)

import { KV_TODOIST_TOKEN, type TodoistEnv, json, requireAppSecret } from '../../_shared';

export const onRequestPost: PagesFunction<TodoistEnv> = async ({ request, env }) => {
    const authError = requireAppSecret(request, env);
    if (authError) return authError;

    try {
        await env.OAUTH_KV.delete(KV_TODOIST_TOKEN);
    } catch {
        return json({ error: 'storage_unavailable' }, 503);
    }
    return json({ ok: true });
};
