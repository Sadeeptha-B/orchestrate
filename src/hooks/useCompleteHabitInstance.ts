import { useCallback } from 'react';
import { useDayPlan } from './useDayPlan';
import { useTodoistActions } from './useTodoist';
import type { TodaysHabitInstance } from '../types';

/**
 * Shared ✓ Complete gesture for a `TodaysHabitInstance`. Advances the backing recurring Todoist
 * task first, then flips the local instance to 'completed' so Orchestrate doesn't drift from the
 * Todoist source of truth when the API call fails. Used by the dashboard `HabitInstanceCard` as
 * well as the planning surfaces (Step 1 season card, Step 3 habits panel) so completing a habit
 * behaves identically wherever it's surfaced.
 */
export function useCompleteHabitInstance(): (instance: TodaysHabitInstance) => Promise<boolean> {
    const { dispatch } = useDayPlan();
    const { completeTask } = useTodoistActions();
    return useCallback(async (instance: TodaysHabitInstance): Promise<boolean> => {
        if (instance.todoistTaskId) {
            const completed = await completeTask(instance.todoistTaskId);
            if (!completed) return false;
        }
        dispatch({ type: 'COMPLETE_HABIT_INSTANCE', instanceId: instance.id, now: new Date().toISOString() });
        return true;
    }, [dispatch, completeTask]);
}
