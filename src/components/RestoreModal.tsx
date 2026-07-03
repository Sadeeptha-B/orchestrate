import { useRef } from 'react';
import { useDayPlan } from '../hooks/useDayPlan';
import { useDataImport } from '../hooks/useDataImport';
import { Modal } from './ui/Modal';
import { ConfirmModal } from './ui/ConfirmModal';
import { Button } from './ui/Button';

interface RestoreModalProps {
    open: boolean;
    onClose: () => void;
}

/**
 * Seamless restore flow surfaced from the Welcome page. Lets the user import a Full
 * Backup or a saved-sessions file in place, then load any restored day as today's plan
 * without leaving Welcome — replacing the old "redirect to Settings" round-trip.
 */
export function RestoreModal({ open, onClose }: RestoreModalProps) {
    const { history, dispatch } = useDayPlan();
    const {
        importError,
        importInfo,
        pendingBackup,
        importDayPlanFile,
        importBackupFile,
        confirmBackupImport,
        cancelBackupImport,
        reset,
    } = useDataImport();
    const backupInputRef = useRef<HTMLInputElement>(null);
    const dayPlanInputRef = useRef<HTMLInputElement>(null);

    const close = () => {
        reset();
        onClose();
    };

    const handleUseAsToday = (savedAt: string) => {
        dispatch({ type: 'RESTORE_DAY', savedAt });
        // RESTORE_DAY sets the day plan (often setupComplete), so the `/` route re-renders
        // to the Dashboard on its own — just dismiss the modal.
        close();
    };

    return (
        <Modal open={open} onClose={close} title="Restore from a backup">
            <div className="space-y-5">
                <p className="text-sm text-text-light">
                    Moving from another browser or device? Import your data here, then load any
                    saved day as today's plan — all without leaving this page.
                </p>

                <div className="flex flex-wrap gap-2">
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => backupInputRef.current?.click()}
                        title="Restore a Full Backup file (settings, life, saved days, and the day you were working on; replaces local data with the backup's)"
                    >
                        Import Full Backup
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => dayPlanInputRef.current?.click()}
                        title="Import a single day plan JSON file"
                    >
                        Import Day Plan
                    </Button>
                </div>

                <input
                    ref={backupInputRef}
                    type="file"
                    accept=".json"
                    className="hidden"
                    onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) importBackupFile(file);
                        e.target.value = '';
                    }}
                />
                <input
                    ref={dayPlanInputRef}
                    type="file"
                    accept=".json"
                    className="hidden"
                    onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) importDayPlanFile(file);
                        e.target.value = '';
                    }}
                />

                {importError && <p className="text-xs text-red-500">{importError}</p>}
                {importInfo && <p className="text-xs text-success">{importInfo}</p>}

                {history.length > 0 && (
                    <div className="space-y-2 pt-3 border-t border-border">
                        <h4 className="text-xs font-semibold text-text-light uppercase tracking-wider">
                            Load a day as today's plan
                        </h4>
                        <p className="text-xs text-text-light">
                            This replaces your current day plan with the saved one.
                        </p>
                        <ul className="space-y-2 max-h-64 overflow-y-auto scrollbar-subtle">
                            {history.map((entry) => {
                                const items = entry.plan.intentions ?? [];
                                const linkedTasks = entry.plan.linkedTasks;
                                const itemCount = linkedTasks ? linkedTasks.length : items.length;
                                const doneCount = linkedTasks
                                    ? linkedTasks.filter((lt) => lt.completed).length
                                    : items.filter((i) => i.completed).length;

                                return (
                                    <li
                                        key={entry.savedAt}
                                        className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
                                    >
                                        <div className="min-w-0">
                                            <p className="text-sm font-medium truncate">{entry.label}</p>
                                            <p className="text-xs text-text-light">
                                                {entry.plan.date} &middot; {doneCount}/{itemCount} done
                                            </p>
                                        </div>
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            className="flex-shrink-0"
                                            onClick={() => handleUseAsToday(entry.savedAt)}
                                        >
                                            Use as today
                                        </Button>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                )}
            </div>

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
        </Modal>
    );
}
