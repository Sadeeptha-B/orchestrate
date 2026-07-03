import { useCallback, useState } from 'react';
import { useDayPlan } from './useDayPlan';
import { SCHEMA_VERSION, isSupportedSchemaVersion } from '../lib/schema';
import { isRecord, validateBackup, validateSessions, type FullBackup } from '../lib/dataImport';

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
 * one (see `IMPORT_BACKUP`). Because that is destructive, `importBackupFile` does not
 * dispatch directly when local data already exists; it parks the validated backup in
 * `pendingBackup` for the caller to confirm via `confirmBackupImport`.
 */
export function useDataImport() {
    const { settings, life, history, plan, dispatch } = useDayPlan();
    const [state, setState] = useState<DataImportState>({
        importError: null,
        importInfo: null,
        importedDayCount: null,
    });
    const [pendingBackup, setPendingBackup] = useState<PendingBackup | null>(null);

    // Is there local data a backup restore would overwrite? (i.e. not a pristine install.)
    const hasLocalData =
        history.length > 0 ||
        life.seasons.length > 0 ||
        life.habits.length > 0 ||
        (life.backlog?.length ?? 0) > 0 ||
        (life.sessionTemplates?.length ?? 0) > 0 ||
        plan.intentions.length > 0 ||
        plan.setupComplete ||
        Boolean(settings.userName);

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
                if (!isRecord(parsed)) {
                    setState({
                        importError: 'File is not a recognised Orchestrate full backup.',
                        importInfo: null,
                        importedDayCount: null,
                    });
                    return;
                }
                // Schema guard: refuse backups outside the supported range (floor → current).
                if (!isSupportedSchemaVersion(parsed._schemaVersion)) {
                    setState({
                        importError: `Backup is from an unsupported version (expected schema ${SCHEMA_VERSION} or a supported predecessor). Only supported backups can be imported.`,
                        importInfo: null,
                        importedDayCount: null,
                    });
                    return;
                }
                const data = validateBackup(parsed);
                if (!data) {
                    setState({
                        importError: 'Backup file is malformed or contains unsupported day plans.',
                        importInfo: null,
                        importedDayCount: null,
                    });
                    return;
                }
                // Authoritative restore replaces local data — confirm first if there's anything to lose.
                if (hasLocalData) {
                    setPendingBackup({ data, summary: describeBackup(data) });
                    return;
                }
                commitBackup(data);
            });
        },
        [readFile, hasLocalData, commitBackup],
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
