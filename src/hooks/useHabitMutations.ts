import { useMemo, useState } from 'react';
import { useDayPlan } from './useDayPlan';
import { useTodoistActions, useTodoistData } from './useTodoist';
import { useSyncHabit } from './useSyncHabit';
import { ensureHabitsProject } from '../lib/habitsTodoistSync';
import type { HabitDraft } from '../components/life/HabitForm';
import type { Habit } from '../types';

/**
 * Shared habit create/edit/delete with Todoist sync. Extracted from HabitsLibrary so the same
 * mutations can be driven from any surface (HabitsLibrary, LifeView) without duplicating the
 * Todoist project resolution + per-habit sync dance. Owns its own `syncError` and the
 * project-list refresh state that the HabitForm needs.
 *
 * Mirrors the create/edit posture of `useSyncHabit`: the local habit is written immediately and
 * Todoist sync is best-effort — a failure leaves the habit saved locally and surfaces `syncError`.
 */
export function useHabitMutations() {
    const { settings, dispatch } = useDayPlan();
    const todoistActions = useTodoistActions();
    const { projects, isConfigured: isTodoistConfigured } = useTodoistData();
    const syncHabit = useSyncHabit();

    const [syncError, setSyncError] = useState<string | null>(null);
    const [refreshingProjects, setRefreshingProjects] = useState(false);

    const defaultProjectName = useMemo(() => {
        const id = settings.habitsTodoistProjectId;
        if (!id) return undefined;
        return projects.find((p) => p.id === id)?.name;
    }, [settings.habitsTodoistProjectId, projects]);

    const handleRefreshProjects = async () => {
        setRefreshingProjects(true);
        try {
            await todoistActions.refreshProjects({ force: true });
        } finally {
            setRefreshingProjects(false);
        }
    };

    const onUpdateSettings = (updates: Partial<typeof settings>) =>
        dispatch({ type: 'UPDATE_SETTINGS', settings: updates });

    const resolveDefaultProject = async (): Promise<string | null> =>
        ensureHabitsProject({ actions: todoistActions, settings, projects, onUpdateSettings });

    // Best-effort removal of a habit's backing recurring Todoist task. No-op for micro-gaps,
    // never-synced habits, or when Todoist isn't configured. Non-blocking: callers remove the
    // local habit regardless of whether the API call succeeds (a failure leaves an orphan task,
    // logged for debugging — same posture as the create/edit sync path).
    const deleteHabitTodoistTask = (habit: Habit) => {
        if (habit.kind !== 'habit' || !habit.todoistTaskId || !isTodoistConfigured) return;
        void todoistActions.deleteTask(habit.todoistTaskId).then((deleted) => {
            if (!deleted) {
                console.error(`[habits] delete: Todoist task ${habit.todoistTaskId} failed.`);
            }
        });
    };

    // Remove a habit everywhere: local state + its Todoist task.
    const deleteHabit = (habit: Habit) => {
        dispatch({ type: 'DELETE_HABIT', habitId: habit.id });
        deleteHabitTodoistTask(habit);
    };

    const handleCreate = async (draft: HabitDraft): Promise<Habit> => {
        const newHabit: Habit = { ...draft, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
        dispatch({ type: 'ADD_HABIT', habit: newHabit });
        // v6.7: only 'habit' kind syncs to Todoist — micro-gaps are local-only.
        if (newHabit.kind === 'habit' && isTodoistConfigured) {
            const defaultProjectId = await resolveDefaultProject();
            if (!defaultProjectId) {
                setSyncError("Couldn't reach the Habits project in Todoist — the habit is saved locally. Try again later.");
                return newHabit;
            }
            const taskId = await syncHabit(newHabit, defaultProjectId);
            if (!taskId) setSyncError("Couldn't sync to Todoist — the habit is saved locally. Try again later.");
        }
        return newHabit;
    };

    const handleEdit = async (target: Habit, draft: HabitDraft): Promise<void> => {
        const updated: Habit = { ...draft, id: target.id, createdAt: target.createdAt };
        dispatch({ type: 'UPDATE_HABIT', habit: updated });
        // Kind changed 'habit' → 'micro-gap': the old recurring Todoist task is now orphaned
        // (HabitForm drops `todoistTaskId` for non-habit kinds), so delete it before it keeps
        // recurring in Todoist with no Orchestrate reference.
        if (target.kind === 'habit' && updated.kind !== 'habit') {
            deleteHabitTodoistTask(target);
        }
        // v6.7: only 'habit' kind syncs to Todoist — micro-gaps are local-only.
        if (updated.kind === 'habit' && isTodoistConfigured) {
            const defaultProjectId = await resolveDefaultProject();
            if (!defaultProjectId) {
                setSyncError("Couldn't reach the Habits project in Todoist — the habit is saved locally. Try again later.");
                return;
            }
            const taskId = await syncHabit(updated, defaultProjectId);
            if (!taskId) setSyncError("Couldn't sync to Todoist — the habit is saved locally. Try again later.");
        }
    };

    return {
        // Todoist context the HabitForm needs
        isTodoistConfigured,
        projects,
        defaultProjectName,
        handleRefreshProjects,
        refreshingProjects,
        // Error surface
        syncError,
        setSyncError,
        // Mutations
        handleCreate,
        handleEdit,
        deleteHabit,
        deleteHabitTodoistTask,
    };
}
