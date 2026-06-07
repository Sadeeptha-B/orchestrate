// GET /api/auth/google/status
// Guarded by the shared secret. Reports whether a refresh token is held (i.e. connected) and the
// granted scope. Drives the app's auto-reconnect / connected-state on load.

import { isConnected, isGoogleWorkerError, json, requireAppSecret, type Env } from './_lib';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
    const authError = requireAppSecret(request, env);
    if (authError) return authError;
    try {
        const { connected, scope } = await isConnected(env);
        return json({ connected, scope });
    } catch (error) {
        if (isGoogleWorkerError(error)) return json({ error: error.code }, error.status);
        throw error;
    }
};
