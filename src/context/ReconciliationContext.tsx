import {
    createContext,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from 'react';
import { useDayPlan } from '../hooks/useDayPlan';
import { useTodoistActions, useTodoistData } from '../hooks/useTodoist';
import {
    computeTodaysHabitInstances,
    ensureHabitsProject,
    findNeedsSyncStabilizers,
    findOverdueStabilizers,
    reconcileOverdueStabilizers,
    resolveHabitProjectId,
    syncHabitToTodoist,
    type NeedsSyncStabilizerInfo,
    type OverdueStabilizerInfo,
} from '../lib/habitsTodoistSync';
import { DEFAULT_TASK_CAPS } from '../lib/capacity';
import type { Habit } from '../types';

/**
 * Time after a successful reconciliation before a focus event can trigger another.
 * Keeps the focus-refresh from spamming Todoist when the user is tab-switching often.
 */
const FOCUS_STALENESS_MS = 5 * 60_000;

interface ReconciliationStatus {
    /** Active stabilizers with an unchecked, overdue Todoist task whose recurrence matches today. */
    overdueCount: number;
    /** Active stabilizers whose Todoist task is missing — either never synced or deleted upstream. */
    needsSyncCount: number;
    /** Of `needsSyncCount`, how many never had a `todoistTaskId`. */
    neverSyncedCount: number;
    /** Of `needsSyncCount`, how many were synced but the task is gone. */
    missingTaskCount: number;
    /** True while a reconcile pass is in flight. */
    isReconciling: boolean;
    /** Wall-clock of the last successful (or attempted) reconcile, or null if never run. */
    lastReconciledAt: number | null;
    /** Last error message from a reconcile attempt; cleared on the next success. */
    lastError: string | null;
    /** True when Todoist is configured (token present). */
    isConfigured: boolean;
    /**
     * Trigger a full reconcile (needs-sync first, then overdue bump). Idempotent — running
     * while a pass is in flight is a no-op. Safe to call repeatedly; failures land in
     * `lastError` and are also console.error'd.
     */
    triggerReconcile: () => Promise<void>;
}

const ReconciliationContext = createContext<ReconciliationStatus | null>(null);
export { ReconciliationContext };

/**
 * v6.5: central reconciliation provider for stabilizer habits. Replaces the per-surface
 * reconciles that lived in Step1Intentions (overdue bump) and HabitsLibrary (manual
 * migrate). Detection is read-only and recomputed every render; the action runs:
 *
 *   1. **On first hydration** of the session — once Todoist is configured and `taskMap`
 *      has hydrated, runs a full reconcile pass.
 *   2. **On window focus**, gated by `FOCUS_STALENESS_MS` so quick tab-switches don't
 *      re-fire writes.
 *   3. **On manual `triggerReconcile()`** call (used by the HabitsLibrary button and
 *      could be wired to other surfaces).
 *
 * The pass is ordered needs-sync → overdue. Newly-created tasks from needs-sync don't
 * participate in the same pass's overdue bump (taskMap closure is stale within the
 * pass), but this is fine in practice: a freshly-created recurring task starts at its
 * next valid occurrence, which is never overdue.
 *
 * Consumers read the status via `useStabilizerReconciliation()` (see `hooks/`). The
 * status object drives the `HabitSyncChip` in the shared header and the banner in
 * `/habits`.
 */
export function ReconciliationProvider({ children }: { children: ReactNode }) {
    const { plan, settings, life, dispatch } = useDayPlan();
    const { taskMap, projects, isConfigured } = useTodoistData();
    const actions = useTodoistActions();

    const [isReconciling, setIsReconciling] = useState(false);
    const [lastReconciledAt, setLastReconciledAt] = useState<number | null>(null);
    const [lastError, setLastError] = useState<string | null>(null);

    // Pure detection — recomputed every render but bounded by habit count (small N).
    const overdue = useMemo<OverdueStabilizerInfo[]>(
        () => findOverdueStabilizers({ life, taskMap, dateISO: plan.date }),
        [life, taskMap, plan.date],
    );
    const needsSync = useMemo<NeedsSyncStabilizerInfo[]>(
        () => findNeedsSyncStabilizers({ life, taskMap }),
        [life, taskMap],
    );
    const neverSyncedCount = useMemo(
        () => needsSync.filter((n) => n.reason === 'never-synced').length,
        [needsSync],
    );

    // Refs for effect guards — using state for these would bind the effects to changing
    // values and cause double-fire.
    const inflightRef = useRef(false);
    const lastReconciledAtRef = useRef<number | null>(null);
    const firstRunDoneRef = useRef(false);

    /**
     * Sync one stabilizer to Todoist, mirroring `HabitsLibrary.syncStabilizer`. Returns
     * the resulting task id on success, null on failure. On success, patches the habit
     * to write back the (possibly new) `todoistTaskId` and clear a stale `todoistProjectId`.
     */
    const syncStabilizer = useCallback(async (habit: Habit, defaultProjectId: string): Promise<string | null> => {
        if (habit.kind !== 'stabilizer') return null;
        const projectId = resolveHabitProjectId(habit, defaultProjectId, projects);
        const taskId = await syncHabitToTodoist({
            habit,
            projectId,
            actions,
            taskMap,
        });
        if (!taskId) return null;
        const patch: Partial<Habit> = {};
        if (taskId !== habit.todoistTaskId) patch.todoistTaskId = taskId;
        if (
            habit.todoistProjectId
            && !projects.some((p) => p.id === habit.todoistProjectId)
        ) {
            patch.todoistProjectId = undefined;
        }
        if (Object.keys(patch).length > 0) {
            dispatch({ type: 'UPDATE_HABIT', habit: { ...habit, ...patch } });
        }
        return taskId;
    }, [actions, dispatch, projects, taskMap]);

    const triggerReconcile = useCallback(async () => {
        if (!isConfigured) return;
        if (inflightRef.current) return;
        inflightRef.current = true;
        setIsReconciling(true);

        try {
            // Phase 1: needs-sync — create/update Todoist tasks for habits without a live link.
            // Resolve the default project ONCE so a batch can't churn the project (the v6.1
            // stale-closure bug).
            if (needsSync.length > 0) {
                const defaultProjectId = await ensureHabitsProject({
                    actions,
                    settings,
                    projects,
                    onUpdateSettings: (updates) =>
                        dispatch({ type: 'UPDATE_SETTINGS', settings: updates }),
                });
                if (!defaultProjectId) {
                    throw new Error("Couldn't reach the Habits project in Todoist");
                }
                let failures = 0;
                for (const { habit } of needsSync) {
                    const ok = await syncStabilizer(habit, defaultProjectId);
                    if (!ok) failures += 1;
                }
                if (failures > 0) {
                    // Partial success is recorded but doesn't block Phase 2 — overdue bumping
                    // is independent of whether the new tasks were created.
                    console.error(
                        `[habits] reconcile: ${failures}/${needsSync.length} needs-sync habits failed to sync`,
                    );
                }
            }

            // Phase 2: overdue bump — uses the original taskMap snapshot. Newly-created
            // tasks from Phase 1 don't participate, but they're never overdue (Todoist
            // creates them at the next valid occurrence), so this is safe.
            if (overdue.length > 0) {
                const patched = await reconcileOverdueStabilizers({
                    overdue,
                    actions,
                    dateISO: plan.date,
                });
                if (patched.size > 0) {
                    const merged = new Map(taskMap);
                    patched.forEach((t, id) => merged.set(id, t));
                    const instances = computeTodaysHabitInstances({
                        life,
                        plan,
                        taskMap: merged,
                        now: new Date(),
                        taskCaps: settings.taskCapDefaults ?? DEFAULT_TASK_CAPS,
                    });
                    if (instances.length > 0) {
                        dispatch({ type: 'REFRESH_TODAYS_HABITS', instances });
                    }
                }
            }

            setLastError(null);
            const now = Date.now();
            setLastReconciledAt(now);
            lastReconciledAtRef.current = now;
        } catch (e) {
            const msg = e instanceof Error ? e.message : 'Habit reconciliation failed';
            console.error('[habits] reconcile pass failed:', e);
            setLastError(msg);
        } finally {
            setIsReconciling(false);
            inflightRef.current = false;
        }
    }, [
        isConfigured, needsSync, overdue, actions, settings, projects, taskMap, life, plan,
        dispatch, syncStabilizer,
    ]);

    // Trigger 1: first hydration — fire once per session as soon as Todoist + tasks are ready.
    useEffect(() => {
        if (firstRunDoneRef.current) return;
        if (!isConfigured) return;
        if (taskMap.size === 0) return;
        firstRunDoneRef.current = true;
        void triggerReconcile();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isConfigured, taskMap.size]);

    // Trigger 2: window focus, gated by staleness. Stays in sync with how Todoist's own
    // focus-refresh handles dedup.
    useEffect(() => {
        if (!isConfigured) return;
        const onFocus = () => {
            const last = lastReconciledAtRef.current;
            if (last !== null && Date.now() - last < FOCUS_STALENESS_MS) return;
            void triggerReconcile();
        };
        window.addEventListener('focus', onFocus);
        return () => window.removeEventListener('focus', onFocus);
    }, [isConfigured, triggerReconcile]);

    const value = useMemo<ReconciliationStatus>(() => ({
        overdueCount: overdue.length,
        needsSyncCount: needsSync.length,
        neverSyncedCount,
        missingTaskCount: needsSync.length - neverSyncedCount,
        isReconciling,
        lastReconciledAt,
        lastError,
        isConfigured,
        triggerReconcile,
    }), [
        overdue.length, needsSync.length, neverSyncedCount,
        isReconciling, lastReconciledAt, lastError, isConfigured, triggerReconcile,
    ]);

    return (
        <ReconciliationContext.Provider value={value}>
            {children}
        </ReconciliationContext.Provider>
    );
}
