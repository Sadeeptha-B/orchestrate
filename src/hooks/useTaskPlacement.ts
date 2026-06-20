import { useCallback } from 'react';
import { useDayPlan } from './useDayPlan';

/** Custom MIME so task drags don't collide with text/other DnD payloads. */
export const TASK_DND_MIME = 'application/x-orchestrate-task';

export interface TaskDragPayload {
    todoistId: string;
    /** Session the drag started from, or `null` for the Anytime pool. */
    fromSessionId: string | null;
}

export function writeTaskDragPayload(e: React.DragEvent, payload: TaskDragPayload): void {
    e.dataTransfer.setData(TASK_DND_MIME, JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'move';
}

export function readTaskDragPayload(e: React.DragEvent): TaskDragPayload | null {
    const raw = e.dataTransfer.getData(TASK_DND_MIME);
    if (!raw) return null;
    try {
        return JSON.parse(raw) as TaskDragPayload;
    } catch {
        return null;
    }
}

/**
 * Dashboard-side task placement: move a linked task between sessions and the "Anytime" pool.
 *
 * Reuses the existing reducer actions (no new action, no schema change) — the same
 * `UNASSIGN_TASK` + `ASSIGN_TASK` chain the wizard's Schedule step uses for "Move to…":
 *  - main tasks are session-exclusive, so `ASSIGN_TASK` alone re-homes them (it clears the
 *    prior session itself); moving to Anytime is a plain `UNASSIGN_TASK`.
 *  - background tasks can live in several sessions, so a move from one specific session to
 *    another is an explicit `UNASSIGN_TASK(from)` + `ASSIGN_TASK(to)`.
 *
 * `null` for `from`/`to` means the Anytime pool (no session bucket).
 */
export function useTaskPlacement() {
    const { plan, dispatch } = useDayPlan();

    const moveTask = useCallback(
        (todoistId: string, fromSessionId: string | null, toSessionId: string | null) => {
            if (fromSessionId === toSessionId) return;
            const task = plan.linkedTasks.find((lt) => lt.todoistId === todoistId);
            if (!task) return;

            if (task.type === 'background') {
                if (fromSessionId) dispatch({ type: 'UNASSIGN_TASK', todoistId, sessionId: fromSessionId });
                if (toSessionId) dispatch({ type: 'ASSIGN_TASK', todoistId, sessionId: toSessionId });
                return;
            }

            // main / unclassified — session-exclusive.
            if (toSessionId) {
                dispatch({ type: 'ASSIGN_TASK', todoistId, sessionId: toSessionId });
            } else if (fromSessionId) {
                dispatch({ type: 'UNASSIGN_TASK', todoistId, sessionId: fromSessionId });
            }
        },
        [plan.linkedTasks, dispatch],
    );

    return { moveTask };
}
