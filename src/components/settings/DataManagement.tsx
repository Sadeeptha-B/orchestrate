import { useRef, useState } from 'react';
import { useDayPlan } from '../../hooks/useDayPlan';
import { useDataImport } from '../../hooks/useDataImport';
import { Button } from '../ui/Button';
import { ConfirmModal } from '../ui/ConfirmModal';
import { useConfirmModal } from '../../hooks/useConfirmModal';
import { downloadJSON } from '../../lib/download';
import { SCHEMA_VERSION } from '../../lib/schema';
import type { FullBackup } from '../../lib/dataImport';
import type { DayPlan } from '../../types';

interface DataManagementProps {
    /** Optional handler to surface the Saved Sessions sidebar (closes modal + reveals panel). */
    onShowSavedSessions?: () => void;
}

export function DataManagement({ onShowSavedSessions }: DataManagementProps) {
    const { settings, life, history, plan, dispatch } = useDayPlan();
    const {
        importError,
        importInfo,
        importedDayCount,
        pendingBackup,
        importDayPlanFile,
        importBackupFile,
        confirmBackupImport,
        cancelBackupImport,
        reset: resetImportStatus,
    } = useDataImport();
    const [resetInfo, setResetInfo] = useState<string | null>(null);
    const dayPlanInputRef = useRef<HTMLInputElement>(null);
    const backupInputRef = useRef<HTMLInputElement>(null);
    const confirmResetDay = useConfirmModal<true>();
    const confirmResetAll = useConfirmModal<true>();

    const showRestoreHint = (importedDayCount ?? 0) > 0;

    const handleResetDay = () => {
        dispatch({ type: 'RESET_DAY' });
        resetImportStatus();
        setResetInfo("Today's plan has been cleared.");
    };

    const handleResetAll = () => {
        // Clear the Todoist cache too — it's keyed off the token we're about to wipe.
        try { localStorage.removeItem('orchestrate-todoist-cache'); } catch { /* ignore */ }
        dispatch({ type: 'RESET_ALL' });
        resetImportStatus();
        setResetInfo('All data has been reset to defaults.');
    };

    const exportFullBackup = () => {
        // v2: bundle the live working day so a backup captures "today" even before it's
        // manually saved to history. Skip it when nothing's been entered yet.
        const planHasContent = plan.intentions.length > 0 || plan.setupComplete;
        const payload: FullBackup = {
            settings,
            life,
            history,
            currentDay: planHasContent
                ? ({ ...plan, _schemaVersion: SCHEMA_VERSION } as DayPlan)
                : undefined,
            _backupVersion: 2,
            _schemaVersion: SCHEMA_VERSION,
        };
        const stamp = new Date().toISOString().slice(0, 10);
        downloadJSON(payload, `orchestrate-backup-${stamp}.json`);
    };

    const exportAllSessions = () => {
        downloadJSON(history, `orchestrate-all-sessions.json`);
    };

    const handleDayPlanImport = (e: React.ChangeEvent<HTMLInputElement>) => {
        setResetInfo(null);
        const file = e.target.files?.[0];
        if (file) importDayPlanFile(file);
        e.target.value = '';
    };

    const handleBackupImport = (e: React.ChangeEvent<HTMLInputElement>) => {
        setResetInfo(null);
        const file = e.target.files?.[0];
        if (file) importBackupFile(file);
        e.target.value = '';
    };

    return (
        <div className="space-y-5">
            <div className="space-y-2">
                <h4 className="text-xs font-semibold text-text-light uppercase tracking-wider">
                    Restore
                </h4>
                <p className="text-xs text-text-light">
                    Moving from another browser or device? Restore a Full Backup (settings, life, saved days, and the day you were working on) to make this device match the backup, or import just a single day plan into Saved Sessions.
                </p>
                <div className="flex flex-wrap gap-2">
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => backupInputRef.current?.click()}
                        title="Restore from a Full Backup file (replaces local data with the backup's)"
                    >
                        Import Backup
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => dayPlanInputRef.current?.click()}
                        title="Import a single day plan (or an exported day plans file) into Saved Sessions"
                    >
                        Import Day Plan
                    </Button>
                </div>
            </div>

            <div className="space-y-2">
                <h4 className="text-xs font-semibold text-text-light uppercase tracking-wider">
                    Export
                </h4>
                <p className="text-xs text-text-light">
                    Back up your data or move it to another device.
                </p>
                <div className="flex flex-wrap gap-2">
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={exportFullBackup}
                        title="Bundle settings + life + history into one JSON file"
                    >
                        Full Backup
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={exportAllSessions}
                        disabled={history.length === 0}
                    >
                        Export All Sessions
                    </Button>
                </div>
            </div>

            <div className="space-y-2 pt-3 border-t border-border">
                <h4 className="text-xs font-semibold text-text-light uppercase tracking-wider">
                    Reset
                </h4>
                <p className="text-xs text-text-light">
                    Clear today's plan after a messy import, or wipe everything and start
                    from scratch. Reset Everything also removes your Todoist connection
                    and saved sessions; it does not touch tasks in Todoist itself.
                </p>
                <div className="flex flex-wrap gap-2">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => confirmResetDay.open(true)}
                        className="text-red-500 hover:text-red-600"
                        title="Clear today's intentions, tasks, sessions, and habit instances"
                    >
                        Reset Today's Plan
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => confirmResetAll.open(true)}
                        className="text-red-500 hover:text-red-600"
                        title="Wipe all local data: plan, history, seasons, habits, settings"
                    >
                        Reset Everything
                    </Button>
                </div>
            </div>

            <input
                ref={dayPlanInputRef}
                type="file"
                accept=".json"
                className="hidden"
                onChange={handleDayPlanImport}
            />
            <input
                ref={backupInputRef}
                type="file"
                accept=".json"
                className="hidden"
                onChange={handleBackupImport}
            />

            {importError && (
                <p className="text-xs text-red-500">{importError}</p>
            )}
            {(importInfo ?? resetInfo) && (
                <p className="text-xs text-success">{importInfo ?? resetInfo}</p>
            )}
            {showRestoreHint && (
                <p className="text-xs text-text-light">
                    {onShowSavedSessions ? (
                        <>
                            <button
                                onClick={onShowSavedSessions}
                                className="text-accent hover:underline cursor-pointer font-medium"
                            >
                                Open Saved Sessions →
                            </button>{' '}
                            to use one as today's plan.
                        </>
                    ) : (
                        <>Open the Saved Sessions sidebar to use one as today's plan.</>
                    )}
                </p>
            )}

            <ConfirmModal
                open={pendingBackup !== null}
                onClose={cancelBackupImport}
                onConfirm={confirmBackupImport}
                title="Restore from this backup?"
                confirmLabel="Replace & Restore"
            >
                <p className="text-sm text-text-light mb-3">
                    This <strong>replaces</strong> your current{' '}
                    {pendingBackup?.summary.join(', ')} with the backup's. Local entries not in the
                    backup are removed — this is a restore, not a merge.
                </p>
                <p className="text-sm text-text-light mb-4">
                    Export a Full Backup first if you want to keep your current data. This cannot be
                    undone.
                </p>
            </ConfirmModal>

            <ConfirmModal
                open={confirmResetDay.value !== null}
                onClose={confirmResetDay.close}
                onConfirm={handleResetDay}
                title="Reset today's plan?"
                confirmLabel="Reset Day"
            >
                <p className="text-sm text-text-light mb-4">
                    Today's intentions, linked tasks, session assignments, habit instances,
                    and check-ins will be cleared. Saved sessions, seasons,
                    habits, the backlog, and settings will be untouched. Todoist tasks are
                    not modified.
                </p>
            </ConfirmModal>

            <ConfirmModal
                open={confirmResetAll.value !== null}
                onClose={confirmResetAll.close}
                onConfirm={handleResetAll}
                title="Reset everything?"
                confirmLabel="Reset Everything"
            >
                <p className="text-sm text-text-light mb-2">
                    This wipes all local Orchestrate data: today's plan, saved sessions,
                    seasons, habits, the intentions backlog, rest cues, capacity settings,
                    and your Todoist connection.
                </p>
                <p className="text-sm text-text-light mb-4">
                    Tasks and projects in Todoist itself are not modified. Export a Full
                    Backup first if you want to keep a copy. This cannot be undone.
                </p>
            </ConfirmModal>
        </div>
    );
}
