// GET /api/auth/google/token
// Identity-guarded. Returns a short-lived Google access token (from the caller's KV cache or
// minted from their stored refresh token). The browser uses it as a Bearer token against the
// Calendar REST API. The refresh token itself never leaves the Worker.

import { getAccessToken, isGoogleWorkerError, json, requireUser, type Env } from './_lib';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
    const auth = await requireUser(request, env);
    if (auth instanceof Response) return auth;

    try {
        const result = await getAccessToken(env, auth.email);
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
