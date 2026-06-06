import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useDayPlan } from '../../hooks/useDayPlan';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { findActiveSeason, getSeasonProgress } from '../../lib/seasons';
import type { RecurringFocus } from '../../types';

const MAX_GOALS_SHOWN = 2;
const MAX_CHIPS_SHOWN = 3;

const FOCUS_DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function focusRecurrenceLabel(f: RecurringFocus): string {
    const r = f.recurrence;
    if (r.kind === 'daily') return 'Daily';
    if (r.kind === 'weekdays') return 'Weekdays';
    const days = r.daysOfWeek ?? [];
    return days.length > 0 ? days.map((d) => FOCUS_DOW[d]).join(', ') : 'Weekly';
}

interface SeasonContextCardProps {
    /** `card` (default) = full side-rail card; `inline` = a comprehensive contextualization panel. */
    variant?: 'card' | 'inline';
}

export function SeasonContextCard({ variant = 'card' }: SeasonContextCardProps = {}) {
    const { plan, life } = useDayPlan();
    const navigate = useNavigate();
    const season = findActiveSeason(life);
    const [expanded, setExpanded] = useState(false);

    if (!season) {
        if (variant === 'inline') {
            return (
                <section>
                    <h3 className="text-sm font-semibold text-text-light uppercase tracking-wider mb-4">
                        Season
                    </h3>
                    <div className="flex flex-col lg:flex-row gap-4 lg:items-start">
                        <div className="flex-1 min-w-0 flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-lg border border-accent/30 bg-accent-subtle/20">
                            <p className="text-sm text-text-light">
                                <span className="font-medium text-text">No active season.</span>{' '}
                                Anchor what you're building toward over the next few weeks.
                            </p>
                            <Button size="sm" onClick={() => navigate('/season')}>
                                Create a season
                            </Button>
                        </div>
                    </div>
                </section>
            );
        }
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

    if (variant === 'inline') {
        const visibleChips = expanded ? goals : goals.slice(0, MAX_CHIPS_SHOWN);
        const extraChipCount = Math.max(0, goals.length - MAX_CHIPS_SHOWN);
        const activeFocuses = (season.recurringFocuses ?? []).filter((f) => f.active);

        return (
            <section>
                <h3 className="text-sm font-semibold text-text-light uppercase tracking-wider mb-4">
                    Season
                </h3>
                <div className="flex flex-col lg:flex-row gap-4 lg:items-start">
                    <div className="flex-1 min-w-0 border border-border rounded-lg p-3">
                        {/* Season name + week badge + dates */}
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                            <Link
                                to={`/season/${season.id}`}
                                className="text-lg text-accent hover:underline inline-flex items-center gap-1 group/link"
                            >
                                {season.name}
                                <svg className="w-4 h-4 opacity-50 group-hover/link:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                </svg>
                            </Link>
                            {progress && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-accent-subtle text-accent text-[11px] font-medium">
                                    Week {progress.weekNumber} of {progress.totalWeeks}
                                </span>
                            )}
                            <span className="text-xs text-text-light tabular-nums">
                                {season.startDate} → {season.endDate ?? 'open-ended'}
                            </span>
                        </div>
                        {season.primaryTheme && (
                            <p className="text-sm text-text break-words mt-1.5">{season.primaryTheme}</p>
                        )}
                        {season.successCriteria && (
                            <p className="text-xs text-text-light break-words mt-1.5">
                                <span className="font-medium">success —</span>{' '}
                                {season.successCriteria}
                            </p>
                        )}

                        {/* Supporting goals — wrapping chips, capped with expand toggle. */}
                        {goals.length > 0 && (
                            <div className="mt-2.5">
                                <div className="flex flex-wrap gap-1.5">
                                    {visibleChips.map((goal, i) => (
                                        <span
                                            key={i}
                                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-card border border-border text-text-light text-[11px]"
                                        >
                                            <span aria-hidden className="text-accent">◆</span>
                                            <span>{goal}</span>
                                        </span>
                                    ))}
                                    {extraChipCount > 0 && (
                                        <button
                                            type="button"
                                            onClick={() => setExpanded((v) => !v)}
                                            className="inline-flex items-center px-2 py-0.5 rounded-full bg-card border border-border text-accent text-[11px] hover:bg-accent-subtle/30 transition-colors cursor-pointer"
                                        >
                                            {expanded ? 'less' : `+${extraChipCount} more`}
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="lg:w-60 lg:flex-shrink-0 border border-border rounded-lg p-3">
                        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-text-light mb-2">
                            Recurring Focuses
                        </h4>
                        <ul className="space-y-0.5">
                            {activeFocuses.map((f) => (
                                <li key={f.id} className="flex items-center gap-1.5 px-1.5 py-1 rounded hover:bg-surface-dark/50 transition-colors">
                                    <span aria-hidden className="text-[10px] text-accent flex-shrink-0">◉</span>
                                    <span className="flex-1 min-w-0 text-xs truncate" title={f.title}>{f.title}</span>
                                    <span className="text-[10px] px-1 py-px rounded-full bg-surface-dark text-text-light tabular-nums flex-shrink-0">
                                        {focusRecurrenceLabel(f)}
                                    </span>
                                </li>
                            ))}
                            {activeFocuses.length === 0 && (
                                <li className="text-xs text-text-light italic px-1.5">No recurring focuses</li>
                            )}
                        </ul>
                        <div className="mt-3 pt-2 border-t border-border">
                            <button
                                type="button"
                                onClick={() => navigate(`/season/${season.id}`, { state: { openEdit: true } })}
                                className="text-xs text-accent hover:underline cursor-pointer"
                            >
                                + Add focus
                            </button>
                        </div>
                    </div>
                </div>
            </section>
        );
    }

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
