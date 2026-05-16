import { useCallback } from 'react';
import { useDayPlan } from '../hooks/useDayPlan';
import { useTodoistActions, useTodoistData } from '../hooks/useTodoist';
import type { TodoistTask } from '../hooks/useTodoist';
import type { TodoistActionsValue } from '../context/TodoistContext';
import type { LinkedTask } from '../types';

/**
 * v6.2: clear Todoist due dates for a set of task ids. Safe to call with ids that
 * are no longer in the cache (deleted upstream), already-unscheduled tasks, or
 * habit-derived orphans — each is skipped.
 *
 * Behavior per id:
 *  - Skip when the matching LinkedTask has `sourceHabitId` (habit-tasks are owned by `syncHabitToTodoist`).
 *  - Skip when the Todoist task is missing from `taskMap` (already deleted).
 *  - Skip when the Todoist task has no `due` (no-op).
 *  - Otherwise: `updateTask(id, { due_string: 'no date' })` — the Todoist-documented way to clear scheduling.
 *
 * Errors are swallowed per call so a single bad id can't block the rest. Calls run in parallel
 * via `Promise.allSettled`. Local state proceeds regardless — Todoist drift is recoverable; a
 * blocked deletion would be a worse UX failure than a residual due date.
 */
export async function unscheduleIntentionTasks(
    todoistIds: string[],
    linkedTasks: LinkedTask[],
    actions: TodoistActionsValue,
    taskMap: Map<string, TodoistTask>,
): Promise<void> {
    const ltById = new Map(linkedTasks.map((lt) => [lt.todoistId, lt]));
    const calls: Promise<void>[] = [];
    for (const id of todoistIds) {
        const lt = ltById.get(id);
        if (lt?.sourceHabitId) continue;     // habit-owned, not ours to touch
        const t = taskMap.get(id);
        if (!t) continue;                    // already gone in Todoist
        if (!t.due) continue;                // not scheduled
        calls.push(
            actions.updateTask(id, { due_string: 'no date' }).catch((err) => {
                console.warn(`[v6.2] failed to unschedule Todoist task ${id}:`, err);
            }),
        );
    }
    await Promise.allSettled(calls);
}

/**
 * v6.2: shared hook wrapping the "unschedule first, then dispatch" pattern used by
 * every intention-removal call site (Step 1 / Step 3 / BacklogTab).
 *
 * Three operations, all returning a void Promise so call sites can `await` if desired:
 *  - `moveToBacklog(intentionId)` — unschedules + dispatches `MOVE_INTENTION_TO_BACKLOG`.
 *  - `removeIntention(intentionId)` — unschedules + dispatches `REMOVE_INTENTION` (caller is responsible for any confirm modal).
 *  - `discardFromBacklog(backlogId)` — unschedules the entry's linked tasks + dispatches `DELETE_BACKLOG_ENTRY`.
 */
export function useIntentionRemoval(): {
    moveToBacklog: (intentionId: string) => Promise<void>;
    removeIntention: (intentionId: string) => Promise<void>;
    discardFromBacklog: (backlogId: string) => Promise<void>;
} {
    const { plan, life, dispatch } = useDayPlan();
    const actions = useTodoistActions();
    const { taskMap } = useTodoistData();

    const collectIntentionTaskIds = useCallback(
        (intentionId: string): string[] =>
            plan.linkedTasks
                .filter((lt) => lt.intentionId === intentionId)
                .map((lt) => lt.todoistId),
        [plan.linkedTasks],
    );

    const moveToBacklog = useCallback(async (intentionId: string) => {
        const ids = collectIntentionTaskIds(intentionId);
        await unscheduleIntentionTasks(ids, plan.linkedTasks, actions, taskMap);
        dispatch({ type: 'MOVE_INTENTION_TO_BACKLOG', intentionId, reason: 'manual' });
    }, [collectIntentionTaskIds, plan.linkedTasks, actions, taskMap, dispatch]);

    const removeIntention = useCallback(async (intentionId: string) => {
        const ids = collectIntentionTaskIds(intentionId);
        await unscheduleIntentionTasks(ids, plan.linkedTasks, actions, taskMap);
        dispatch({ type: 'REMOVE_INTENTION', intentionId });
    }, [collectIntentionTaskIds, plan.linkedTasks, actions, taskMap, dispatch]);

    const discardFromBacklog = useCallback(async (backlogId: string) => {
        const entry = (life.backlog ?? []).find((e) => e.id === backlogId);
        if (!entry) return;
        // For backlog tasks, LinkedTasks don't exist in plan anymore — pass an empty array
        // to the unschedule helper so it falls back to the taskMap check alone (no habit-owned filter
        // is needed because backlog entries can only hold intention-bound ids by construction).
        await unscheduleIntentionTasks(entry.intention.linkedTaskIds, [], actions, taskMap);
        dispatch({ type: 'DELETE_BACKLOG_ENTRY', backlogId });
    }, [life.backlog, actions, taskMap, dispatch]);

    return { moveToBacklog, removeIntention, discardFromBacklog };
}
