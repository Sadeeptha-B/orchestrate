// GET /api/auth/google/status
// Identity-guarded. Reports whether the caller's refresh token is held (i.e. connected) and the
// granted scope. Drives the app's auto-reconnect / connected-state on load.

import { isConnected, isGoogleWorkerError, json, requireUser, type Env } from './_lib';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
    const auth = await requireUser(request, env);
    if (auth instanceof Response) return auth;
    try {
        const { connected, scope } = await isConnected(env, auth.email);
        return json({ connected, scope });
    } catch (error) {
        if (isGoogleWorkerError(error)) return json({ error: error.code }, error.status);
        throw error;
    }
};
