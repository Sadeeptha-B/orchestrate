import { useCallback, useState } from 'react';
import { useDayPlan } from './useDayPlan';
import { useTodoistData } from './useTodoist';
import { useGoogleCalendarData } from './useGoogleCalendar';
import { SCHEMA_VERSION } from '../lib/schema';
import { latestLocalChangeMs } from '../lib/cloudSync';
import { validateBackup, validateSessions, type BackupInvalidReason, type FullBackup } from '../lib/dataImport';

/**
 * v7.11: slack before the "older backup" warning fires. Wide enough that an export→re-import
 * round-trip (or a stray settings write after exporting) doesn't nag; A3's real case is a
 * backup that's hours-to-weeks behind the live data.
 */
const BACKUP_AGE_WARN_MS = 5 * 60_000;

/** User-facing message per `validateBackup` rejection reason. */
const BACKUP_ERROR_MESSAGES: Record<BackupInvalidReason, string> = {
    'sessions-file':
        'This is a day-plans file (an Export All Sessions download), not a Full Backup — use Import Day Plan instead.',
    'not-a-backup': 'File is not a recognised Orchestrate full backup.',
    'unsupported-schema':
        `Backup is from an unsupported version (expected schema ${SCHEMA_VERSION} or a supported predecessor). Only supported backups can be imported.`,
    'malformed': 'Backup file is malformed or contains unsupported day plans.',
};

export interface DataImportState {
    importError: string | null;
    importInfo: string | null;
    /** Number of day plans added to Saved Sessions by the most recent successful import (0 if none). */
    importedDayCount: number | null;
}

/** A validated backup awaiting confirmation because importing it would replace local data. */
export interface PendingBackup {
    data: FullBackup;
    /** Human-readable list of the slices the backup will overwrite (for the confirm dialog). */
    summary: string[];
    /** v7.11: provenance mismatches (account / origin) the user should see before restoring. */
    warnings: string[];
    /** v7.11: `_exportedAt` from the backup, for the "exported on …" caption (absent pre-7.7). */
    exportedAt?: string;
}

function describeBackup(data: FullBackup): string[] {
    const parts: string[] = [];
    if (data.settings) parts.push('settings');
    if (data.life) parts.push('life (seasons, habits, backlog, templates)');
    if (data.history) {
        parts.push(`${data.history.length} saved day${data.history.length !== 1 ? 's' : ''}`);
    }
    if (data.currentDay) parts.push("today's plan");
    return parts;
}

/**
 * Shared restore/import logic for both the Settings → Data panel and the Welcome
 * restore flow. Owns parse + validate + dispatch and surfaces a small status model
 * so each caller can render its own UI around it.
 *
 * Backup import is **authoritative** — each slice the backup carries replaces the local
 * one (see `IMPORT_BACKUP`). Because that is destructive, `importBackupFile` never
 * dispatches directly: every validated backup is parked in `pendingBackup` for the
 * caller to confirm via `confirmBackupImport` (the shared `RestoreConfirmModal`, which
 * also owns the "download a backup of the current data first" escape hatch).
 */
export function useDataImport() {
    const { settings, dispatch } = useDayPlan();
    const { accountId: todoistAccountId, accountEmail: todoistAccountEmail } = useTodoistData();
    const { availableCalendars } = useGoogleCalendarData();
    const [state, setState] = useState<DataImportState>({
        importError: null,
        importInfo: null,
        importedDayCount: null,
    });
    const [pendingBackup, setPendingBackup] = useState<PendingBackup | null>(null);

    /**
     * v7.11: provenance checks — compare the backup's account fingerprints (riding inside its
     * `settings`) and origin host against the live connections (preferred) or this store's own
     * fingerprints. Purely informative here: the hard stop against cross-account writes is the
     * reconcile/sync mismatch gate, which the imported fingerprint arms automatically.
     */
    const buildProvenanceWarnings = useCallback((data: FullBackup): string[] => {
        const label = (ref: { id: string; email?: string }) => ref.email ?? ref.id;
        const warnings: string[] = [];

        const backupTodoist = data.settings?.todoistAccount;
        const localTodoist = todoistAccountId
            ? { id: todoistAccountId, ...(todoistAccountEmail ? { email: todoistAccountEmail } : {}) }
            : settings.todoistAccount;
        if (backupTodoist && localTodoist && backupTodoist.id !== localTodoist.id) {
            warnings.push(
                `Different Todoist account — the backup's habits were synced against ${label(backupTodoist)}, `
                + `but this device uses ${label(localTodoist)}. After restoring, habit auto-sync stays paused `
                + 'until you adopt the connected account on the Habits page.',
            );
        }

        const backupGoogle = data.settings?.googleAccount;
        const primary = availableCalendars.find((c) => c.primary);
        const localGoogle = primary ? { id: primary.id, email: primary.id } : settings.googleAccount;
        if (backupGoogle && localGoogle && backupGoogle.id !== localGoogle.id) {
            warnings.push(
                `Different Google account — the backup's calendar references belong to ${label(backupGoogle)}, `
                + `but this device uses ${label(localGoogle)}.`,
            );
        }

        if (
            data._originHost
            && typeof window !== 'undefined'
            && data._originHost !== window.location.host
        ) {
            warnings.push(
                `Different environment — exported from ${data._originHost}, importing into ${window.location.host}.`,
            );
        }

        // v7.11 (A3): warn when the backup predates the data it would replace. The sync meta
        // clock also carries adopted-remote stamps, so this works on a freshly-synced device too.
        // Pre-7.7 backups have no _exportedAt and skip the check.
        if (data._exportedAt) {
            const exportedMs = Date.parse(data._exportedAt);
            const latestLocalMs = latestLocalChangeMs();
            if (Number.isFinite(exportedMs) && latestLocalMs - exportedMs > BACKUP_AGE_WARN_MS) {
                warnings.push(
                    `Older backup — exported ${new Date(exportedMs).toLocaleString()}, but the data here `
                    + `changed as recently as ${new Date(latestLocalMs).toLocaleString()}. Restoring rolls `
                    + 'everything back to the backup, and the rollback syncs to your other devices.',
                );
            }
        }
        return warnings;
    }, [todoistAccountId, todoistAccountEmail, availableCalendars, settings.todoistAccount, settings.googleAccount]);

    const reset = useCallback(() => {
        setState({ importError: null, importInfo: null, importedDayCount: null });
        setPendingBackup(null);
    }, []);

    const readFile = useCallback(
        (file: File, onParsed: (data: unknown) => void) => {
            setState({ importError: null, importInfo: null, importedDayCount: null });
            setPendingBackup(null);
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    onParsed(JSON.parse(reader.result as string));
                } catch {
                    setState({
                        importError: 'Could not parse the file as JSON.',
                        importInfo: null,
                        importedDayCount: null,
                    });
                }
            };
            reader.readAsText(file);
        },
        [],
    );

    const commitBackup = useCallback(
        (data: FullBackup) => {
            // Drop the Todoist snapshot so pre-restore task rows can't briefly render against
            // the imported registry; it's rebuilt from the API on the next fetch. (Reset
            // Everything clears the same key, for the same reason.)
            try { localStorage.removeItem('orchestrate-todoist-cache'); } catch { /* ignore */ }
            dispatch({
                type: 'IMPORT_BACKUP',
                settings: data.settings,
                life: data.life,
                history: data.history,
                currentDay: data.currentDay,
            });
            setState({
                importError: null,
                importInfo: `Restored: ${describeBackup(data).join(', ')}`,
                importedDayCount: data.history?.length ?? 0,
            });
        },
        [dispatch],
    );

    const importDayPlanFile = useCallback(
        (file: File) => {
            readFile(file, (data) => {
                const sessions = validateSessions(data);
                if (!sessions) {
                    setState({
                        importError: 'Invalid day plan file format.',
                        importInfo: null,
                        importedDayCount: null,
                    });
                    return;
                }
                dispatch({ type: 'IMPORT_SESSIONS', sessions });
                setState({
                    importError: null,
                    importInfo: `Imported ${sessions.length} day plan${sessions.length !== 1 ? 's' : ''}.`,
                    importedDayCount: sessions.length,
                });
            });
        },
        [dispatch, readFile],
    );

    const importBackupFile = useCallback(
        (file: File) => {
            readFile(file, (parsed) => {
                const result = validateBackup(parsed);
                if (!result.ok) {
                    setState({
                        importError: BACKUP_ERROR_MESSAGES[result.reason],
                        importInfo: null,
                        importedDayCount: null,
                    });
                    return;
                }
                // Authoritative restore replaces local data — always park for confirmation
                // (the confirm modal offers a backup of the current data before it's replaced).
                const { data } = result;
                setPendingBackup({
                    data,
                    summary: describeBackup(data),
                    warnings: buildProvenanceWarnings(data),
                    exportedAt: data._exportedAt,
                });
            });
        },
        [readFile, buildProvenanceWarnings],
    );

    const confirmBackupImport = useCallback(() => {
        if (!pendingBackup) return;
        commitBackup(pendingBackup.data);
        setPendingBackup(null);
    }, [pendingBackup, commitBackup]);

    const cancelBackupImport = useCallback(() => {
        setPendingBackup(null);
    }, []);

    return {
        ...state,
        pendingBackup,
        importDayPlanFile,
        importBackupFile,
        confirmBackupImport,
        cancelBackupImport,
        reset,
    };
}
