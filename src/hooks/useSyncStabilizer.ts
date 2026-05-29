import { useCallback } from 'react';
import { useDayPlan } from './useDayPlan';
import { useTodoistActions, useTodoistData } from './useTodoist';
import { resolveHabitProjectId, syncHabitToTodoist } from '../lib/habitsTodoistSync';
import type { Habit } from '../types';

/**
 * v6.5: shared per-habit stabilizer sync. Pushes one stabilizer to Todoist using a
 * pre-resolved default project id and writes the resulting `todoistTaskId` back onto
 * the habit. Used by both the explicit HabitsLibrary create/edit save flow and the
 * central `ReconciliationProvider` batch pass — the caller resolves the default project
 * once (via `ensureHabitsProject`) so a batch can't churn the project on every iteration.
 *
 * Returns the resulting task id on success, or null on failure / non-stabilizer.
 *
 * Self-heals two stale-reference cases by patching the habit on success:
 *   - `todoistTaskId` updated when create-or-update returned a different id
 *   - `todoistProjectId` cleared when the per-habit override pointed at a deleted project
 *     (we silently fell back to the default in `resolveHabitProjectId`).
 */
export function useSyncStabilizer(): (habit: Habit, defaultProjectId: string) => Promise<string | null> {
    const { dispatch } = useDayPlan();
    const actions = useTodoistActions();
    const { projects, taskMap } = useTodoistData();

    return useCallback(async (habit: Habit, defaultProjectId: string): Promise<string | null> => {
        if (habit.kind !== 'stabilizer') return null;
        const projectId = resolveHabitProjectId(habit, defaultProjectId, projects);
        const taskId = await syncHabitToTodoist({ habit, projectId, actions, taskMap });
        if (!taskId) return null;

        const patch: Partial<Habit> = {};
        if (taskId !== habit.todoistTaskId) patch.todoistTaskId = taskId;
        if (habit.todoistProjectId && !projects.some((p) => p.id === habit.todoistProjectId)) {
            patch.todoistProjectId = undefined;
        }
        if (Object.keys(patch).length > 0) {
            dispatch({ type: 'UPDATE_HABIT', habit: { ...habit, ...patch } });
        }
        return taskId;
    }, [actions, dispatch, projects, taskMap]);
}
