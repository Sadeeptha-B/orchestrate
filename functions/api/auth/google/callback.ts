// GET /api/auth/google/callback?code=...&state=...
// Google redirects here after consent. Verifies the signed state, exchanges the code for tokens,
// stores the refresh token in KV, then redirects back into the app. Not secret-guarded (Google
// calls it) — the HMAC state proves the flow originated from our /login.

import {
    appOrigin,
    exchangeCode,
    hasGoogleOAuthConfig,
    isGoogleWorkerError,
    storeConnection,
    verifyState,
    type Env,
} from './_lib';

function back(origin: string, status: 'connected' | 'error', reason?: string): Response {
    const url = new URL(`${origin}/settings`);
    url.searchParams.set('tab', 'integrations'); // ensure the Google Calendar panel is mounted to handle this
    url.searchParams.set('gcal', status);
    if (reason) url.searchParams.set('reason', reason);
    return Response.redirect(url.toString(), 302);
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
    const origin = appOrigin(request, env);
    const params = new URL(request.url).searchParams;

    if (!hasGoogleOAuthConfig(env)) return back(origin, 'error', 'server_not_configured');

    if (params.get('error')) return back(origin, 'error', params.get('error')!);
    if (!(await verifyState(env, params.get('state')))) return back(origin, 'error', 'state');

    const code = params.get('code');
    if (!code) return back(origin, 'error', 'no_code');

    let tokens;
    try {
        tokens = await exchangeCode(request, env, code);
    } catch (error) {
        if (isGoogleWorkerError(error)) return back(origin, 'error', error.code);
        throw error;
    }
    if (!tokens.access_token) return back(origin, 'error', tokens.error || 'exchange_failed');

    try {
        await storeConnection(env, tokens);
    } catch (error) {
        if (isGoogleWorkerError(error)) return back(origin, 'error', error.code);
        throw error;
    }
    return back(origin, 'connected');
};
