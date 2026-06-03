import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDayPlan } from '../../hooks/useDayPlan';
import { findActiveSeason } from '../../lib/seasons';
import { recurrenceMatchesDate } from '../../lib/habits';
import type { TodaysHabitInstance } from '../../types';

interface SeasonFocusBannerProps {
    /**
     * Today's 'habit'-kind instances, merged into the same card so Step 1 shows the day's
     * recurring commitments alongside the season arc (v6.7 UI: one "today's context" card).
     * Empty/omitted → the habits section is hidden.
     */
    todaysHabits?: TodaysHabitInstance[];
}

export function SeasonFocusBanner({ todaysHabits = [] }: SeasonFocusBannerProps) {
    const { plan, life, dispatch } = useDayPlan();
    const navigate = useNavigate();
    const season = findActiveSeason(life);
    const [emptyDismissed, setEmptyDismissed] = useState(false);

    // Timed habits first (sorted by time), then "anytime" — so the row reads chronologically.
    const sortedHabits = useMemo(
        () =>
            [...todaysHabits].sort((a, b) => {
                if (a.targetTime && b.targetTime) return a.targetTime.localeCompare(b.targetTime);
                if (a.targetTime) return -1;
                if (b.targetTime) return 1;
                return a.titleSnapshot.localeCompare(b.titleSnapshot);
            }),
        [todaysHabits],
    );

    const habitsSection = sortedHabits.length > 0 && (
        <div>
            <div className="flex items-center gap-1.5 mb-1">
                <span aria-hidden className="text-[11px] leading-none">🔁</span>
                <span className="text-[10px] font-semibold text-accent uppercase tracking-wider">
                    {sortedHabits.length} habit{sortedHabits.length === 1 ? '' : 's'} today
                </span>
                <span className="text-[10px] text-text-light normal-case tracking-normal">
                    · already on your timeline
                </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
                {sortedHabits.map((h) => (
                    <span
                        key={h.id}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-card border border-border text-text-light text-[11px]"
                    >
                        <span className="truncate max-w-[10rem]">{h.titleSnapshot}</span>
                        {h.targetTime && (
                            <span className="text-accent tabular-nums">{h.targetTime}</span>
                        )}
                    </span>
                ))}
            </div>
        </div>
    );

    if (!season) {
        if (emptyDismissed && !habitsSection) return null;
        return (
            <div className="rounded-lg border border-border bg-subtle/40 px-4 py-3 space-y-2">
                {!emptyDismissed && (
                    <div className="flex items-start gap-3">
                        <span aria-hidden className="text-base leading-none mt-0.5">◆</span>
                        <div className="flex-1 min-w-0 text-xs text-text-light">
                            No active season — your day plan won't have a longer arc to connect to.{' '}
                            <button
                                type="button"
                                onClick={() => navigate('/season')}
                                className="text-accent hover:underline cursor-pointer"
                            >
                                Set up a season
                            </button>
                        </div>
                        <button
                            type="button"
                            onClick={() => setEmptyDismissed(true)}
                            className="text-text-light hover:text-text text-base leading-none cursor-pointer flex-shrink-0"
                            title="Dismiss"
                            aria-label="Dismiss"
                        >
                            &times;
                        </button>
                    </div>
                )}
                {habitsSection}
            </div>
        );
    }

    const goals = season.supportingGoals;

    // v6.7: recurring focuses whose cadence matches today and haven't been added yet → "+ Add" chips.
    const seeded = plan.seededFocusIds ?? [];
    const dueFocuses = (season.recurringFocuses ?? []).filter(
        (f) => f.active && recurrenceMatchesDate(f.recurrence, plan.date) && !seeded.includes(f.id),
    );
    const addFocus = (focusId: string, title: string) => {
        dispatch({ type: 'ADD_INTENTION', title });
        dispatch({ type: 'MARK_FOCUS_SEEDED', focusId });
    };

    return (
        <div className="rounded-lg border border-accent/30 bg-accent-subtle/20 px-3 py-2 space-y-1">
            {/* Season name + view link */}
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] font-semibold text-accent uppercase tracking-wider flex-shrink-0">
                        Season
                    </span>
                    <span className="text-sm font-medium text-text">{season.name}</span>
                </div>
                <button
                    type="button"
                    onClick={() => navigate(`/season/${season.id}`)}
                    className="text-[11px] text-accent hover:underline cursor-pointer flex-shrink-0"
                >
                    View →
                </button>
            </div>

            {/* Theme */}
            {season.primaryTheme && (
                <p className="text-xs text-text-light">{season.primaryTheme}</p>
            )}

            {/* Goals — wrapping chips, capped to ~2 rows with a subtle scroll so a long
                goal list doesn't push the rest of the card (theme, focuses, habits) down. */}
            {goals.length > 0 && (
                <div className="flex flex-wrap gap-1.5 max-h-14 overflow-y-auto scrollbar-subtle">
                    {goals.map((goal, i) => (
                        <span
                            key={i}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-card border border-border text-text-light text-[11px]"
                        >
                            <span aria-hidden className="text-accent">◆</span>
                            <span>{goal}</span>
                        </span>
                    ))}
                </div>
            )}

            {/* v6.7: recurring focuses due today — click to seed an intention you'll break down. */}
            {dueFocuses.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {dueFocuses.map((f) => (
                        <button
                            key={f.id}
                            type="button"
                            onClick={() => addFocus(f.id, f.title)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent-subtle border border-accent/30 text-accent text-[11px] hover:bg-accent/20 cursor-pointer transition-colors"
                            title="Add this recurring focus as an intention for today"
                        >
                            <span aria-hidden>＋</span>
                            <span>{f.title}</span>
                        </button>
                    ))}
                </div>
            )}

            {/* Today's habits — merged in so the season arc and the day's recurring commitments
                share one compact card. Divider separates the longer arc from today's instances. */}
            {habitsSection && (
                <div className="pt-1.5 border-t border-accent/15">{habitsSection}</div>
            )}
        </div>
    );
}
