import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDayPlan } from '../../hooks/useDayPlan';
import { useTodoistData } from '../../hooks/useTodoist';
import { useIntentionRemoval } from '../../hooks/useIntentionRemoval';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { ConfirmModal } from '../ui/ConfirmModal';
import { useConfirmModal } from '../../hooks/useConfirmModal';

/**
 * v6.2: list view of `life.backlog` shown inside the `HistorySidebar`'s Backlog tab.
 * Each row: intention title + task-count + archived-from date + reason chip,
 * with per-row "Bring to today" and "Discard" affordances.
 */
export function BacklogTab() {
    const { life, plan, dispatch } = useDayPlan();
    const { taskMap } = useTodoistData();
    const { discardFromBacklog } = useIntentionRemoval();
    const navigate = useNavigate();
    const confirmDiscard = useConfirmModal<string>();

    const entries = useMemo(
        () => [...(life.backlog ?? [])].sort((a, b) => b.archivedAt.localeCompare(a.archivedAt)),
        [life.backlog],
    );

    const handleBringBack = (backlogId: string) => {
        const entry = entries.find((e) => e.id === backlogId);
        if (!entry) return;
        // Build a fresh title cache from live Todoist data, then fall back to the
        // entry's captured titleSnapshots inside the reducer helper.
        const taskCache: Record<string, string> = {};
        for (const id of entry.intention.linkedTaskIds) {
            const t = taskMap.get(id);
            if (t) taskCache[id] = t.content;
        }
        dispatch({ type: 'RESTORE_FROM_BACKLOG', backlogId, taskCache });
        // If today's plan isn't set up yet, hop the user into the wizard so they
        // can re-flow the restored tasks through Step 2 + Step 3.
        if (!plan.setupComplete) navigate('/setup', { state: { fromWelcome: true } });
    };

    if (entries.length === 0) {
        return (
            <p className="text-xs text-text-light">
                Nothing in the backlog. Intentions you defer (📥) or that roll over from earlier days will appear here.
            </p>
        );
    }

    return (
        <div className="space-y-2">
            {entries.map((entry) => {
                const pendingCount = entry.intention.linkedTaskIds.length;
                const completedTitles = entry.completedTaskTitles ?? [];
                return (
                    <Card key={entry.id} className="!p-3">
                        <div className="space-y-2">
                            <div className="min-w-0">
                                <p className="text-sm font-medium truncate" title={entry.intention.title}>
                                    {entry.intention.title}
                                </p>
                                <p className="text-xs text-text-light">
                                    {pendingCount} pending &middot;
                                    {' '}from {entry.archivedFromDate} &middot;
                                    {' '}{entry.reason === 'rollover' ? 'rolled over' : 'manual'}
                                </p>
                                {completedTitles.length > 0 && (
                                    <p
                                        className="text-xs text-text-light/70 truncate"
                                        title={completedTitles.join('\n')}
                                    >
                                        ✓ Done: {completedTitles.join(', ')}
                                    </p>
                                )}
                            </div>
                            <div className="flex gap-2">
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => handleBringBack(entry.id)}
                                >
                                    Bring to today
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => confirmDiscard.open(entry.id)}
                                >
                                    Discard
                                </Button>
                            </div>
                        </div>
                    </Card>
                );
            })}

            <ConfirmModal
                open={confirmDiscard.value !== null}
                onClose={confirmDiscard.close}
                onConfirm={() => confirmDiscard.value ? discardFromBacklog(confirmDiscard.value) : Promise.resolve()}
                title="Discard backlog entry?"
                confirmLabel="Discard"
            >
                <p className="text-sm text-text-light mb-4">
                    The intention will be removed from the backlog. Any of its linked
                    Todoist tasks that are currently scheduled will be unscheduled.
                </p>
            </ConfirmModal>
        </div>
    );
}
