import { useContext } from 'react';
import { ReconciliationContext } from '../context/ReconciliationContext';

/**
 * v6.5: read the central habit reconciliation status (v6.6: both kinds). See
 * `ReconciliationProvider` for trigger conditions and reconcile semantics. Throws if used
 * outside the provider.
 */
export function useHabitReconciliation() {
    const ctx = useContext(ReconciliationContext);
    if (!ctx) {
        throw new Error(
            'useHabitReconciliation must be used inside <ReconciliationProvider>',
        );
    }
    return ctx;
}
