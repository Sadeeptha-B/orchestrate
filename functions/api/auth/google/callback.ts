// GET /api/auth/google/callback?code=...&state=...
// Google redirects here after consent. Behind Cloudflare Access the browser carries its session
// cookie through the redirect, so this endpoint has a verified identity too. The HMAC state proves
// the flow originated from our /login *and* that it was started by the same user — tokens are
// stored under the callback identity's keys only when the two match.

import {
    RETURN_TARGETS,
    type ReturnTarget,
    appOrigin,
    exchangeCode,
    hasGoogleOAuthConfig,
    isGoogleWorkerError,
    requireUser,
    storeConnection,
    verifyState,
    type Env,
} from './_lib';

function back(origin: string, returnTo: ReturnTarget, status: 'connected' | 'error', reason?: string): Response {
    const url = new URL(`${origin}${RETURN_TARGETS[returnTo]}`);
    url.searchParams.set('gcal', status);
    if (reason) url.searchParams.set('reason', reason);
    return Response.redirect(url.toString(), 302);
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
    const origin = appOrigin(request, env);
    const params = new URL(request.url).searchParams;

    const auth = await requireUser(request, env);
    if (auth instanceof Response) return back(origin, 'settings', 'error', 'unauthorized');

    if (!hasGoogleOAuthConfig(env)) return back(origin, 'settings', 'error', 'server_not_configured');

    const state = await verifyState(env, params.get('state'));
    if (!state) return back(origin, 'settings', 'error', 'state');
    if (state.email !== auth.email) return back(origin, state.returnTo, 'error', 'state');

    if (params.get('error')) return back(origin, state.returnTo, 'error', params.get('error')!);

    const code = params.get('code');
    if (!code) return back(origin, state.returnTo, 'error', 'no_code');

    let tokens;
    try {
        tokens = await exchangeCode(request, env, code);
    } catch (error) {
        if (isGoogleWorkerError(error)) return back(origin, state.returnTo, 'error', error.code);
        throw error;
    }
    if (!tokens.access_token) return back(origin, state.returnTo, 'error', tokens.error || 'exchange_failed');

    try {
        await storeConnection(env, auth.email, tokens);
    } catch (error) {
        if (isGoogleWorkerError(error)) return back(origin, state.returnTo, 'error', error.code);
        throw error;
    }
    return back(origin, state.returnTo, 'connected');
};
