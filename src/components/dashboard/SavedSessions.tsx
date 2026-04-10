import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDayPlan } from '../../context/DayPlanContext';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';

interface SavedSessionsProps {
    compact?: boolean;
    hideHeading?: boolean;
}

export function SavedSessions({ compact = false, hideHeading = false }: SavedSessionsProps) {
    const { history, dispatch } = useDayPlan();
    const navigate = useNavigate();
    const [confirmRestore, setConfirmRestore] = useState<string | null>(null);

    if (history.length === 0) return null;

    const handleRestore = (savedAt: string) => {
        dispatch({ type: 'RESTORE_DAY', savedAt });
        setConfirmRestore(null);
        navigate('/');
    };

    return (
        <div className="space-y-3">
            {!hideHeading && (
                <h3 className="text-sm font-semibold text-text-light uppercase tracking-wider">
                    {compact ? 'Restore from Saved' : 'Saved Sessions'}
                </h3>
            )}

            <div className="space-y-2">
                {history.map((entry) => {
                    const taskCount = entry.plan.tasks.length;
                    const doneCount = entry.plan.tasks.filter((t) => t.completed).length;
                    const taskNames = entry.plan.tasks.map((t) => t.title).join('\n');

                    return (
                        <Card key={entry.savedAt} className="!p-3" title={taskNames}>
                            <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="text-sm font-medium truncate">{entry.label}</p>
                                    <p className="text-xs text-text-light">
                                        {entry.plan.date} &middot; {doneCount}/{taskCount} tasks
                                        {!compact && ' done'}
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
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() =>
                                                dispatch({ type: 'DELETE_SAVED_DAY', savedAt: entry.savedAt })
                                            }
                                        >
                                            Delete
                                        </Button>
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
