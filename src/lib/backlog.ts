import type { BacklogEntry, DayPlan, Intention, LinkedTask, SavedDayPlan } from '../types';

/**
 * v6.2: returns true when an intention has at least one *intention-bound* linked task
 * that isn't yet completed. Empty-linked-task intentions are NOT considered unfinished —
 * there's nothing to recover. Habit-derived orphan tasks are intentionally ignored:
 * they belong to recurring Todoist tasks, not the parked intention.
 */
export function hasUnfinishedWork(intention: Intention, plan: DayPlan): boolean {
    if (intention.linkedTaskIds.length === 0) return false;
    return plan.linkedTasks.some(
        (lt) =>
            lt.intentionId === intention.id &&
            !lt.sourceHabitId &&
            !lt.completed,
    );
}

/**
 * v6.2: snapshot an intention into a BacklogEntry. Captures titleSnapshots from the
 * current LinkedTask rows so a future bring-back can show task labels even if the
 * underlying Todoist tasks are gone.
 */
export function buildBacklogEntry(
    intention: Intention,
    plan: DayPlan,
    reason: BacklogEntry['reason'],
): BacklogEntry {
    const taskSnapshots: Record<string, string> = {};
    for (const id of intention.linkedTaskIds) {
        const lt = plan.linkedTasks.find((t) => t.todoistId === id);
        if (lt?.titleSnapshot) taskSnapshots[id] = lt.titleSnapshot;
    }
    return {
        id: crypto.randomUUID(),
        intention: { ...intention },
        archivedAt: new Date().toISOString(),
        archivedFromDate: plan.date,
        reason,
        ...(Object.keys(taskSnapshots).length > 0 ? { taskSnapshots } : {}),
    };
}

/**
 * v6.2: harvest unfinished intentions from a stale plan into BacklogEntries.
 * Used by the rollover migration in DayPlanContext's loadInitialState.
 */
export function harvestStalePlan(plan: DayPlan): BacklogEntry[] {
    return plan.intentions
        .filter((i) => hasUnfinishedWork(i, plan))
        .map((i) => buildBacklogEntry(i, plan, 'rollover'));
}

/**
 * v6.2: rebuild LinkedTask rows when an intention is brought back from the backlog.
 * Fresh state — no categorization, no estimate, no assignment, not completed.
 * `taskCache` is the live Todoist title map (todoistId → content); falls back to
 * the entry's captured `taskSnapshots`, then to the id itself as a last resort.
 */
export function rebuildLinkedTasksForBacklogEntry(
    entry: BacklogEntry,
    taskCache: Record<string, string>,
): LinkedTask[] {
    return entry.intention.linkedTaskIds.map((todoistId) => {
        const titleSnapshot =
            taskCache[todoistId] ?? entry.taskSnapshots?.[todoistId];
        return {
            todoistId,
            intentionId: entry.intention.id,
            type: 'unclassified' as const,
            assignedSessions: [],
            completed: false,
            estimatedMinutes: null,
            ...(titleSnapshot ? { titleSnapshot } : {}),
        };
    });
}

/**
 * v6.2: build an auto-save SavedDayPlan from a stale plan being rolled over.
 * Stamp the schema markers consistent with manual SAVE_DAY.
 */
export function buildAutoSaveEntry(
    plan: DayPlan,
    wizardStepsCount: number,
    schemaVersion: number,
): SavedDayPlan {
    return {
        plan: {
            ...structuredClone(plan),
            _wizardSteps: wizardStepsCount,
            _schemaVersion: schemaVersion,
        } as DayPlan,
        savedAt: new Date().toISOString(),
        label: `Auto: ${plan.date}`,
    };
}
