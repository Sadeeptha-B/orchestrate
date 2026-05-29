import { useContext } from 'react';
import { ReconciliationContext } from '../context/ReconciliationContext';

/**
 * v6.5: read the central stabilizer reconciliation status. See `ReconciliationProvider`
 * for trigger conditions and reconcile semantics. Throws if used outside the provider.
 */
export function useStabilizerReconciliation() {
    const ctx = useContext(ReconciliationContext);
    if (!ctx) {
        throw new Error(
            'useStabilizerReconciliation must be used inside <ReconciliationProvider>',
        );
    }
    return ctx;
}
