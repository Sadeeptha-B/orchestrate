// GET /api/auth/google/login
// Guarded by the shared secret. Returns the Google consent URL as JSON so the browser can
// redirect to it — keeping the secret out of the navigation URL / history.

import { buildAuthUrl, hasGoogleOAuthConfig, json, requireAppSecret, signState, type Env } from './_lib';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
    const authError = requireAppSecret(request, env);
    if (authError) return authError;
    if (!hasGoogleOAuthConfig(env)) {
        return json({ error: 'server_not_configured' }, 500);
    }
    const state = await signState(env);
    return json({ url: buildAuthUrl(request, env, state) });
};
