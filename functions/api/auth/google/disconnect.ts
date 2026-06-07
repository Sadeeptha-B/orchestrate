// POST /api/auth/google/disconnect
// Guarded by the shared secret. Revokes the refresh token at Google (best-effort) and clears all
// stored token state from KV.

import { checkSecret, clearConnection, json, revokeToken, type Env } from './_lib';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
    if (!checkSecret(request, env)) return json({ error: 'unauthorized' }, 401);
    const refresh = await clearConnection(env);
    if (refresh) await revokeToken(refresh);
    return json({ connected: false });
};
