// GET /api/state
// Identity-guarded. Returns the caller's identity plus every synced slice for the cold-start merge
// (SyncGate):
//   { user, slices: { [key]: { value, schemaVersion, updatedAt } } }
// `user` drives the client's identity-switch guard (localStorage is per browser profile, so a
// different Access identity must not merge into the previous user's local slices). `value` is the
// exact JSON string the client persisted; the client migrates/validates it on load.

import { type StateEnv, json, requireUser } from '../../_shared';

interface SliceRow {
    key: string;
    value: string;
    schema_version: number;
    updated_at: number;
}

export const onRequestGet: PagesFunction<StateEnv> = async ({ request, env }) => {
    const auth = await requireUser(request, env);
    if (auth instanceof Response) return auth;

    let rows: SliceRow[];
    try {
        const result = await env.SYNC_DB
            .prepare('SELECT key, value, schema_version, updated_at FROM slices WHERE user_id = ?1')
            .bind(auth.email)
            .all<SliceRow>();
        rows = result.results ?? [];
    } catch {
        return json({ error: 'storage_unavailable' }, 503);
    }

    const slices: Record<string, { value: string; schemaVersion: number; updatedAt: number }> = {};
    for (const r of rows) {
        slices[r.key] = { value: r.value, schemaVersion: r.schema_version, updatedAt: r.updated_at };
    }
    return json({ user: auth.email, slices });
};
