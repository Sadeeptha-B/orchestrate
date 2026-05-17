import type { TodoistTask } from '../hooks/useTodoist';
import type { TodoistActionsValue } from '../context/TodoistContext';
import type { LinkedTask } from '../types';

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
 * so the prior `sourceHabitId` skip is structurally unreachable. The `linkedTasks` arg is kept
 * for API stability but is no longer consulted for filtering.
 *
 * Errors are swallowed per call so a single bad id can't block the rest. Calls run in parallel
 * via `Promise.allSettled`. Local state proceeds regardless — Todoist drift is recoverable.
 */
export async function unscheduleIntentionTasks(
    todoistIds: string[],
    _linkedTasks: LinkedTask[],
    actions: TodoistActionsValue,
    taskMap: Map<string, TodoistTask>,
): Promise<void> {
    void _linkedTasks;
    const calls: Promise<void>[] = [];
    for (const id of todoistIds) {
        const t = taskMap.get(id);
        if (!t) continue;                    // already gone in Todoist
        if (!t.due) continue;                // not scheduled
        calls.push(
            actions.updateTask(id, { due_string: 'no date' }).catch((err) => {
                console.warn(`[v6.3] failed to unschedule Todoist task ${id}:`, err);
            }),
        );
    }
    await Promise.allSettled(calls);
}
