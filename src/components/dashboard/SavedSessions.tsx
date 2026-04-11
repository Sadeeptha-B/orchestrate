import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDayPlan } from '../../context/DayPlanContext';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import type { SavedDayPlan } from '../../types';

function downloadJSON(data: unknown, filename: string) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

function sanitizeFilename(name: string): string {
    return name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
}

function validateImport(data: unknown): SavedDayPlan[] | null {
    const arr = Array.isArray(data) ? data : [data];
    for (const item of arr) {
        if (
            !item ||
            typeof item !== 'object' ||
            typeof (item as SavedDayPlan).savedAt !== 'string' ||
            typeof (item as SavedDayPlan).label !== 'string' ||
            !(item as SavedDayPlan).plan ||
            // Accept both v1 (tasks) and v2 (intentions) formats
            (!Array.isArray((item as SavedDayPlan).plan?.intentions) &&
                !Array.isArray((item as unknown as { plan: { tasks: unknown[] } }).plan?.tasks))
        ) {
            return null;
        }
    }
    return arr as SavedDayPlan[];
}

interface SavedSessionsProps {
    compact?: boolean;
    hideHeading?: boolean;
}

export function SavedSessions({ compact = false, hideHeading = false }: SavedSessionsProps) {
    const { history, dispatch } = useDayPlan();
    const navigate = useNavigate();
    const [confirmRestore, setConfirmRestore] = useState<string | null>(null);
    const [importError, setImportError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleRestore = (savedAt: string) => {
        dispatch({ type: 'RESTORE_DAY', savedAt });
        setConfirmRestore(null);
        navigate('/');
    };

    const exportSession = (entry: SavedDayPlan) => {
        const filename = `orchestrate-${sanitizeFilename(entry.label)}.json`;
        downloadJSON(entry, filename);
    };

    const exportAll = () => {
        downloadJSON(history, `orchestrate-all-sessions.json`);
    };

    const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
        setImportError(null);
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = () => {
            try {
                const data = JSON.parse(reader.result as string);
                const sessions = validateImport(data);
                if (!sessions) {
                    setImportError('Invalid session file format.');
                    return;
                }
                dispatch({ type: 'IMPORT_SESSIONS', sessions });
                setImportError(null);
            } catch {
                setImportError('Could not parse the file as JSON.');
            }
        };
        reader.readAsText(file);
        // Reset so the same file can be re-imported
        e.target.value = '';
    };

    return (
        <div className="space-y-3">
            {!hideHeading && (
                <h3 className="text-sm font-semibold text-text-light uppercase tracking-wider">
                    {compact ? 'Restore from Saved' : 'Saved Sessions'}
                </h3>
            )}

            <div className="flex flex-wrap gap-2">
                {!compact && history.length > 0 && (
                    <Button variant="secondary" size="sm" onClick={exportAll}>
                        Export All
                    </Button>
                )}
                <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>
                    Import
                </Button>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json"
                    className="hidden"
                    onChange={handleImport}
                />
            </div>

            {importError && (
                <p className="text-xs text-red-500">{importError}</p>
            )}

            {history.length === 0 && (
                <p className="text-xs text-text-light">No saved sessions yet.</p>
            )}

            <div className="space-y-2">
                {history.map((entry) => {
                    const items = entry.plan.intentions ?? (entry.plan as unknown as { tasks: typeof entry.plan.intentions }).tasks ?? [];
                    const itemCount = items.length;
                    const doneCount = items.filter((i) => i.completed).length;
                    const itemNames = items.map((i) => i.title).join('\n');

                    return (
                        <Card key={entry.savedAt} className="!p-3" title={itemNames}>
                            <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="text-sm font-medium truncate">{entry.label}</p>
                                    <p className="text-xs text-text-light">
                                        {entry.plan.date} &middot; {doneCount}/{itemCount} done
                                        {!compact && ''}
                                    </p>
                                </div>
                                <div className="flex gap-2 flex-shrink-0">
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => setConfirmRestore(entry.savedAt)}
                                    >
                                        Restore
                                    </Button>
                                    {!compact && (
                                        <>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => exportSession(entry)}
                                                title="Export as JSON"
                                            >
                                                Export
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() =>
                                                    dispatch({ type: 'DELETE_SAVED_DAY', savedAt: entry.savedAt })
                                                }
                                            >
                                                Delete
                                            </Button>
                                        </>
                                    )}
                                </div>
                            </div>
                        </Card>
                    );
                })}
            </div>

            <Modal
                open={confirmRestore !== null}
                onClose={() => setConfirmRestore(null)}
                title="Restore saved session?"
            >
                <p className="text-sm text-text-light mb-4">
                    This will replace your current day plan with the saved one.
                    Any unsaved changes will be lost.
                </p>
                <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setConfirmRestore(null)}>
                        Cancel
                    </Button>
                    <Button size="sm" onClick={() => confirmRestore && handleRestore(confirmRestore)}>
                        Restore
                    </Button>
                </div>
            </Modal>
        </div>
    );
}
