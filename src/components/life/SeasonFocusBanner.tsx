import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDayPlan } from '../../context/DayPlanContext';
import { findActiveSeason } from '../../lib/seasons';

export function SeasonFocusBanner() {
    const { plan, life, dispatch } = useDayPlan();
    const navigate = useNavigate();
    const season = findActiveSeason(life);
    const [emptyDismissed, setEmptyDismissed] = useState(false);

    const existingTitles = useMemo(
        () => new Set(plan.intentions.map((i) => i.title.trim().toLowerCase())),
        [plan.intentions],
    );

    if (!season) {
        if (emptyDismissed) return null;
        return (
            <div className="rounded-lg border border-border bg-subtle/40 px-4 py-3 flex items-start gap-3">
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
        );
    }

    const goals = season.supportingGoals;

    return (
        <div className="rounded-lg border border-accent/30 bg-accent-subtle/20 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-xs font-semibold text-text-light uppercase tracking-wider">
                        Season
                    </p>
                    <p className="text-sm font-medium text-text mt-0.5">{season.name}</p>
                    {season.primaryTheme && (
                        <p className="text-xs text-text-light mt-0.5">{season.primaryTheme}</p>
                    )}
                </div>
                <button
                    type="button"
                    onClick={() => navigate(`/season/${season.id}`)}
                    className="text-xs text-accent hover:underline cursor-pointer flex-shrink-0"
                >
                    View →
                </button>
            </div>

            {goals.length > 0 ? (
                <div className="mt-3">
                    <p className="text-[11px] text-text-light mb-1.5">
                        Pull goals into today:
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                        {goals.map((goal, i) => {
                            const already = existingTitles.has(goal.trim().toLowerCase());
                            return (
                                <button
                                    key={i}
                                    type="button"
                                    disabled={already}
                                    onClick={() => dispatch({ type: 'ADD_INTENTION', title: goal })}
                                    className={
                                        already
                                            ? 'inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface-dark/50 text-text-light text-xs cursor-default'
                                            : 'inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-card border border-accent/30 text-accent text-xs hover:bg-accent-subtle/60 transition-colors cursor-pointer'
                                    }
                                    title={already ? 'Already added' : 'Add as intention for today'}
                                >
                                    <span aria-hidden>{already ? '✓' : '+'}</span>
                                    <span>{goal}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            ) : (
                <p className="text-xs text-text-light italic mt-2">
                    No supporting goals listed for this season.
                </p>
            )}
        </div>
    );
}
