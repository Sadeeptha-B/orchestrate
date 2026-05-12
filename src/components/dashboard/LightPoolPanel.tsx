import { useMemo, useState } from 'react';
import { useDayPlan } from '../../hooks/useDayPlan';
import { useCurrentSession } from '../../hooks/useCurrentSession';
import { getLightPoolHabits } from '../../lib/habits';
import { Button } from '../ui/Button';

/**
 * v6 Light Pool — surfaces today's light-coherent habits (filtered to the active season)
 * as opportunistic micro-gap fillers. Pulling an item LOGS to `plan.habitLog` only;
 * it never becomes an intention or LinkedTask.
 */
export function LightPoolPanel() {
    const { plan, life, settings, dispatch } = useDayPlan();
    const { currentSession } = useCurrentSession(settings.sessionSlots);
    const [open, setOpen] = useState(true);

    const pool = useMemo(() => getLightPoolHabits(life, plan.date), [life, plan.date]);

    if (pool.length === 0) return null;

    const habitById = new Map(life.habits.map((h) => [h.id, h]));
    const todayLog = plan.habitLog;
    const inProgress = new Map<string, string>(); // habitId → entryId
    for (const e of todayLog) {
        if (!e.completedAt) inProgress.set(e.habitId, e.id);
    }

    const start = (habitId: string) => {
        dispatch({ type: 'LOG_HABIT_START', habitId, sessionId: currentSession?.id });
    };
    const complete = (entryId: string) => {
        dispatch({ type: 'LOG_HABIT_COMPLETE', entryId });
    };
    const remove = (entryId: string) => {
        dispatch({ type: 'DELETE_HABIT_LOG_ENTRY', entryId });
    };

    return (
        <div>
            <button
                onClick={() => setOpen(!open)}
                className="flex items-center gap-2 text-sm font-semibold text-text-light uppercase tracking-wider hover:text-accent transition-colors cursor-pointer"
            >
                <svg
                    className={`w-3 h-3 transition-transform ${open ? 'rotate-90' : ''}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
                Light Pool
                <span className="text-[10px] normal-case tracking-normal text-text-light">
                    micro-gap fillers
                </span>
            </button>
            {open && (
                <div className="mt-2 rounded-lg border border-border bg-card p-4 space-y-3">
                    <p className="text-xs text-text-light">
                        Small, resumable activities for when you have a short window or your
                        attention is drifting. Logged-only — never enters today's task plan.
                    </p>

                    <ul className="space-y-2">
                        {pool.map((h) => {
                            const activeEntryId = inProgress.get(h.id);
                            return (
                                <li
                                    key={h.id}
                                    className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
                                >
                                    <div className="min-w-0 flex-1">
                                        <div className="text-sm truncate">{h.name}</div>
                                        {h.minimumViable && (
                                            <div className="text-[11px] text-text-light truncate">
                                                {h.minimumViable}
                                            </div>
                                        )}
                                    </div>
                                    {activeEntryId ? (
                                        <Button size="sm" onClick={() => complete(activeEntryId)}>
                                            Done
                                        </Button>
                                    ) : (
                                        <Button variant="secondary" size="sm" onClick={() => start(h.id)}>
                                            Start
                                        </Button>
                                    )}
                                </li>
                            );
                        })}
                    </ul>

                    {todayLog.length > 0 && (
                        <div className="pt-2 border-t border-border">
                            <h4 className="text-[11px] uppercase tracking-wider text-text-light mb-1.5">
                                Today's log
                            </h4>
                            <ul className="space-y-1">
                                {todayLog.map((e) => {
                                    const habit = habitById.get(e.habitId);
                                    return (
                                        <li
                                            key={e.id}
                                            className="flex items-center justify-between gap-2 text-xs"
                                        >
                                            <span className="truncate">
                                                <span className={e.completedAt ? 'line-through text-text-light' : ''}>
                                                    {habit?.name ?? '(deleted)'}
                                                </span>
                                                {e.completedAt && e.durationMinutes !== undefined && (
                                                    <span className="ml-2 text-text-light">
                                                        · {e.durationMinutes}m
                                                    </span>
                                                )}
                                            </span>
                                            <button
                                                onClick={() => remove(e.id)}
                                                className="text-text-light hover:text-text transition-colors cursor-pointer"
                                                title="Delete entry"
                                            >
                                                ×
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
