import type { SessionCapacity } from '../../lib/capacity';

/**
 * v6: small pill summarizing a session's load — "assigned / available min".
 * Color follows capacity status (ok / tight / over). Pure presentation.
 */
export function SessionCapacityBadge({ capacity }: { capacity: SessionCapacity }) {
    const { assignedMinutes, totalMinutes, status } = capacity;
    const cls =
        status === 'over'
            ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-red-300 dark:border-red-700'
            : status === 'tight'
                ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700'
                : 'bg-surface-dark text-text-light border-border';
    const label = `${assignedMinutes}/${totalMinutes} min`;
    const title =
        status === 'over'
            ? `Over capacity (${Math.round(capacity.percentUsed * 100)}%)`
            : status === 'tight'
                ? `At capacity (${Math.round(capacity.percentUsed * 100)}%)`
                : `${Math.max(0, totalMinutes - assignedMinutes)} min free`;
    return (
        <span
            className={`inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded-full border whitespace-nowrap tabular-nums ${cls}`}
            title={title}
        >
            {label}
        </span>
    );
}
