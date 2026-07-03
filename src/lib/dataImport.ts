import { isSupportedSchemaVersion } from './schema';
import type { AppSettings, DayPlan, LifeContext, SavedDayPlan } from '../types';

/**
 * Shape of a Full Backup export (settings + life + history, schema-stamped). `currentDay`
 * (v2 backups) carries the live, not-yet-saved working day so a backup captures "today"
 * — not just the manually saved sessions in `history`.
 */
export interface FullBackup {
    settings?: AppSettings;
    life?: LifeContext;
    history?: SavedDayPlan[];
    currentDay?: DayPlan;
    _backupVersion?: number;
    _schemaVersion?: number;
}

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
 * Validate a Full Backup payload. Returns the normalised backup, or `null` if it is
 * not a recognised backup / is outside the supported schema range.
 */
export function validateBackup(data: unknown): FullBackup | null {
    if (!isRecord(data) || (!data.settings && !data.life && !data.history && !data.currentDay)) {
        return null;
    }
    // Schema guard: accept backups within the supported range (floor → current).
    if (!isSupportedSchemaVersion(data._schemaVersion)) {
        return null;
    }
    if (data.settings !== undefined && !isRecord(data.settings)) {
        return null;
    }
    if (data.life !== undefined && !isRecord(data.life)) {
        return null;
    }
    if (data.history !== undefined && validateSessions(data.history) === null) {
        return null;
    }
    if (data.currentDay !== undefined && validateDayPlan(data.currentDay) === null) {
        return null;
    }
    return {
        settings: data.settings as AppSettings | undefined,
        life: data.life as LifeContext | undefined,
        history: data.history as SavedDayPlan[] | undefined,
        currentDay: data.currentDay as DayPlan | undefined,
        _backupVersion: typeof data._backupVersion === 'number' ? data._backupVersion : undefined,
        _schemaVersion: typeof data._schemaVersion === 'number' ? data._schemaVersion : undefined,
    };
}
