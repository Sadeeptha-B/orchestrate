import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDayPlan } from '../../hooks/useDayPlan';
import { useTodoistData } from '../../hooks/useTodoist';
import { totalEngagedSeconds } from '../../lib/engagement';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';

/**
 * v6.2: list view of `life.backlog` shown inside the `HistorySidebar`'s Backlog tab.
 * Each row: intention title + task-count + archived-from date + reason chip, a collapsible
 * task list, and per-row "Bring to today" and "Discard" affordances. v7.9: discard
 * confirmation is owned by `HistorySidebar` and pinned at the bottom of the sidebar; this
 * component just signals which entry the user wants to discard via `onRequestDiscard`.
 */
export function BacklogTab({
    pendingDiscardId,
    onRequestDiscard,
}: {
    pendingDiscardId: string | null;
    onRequestDiscard: (id: string | null) => void;
}) {
    const { life, plan, dispatch } = useDayPlan();
    const { taskMap } = useTodoistData();
    const navigate = useNavigate();
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

    const entries = useMemo(
        () => [...(life.backlog ?? [])].sort((a, b) => b.archivedAt.localeCompare(a.archivedAt)),
        [life.backlog],
    );

    const toggleExpanded = (id: string) => {
        setExpandedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

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
        // can re-flow the restored tasks through the Intentions + Schedule steps.
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
                const pendingIds = entry.intention.linkedTaskIds;
                const pendingCount = pendingIds.length;
                const completedTitles = entry.completedTaskTitles ?? [];
                const unfinishedRecords = entry.unfinishedTaskRecords ?? {};
                const unfinishedIds = Object.keys(unfinishedRecords);
                const minutesFor = (id: string) =>
                    Math.round(totalEngagedSeconds(unfinishedRecords[id], Date.parse(entry.archivedAt)) / 60);
                const unfinishedTotalMinutes = unfinishedIds.reduce((sum, id) => sum + minutesFor(id), 0);
                const unfinishedTooltip = unfinishedIds
                    .map((id) => `${entry.taskSnapshots?.[id] ?? id}: ${minutesFor(id)}m`)
                    .join('\n');
                const titleFor = (id: string) => taskMap.get(id)?.content ?? entry.taskSnapshots?.[id] ?? id;
                const isExpanded = expandedIds.has(entry.id);
                const isPendingDiscard = pendingDiscardId === entry.id;
                return (
                    <Card
                        key={entry.id}
                        className={`!p-3 transition-shadow ${isPendingDiscard ? 'ring-1 ring-red-400/50' : ''}`}
                    >
                        <div className="space-y-2">
                            <div className="min-w-0">
                                <p className="text-sm font-medium truncate" title={entry.intention.title}>
                                    {entry.intention.title}
                                </p>
                                <p className="text-xs text-text-light">
                                    {pendingCount > 0 ? (
                                        <button
                                            onClick={() => toggleExpanded(entry.id)}
                                            className="hover:text-accent transition-colors cursor-pointer inline-flex items-center gap-0.5"
                                            title={isExpanded ? 'Hide tasks' : 'View tasks'}
                                        >
                                            <span className={`transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}>›</span>
                                            {pendingCount} pending
                                        </button>
                                    ) : (
                                        <span>{pendingCount} pending</span>
                                    )}
                                    {' '}&middot; from {entry.archivedFromDate} &middot;
                                    {' '}{entry.reason === 'rollover' ? 'rolled over' : 'manual'}
                                </p>
                                {isExpanded && pendingCount > 0 && (
                                    <ul className="mt-1.5 space-y-0.5 border-l border-border/60 pl-2.5">
                                        {pendingIds.map((id) => (
                                            <li key={id} className="text-xs text-text-light truncate" title={titleFor(id)}>
                                                {titleFor(id)}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                                {unfinishedIds.length > 0 && (
                                    <p
                                        className="text-xs text-amber-700 dark:text-amber-300 mt-1"
                                        title={unfinishedTooltip}
                                    >
                                        ✱ Engaged earlier: {unfinishedIds.length} task{unfinishedIds.length === 1 ? '' : 's'}, {unfinishedTotalMinutes}m
                                    </p>
                                )}
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
                                    onClick={() => onRequestDiscard(entry.id)}
                                >
                                    Discard
                                </Button>
                            </div>
                        </div>
                    </Card>
                );
            })}
        </div>
    );
}
