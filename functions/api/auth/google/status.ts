// GET /api/auth/google/status
// Guarded by the shared secret. Reports whether a refresh token is held (i.e. connected) and the
// granted scope. Drives the app's auto-reconnect / connected-state on load.

import { checkSecret, isConnected, json, type Env } from './_lib';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
    if (!checkSecret(request, env)) return json({ error: 'unauthorized' }, 401);
    const { connected, scope } = await isConnected(env);
    return json({ connected, scope });
};
