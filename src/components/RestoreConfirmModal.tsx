import { useState } from 'react';
import { useDayPlan } from '../hooks/useDayPlan';
import { downloadFullBackup } from '../lib/backup';
import { ConfirmModal } from './ui/ConfirmModal';
import type { PendingBackup } from '../hooks/useDataImport';

interface RestoreConfirmModalProps {
    /** The parked backup awaiting confirmation (from `useDataImport`), or null when closed. */
    pending: PendingBackup | null;
    onConfirm: () => void;
    onCancel: () => void;
}

/**
 * Shared confirm step for a Full Backup restore (Settings → Data and the Welcome restore
 * flow). Restore is authoritative and destructive, so every import passes through here —
 * and gets the same escape hatch Reset Everything offers: a default-on download of the
 * current data before it's replaced.
 */
export function RestoreConfirmModal({ pending, onConfirm, onCancel }: RestoreConfirmModalProps) {
    const { settings, life, history, plan } = useDayPlan();
    const [backupFirst, setBackupFirst] = useState(true);
    // Re-default the opt-in each time a new backup is parked (adjust-state-during-render
    // pattern — https://react.dev/learn/you-might-not-need-an-effect).
    const [lastPending, setLastPending] = useState(pending);
    if (pending !== lastPending) {
        setLastPending(pending);
        if (pending) setBackupFirst(true);
    }

    const handleConfirm = () => {
        if (backupFirst) downloadFullBackup({ settings, life, history, plan });
        onConfirm();
    };

    return (
        <ConfirmModal
            open={pending !== null}
            onClose={onCancel}
            onConfirm={handleConfirm}
            title="Restore from this backup?"
            confirmLabel="Replace & Restore"
        >
            <p className="text-sm text-text-light mb-3">
                This <strong>replaces</strong> your current{' '}
                {pending?.summary.join(', ')} with the backup's. Local entries not in the
                backup are removed — this is a restore, not a merge, and it syncs to your
                other devices.
                {pending?.exportedAt && (
                    <> Backup exported {new Date(pending.exportedAt).toLocaleString()}.</>
                )}
            </p>
            {(pending?.warnings.length ?? 0) > 0 && (
                <ul className="mb-3 space-y-1.5">
                    {pending?.warnings.map((w) => (
                        <li
                            key={w}
                            className="text-sm text-amber-700 dark:text-amber-300 flex gap-2"
                        >
                            <span aria-hidden>⚠</span>
                            <span>{w}</span>
                        </li>
                    ))}
                </ul>
            )}
            <label className="flex items-start gap-2 text-sm cursor-pointer mb-3">
                <input
                    type="checkbox"
                    className="mt-0.5 accent-accent"
                    checked={backupFirst}
                    onChange={(e) => setBackupFirst(e.target.checked)}
                />
                <span>
                    Download a Full Backup of this device's current data first{' '}
                    <span className="text-text-light text-xs">
                        (recommended — the only way back)
                    </span>
                </span>
            </label>
            <p className="text-sm text-text-light mb-4">
                Once replaced, the restore cannot be undone.
            </p>
        </ConfirmModal>
    );
}
