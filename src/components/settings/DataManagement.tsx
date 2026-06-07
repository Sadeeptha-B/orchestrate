import { useRef, useState } from 'react';
import { useDayPlan } from '../../hooks/useDayPlan';
import { Button } from '../ui/Button';
import { ConfirmModal } from '../ui/ConfirmModal';
import { useConfirmModal } from '../../hooks/useConfirmModal';
import { downloadJSON } from '../../lib/download';
import { SCHEMA_VERSION } from '../../context/DayPlanContext';
import type { AppSettings, LifeContext, SavedDayPlan } from '../../types';

interface FullBackup {
    settings?: AppSettings;
    life?: LifeContext;
    history?: SavedDayPlan[];
    _backupVersion?: number;
    _schemaVersion?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function validateSessions(data: unknown): SavedDayPlan[] | null {
    const arr = Array.isArray(data) ? data : [data];
    for (const item of arr) {
        if (
            !item ||
            typeof item !== 'object' ||
            typeof (item as SavedDayPlan).savedAt !== 'string' ||
            typeof (item as SavedDayPlan).label !== 'string' ||
            !(item as SavedDayPlan).plan ||
            !Array.isArray((item as SavedDayPlan).plan?.intentions) ||
            // Schema guard: only accept current-version saved plans (no migration).
            (item as unknown as { plan: { _schemaVersion?: number } }).plan?._schemaVersion !== SCHEMA_VERSION
        ) {
            return null;
        }
    }
    return arr as SavedDayPlan[];
}

function validateBackup(data: unknown): FullBackup | null {
    if (!isRecord(data) || (!data.settings && !data.life && !data.history)) {
        return null;
    }
    if (data._schemaVersion !== SCHEMA_VERSION) {
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
    return {
        settings: data.settings as AppSettings | undefined,
        life: data.life as LifeContext | undefined,
        history: data.history as SavedDayPlan[] | undefined,
        _backupVersion: typeof data._backupVersion === 'number' ? data._backupVersion : undefined,
        _schemaVersion: data._schemaVersion,
    };
}

interface DataManagementProps {
    /** Optional handler to surface the Saved Sessions sidebar (closes modal + reveals panel). */
    onShowSavedSessions?: () => void;
}

export function DataManagement({ onShowSavedSessions }: DataManagementProps) {
    const { settings, life, history, dispatch } = useDayPlan();
    const [importError, setImportError] = useState<string | null>(null);
    const [importInfo, setImportInfo] = useState<string | null>(null);
    const [showRestoreHint, setShowRestoreHint] = useState(false);
    const sessionsInputRef = useRef<HTMLInputElement>(null);
    const backupInputRef = useRef<HTMLInputElement>(null);
    const confirmResetDay = useConfirmModal<true>();
    const confirmResetAll = useConfirmModal<true>();

    const handleResetDay = () => {
        dispatch({ type: 'RESET_DAY' });
        setImportError(null);
        setImportInfo("Today's plan has been cleared.");
        setShowRestoreHint(false);
    };

    const handleResetAll = () => {
        // Clear the Todoist cache too — it's keyed off the token we're about to wipe.
        try { localStorage.removeItem('orchestrate-todoist-cache'); } catch { /* ignore */ }
        dispatch({ type: 'RESET_ALL' });
        setImportError(null);
        setImportInfo('All data has been reset to defaults.');
        setShowRestoreHint(false);
    };

    const exportFullBackup = () => {
        const payload: FullBackup = {
            settings,
            life,
            history,
            _backupVersion: 1,
            _schemaVersion: SCHEMA_VERSION,
        };
        const stamp = new Date().toISOString().slice(0, 10);
        downloadJSON(payload, `orchestrate-backup-${stamp}.json`);
    };

    const exportAllSessions = () => {
        downloadJSON(history, `orchestrate-all-sessions.json`);
    };

    const handleSessionsImport = (e: React.ChangeEvent<HTMLInputElement>) => {
        setImportError(null);
        setImportInfo(null);
        setShowRestoreHint(false);
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const data = JSON.parse(reader.result as string);
                const sessions = validateSessions(data);
                if (!sessions) {
                    setImportError('Invalid session file format.');
                    return;
                }
                dispatch({ type: 'IMPORT_SESSIONS', sessions });
                setImportInfo(`Imported ${sessions.length} session${sessions.length !== 1 ? 's' : ''}.`);
                setShowRestoreHint(sessions.length > 0);
            } catch {
                setImportError('Could not parse the file as JSON.');
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    };

    const handleBackupImport = (e: React.ChangeEvent<HTMLInputElement>) => {
        setImportError(null);
        setImportInfo(null);
        setShowRestoreHint(false);
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const parsed = JSON.parse(reader.result as string) as unknown;
                if (!isRecord(parsed)) {
                    setImportError('File is not a recognised Orchestrate full backup.');
                    return;
                }
                // Schema guard: refuse backups that aren't the current version (no migration).
                if (parsed._schemaVersion !== SCHEMA_VERSION) {
                    setImportError(
                        `Backup is from an unsupported version (expected schema ${SCHEMA_VERSION}). Only current backups can be imported.`,
                    );
                    return;
                }
                const data = validateBackup(parsed);
                if (!data) {
                    setImportError('Backup file is malformed or contains unsupported saved sessions.');
                    return;
                }
                dispatch({
                    type: 'IMPORT_BACKUP',
                    settings: data.settings,
                    life: data.life,
                    history: data.history,
                });
                const parts: string[] = [];
                if (data.settings) parts.push('settings');
                if (data.life) parts.push('life');
                if (data.history) parts.push(`${data.history.length} sessions`);
                setImportInfo(`Imported: ${parts.join(', ')}`);
                setShowRestoreHint(!!data.history && data.history.length > 0);
            } catch {
                setImportError('Could not parse the file as JSON.');
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    };

    return (
        <div className="space-y-5">
            <div className="space-y-2">
                <h4 className="text-xs font-semibold text-text-light uppercase tracking-wider">
                    Restore
                </h4>
                <p className="text-xs text-text-light">
                    Moving from another browser or device? Restore your data here, then pick a session to use as today's plan from the Saved Sessions sidebar.
                </p>
                <div className="flex flex-wrap gap-2">
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => backupInputRef.current?.click()}
                        title="Import from a Full Backup file (merges, never overwrites)"
                    >
                        Import Backup
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => sessionsInputRef.current?.click()}
                        title="Import a saved sessions JSON file"
                    >
                        Import Sessions
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
                ref={sessionsInputRef}
                type="file"
                accept=".json"
                className="hidden"
                onChange={handleSessionsImport}
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
            {importInfo && (
                <p className="text-xs text-success">{importInfo}</p>
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
