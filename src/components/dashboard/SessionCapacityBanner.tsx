import type { SessionSlot } from '../../types';
import type { SessionCapacity } from '../../lib/capacity';

interface SessionCapacityBannerProps {
    sessions: SessionSlot[];
    capacities: Record<string, SessionCapacity>;
}

/**
 * v6: single advisory banner naming over-capacity sessions. Renders nothing
 * when no session is in the 'over' state. Looser-variant: triggers only at
 * >150% load, never blocks the user.
 */
export function SessionCapacityBanner({ sessions, capacities }: SessionCapacityBannerProps) {
    const over = sessions.filter((s) => capacities[s.id]?.status === 'over');
    if (over.length === 0) return null;
    const names = over.map((s) => s.name).join(', ');
    return (
        <div className="rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-xs text-red-800 dark:text-red-300">
            <strong>Over capacity:</strong> {names}. Consider moving a task, breaking it down,
            or accepting that some won't land today.
        </div>
    );
}
