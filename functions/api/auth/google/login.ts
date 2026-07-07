// GET /api/auth/google/login[?return=settings|home]
// Identity-guarded. Returns the Google consent URL as JSON so the browser can redirect to it.
// The signed state binds the caller's email (the callback only completes for the same identity)
// and the allowlisted return target (so onboarding can get the redirect back to `/`).

import {
    buildAuthUrl,
    hasGoogleOAuthConfig,
    isReturnTarget,
    json,
    requireUser,
    signState,
    type Env,
} from './_lib';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
    const auth = await requireUser(request, env);
    if (auth instanceof Response) return auth;
    if (!hasGoogleOAuthConfig(env)) {
        return json({ error: 'server_not_configured' }, 500);
    }
    const requested = new URL(request.url).searchParams.get('return') ?? '';
    const returnTo = isReturnTarget(requested) ? requested : 'settings';
    const state = await signState(env, auth.email, returnTo);
    return json({ url: buildAuthUrl(request, env, state) });
};
