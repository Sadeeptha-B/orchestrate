// POST /api/auth/google/disconnect
// Identity-guarded. Revokes the caller's refresh token at Google (best-effort) and clears their
// stored token state from KV.

import { clearConnection, isGoogleWorkerError, json, requireUser, revokeToken, type Env } from './_lib';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
    const auth = await requireUser(request, env);
    if (auth instanceof Response) return auth;
    try {
        const refresh = await clearConnection(env, auth.email);
        if (refresh) await revokeToken(refresh);
        return json({ connected: false });
    } catch (error) {
        if (isGoogleWorkerError(error)) return json({ error: error.code }, error.status);
        throw error;
    }
};
