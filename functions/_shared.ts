// Shared helpers for Cloudflare Pages Functions: the Cloudflare Access identity guard + a JSON helper.
//
// Every guarded endpoint validates the `Cf-Access-Jwt-Assertion` JWT that Cloudflare Access injects
// after the user authenticates at the edge (Google SSO against the Access policy's email allowlist).
// The verified `email` claim is the user id — it namespaces the KV credential keys and the D1 sync
// rows, so each pre-approved account uses the app independently. Files prefixed `_` are modules,
// not routes.

import { createRemoteJWKSet, jwtVerify } from 'jose';

/** Minimal env shape every guarded endpoint needs. */
export interface AccessEnv {
    /** Zero Trust team domain, e.g. "myteam.cloudflareaccess.com". */
    CF_ACCESS_TEAM_DOMAIN: string;
    /** The Access application's AUD tag. */
    CF_ACCESS_AUD: string;
    /** Dev-only bypass (.dev.vars): skip JWT validation and act as this email. Never set in prod. */
    DEV_USER_EMAIL?: string;
}

/** Env for the Todoist proxy + token endpoints (identity guard + the KV holding the tokens). */
export interface TodoistEnv extends AccessEnv {
    OAUTH_KV: KVNamespace;
}

/** Env for the state-sync endpoints (identity guard + the D1 slice store). */
export interface StateEnv extends AccessEnv {
    SYNC_DB: D1Database;
}

/** The four persisted slices synced to D1 (mirror of the localStorage working store). */
export const SYNC_SLICE_KEYS = ['plan', 'settings', 'history', 'life'] as const;
export type SyncSliceKey = (typeof SYNC_SLICE_KEYS)[number];

/** Origin of the Todoist REST/Sync API the proxy forwards to. */
export const TODOIST_API = 'https://api.todoist.com';

/** Per-user KV key: `user:<email>:<suffix>`. */
export function userKey(email: string, suffix: string): string {
    return `user:${email}:${suffix}`;
}

/** KV key holding a user's Todoist personal token. */
export function todoistTokenKey(email: string): string {
    return userKey(email, 'todoist:token');
}

export function json(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
}

// One JWKS fetcher per isolate — jose caches the fetched keys internally and refetches on rotation.
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksTeamDomain = '';

function jwksFor(teamDomain: string): ReturnType<typeof createRemoteJWKSet> {
    if (!jwks || jwksTeamDomain !== teamDomain) {
        jwks = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
        jwksTeamDomain = teamDomain;
    }
    return jwks;
}

export function hasAccessConfig(env: AccessEnv): boolean {
    return Boolean(env.CF_ACCESS_TEAM_DOMAIN && env.CF_ACCESS_AUD) || Boolean(env.DEV_USER_EMAIL);
}

/**
 * Resolve the authenticated user from the Access JWT. Returns `{ email }` (lowercased) on success,
 * or a ready-made error Response (401 unauthorized / 500 server_not_configured) to relay.
 *
 * Dev bypass: when DEV_USER_EMAIL is set (only ever in .dev.vars — `wrangler pages dev` has no
 * Access in front), validation is skipped and that identity is assumed.
 */
export async function requireUser(
    request: Request,
    env: AccessEnv,
): Promise<{ email: string } | Response> {
    if (env.DEV_USER_EMAIL) return { email: env.DEV_USER_EMAIL.toLowerCase() };
    if (!env.CF_ACCESS_TEAM_DOMAIN || !env.CF_ACCESS_AUD) {
        return json({ error: 'server_not_configured' }, 500);
    }

    const token = request.headers.get('Cf-Access-Jwt-Assertion');
    if (!token) return json({ error: 'unauthorized' }, 401);

    try {
        const { payload } = await jwtVerify(token, jwksFor(env.CF_ACCESS_TEAM_DOMAIN), {
            issuer: `https://${env.CF_ACCESS_TEAM_DOMAIN}`,
            audience: env.CF_ACCESS_AUD,
        });
        const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
        if (!email) return json({ error: 'unauthorized' }, 401);
        return { email };
    } catch {
        return json({ error: 'unauthorized' }, 401);
    }
}
