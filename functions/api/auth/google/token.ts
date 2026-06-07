// GET /api/auth/google/token
// Guarded by the shared secret. Returns a short-lived Google access token (from the KV cache or
// minted from the stored refresh token). The browser uses it as a Bearer token against the
// Calendar REST API. The refresh token itself never leaves the Worker.

import { checkSecret, getAccessToken, json, type Env } from './_lib';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
    if (!checkSecret(request, env)) return json({ error: 'unauthorized' }, 401);

    const result = await getAccessToken(env);
    if (!result.ok) {
        return json({ error: result.error, connected: !result.disconnected }, result.status);
    }
    return json({ access_token: result.access_token, expires_in: result.expires_in });
};
