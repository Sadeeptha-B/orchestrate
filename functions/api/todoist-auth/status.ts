// GET /api/todoist-auth/status
// Guarded by the shared secret. Reports whether a Todoist token is held in KV (drives isConfigured).

import { checkSecret, json } from '../../_shared';

interface Env {
    OAUTH_KV: KVNamespace;
    APP_SHARED_SECRET: string;
}

const KV_TODOIST_TOKEN = 'todoist:token';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
    if (!checkSecret(request, env)) return json({ error: 'unauthorized' }, 401);
    const token = await env.OAUTH_KV.get(KV_TODOIST_TOKEN);
    return json({ configured: Boolean(token) });
};
