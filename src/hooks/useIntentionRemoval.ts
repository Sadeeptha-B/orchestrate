import { useCallback } from 'react';
import { useDayPlan } from './useDayPlan';
import { useTodoistActions, useTodoistData } from './useTodoist';
import { unscheduleIntentionTasks } from '../lib/intentionUnschedule';

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
        await unscheduleIntentionTasks(entry.intention.linkedTaskIds, [], actions, taskMap);
        dispatch({ type: 'DELETE_BACKLOG_ENTRY', backlogId });
    }, [life.backlog, actions, taskMap, dispatch]);

    return { moveToBacklog, removeIntention, discardFromBacklog };
}
