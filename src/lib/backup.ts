import { downloadJSON } from './download';
import { SCHEMA_VERSION } from './schema';
import type { FullBackup } from './dataImport';
import type { AppSettings, DayPlan, LifeContext, SavedDayPlan } from '../types';

function hasCurrentDayContent(plan: DayPlan): boolean {
    return plan.intentions.length > 0
        || plan.linkedTasks.length > 0
        || plan.todaysHabits.length > 0
        || plan.checkIns.length > 0
        || Object.values(plan.taskSessions).some((taskIds) => taskIds.length > 0)
        || Object.keys(plan.sessionCalendarEventIds ?? {}).length > 0
        || Object.keys(plan.sessionStarts ?? {}).length > 0
        || (plan.seededFocusIds?.length ?? 0) > 0
        || plan.wizardStep !== 1
        || plan.setupComplete;
}

/**
 * Build and download a Full Backup of the given state. Shared by the Export panel's
 * "Full Backup" button, the Reset Everything "backup first" opt-in, and the restore
 * confirm's "backup first" escape hatch — all three must produce the identical file.
 */
export function downloadFullBackup(state: {
    settings: AppSettings;
    life: LifeContext;
    history: SavedDayPlan[];
    plan: DayPlan;
}): void {
    const { settings, life, history, plan } = state;
    // Bundle the live working day so a backup captures meaningful in-progress state even when
    // the day only has habit/check-in/calendar activity and no intentions yet.
    const payload: FullBackup = {
        settings,
        life,
        history,
        currentDay: hasCurrentDayContent(plan)
            ? ({ ...plan, _schemaVersion: SCHEMA_VERSION } as DayPlan)
            : undefined,
        _schemaVersion: SCHEMA_VERSION,
        // Provenance: when + where this backup was taken. The account fingerprints ride
        // inside `settings` (todoistAccount / googleAccount) — nothing extra to stamp here.
        _exportedAt: new Date().toISOString(),
        _originHost: window.location.host,
    };
    const stamp = new Date().toISOString().slice(0, 10);
    downloadJSON(payload, `orchestrate-backup-${stamp}.json`);
}
