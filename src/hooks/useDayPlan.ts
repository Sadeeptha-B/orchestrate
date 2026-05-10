import { useContext } from 'react';
import { DayPlanContext, type DayPlanContextValue } from '../context/DayPlanContext';

export function useDayPlan(): DayPlanContextValue {
    const ctx = useContext(DayPlanContext);
    if (!ctx) throw new Error('useDayPlan must be used within DayPlanProvider');
    return ctx;
}
