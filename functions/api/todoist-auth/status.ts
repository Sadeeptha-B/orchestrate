// GET /api/todoist-auth/status
// Guarded by the shared secret. Reports whether a Todoist token is held in KV (drives isConfigured).

import { KV_TODOIST_TOKEN, type TodoistEnv, json, requireAppSecret } from '../../_shared';

export const onRequestGet: PagesFunction<TodoistEnv> = async ({ request, env }) => {
    const authError = requireAppSecret(request, env);
    if (authError) return authError;

    let token: string | null;
    try {
        token = await env.OAUTH_KV.get(KV_TODOIST_TOKEN);
    } catch {
        return json({ error: 'storage_unavailable' }, 503);
    }
    return json({ configured: Boolean(token) });
};
