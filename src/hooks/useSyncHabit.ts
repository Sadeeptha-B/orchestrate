import { useCallback, useEffect, useRef } from 'react';
import { useDayPlan } from './useDayPlan';
import { useTodoistActions, useTodoistData } from './useTodoist';
import { fingerprintVerdict } from './useAccountFingerprint';
import { resolveHabitProjectId, syncHabitToTodoist } from '../lib/habitsTodoistSync';
import type { Habit } from '../types';

/**
 * v6.5: shared per-habit sync. v6.7: **'habit' kind only** — micro-gaps never sync (the inner
 * `syncHabitToTodoist` also early-returns null for them). Pushes one habit to Todoist using a
 * pre-resolved default project id and writes the resulting `todoistTaskId` back onto the habit.
 * Used by both the explicit HabitsLibrary create/edit save flow and the central
 * `ReconciliationProvider` batch pass — the caller resolves the default project once (via
 * `ensureHabitsProject`) so a batch can't churn the project on every iteration.
 *
 * Returns the resulting task id on success, or null on failure / non-'habit' kind.
 *
 * Self-heals two stale-reference cases by patching the habit on success:
 *   - `todoistTaskId` updated when create-or-update returned a different id
 *   - `todoistProjectId` cleared when the per-habit override pointed at a deleted project
 *     (we silently fell back to the default in `resolveHabitProjectId`).
 */
export function useSyncHabit(): (
    habit: Habit,
    defaultProjectId: string,
    opts?: { allowCreate?: boolean },
) => Promise<string | null> {
    const { settings, life, dispatch } = useDayPlan();
    const actions = useTodoistActions();
    const { projects, taskMap, accountId, accountResolved } = useTodoistData();
    const storedAccount = settings.todoistAccount;
    // Ref so the claimed-task set reads current habits without churning the callback identity.
    const lifeRef = useRef(life);
    useEffect(() => { lifeRef.current = life; }, [life]);

    return useCallback(async (
        habit: Habit,
        defaultProjectId: string,
        opts?: { allowCreate?: boolean },
    ): Promise<string | null> => {
        if (habit.kind !== 'habit') return null; // v6.7: micro-gaps don't sync to Todoist.
        // v7.11 provenance guard — the same verdict as ReconciliationProvider's batch gate,
        // repeated here because direct callers (e.g. the HabitsLibrary save flow) don't pass
        // through the provider. 'wait': the identity fetch hasn't settled — the habit stays
        // saved locally, reads as needs-sync, and the next reconcile pass picks it up.
        // 'blocked': writing would mint tasks in an account the registry wasn't minted against.
        const verdict = fingerprintVerdict({
            stored: storedAccount,
            currentId: accountId,
            resolved: accountResolved,
        });
        if (verdict === 'wait') {
            console.warn('[habits] sync deferred: Todoist account identity not resolved yet.');
            return null;
        }
        if (verdict === 'blocked') {
            console.error(
                '[habits] sync blocked: connected Todoist account differs from the account this '
                + "store's habits were synced against. Adopt the current account (Habits page) or "
                + 'reconnect the original one.',
            );
            return null;
        }
        const projectId = resolveHabitProjectId(habit, defaultProjectId, projects);
        // v7.11: tasks other habits already link to are off-limits for marker adoption. (Within a
        // batch pass this closes over the pre-pass life; only degenerate same-named habits could
        // collide, and the exact-name pairing makes that a pre-existing modeling problem.)
        const claimedTaskIds = new Set(
            lifeRef.current.habits
                .filter((h) => h.id !== habit.id && h.todoistTaskId)
                .map((h) => h.todoistTaskId as string),
        );
        const taskId = await syncHabitToTodoist({
            habit, projectId, actions, taskMap, claimedTaskIds,
            allowCreate: opts?.allowCreate,
        });
        if (!taskId) return null;

        const patch: Partial<Habit> = {};
        if (taskId !== habit.todoistTaskId) patch.todoistTaskId = taskId;
        if (habit.todoistProjectId && !projects.some((p) => p.id === habit.todoistProjectId)) {
            patch.todoistProjectId = undefined;
        }
        if (Object.keys(patch).length > 0) {
            dispatch({ type: 'UPDATE_HABIT', habit: { ...habit, ...patch } });
        }
        return taskId;
    }, [actions, dispatch, projects, taskMap, accountId, accountResolved, storedAccount]);
}
