// GET /api/me
// Returns the authenticated identity resolved from the Cloudflare Access JWT. The client uses it
// to stamp localStorage with the active user (identity-switch guard) and to default the greeting.

import { type AccessEnv, json, requireUser } from '../_shared';

export const onRequestGet: PagesFunction<AccessEnv> = async ({ request, env }) => {
    const auth = await requireUser(request, env);
    if (auth instanceof Response) return auth;
    return json({ email: auth.email });
};
