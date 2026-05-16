import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDayPlan } from '../../hooks/useDayPlan';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { downloadJSON } from '../../lib/download';
import type { SavedDayPlan } from '../../types';
import { BacklogTab } from './BacklogTab';

export type HistoryTab = 'sessions' | 'backlog';

function sanitizeFilename(name: string): string {
    return name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
}

/**
 * v6.2: container for the left-side history sidebar. Replaces the v6.1 `SavedSessions`
 * component; the previous per-row session UI now lives inside `SavedSessionsTab`.
 * Tab state is controlled by the parent (Dashboard / WizardLayout) so the header
 * buttons can both toggle the panel and switch tabs in a single click.
 */
export function HistorySidebar({
    tab,
    onTabChange,
}: {
    tab: HistoryTab;
    onTabChange: (tab: HistoryTab) => void;
}) {
    const { life, history } = useDayPlan();
    const backlogCount = life.backlog?.length ?? 0;
    const sessionsCount = history.length;

    return (
        <div className="space-y-3">
            <div className="flex gap-1">
                <TabButton
                    active={tab === 'sessions'}
                    onClick={() => onTabChange('sessions')}
                    label="Saved Sessions"
                    count={sessionsCount}
                />
                <TabButton
                    active={tab === 'backlog'}
                    onClick={() => onTabChange('backlog')}
                    label="Backlog"
                    count={backlogCount}
                />
            </div>
            {tab === 'sessions' ? <SavedSessionsTab /> : <BacklogTab />}
        </div>
    );
}

function TabButton({
    active,
    onClick,
    label,
    count,
}: {
    active: boolean;
    onClick: () => void;
    label: string;
    count: number;
}) {
    return (
        <button
            onClick={onClick}
            className={`flex-1 px-2.5 py-1.5 text-xs rounded-md border transition-colors cursor-pointer ${active
                ? 'bg-accent text-white border-accent'
                : 'border-border text-text-light hover:border-accent hover:text-accent'
                }`}
        >
            {label} {count > 0 && <span className="opacity-80">({count})</span>}
        </button>
    );
}

/** v6.2: extracted from the former `SavedSessions` component. Per-row Restore / Export / Delete. */
export function SavedSessionsTab() {
    const { history, dispatch } = useDayPlan();
    const navigate = useNavigate();
    const [confirmRestore, setConfirmRestore] = useState<string | null>(null);

    const handleRestore = (savedAt: string) => {
        dispatch({ type: 'RESTORE_DAY', savedAt });
        setConfirmRestore(null);
        navigate('/');
    };

    const exportSession = (entry: SavedDayPlan) => {
        const filename = `orchestrate-${sanitizeFilename(entry.label)}.json`;
        downloadJSON(entry, filename);
    };

    if (history.length === 0) {
        return <p className="text-xs text-text-light">No saved sessions yet.</p>;
    }

    return (
        <div className="space-y-2">
            {history.map((entry) => {
                const items = entry.plan.intentions ?? [];
                const linkedTasks = entry.plan.linkedTasks;
                const itemCount = linkedTasks ? linkedTasks.length : items.length;
                const doneCount = linkedTasks
                    ? linkedTasks.filter((lt) => lt.completed).length
                    : items.filter((i) => i.completed).length;
                const itemNames = items.map((i) => i.title).join('\n');

                return (
                    <Card key={entry.savedAt} className="!p-3" title={itemNames}>
                        <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                                <p className="text-sm font-medium truncate">{entry.label}</p>
                                <p className="text-xs text-text-light">
                                    {entry.plan.date} &middot; {doneCount}/{itemCount} done
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
                            </div>
                        </div>
                    </Card>
                );
            })}

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
