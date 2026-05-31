import { useNavigate } from 'react-router-dom';
import { useHabitReconciliation } from '../../hooks/useHabitReconciliation';

/**
 * v6.5: header chip surfacing the central habit reconciliation status across the
 * app (v6.6: both kinds). Three rendered states:
 *
 *  - **Needs attention** (`needsSyncCount > 0`): orange dot + count. Click navigates to
 *    `/habits` where the user can hit Migrate / Re-sync.
 *  - **Reconcile failed** (`lastError` set, no needs-sync): red dot + title-hover with
 *    the error text. Click navigates to `/habits` for diagnostics.
 *  - **In flight** (`isReconciling`): faint pulse, no count. Doesn't intercept clicks.
 *
 * Silent in the happy path (no count, no error, not in flight). Overdue habits are
 * auto-bumped by the reconcile and don't surface a chip — they're a transient state
 * the user shouldn't have to act on.
 */
export function HabitSyncChip() {
    const {
        needsSyncCount,
        isReconciling,
        lastError,
        isConfigured,
    } = useHabitReconciliation();
    const navigate = useNavigate();

    if (!isConfigured) return null;

    if (needsSyncCount > 0) {
        return (
            <button
                onClick={() => navigate('/habits')}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-amber-100 hover:bg-amber-200 dark:bg-amber-900/30 dark:hover:bg-amber-900/50 text-amber-800 dark:text-amber-200 text-xs cursor-pointer transition-colors"
                title={`${needsSyncCount} habit${needsSyncCount === 1 ? '' : 's'} need syncing to Todoist. Click to review.`}
            >
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                <span className="font-medium tabular-nums">{needsSyncCount}</span>
                <span className="hidden sm:inline">needs sync</span>
            </button>
        );
    }

    if (lastError) {
        return (
            <button
                onClick={() => navigate('/habits')}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-red-100 hover:bg-red-200 dark:bg-red-900/30 dark:hover:bg-red-900/50 text-red-800 dark:text-red-200 text-xs cursor-pointer transition-colors"
                title={`Habit reconcile failed: ${lastError}. Click to review.`}
            >
                <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                <span className="hidden sm:inline">sync error</span>
            </button>
        );
    }

    if (isReconciling) {
        return (
            <span
                className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-surface-dark text-text-light text-xs"
                title="Reconciling habits with Todoist…"
            >
                <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                <span className="hidden sm:inline">syncing</span>
            </span>
        );
    }

    return null;
}
