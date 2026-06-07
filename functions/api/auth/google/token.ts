// GET /api/auth/google/token
// Guarded by the shared secret. Returns a short-lived Google access token (from the KV cache or
// minted from the stored refresh token). The browser uses it as a Bearer token against the
// Calendar REST API. The refresh token itself never leaves the Worker.

import { getAccessToken, isGoogleWorkerError, json, requireAppSecret, type Env } from './_lib';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
    const authError = requireAppSecret(request, env);
    if (authError) return authError;

    try {
        const result = await getAccessToken(env);
        if (!result.ok) {
            return json({ error: result.error, connected: !result.disconnected }, result.status);
        }
        return json({ access_token: result.access_token, expires_in: result.expires_in });
    } catch (error) {
        if (isGoogleWorkerError(error)) {
            return json({ error: error.code, connected: !error.disconnected }, error.status);
        }
        throw error;
    }
};
