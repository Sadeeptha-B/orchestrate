import { useEffect } from 'react';
import { useDayPlan } from './useDayPlan';
import { useTodoistData } from './useTodoist';
import { computeTodaysMicroGapInstances } from '../lib/habits';
import { computeTodaysHabitInstances, findStaleTodaysHabitInstances } from '../lib/habitsTodoistSync';
import { DEFAULT_TASK_CAPS } from '../lib/capacity';

/**
 * v6.7: keep `plan.todaysHabits` in sync with the habit library while a surface is mounted, so a
 * habit created/edited/deleted in /habits is reflected without re-running the wizard. Computes
 * today's 'habit' (Todoist-gated) + 'micro-gap' (no-Todoist) instances and merges them via
 * `REFRESH_TODAYS_HABITS` — which dedupes by habitId, value-stably refreshes a `planned` instance's
 * time/duration/title (so form edits propagate), and is a true no-op when nothing changed (safe to
 * re-fire). It then prunes (a) any instance whose habit was deleted (defensive — `DELETE_HABIT`
 * already prunes; this catches anything that slipped through) and (b) any `planned` habit instance
 * whose backing Todoist task was completed / moved off today out-of-band (e.g. checked off directly
 * in the Todoist app) — gated on `tasksHydrated` so a cold cache can't false-prune. Shared by the
 * dashboard and the Step 1 wizard so the two surfaces can't drift.
 *
 * The overdue-reconcile half (bumping yesterday's missed habits forward) is owned by
 * `ReconciliationProvider`; this hook only computes & dispatches due-today instances.
 */
export function useTodaysHabitsSync() {
    const { plan, settings, life, dispatch } = useDayPlan();
    const { taskMap, tasksHydrated } = useTodoistData();

    useEffect(() => {
        const taskCaps = settings.taskCapDefaults ?? DEFAULT_TASK_CAPS;
        const now = new Date();
        const instances = [
            ...computeTodaysHabitInstances({ life, plan, taskMap, now, taskCaps }),
            ...computeTodaysMicroGapInstances({ life, plan, taskCaps }),
        ];
        if (instances.length > 0) dispatch({ type: 'REFRESH_TODAYS_HABITS', instances });
        if (plan.todaysHabits.some((i) => !life.habits.some((h) => h.id === i.habitId))) {
            dispatch({ type: 'PRUNE_TODAYS_HABITS' });
        }
        // Drop instances whose Todoist task was completed externally. Only once tasks are
        // hydrated, so the (possibly empty) cold cache doesn't read as "everything completed".
        if (tasksHydrated) {
            const staleIds = findStaleTodaysHabitInstances({ plan, life, taskMap, now });
            if (staleIds.length > 0) dispatch({ type: 'PRUNE_STALE_HABIT_INSTANCES', instanceIds: staleIds });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [taskMap, tasksHydrated, life.habits, life.activeSeasonId, plan.todaysHabits, plan.date, settings.taskCapDefaults, dispatch]);
}
