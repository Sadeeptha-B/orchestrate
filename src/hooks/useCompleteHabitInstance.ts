import { useCallback } from 'react';
import { useDayPlan } from './useDayPlan';
import { useTodoistActions } from './useTodoist';
import type { TodaysHabitInstance } from '../types';

/**
 * Shared ✓ Complete gesture for a `TodaysHabitInstance`. Flips the instance to 'completed'
 * locally and pushes the completion to the backing recurring Todoist task (advancing its
 * recurrence). Used by the dashboard `HabitInstanceCard` as well as the planning surfaces
 * (Step 1 season card, Step 3 habits panel) so completing a habit behaves identically
 * wherever it's surfaced. Todoist failures are logged but don't block local state.
 */
export function useCompleteHabitInstance(): (instance: TodaysHabitInstance) => void {
    const { dispatch } = useDayPlan();
    const { completeTask } = useTodoistActions();
    return useCallback((instance: TodaysHabitInstance) => {
        dispatch({ type: 'COMPLETE_HABIT_INSTANCE', instanceId: instance.id, now: new Date().toISOString() });
        if (!instance.todoistTaskId) return;
        completeTask(instance.todoistTaskId).catch((err) => {
            console.error(`[habits] complete: Todoist task ${instance.todoistTaskId} failed:`, err);
        });
    }, [dispatch, completeTask]);
}
