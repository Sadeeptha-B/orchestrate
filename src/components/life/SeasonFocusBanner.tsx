import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDayPlan } from '../../hooks/useDayPlan';
import { findActiveSeason } from '../../lib/seasons';

export function SeasonFocusBanner() {
    const { life } = useDayPlan();
    const navigate = useNavigate();
    const season = findActiveSeason(life);
    const [emptyDismissed, setEmptyDismissed] = useState(false);

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

            {/* Goals — wrapping chips, scrollable after 2 rows */}
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
        </div>
    );
}
