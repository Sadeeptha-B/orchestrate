import { useState, type ReactNode } from 'react';
import { useDayPlan } from './useDayPlan';
import { useHabitMutations } from './useHabitMutations';
import { Modal } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';
import { HabitForm, type HabitDraft } from '../components/life/HabitForm';
import type { Habit } from '../types';

interface UseHabitFormsOptions {
    /** Seed the create modal open (e.g. arriving from a "new habit" navigation). */
    initialShowCreate?: boolean;
    /** Pre-fill the create form (e.g. a kind chosen on the previous screen). */
    initialCreateDraft?: Partial<HabitDraft>;
    /** Open straight into editing this habit (e.g. arriving from a habit pill's edit link). */
    initialEditing?: Habit | null;
}

/**
 * Owns the shared habit create / edit / anchor-delete modal stack and the handlers that drive
 * it, on top of `useHabitMutations`. Extracted so `HabitsLibrary` and `LifeView` render the exact
 * same modals + deletion-confirm behavior instead of copy-pasting ~75 lines of JSX each.
 *
 * Returns everything `useHabitMutations` exposes (so callers still get `syncError`, `projects`,
 * etc.) plus the open/edit/delete triggers and a ready-to-render `modals` node. Surface-specific
 * UI (the library's needs-sync banner + bulk-delete, the Life view's inline pills) stays in the
 * component; only the form/confirm plumbing is shared.
 */
export function useHabitForms(opts: UseHabitFormsOptions = {}) {
    const { life } = useDayPlan();
    const mutations = useHabitMutations();
    const { isTodoistConfigured, projects, defaultProjectName, handleRefreshProjects, refreshingProjects, handleCreate, handleEdit, deleteHabit } = mutations;

    const [showCreate, setShowCreate] = useState(opts.initialShowCreate ?? false);
    const [createDraft, setCreateDraft] = useState<Partial<HabitDraft> | undefined>(opts.initialCreateDraft);
    const [editing, setEditing] = useState<Habit | null>(opts.initialEditing ?? null);
    const [confirmDelete, setConfirmDelete] = useState<Habit | null>(null);

    const openCreate = (draft?: Partial<HabitDraft>) => {
        setCreateDraft(draft);
        setShowCreate(true);
    };
    const closeCreate = () => {
        setShowCreate(false);
        setCreateDraft(undefined);
    };
    const openEdit = (habit: Habit) => setEditing(habit);

    // Anchor habits get a confirm gate before deletion; everything else deletes immediately.
    const requestDelete = (habit: Habit) => {
        if (habit.isAnchor && habit.active) {
            setConfirmDelete(habit);
            return;
        }
        deleteHabit(habit);
    };

    // Close the modal immediately, then let the shared mutation run its best-effort Todoist sync.
    const submitCreate = (draft: HabitDraft) => {
        closeCreate();
        void handleCreate(draft);
    };
    const submitEdit = (target: Habit, draft: HabitDraft) => {
        setEditing(null);
        void handleEdit(target, draft);
    };

    const formProps = {
        seasons: life.seasons,
        todoistProjects: isTodoistConfigured ? projects : [],
        defaultProjectName,
        onRefreshProjects: isTodoistConfigured ? handleRefreshProjects : undefined,
        refreshingProjects,
    };

    const modals: ReactNode = (
        <>
            <Modal open={showCreate} onClose={closeCreate} title="New habit">
                <HabitForm
                    {...formProps}
                    initial={createDraft}
                    submitLabel="Create"
                    onCancel={closeCreate}
                    onSubmit={submitCreate}
                />
            </Modal>

            <Modal
                open={editing !== null}
                onClose={() => setEditing(null)}
                title={editing ? `Edit ${editing.name}` : ''}
            >
                {editing && (
                    <HabitForm
                        {...formProps}
                        initial={editing}
                        submitLabel="Save"
                        onCancel={() => setEditing(null)}
                        onSubmit={(draft) => submitEdit(editing, draft)}
                    />
                )}
            </Modal>

            <Modal
                open={confirmDelete !== null}
                onClose={() => setConfirmDelete(null)}
                title="Delete anchor habit?"
            >
                {confirmDelete && (
                    <div>
                        <p className="text-sm text-text-light mb-4">
                            <strong>{confirmDelete.name}</strong> is an anchor — one of your
                            load-bearing habits. Delete it anyway?
                            {confirmDelete.kind === 'habit' && confirmDelete.todoistTaskId && isTodoistConfigured && (
                                <> Its recurring Todoist task will also be removed.</>
                            )}
                        </p>
                        <div className="flex justify-end gap-2">
                            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(null)}>
                                Cancel
                            </Button>
                            <Button
                                variant="secondary"
                                size="sm"
                                className="text-red-500 hover:text-red-600"
                                onClick={() => {
                                    deleteHabit(confirmDelete);
                                    setConfirmDelete(null);
                                }}
                            >
                                Delete
                            </Button>
                        </div>
                    </div>
                )}
            </Modal>
        </>
    );

    return { ...mutations, openCreate, openEdit, requestDelete, modals };
}
