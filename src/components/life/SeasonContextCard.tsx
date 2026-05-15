import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useDayPlan } from '../../hooks/useDayPlan';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { findActiveSeason, getSeasonProgress } from '../../lib/seasons';

const MAX_GOALS_SHOWN = 2;

export function SeasonContextCard() {
    const { plan, life } = useDayPlan();
    const navigate = useNavigate();
    const season = findActiveSeason(life);
    const [expanded, setExpanded] = useState(false);

    if (!season) {
        return (
            <section>
                <h3 className="text-sm font-semibold text-text-light uppercase tracking-wider mb-3">
                    Season
                </h3>
                <Card className="border-accent/30 bg-accent-subtle/20">
                    <p className="text-sm font-medium text-text">No active season</p>
                    <p className="text-xs text-text-light mt-1">
                        Anchor what you're building toward over the next few weeks. A season
                        gives today's work a longer arc to connect to.
                    </p>
                    <div className="flex flex-wrap gap-2 mt-3">
                        <Button size="sm" onClick={() => navigate('/season')}>
                            Create a season
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => navigate('/life')}>
                            Why seasons?
                        </Button>
                    </div>
                </Card>
            </section>
        );
    }

    const progress = getSeasonProgress(season, plan.date);
    const goals = season.supportingGoals;
    const visibleGoals = expanded ? goals : goals.slice(0, MAX_GOALS_SHOWN);
    const extraGoalCount = Math.max(0, goals.length - MAX_GOALS_SHOWN);

    return (
        <section>
            <h3 className="text-sm font-semibold text-text-light uppercase tracking-wider mb-3">
                Season
            </h3>
            <Card>
                <div className="min-w-0">
                    <Link
                        to={`/season/${season.id}`}
                        className="text-base font-medium text-accent hover:underline break-words"
                    >
                        {season.name}
                    </Link>
                    {season.primaryTheme && (
                        <p className="text-sm text-text mt-1 break-words">{season.primaryTheme}</p>
                    )}
                </div>

                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-light mt-2">
                    <span className="break-words">
                        {season.startDate} → {season.endDate ?? 'open-ended'}
                    </span>
                    {progress && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-accent-subtle text-accent text-[11px] font-medium">
                            Week {progress.weekNumber} of {progress.totalWeeks}
                        </span>
                    )}
                </div>

                {goals.length > 0 && (
                    <div className="mt-2.5">
                        <ul className="text-sm space-y-1 max-h-28 overflow-y-auto scrollbar-subtle pr-1">
                            {visibleGoals.map((g, i) => (
                                <li key={i} className="flex gap-2">
                                    <span className="text-text-light flex-shrink-0">·</span>
                                    <span className="min-w-0 break-words">{g}</span>
                                </li>
                            ))}
                        </ul>
                        {extraGoalCount > 0 && (
                            <button
                                type="button"
                                onClick={() => setExpanded((v) => !v)}
                                className="mt-1.5 text-xs text-accent hover:underline cursor-pointer"
                            >
                                {expanded ? 'Show less' : `+ ${extraGoalCount} more`}
                            </button>
                        )}
                    </div>
                )}

                <div className="mt-3 flex justify-end">
                    <button
                        type="button"
                        onClick={() => navigate(`/season/${season.id}`)}
                        className="text-xs text-text-light hover:text-accent transition-colors cursor-pointer"
                    >
                        Manage →
                    </button>
                </div>
            </Card>
        </section>
    );
}
