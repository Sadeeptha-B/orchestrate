// PUT /api/state/:key   body { value: string, schemaVersion: number, updatedAt: number }
// Guarded by the shared secret. Upserts one slice with a last-write-wins guard applied *inside* the
// SQL statement (race-safe without a transaction): the write only lands when the incoming updatedAt is
// >= the stored one. A rejected write returns 409 with the current row so the client can back off — the
// next cold-start merge (SyncGate) reconciles authoritatively.

import { SYNC_SLICE_KEYS, type StateEnv, json, requireAppSecret } from '../../_shared';

const SLICE_KEYS = new Set<string>(SYNC_SLICE_KEYS);

interface CurrentRow {
    value: string;
    schema_version: number;
    updated_at: number;
}

export const onRequestPut: PagesFunction<StateEnv> = async ({ request, env, params }) => {
    const authError = requireAppSecret(request, env);
    if (authError) return authError;

    const key = typeof params.key === 'string' ? params.key : '';
    if (!SLICE_KEYS.has(key)) return json({ error: 'unknown_slice' }, 404);

    let body: { value?: unknown; schemaVersion?: unknown; updatedAt?: unknown };
    try {
        body = await request.json();
    } catch {
        return json({ error: 'invalid_body' }, 400);
    }
    const { value, schemaVersion, updatedAt } = body;
    if (typeof value !== 'string' || typeof schemaVersion !== 'number' || typeof updatedAt !== 'number') {
        return json({ error: 'invalid_body' }, 400);
    }

    try {
        // LWW guard in the statement: the UPDATE branch only fires when the incoming stamp wins.
        // `>=` (not `>`) keeps an identical re-push idempotent rather than 409-ing on itself.
        const res = await env.SYNC_DB.prepare(
            `INSERT INTO slices (key, value, schema_version, updated_at) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(key) DO UPDATE SET
                 value = excluded.value,
                 schema_version = excluded.schema_version,
                 updated_at = excluded.updated_at
             WHERE excluded.updated_at >= slices.updated_at`,
        ).bind(key, value, schemaVersion, updatedAt).run();

        if (res.meta.changes === 0) {
            const current = await env.SYNC_DB
                .prepare('SELECT value, schema_version, updated_at FROM slices WHERE key = ?1')
                .bind(key)
                .first<CurrentRow>();
            return json(
                {
                    error: 'conflict',
                    current: current
                        ? { value: current.value, schemaVersion: current.schema_version, updatedAt: current.updated_at }
                        : null,
                },
                409,
            );
        }
        return json({ ok: true });
    } catch {
        return json({ error: 'storage_unavailable' }, 503);
    }
};
