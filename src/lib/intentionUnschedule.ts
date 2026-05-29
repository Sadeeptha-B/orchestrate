import type { TodoistTask } from '../hooks/useTodoist';
import type { TodoistActionsValue } from '../context/TodoistContext';

/**
 * v6.2: clear Todoist due dates for a set of task ids. Safe to call with ids that
 * are no longer in the cache (deleted upstream) or already-unscheduled tasks.
 *
 * Behavior per id:
 *  - Skip when the Todoist task is missing from `taskMap` (already deleted).
 *  - Skip when the Todoist task has no `due` (no-op).
 *  - Otherwise: `updateTask(id, { due_string: 'no date' })` — the Todoist-documented way to clear scheduling.
 *
 * v6.3: stabilizer habit tasks no longer live in `linkedTasks` (they're TodaysHabitInstance now),
 * so the prior per-task `sourceHabitId` skip is gone — every passed id is an intention-bound task.
 *
 * Errors are swallowed per call so a single bad id can't block the rest. Calls run in parallel
 * via `Promise.allSettled`. Local state proceeds regardless — Todoist drift is recoverable.
 */
export async function unscheduleIntentionTasks(
    todoistIds: string[],
    actions: TodoistActionsValue,
    taskMap: Map<string, TodoistTask>,
): Promise<void> {
    // v6.4: `updateTask` now returns `TodoistTask | null` (never throws — errors funnel
    // through `handleApiError`), so this `.catch` is defensive deadcode. Kept for safety
    // if the contract changes; widened array type to swallow the resolved value.
    const calls: Promise<unknown>[] = [];
    for (const id of todoistIds) {
        const t = taskMap.get(id);
        if (!t) continue;                    // already gone in Todoist
        if (!t.due) continue;                // not scheduled
        calls.push(
            actions.updateTask(id, { due_string: 'no date' }).catch((err) => {
                console.error(`[todoist] failed to unschedule task ${id}:`, err);
            }),
        );
    }
    await Promise.allSettled(calls);
}
