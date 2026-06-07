// POST /api/todoist-auth/disconnect
// Guarded by the shared secret. Clears the stored Todoist token from KV. (Todoist personal tokens
// have no revoke endpoint — the user revokes from Todoist's Developer settings if desired.)

import { checkSecret, json } from '../../_shared';

interface Env {
    OAUTH_KV: KVNamespace;
    APP_SHARED_SECRET: string;
}

const KV_TODOIST_TOKEN = 'todoist:token';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
    if (!checkSecret(request, env)) return json({ error: 'unauthorized' }, 401);
    await env.OAUTH_KV.delete(KV_TODOIST_TOKEN);
    return json({ ok: true });
};
