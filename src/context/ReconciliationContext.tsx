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
import { useSyncHabit } from '../hooks/useSyncHabit';
import {
    computeTodaysHabitInstances,
    ensureHabitsProject,
    findNeedsSyncHabits,
    findOverdueHabits,
    habitIdTokenOf,
    hasHabitMarker,
    reconcileOverdueHabits,
    withHabitIdToken,
    ORCHESTRATE_HABIT_LABEL,
    type NeedsSyncHabitInfo,
    type OverdueHabitInfo,
} from '../lib/habitsTodoistSync';
import { DEFAULT_TASK_CAPS } from '../lib/capacity';
import { useAccountFingerprint, type AccountMismatch } from '../hooks/useAccountFingerprint';
import type { ExternalAccountRef } from '../types';

/**
 * Time after a successful reconciliation before a focus event can trigger another.
 * Keeps the focus-refresh from spamming Todoist when the user is tab-switching often.
 */
const FOCUS_STALENESS_MS = 5 * 60_000;

export type { AccountMismatch };

interface ReconciliationStatus {
    /** Active habits with an unchecked, overdue Todoist task whose recurrence matches today. */
    overdueCount: number;
    /** Active habits whose Todoist task is missing — either never synced or deleted upstream. */
    needsSyncCount: number;
    /** The actual habits behind `needsSyncCount`, so surfaces can list them by name. */
    needsSyncHabits: NeedsSyncHabitInfo[];
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
    /** v7.11: non-null when the connected account differs from the stored fingerprint — all
     *  habit-task auto-writes (reconcile pass + manual saves) are gated off while set. */
    accountMismatch: AccountMismatch | null;
    /** v7.11: stamp the currently connected account as this store's fingerprint, clearing the
     *  mismatch gate. Deliberately does NOT auto-run a reconcile — the user should see the
     *  needs-sync counts and choose to sync explicitly. */
    adoptCurrentAccount: () => void;
    /** Clear the current reconcile error banner without mutating counts or timestamps. */
    clearError: () => void;
    /**
     * Trigger a full reconcile (needs-sync first, then overdue bump). Idempotent — running
     * while a pass is in flight is a no-op. Safe to call repeatedly; failures land in
     * `lastError` and are also console.error'd.
     *
     * v7.11 (R4): by default the pass is **adopt-only for previously-linked habits** — a
     * `missing-in-todoist` habit re-links by id or adopts by marker, but its task is never
     * re-*created* automatically (a task deliberately deleted in Todoist must stay deleted).
     * Pass `recreateMissing: true` from an explicit user action (the Habits-page Re-sync
     * button) to also re-create; `never-synced` habits always create — that's the feature.
     */
    triggerReconcile: (opts?: { recreateMissing?: boolean }) => Promise<void>;
    /**
     * v7.11 (R4): recreate a single missing habit's Todoist task — the per-row consent,
     * for when only some of the missing tasks should come back (the rest being deliberate
     * deletions the user resolves by deactivating/deleting those habits).
     */
    recreateHabitTask: (habitId: string) => Promise<void>;
}

const ReconciliationContext = createContext<ReconciliationStatus | null>(null);
export { ReconciliationContext };

/**
 * v6.5: central reconciliation provider for habits (v6.7: 'habit' kind only — micro-gaps never sync).
 * Replaces the per-surface reconciles that lived in Step2Intentions (overdue bump) and HabitsLibrary
 * (manual migrate). Detection is read-only and recomputed every render; the action runs:
 *
 *   1. **On first hydration** of the session — once Todoist is configured and `taskMap`
 *      has hydrated, runs a full reconcile pass.
 *   2. **On window focus**, gated by `FOCUS_STALENESS_MS` so quick tab-switches don't
 *      re-fire writes.
 *   3. **On manual `triggerReconcile()`** call (used by the HabitsLibrary button and
 *      could be wired to other surfaces). Only this explicit path passes
 *      `recreateMissing: true` — automatic triggers (1) and (2) are adopt-only for
 *      previously-linked habits (R4: a deliberate deletion in Todoist must stay deleted).
 *
 * The pass is ordered needs-sync → overdue. Newly-created tasks from needs-sync don't
 * participate in the same pass's overdue bump (taskMap closure is stale within the
 * pass), but this is fine in practice: a freshly-created recurring task starts at its
 * next valid occurrence, which is never overdue.
 *
 * Consumers read the status via `useHabitReconciliation()` (see `hooks/`). The
 * status object drives the `HabitSyncChip` in the shared header and the banner in
 * `/habits`.
 */
export function ReconciliationProvider({ children }: { children: ReactNode }) {
    const { plan, settings, life, dispatch } = useDayPlan();
    const {
        taskMap, projects, isConfigured, tasksHydrated,
        accountId, accountEmail, accountResolved,
    } = useTodoistData();
    const actions = useTodoistActions();
    const syncHabit = useSyncHabit();

    const [isReconciling, setIsReconciling] = useState(false);
    const [lastReconciledAt, setLastReconciledAt] = useState<number | null>(null);
    const [lastError, setLastError] = useState<string | null>(null);

    // ── v7.11: account provenance — the shared stamp/compare/adopt cycle lives in
    // useAccountFingerprint; this provider just feeds it the live Todoist identity. ──
    const currentAccount = useMemo<ExternalAccountRef | null>(
        () => (accountId ? { id: accountId, ...(accountEmail ? { email: accountEmail } : {}) } : null),
        [accountId, accountEmail],
    );
    const {
        mismatch: accountMismatch,
        verdict: accountVerdict,
        adoptCurrentAccount,
    } = useAccountFingerprint({
        key: 'todoistAccount',
        current: currentAccount,
        resolved: accountResolved,
        connected: isConfigured,
    });

    // Pure detection — recomputed every render but bounded by habit count (small N).
    const overdue = useMemo<OverdueHabitInfo[]>(
        () => findOverdueHabits({ life, taskMap, dateISO: plan.date }),
        [life, taskMap, plan.date],
    );
    const needsSync = useMemo<NeedsSyncHabitInfo[]>(
        () => findNeedsSyncHabits({ life, taskMap, tasksHydrated }),
        [life, taskMap, tasksHydrated],
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

    const stampReconcileAttempt = useCallback(() => {
        const now = Date.now();
        setLastReconciledAt(now);
        lastReconciledAtRef.current = now;
    }, []);
    const clearError = useCallback(() => setLastError(null), []);

    const triggerReconcile = useCallback(async (opts?: { recreateMissing?: boolean }) => {
        const recreateMissing = opts?.recreateMissing ?? false;
        if (!isConfigured) return;
        // v7.11 provenance gate: never write while the fingerprint verdict is out ('wait' — the
        // first pass must not race the /user fetch) or against a foreign account ('blocked').
        // No fingerprint or a *failed* identity fetch → 'ok' (legacy ungated behavior).
        // useSyncHabit applies the same verdict for its direct callers.
        if (accountVerdict !== 'ok') return;
        if (inflightRef.current) return;
        inflightRef.current = true;
        setIsReconciling(true);

        try {
            // Phase 1: needs-sync — resolve Todoist tasks for habits without a live link.
            // `never-synced` habits walk the full ladder (create at the end — that's the
            // feature). `missing-in-todoist` habits are adopt-only unless this is an explicit
            // recreate (R4): a dangling id means the task *vanished*, and the automatic pass
            // can't tell data loss from a deliberate deletion in Todoist — so it heals only
            // via the benign rungs and leaves creation to the user's Re-sync. Resolve the
            // default project ONCE so a batch can't churn it (the v6.1 stale-closure bug).
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
                for (const { habit, reason } of needsSync) {
                    const allowCreate = reason === 'never-synced' || recreateMissing;
                    const ok = await syncHabit(habit, defaultProjectId, { allowCreate });
                    // An adopt-only miss is pending (awaiting explicit recreate), not a failure.
                    if (!ok && allowCreate) failures += 1;
                }
                if (failures > 0) {
                    // Partial success is recorded but doesn't block Phase 2 — overdue bumping
                    // is independent of whether the new tasks were created.
                    console.error(
                        `[habits] reconcile: ${failures}/${needsSync.length} needs-sync habits failed to sync`,
                    );
                }
            }

            // Phase 1.5 (v7.11): marker backfill — stamp the durable markers onto linked tasks
            // that predate them: the `orchestrate-habit` class label (write-once, preserving the
            // user's other labels) and the `[orchestrate:habit:<uuid>]` description token
            // (replaced in place when stale, preserving the user's description text). These let
            // a registry-less store (fresh dev, post-reset, backup-seeded) recognize and adopt
            // the tasks instead of duplicating. A no-op pass once every linked task carries
            // both. Best-effort — a failed update is logged by the Todoist layer and retried on
            // the next pass.
            for (const habit of life.habits) {
                if (habit.kind !== 'habit' || !habit.todoistTaskId) continue;
                const task = taskMap.get(habit.todoistTaskId);
                if (!task) continue;
                const needsLabel = !hasHabitMarker(task);
                const needsToken = habitIdTokenOf(task) !== habit.id;
                if (!needsLabel && !needsToken) continue;
                await actions.updateTask(task.id, {
                    ...(needsLabel ? { labels: [...(task.labels ?? []), ORCHESTRATE_HABIT_LABEL] } : {}),
                    ...(needsToken ? { description: withHabitIdToken(task.description, habit.id) } : {}),
                });
            }

            // Phase 2: overdue bump — uses the original taskMap snapshot. Newly-created
            // tasks from Phase 1 don't participate, but they're never overdue (Todoist
            // creates them at the next valid occurrence), so this is safe.
            if (overdue.length > 0) {
                const patched = await reconcileOverdueHabits({
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
            stampReconcileAttempt();
        } catch (e) {
            const msg = e instanceof Error ? e.message : 'Habit reconciliation failed';
            console.error('[habits] reconcile pass failed:', e);
            setLastError(msg);
            stampReconcileAttempt();
        } finally {
            setIsReconciling(false);
            inflightRef.current = false;
        }
    }, [
        isConfigured, needsSync, overdue, actions, settings, projects, taskMap, life, plan,
        dispatch, syncHabit, stampReconcileAttempt, accountVerdict,
    ]);

    // v7.11 (R4): the per-row consent — recreate exactly one missing habit's task. Shares the
    // inflight guard with the batch pass so the two can't interleave writes.
    const recreateHabitTask = useCallback(async (habitId: string) => {
        if (!isConfigured) return;
        if (accountVerdict !== 'ok') return;
        if (inflightRef.current) return;
        const habit = life.habits.find((h) => h.id === habitId);
        if (!habit) return;
        inflightRef.current = true;
        setIsReconciling(true);
        try {
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
            const ok = await syncHabit(habit, defaultProjectId, { allowCreate: true });
            if (!ok) throw new Error(`Couldn't recreate "${habit.name}" in Todoist`);
            setLastError(null);
        } catch (e) {
            const msg = e instanceof Error ? e.message : 'Recreate failed';
            console.error('[habits] per-habit recreate failed:', e);
            setLastError(msg);
        } finally {
            setIsReconciling(false);
            inflightRef.current = false;
        }
    }, [isConfigured, accountVerdict, life.habits, actions, settings, projects, dispatch, syncHabit]);

    // Trigger 1: first hydration — fire once per session as soon as Todoist + tasks are ready.
    // v7.11: while the fingerprint verdict is 'wait', hold the first pass until the live
    // identity settles (instead of racing it); 'blocked' proceeds into the no-op gate above.
    useEffect(() => {
        if (firstRunDoneRef.current) return;
        if (!isConfigured) return;
        if (!tasksHydrated) return;
        if (accountVerdict === 'wait') return;
        firstRunDoneRef.current = true;
        void triggerReconcile();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isConfigured, tasksHydrated, accountVerdict]);

    useEffect(() => {
        if (!tasksHydrated) {
            firstRunDoneRef.current = false;
        }
    }, [tasksHydrated]);

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
        needsSyncHabits: needsSync,
        neverSyncedCount,
        missingTaskCount: needsSync.length - neverSyncedCount,
        isReconciling,
        lastReconciledAt,
        lastError,
        isConfigured,
        accountMismatch,
        adoptCurrentAccount,
        clearError,
        triggerReconcile,
        recreateHabitTask,
    }), [
        overdue.length, needsSync, neverSyncedCount,
        isReconciling, lastReconciledAt, lastError, isConfigured,
        accountMismatch, adoptCurrentAccount, clearError, triggerReconcile, recreateHabitTask,
    ]);

    return (
        <ReconciliationContext.Provider value={value}>
            {children}
        </ReconciliationContext.Provider>
    );
}
