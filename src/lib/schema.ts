/**
 * Schema versioning + forward-migration seam for persisted artifacts (plan / settings / life /
 * saved-session plans / full backups). Pure helpers — kept out of the provider file so they can be
 * shared by the loaders and the DataManagement import path.
 *
 * Compatibility posture (see docs/synthesis.md §6.1, docs/data-model.md §4): a **supported floor**,
 * not exact-match. An artifact stamped in `[MIN_SUPPORTED_SCHEMA, SCHEMA_VERSION]` is accepted and
 * **migrated forward** to the current shape (`migrateToCurrent`); anything below the floor (or
 * unstamped) is rejected on load (→ fresh start) and refused on import.
 *
 * Non-additive changes are a first-class option — this is a single-user app and we do not carry
 * deep backward-compat. To make one: bump `SCHEMA_VERSION` and add a single forward step at the
 * seam. Compat is kept from the floor upward only; raise `MIN_SUPPORTED_SCHEMA` (deleting now-dead
 * steps) when carrying an old version forward gets too expensive. The deep v1→7.1 chain was deleted
 * for that reason (see docs/history/plan_v7/plan_v7.3.md) and lives in git history.
 */
import type { ContextNote } from '../types';

/**
 * Current schema. Persisted artifacts and full backups are stamped with this on write.
 * 7.4 (v7.4 Phase 2): first bump since 7.1 — `LinkedTask.firstAction`/`reentryNote` → `contextTrail`,
 * and `LifeContext.engagementHistory` introduced.
 */
export const SCHEMA_VERSION = 7.4;

/** Oldest schema the app still understands. Data stamped below this is rejected rather than migrated. */
export const MIN_SUPPORTED_SCHEMA = 7.1;

/** Numeric schema stamp of a parsed artifact, or null when missing/non-numeric. */
export function schemaVersionOf(raw: { _schemaVersion?: unknown } | null | undefined): number | null {
    const v = raw?._schemaVersion;
    return typeof v === 'number' ? v : null;
}

/**
 * True when a schema stamp is one we support — within `[MIN_SUPPORTED_SCHEMA, SCHEMA_VERSION]`.
 * Shared numeric gate so the import path (DataManagement) gates identically to the loaders.
 */
export function isSupportedSchemaVersion(v: unknown): boolean {
    return typeof v === 'number' && v >= MIN_SUPPORTED_SCHEMA && v <= SCHEMA_VERSION;
}

/**
 * True when a parsed, persisted/imported object is a schema we support. Supported-but-older
 * artifacts are brought up to the current shape by `migrateToCurrent`.
 */
export function isSupportedSchema(raw: { _schemaVersion?: unknown } | null | undefined): boolean {
    return isSupportedSchemaVersion(schemaVersionOf(raw));
}

/**
 * 7.1 → 7.4 (plan): fold the v7.4-Phase-1 breadcrumb strings `firstAction` (entry point) and
 * `reentryNote` ("where I left off") into a single ordered `contextTrail` of `ContextNote`s, then
 * drop the two scalar fields. Entry is pushed before exit so the most-recent "left off" note is
 * `contextTrail.at(-1)`. The notes have no original timestamp, so they're stamped at migration time.
 */
function migratePlan_7_1_to_7_4(raw: Record<string, unknown>): Record<string, unknown> {
    const tasks = raw.linkedTasks;
    if (!Array.isArray(tasks)) return raw;
    const migratedAt = new Date().toISOString();
    const linkedTasks = tasks.map((t) => {
        if (t === null || typeof t !== 'object') return t;
        const { firstAction, reentryNote, ...rest } = t as Record<string, unknown>;
        const existing: ContextNote[] = Array.isArray(rest.contextTrail)
            ? (rest.contextTrail as ContextNote[])
            : [];
        const notes: ContextNote[] = [...existing];
        if (typeof firstAction === 'string' && firstAction.trim()) {
            notes.push({ at: migratedAt, text: firstAction.trim(), kind: 'entry' });
        }
        if (typeof reentryNote === 'string' && reentryNote.trim()) {
            notes.push({ at: migratedAt, text: reentryNote.trim(), kind: 'exit' });
        }
        return notes.length > 0 ? { ...rest, contextTrail: notes } : rest;
    });
    return { ...raw, linkedTasks };
}

/** 7.1 → 7.4 (life): introduce the durable engagement archive as an empty array if absent. */
function migrateLife_7_1_to_7_4(raw: Record<string, unknown>): Record<string, unknown> {
    if (Array.isArray(raw.engagementHistory)) return raw;
    return { ...raw, engagementHistory: [] };
}

/**
 * Migration seam. Forward-migrate a parsed, already-supported artifact up to `SCHEMA_VERSION`.
 * Single-step chain from `MIN_SUPPORTED_SCHEMA` upward — one block per step. Runs on the raw record
 * before markers are stripped / defaults are filled. `slice` lets a step target the right shape.
 */
export function migrateToCurrent(
    raw: Record<string, unknown>,
    slice: 'plan' | 'settings' | 'life',
): Record<string, unknown> {
    const from = schemaVersionOf(raw) ?? SCHEMA_VERSION;
    let out = raw;
    if (from < 7.4) {
        if (slice === 'plan') out = migratePlan_7_1_to_7_4(out);
        else if (slice === 'life') out = migrateLife_7_1_to_7_4(out);
    }
    return out;
}
