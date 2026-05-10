import type { LinkedTask } from '../types';
import type { TodoistTask } from '../hooks/useTodoist';

/**
 * Resolve the display title for a Todoist task ID with the standard fallback chain:
 * live Todoist content → cached `titleSnapshot` on the LinkedTask → the raw ID.
 */
export function getTaskTitle(
    todoistId: string,
    linkedTasks: LinkedTask[],
    taskMap: Map<string, Pick<TodoistTask, 'content'>>,
): string {
    const live = taskMap.get(todoistId)?.content;
    if (live) return live;
    const lt = linkedTasks.find((t) => t.todoistId === todoistId);
    return lt?.titleSnapshot ?? todoistId;
}

/**
 * Walk a list of items with parent pointers and return the transitive set of
 * descendant IDs (including the seed roots). Used for cascade-delete in both
 * the task tree (parent_id → child) and the project tree.
 */
export function collectDescendantIds<T extends { id: string }>(
    items: T[],
    rootIds: string[],
    getParentId: (item: T) => string | null | undefined,
): Set<string> {
    const removed = new Set<string>(rootIds);
    let changed = true;
    while (changed) {
        changed = false;
        for (const item of items) {
            const parent = getParentId(item);
            if (parent && !removed.has(item.id) && removed.has(parent)) {
                removed.add(item.id);
                changed = true;
            }
        }
    }
    return removed;
}
