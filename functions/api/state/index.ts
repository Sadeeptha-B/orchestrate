// GET /api/state
// Guarded by the shared secret. Returns every synced slice for the cold-start merge (SyncGate):
//   { slices: { [key]: { value, schemaVersion, updatedAt } } }
// `value` is the exact JSON string the client persisted; the client migrates/validates it on load.

import { type StateEnv, json, requireAppSecret } from '../../_shared';

interface SliceRow {
    key: string;
    value: string;
    schema_version: number;
    updated_at: number;
}

export const onRequestGet: PagesFunction<StateEnv> = async ({ request, env }) => {
    const authError = requireAppSecret(request, env);
    if (authError) return authError;

    let rows: SliceRow[];
    try {
        const result = await env.SYNC_DB
            .prepare('SELECT key, value, schema_version, updated_at FROM slices')
            .all<SliceRow>();
        rows = result.results ?? [];
    } catch {
        return json({ error: 'storage_unavailable' }, 503);
    }

    const slices: Record<string, { value: string; schemaVersion: number; updatedAt: number }> = {};
    for (const r of rows) {
        slices[r.key] = { value: r.value, schemaVersion: r.schema_version, updatedAt: r.updated_at };
    }
    return json({ slices });
};
