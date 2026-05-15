import { useDayPlan } from '../../hooks/useDayPlan';
import { Button } from '../ui/Button';
import type { Habit } from '../../types';

interface LightPoolRowProps {
    habit: Habit;
    /** Id of an in-progress `HabitLogEntry` for this habit, if any. Drives the Start/Done toggle. */
    activeEntryId?: string;
    /** Current session id at the moment of starting (attached to the log entry). */
    sessionId?: string;
}

/**
 * v6: shared Light Pool row used by `LightPoolPanel` and `CheckInModal`.
 * Pure presentation + a single dispatch — no local state, no styling variants.
 */
export function LightPoolRow({ habit, activeEntryId, sessionId }: LightPoolRowProps) {
    const { dispatch } = useDayPlan();
    return (
        <li className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
            <div className="min-w-0 flex-1">
                <div className="text-sm truncate">{habit.name}</div>
                {habit.minimumViable && (
                    <div className="text-[11px] text-text-light truncate">
                        {habit.minimumViable}
                    </div>
                )}
            </div>
            {activeEntryId ? (
                <Button
                    size="sm"
                    onClick={() => dispatch({ type: 'LOG_HABIT_COMPLETE', entryId: activeEntryId })}
                >
                    Done
                </Button>
            ) : (
                <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => dispatch({ type: 'LOG_HABIT_START', habitId: habit.id, sessionId })}
                >
                    Start
                </Button>
            )}
        </li>
    );
}
