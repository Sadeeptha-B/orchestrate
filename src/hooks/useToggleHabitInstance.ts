import { useCallback } from 'react';
import { useDayPlan } from './useDayPlan';
import type { TodaysHabitInstance } from '../types';

/**
 * v6.7: shared ▶ Start / ■ Stop toggle for a `TodaysHabitInstance`. Dispatches
 * `START_HABIT_INSTANCE` / `STOP_HABIT_INSTANCE` based on the instance's current status — the same
 * gesture used by the dashboard `HabitInstanceCard`, the `MicroGapCard`, and the low-energy
 * check-in surface. Start opens an engagement segment; Stop closes it.
 */
export function useToggleHabitInstance(): (instance: TodaysHabitInstance) => void {
    const { dispatch } = useDayPlan();
    return useCallback((instance: TodaysHabitInstance) => {
        dispatch({
            type: instance.status === 'engaged' ? 'STOP_HABIT_INSTANCE' : 'START_HABIT_INSTANCE',
            instanceId: instance.id,
            now: new Date().toISOString(),
        });
    }, [dispatch]);
}
