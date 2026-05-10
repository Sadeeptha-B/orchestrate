import { useNavigate } from 'react-router-dom';
import { useDayPlan } from '../../hooks/useDayPlan';
import { findActiveSeason } from '../../lib/seasons';

interface ActiveSeasonBadgeProps {
    className?: string;
}

export function ActiveSeasonBadge({ className = '' }: ActiveSeasonBadgeProps) {
    const { life } = useDayPlan();
    const navigate = useNavigate();
    const active = findActiveSeason(life);

    if (!active) {
        return (
            <button
                type="button"
                onClick={() => navigate('/season')}
                className={`text-xs text-text-light hover:text-accent underline-offset-2 hover:underline cursor-pointer ${className}`}
                title="No active season — click to set one"
            >
                No active season
            </button>
        );
    }

    return (
        <button
            type="button"
            onClick={() => navigate(`/season/${active.id}`)}
            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-accent-subtle text-accent text-[11px] font-medium hover:bg-accent-subtle/70 transition-colors cursor-pointer ${className}`}
            title={active.primaryTheme || active.name}
        >
            <span aria-hidden>◆</span>
            <span className="truncate max-w-[140px]">{active.name}</span>
        </button>
    );
}
