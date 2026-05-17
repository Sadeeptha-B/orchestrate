import type { BacklogEntry, DayPlan, EngagementRecord, Intention, LinkedTask } from '../types';
import { buildLinkedTaskMap } from './tasks';

/**
 * v6.2: returns true when an intention has at least one intention-bound linked task
 * that isn't yet completed. Empty-linked-task intentions are NOT considered unfinished —
 * there's nothing to recover.
 */
export function hasUnfinishedWork(intention: Intention, plan: DayPlan): boolean {
    if (intention.linkedTaskIds.length === 0) return false;
    return plan.linkedTasks.some(
        (lt) => lt.intentionId === intention.id && !lt.completed,
    );
}

/**
 * v6.2: snapshot an intention into a BacklogEntry. Splits tasks into pending vs completed:
 *  - Pending ids stay on `intention.linkedTaskIds` and have their `titleSnapshot`s captured
 *    in `taskSnapshots` so a future bring-back can render labels even if the underlying
 *    Todoist task is gone.
 *  - Completed tasks are stripped from `linkedTaskIds` and only their titles are kept in
 *    `completedTaskTitles` as read-only context (avoids the broken "stale" rendering in
 *    Step 2 when a completed task would otherwise be rebuilt as fresh `unclassified`).
 *
 * Completed-title fallback chain: `lt.titleSnapshot` (always set by `TOGGLE_TASK_COMPLETE`)
 * → the todoistId itself. Live Todoist titles aren't queried here because both callers
 * (reducer + rollover init) run in contexts without `taskMap` access.
 */
export function buildBacklogEntry(
    intention: Intention,
    plan: DayPlan,
    reason: BacklogEntry['reason'],
): BacklogEntry {
    const linkedTaskMap = buildLinkedTaskMap(plan.linkedTasks);
    const pendingIds: string[] = [];
    const taskSnapshots: Record<string, string> = {};
    const completedTaskTitles: string[] = [];
    const unfinishedTaskRecords: Record<string, EngagementRecord> = {};

    for (const id of intention.linkedTaskIds) {
        const lt = linkedTaskMap.get(id);
        if (lt?.completed) {
            completedTaskTitles.push(lt.titleSnapshot ?? id);
            continue;
        }
        pendingIds.push(id);
        if (lt?.titleSnapshot) taskSnapshots[id] = lt.titleSnapshot;
        // v6.3: preserve engagement memo for pending tasks the user engaged with.
        if (lt?.engagement) unfinishedTaskRecords[id] = lt.engagement;
    }

    return {
        id: crypto.randomUUID(),
        intention: { ...intention, linkedTaskIds: pendingIds },
        archivedAt: new Date().toISOString(),
        archivedFromDate: plan.date,
        reason,
        ...(Object.keys(taskSnapshots).length > 0 ? { taskSnapshots } : {}),
        ...(completedTaskTitles.length > 0 ? { completedTaskTitles } : {}),
        ...(Object.keys(unfinishedTaskRecords).length > 0 ? { unfinishedTaskRecords } : {}),
    };
}

/**
 * v6.2: harvest unfinished intentions from a stale plan into BacklogEntries.
 * Used by the rollover migration in DayPlanContext's loadInitialState.
 */
export function harvestStalePlan(plan: DayPlan): BacklogEntry[] {
    return plan.intentions
        .filter((i) => hasUnfinishedWork(i, plan))
        .map((i) => buildBacklogEntry(i, plan, 'rollover'));
}

/**
 * v6.2: rebuild LinkedTask rows when an intention is brought back from the backlog.
 * Fresh state — no categorization, no estimate, no assignment, not completed.
 * `taskCache` is the live Todoist title map (todoistId → content); falls back to
 * the entry's captured `taskSnapshots`, then to the id itself as a last resort.
 *
 * v6.3: rebuilt rows whose id had an engagement record at archive time get stamped
 * with `rescheduledFromTodoistId` + `rescheduledAt` (engagement memo stays read-only
 * on the BacklogEntry — it's not transferred to the successor).
 */
export function rebuildLinkedTasksForBacklogEntry(
    entry: BacklogEntry,
    taskCache: Record<string, string>,
    nowISO: string,
): LinkedTask[] {
    const unfinished = entry.unfinishedTaskRecords ?? {};
    return entry.intention.linkedTaskIds.map((todoistId) => {
        const titleSnapshot =
            taskCache[todoistId] ?? entry.taskSnapshots?.[todoistId];
        const wasEngaged = todoistId in unfinished;
        return {
            todoistId,
            intentionId: entry.intention.id,
            type: 'unclassified' as const,
            assignedSessions: [],
            completed: false,
            estimatedMinutes: null,
            status: 'pending' as const,
            ...(titleSnapshot ? { titleSnapshot } : {}),
            ...(wasEngaged ? { rescheduledFromTodoistId: todoistId, rescheduledAt: nowISO } : {}),
        };
    });
}

