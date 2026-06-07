// POST /api/auth/google/disconnect
// Guarded by the shared secret. Revokes the refresh token at Google (best-effort) and clears all
// stored token state from KV.

import { clearConnection, isGoogleWorkerError, json, requireAppSecret, revokeToken, type Env } from './_lib';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
    const authError = requireAppSecret(request, env);
    if (authError) return authError;
    try {
        const refresh = await clearConnection(env);
        if (refresh) await revokeToken(refresh);
        return json({ connected: false });
    } catch (error) {
        if (isGoogleWorkerError(error)) return json({ error: error.code }, error.status);
        throw error;
    }
};
