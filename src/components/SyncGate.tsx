import { useEffect, useState, type ReactNode } from 'react';
import { pullAndMerge } from '../lib/cloudSync';

/**
 * Cold-start gate for the D1 sync sidecar. Before the state provider mounts, pull the remote snapshot
 * and merge it into localStorage (last-write-wins per slice) so `DayPlanProvider`'s loader reads the
 * reconciled state. Resolves fast when offline / no secret / on timeout (~2s cap in `pullAndMerge`),
 * so this never blocks startup for long. `pullAndMerge` is memoized, so React StrictMode's double
 * mount still results in a single fetch.
 */
export function SyncGate({ children }: { children: ReactNode }) {
    const [ready, setReady] = useState(false);

    useEffect(() => {
        let cancelled = false;
        pullAndMerge().finally(() => {
            if (!cancelled) setReady(true);
        });
        return () => {
            cancelled = true;
        };
    }, []);

    if (!ready) {
        return (
            <div className="min-h-screen bg-app text-text px-4 py-10 sm:px-6 lg:px-8 flex items-center justify-center">
                <div
                    className="h-8 w-8 animate-spin rounded-full border-2 border-accent/30 border-t-accent"
                    role="status"
                    aria-label="Loading"
                />
            </div>
        );
    }
    return <>{children}</>;
}
