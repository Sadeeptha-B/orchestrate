import { useState } from 'react';
import { useDayPlan } from './useDayPlan';
import type { TodaysHabitInstance } from '../types';

/**
 * v6.5: shared reschedule state for `TodaysHabitInstance` rows. Both the dashboard
 * `HabitInstanceCard` and the wizard's `Step3HabitsPanel` expose an inline "set/change
 * the time for today" affordance with identical state + dispatch — this hook owns that
 * one open row's id and its pending time, and dispatches `RESCHEDULE_HABIT_INSTANCE` on
 * save. Pair it with `<HabitTimeEditor>` for the input + Save/Cancel markup.
 */
export function useHabitReschedule() {
    const { dispatch } = useDayPlan();
    const [reschedulingId, setReschedulingId] = useState<string | null>(null);
    const [time, setTime] = useState('');

    const open = (instance: TodaysHabitInstance) => {
        setReschedulingId(instance.id);
        setTime(instance.targetTime ?? '');
    };

    const cancel = () => {
        setReschedulingId(null);
        setTime('');
    };

    const save = (instance: TodaysHabitInstance) => {
        dispatch({
            type: 'RESCHEDULE_HABIT_INSTANCE',
            instanceId: instance.id,
            newTargetTime: time || undefined,
            now: new Date().toISOString(),
        });
        cancel();
    };

    return { reschedulingId, time, setTime, open, cancel, save };
}
