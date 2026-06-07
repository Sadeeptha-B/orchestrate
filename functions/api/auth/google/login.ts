// GET /api/auth/google/login
// Guarded by the shared secret. Returns the Google consent URL as JSON so the browser can
// redirect to it — keeping the secret out of the navigation URL / history.

import { buildAuthUrl, checkSecret, json, signState, type Env } from './_lib';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
    if (!checkSecret(request, env)) return json({ error: 'unauthorized' }, 401);
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
        return json({ error: 'server_not_configured' }, 500);
    }
    const state = await signState(env);
    return json({ url: buildAuthUrl(request, env, state) });
};
