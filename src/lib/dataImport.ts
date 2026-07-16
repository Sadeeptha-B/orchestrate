import { isSupportedSchemaVersion } from './schema';
import type { AppSettings, DayPlan, LifeContext, SavedDayPlan } from '../types';

/**
 * Shape of a Full Backup export (settings + life + history, schema-stamped). `currentDay`
 * carries the live, not-yet-saved working day so a backup captures "today" — not just the
 * manually saved sessions in `history`. Older backups without it simply leave the plan
 * slice untouched on import; `_schemaVersion` is the only version stamp (the retired
 * `_backupVersion` field was never read and is ignored if present in old files).
 *
 * v7.11 provenance: `_exportedAt` / `_originHost` record when and from which origin the
 * backup was taken, so the import confirm can warn about age and prod↔dev crossings. The
 * account fingerprints (`settings.todoistAccount` / `settings.googleAccount`) ride inside
 * `settings` — the import flow compares them against the live connections.
 */
export interface FullBackup {
    settings?: AppSettings;
    life?: LifeContext;
    history?: SavedDayPlan[];
    currentDay?: DayPlan;
    _schemaVersion?: number;
    _exportedAt?: string;
    _originHost?: string;
}

/** Why a candidate backup file was rejected — each maps to a distinct user-facing message. */
export type BackupInvalidReason = 'sessions-file' | 'not-a-backup' | 'unsupported-schema' | 'malformed';

export type BackupValidation =
    | { ok: true; data: FullBackup }
    | { ok: false; reason: BackupInvalidReason };

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

/**
 * Validate a single day-plan payload (a bare `DayPlan`, as carried by `currentDay`).
 * Returns it untouched, or `null` if malformed / outside the supported schema range.
 */
export function validateDayPlan(data: unknown): DayPlan | null {
    if (
        !isRecord(data) ||
        !Array.isArray((data as { intentions?: unknown }).intentions) ||
        // Schema guard: accept plans within the supported range (floor → current).
        !isSupportedSchemaVersion((data as { _schemaVersion?: number })._schemaVersion)
    ) {
        return null;
    }
    return data as unknown as DayPlan;
}

/**
 * Validate a sessions payload (single session or array). Returns the normalised array,
 * or `null` if any entry is malformed / outside the supported schema range.
 */
export function validateSessions(data: unknown): SavedDayPlan[] | null {
    const arr = Array.isArray(data) ? data : [data];
    for (const item of arr) {
        if (
            !item ||
            typeof item !== 'object' ||
            typeof (item as SavedDayPlan).savedAt !== 'string' ||
            typeof (item as SavedDayPlan).label !== 'string' ||
            !(item as SavedDayPlan).plan ||
            !Array.isArray((item as SavedDayPlan).plan?.intentions) ||
            // Schema guard: accept saved plans within the supported range (floor → current).
            !isSupportedSchemaVersion((item as unknown as { plan: { _schemaVersion?: number } }).plan?._schemaVersion)
        ) {
            return null;
        }
    }
    return arr as SavedDayPlan[];
}

/**
 * Validate a Full Backup payload. Returns the normalised backup, or the reason it was
 * rejected — including the one shape mix-up worth a pointed message: an Export All
 * Sessions file (a bare array) fed to the backup importer.
 */
export function validateBackup(data: unknown): BackupValidation {
    if (Array.isArray(data)) {
        return { ok: false, reason: 'sessions-file' };
    }
    if (!isRecord(data) || (!data.settings && !data.life && !data.history && !data.currentDay)) {
        return { ok: false, reason: 'not-a-backup' };
    }
    // Schema guard: accept backups within the supported range (floor → current).
    if (!isSupportedSchemaVersion(data._schemaVersion)) {
        return { ok: false, reason: 'unsupported-schema' };
    }
    if (
        (data.settings !== undefined && !isRecord(data.settings)) ||
        (data.life !== undefined && !isRecord(data.life)) ||
        (data.history !== undefined && validateSessions(data.history) === null) ||
        (data.currentDay !== undefined && validateDayPlan(data.currentDay) === null)
    ) {
        return { ok: false, reason: 'malformed' };
    }
    return {
        ok: true,
        data: {
            settings: data.settings as AppSettings | undefined,
            life: data.life as LifeContext | undefined,
            history: data.history as SavedDayPlan[] | undefined,
            currentDay: data.currentDay as DayPlan | undefined,
            _schemaVersion: typeof data._schemaVersion === 'number' ? data._schemaVersion : undefined,
            _exportedAt: typeof data._exportedAt === 'string' ? data._exportedAt : undefined,
            _originHost: typeof data._originHost === 'string' ? data._originHost : undefined,
        },
    };
}
