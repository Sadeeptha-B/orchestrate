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
