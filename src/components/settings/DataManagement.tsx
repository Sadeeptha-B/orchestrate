import { useRef, useState } from 'react';
import { useDayPlan } from '../../hooks/useDayPlan';
import { Button } from '../ui/Button';
import { downloadJSON } from '../../lib/download';
import type { AppSettings, LifeContext, SavedDayPlan } from '../../types';

interface FullBackup {
    settings?: AppSettings;
    life?: LifeContext;
    history?: SavedDayPlan[];
    _backupVersion?: number;
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
            // Accept v1 (tasks), v2/v3 (intentions), and v4 (intentions + linkedTasks)
            (!Array.isArray((item as SavedDayPlan).plan?.intentions) &&
                !Array.isArray((item as unknown as { plan: { tasks: unknown[] } }).plan?.tasks))
        ) {
            return null;
        }
    }
    return arr as SavedDayPlan[];
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

    const exportFullBackup = () => {
        const payload: FullBackup = {
            settings,
            life,
            history,
            _backupVersion: 1,
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
                const data = JSON.parse(reader.result as string) as FullBackup;
                if (
                    typeof data !== 'object' ||
                    data === null ||
                    (!data.settings && !data.life && !data.history)
                ) {
                    setImportError('File is not a recognised Orchestrate full backup.');
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
        </div>
    );
}
