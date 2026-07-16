import { useMemo, useRef, useState } from 'react';
import { useDayPlan } from '../../hooks/useDayPlan';
import { useTodoistActions, useTodoistData } from '../../hooks/useTodoist';
import { useDataImport } from '../../hooks/useDataImport';
import { Button } from '../ui/Button';
import { ConfirmModal } from '../ui/ConfirmModal';
import { RestoreConfirmModal } from '../RestoreConfirmModal';
import { useConfirmModal } from '../../hooks/useConfirmModal';
import { downloadJSON } from '../../lib/download';
import { downloadFullBackup } from '../../lib/backup';

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
    const { isConfigured } = useTodoistData();
    const { deleteTask } = useTodoistActions();
    const [resetInfo, setResetInfo] = useState<string | null>(null);
    const dayPlanInputRef = useRef<HTMLInputElement>(null);
    const backupInputRef = useRef<HTMLInputElement>(null);
    const confirmResetDay = useConfirmModal<true>();
    const confirmResetAll = useConfirmModal<true>();
    // Reset Everything options, re-defaulted each time the modal opens.
    const [backupBeforeReset, setBackupBeforeReset] = useState(true);
    const [deleteHabitTasks, setDeleteHabitTasks] = useState(false);

    const showRestoreHint = (importedDayCount ?? 0) > 0;

    // The habit-task registry: the recurring Todoist tasks Orchestrate created for habits.
    // RESET_ALL wipes the registry but not the tasks, leaving them orphaned. They keep the
    // orchestrate-habit marker label, so a same-named habit re-adopts its orphan later
    // instead of duplicating it (see habitsTodoistSync) — the optional delete below is for
    // leaving Todoist clean, or when the habits won't be re-created under the same names.
    const habitTaskIds = useMemo(
        () => [...new Set(
            life.habits
                .filter((h) => h.kind === 'habit' && h.todoistTaskId)
                .map((h) => h.todoistTaskId as string),
        )],
        [life.habits],
    );
    const canDeleteHabitTasks = isConfigured && habitTaskIds.length > 0;

    const handleResetDay = () => {
        dispatch({ type: 'RESET_DAY' });
        resetImportStatus();
        setResetInfo("Today's plan has been cleared.");
    };

    const openResetAll = () => {
        setBackupBeforeReset(true);
        setDeleteHabitTasks(false);
        confirmResetAll.open(true);
    };

    const handleResetAll = async () => {
        // Snapshot the linked task ids before the wipe — RESET_ALL clears life.habits.
        const idsToDelete = deleteHabitTasks && canDeleteHabitTasks ? habitTaskIds : [];
        const backedUp = backupBeforeReset;
        if (backedUp) exportFullBackup();
        // Drop the Todoist snapshot cache too — it's rebuildable, and a factory-reset store
        // shouldn't render pre-reset task data. (Server-side tokens are untouched.)
        try { localStorage.removeItem('orchestrate-todoist-cache'); } catch { /* ignore */ }
        dispatch({ type: 'RESET_ALL' });
        resetImportStatus();
        const base = backedUp
            ? 'Backup downloaded; all data has been reset to defaults.'
            : 'All data has been reset to defaults.';
        if (idsToDelete.length === 0) {
            setResetInfo(base);
            return;
        }
        const plural = idsToDelete.length !== 1 ? 's' : '';
        setResetInfo(`All data reset. Deleting ${idsToDelete.length} habit task${plural} in Todoist…`);
        let deletedCount = 0;
        // Sequential, best-effort: deleteTask logs + surfaces failures via the Todoist error
        // state; the summary below reports honestly rather than assuming success.
        for (const id of idsToDelete) {
            if (await deleteTask(id)) deletedCount += 1;
        }
        const failedCount = idsToDelete.length - deletedCount;
        if (failedCount === 0) {
            setResetInfo(`${base} ${deletedCount} habit task${plural} deleted in Todoist.`);
            return;
        }
        const failedPlural = failedCount !== 1 ? 's' : '';
        if (deletedCount === 0) {
            setResetInfo(
                `${base} None of the ${failedCount} habit task${failedPlural} could be deleted in Todoist — they remain as orphans (their markers still allow later re-adoption).`,
            );
            return;
        }
        setResetInfo(
            `${base} Deleted ${deletedCount} habit task${deletedCount !== 1 ? 's' : ''} in Todoist; ${failedCount} could not be deleted.`,
        );
    };

    const exportFullBackup = () => downloadFullBackup({ settings, life, history, plan });

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
                    from scratch. Reset Everything clears saved sessions too, and can
                    optionally delete the habit tasks Orchestrate created in Todoist.
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
                        onClick={openResetAll}
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

            <RestoreConfirmModal
                pending={pendingBackup}
                onConfirm={confirmBackupImport}
                onCancel={cancelBackupImport}
            />

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
                    seasons, habits, the intentions backlog, rest cues, and capacity
                    settings. The wipe syncs to your other devices. Todoist and Google
                    stay connected — disconnect those in Settings → Integrations.
                </p>
                <p className="text-sm text-text-light mb-3">
                    Habit tasks left in Todoist become orphans, but they keep their
                    Orchestrate label — re-creating a habit under the <em>same name</em> later
                    adopts its old task instead of duplicating it. Delete them below if you'd
                    rather leave Todoist clean.
                </p>
                <div className="space-y-2 mb-3">
                    <label className="flex items-start gap-2 text-sm cursor-pointer">
                        <input
                            type="checkbox"
                            className="mt-0.5 accent-accent"
                            checked={backupBeforeReset}
                            onChange={(e) => setBackupBeforeReset(e.target.checked)}
                        />
                        <span>
                            Download a Full Backup first{' '}
                            <span className="text-text-light text-xs">
                                (recommended — the only way back)
                            </span>
                        </span>
                    </label>
                    <label
                        className={`flex items-start gap-2 text-sm ${canDeleteHabitTasks ? 'cursor-pointer' : 'opacity-60'}`}
                    >
                        <input
                            type="checkbox"
                            className="mt-0.5 accent-accent"
                            disabled={!canDeleteHabitTasks}
                            checked={deleteHabitTasks && canDeleteHabitTasks}
                            onChange={(e) => setDeleteHabitTasks(e.target.checked)}
                        />
                        <span>
                            Also delete{' '}
                            {habitTaskIds.length > 0
                                ? `the ${habitTaskIds.length} habit task${habitTaskIds.length !== 1 ? 's' : ''}`
                                : 'the habit tasks'}{' '}
                            Orchestrate created in Todoist{' '}
                            {!isConfigured && (
                                <span className="text-text-light text-xs">
                                    (Todoist is not connected)
                                </span>
                            )}
                            {isConfigured && habitTaskIds.length === 0 && (
                                <span className="text-text-light text-xs">
                                    (no habits are linked to Todoist)
                                </span>
                            )}
                        </span>
                    </label>
                </div>
                <p className="text-sm text-text-light mb-4">This cannot be undone.</p>
            </ConfirmModal>
        </div>
    );
}
