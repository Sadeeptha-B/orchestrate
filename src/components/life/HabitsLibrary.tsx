import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useDayPlan } from '../../hooks/useDayPlan';
import { useTodoistActions, useTodoistData } from '../../hooks/useTodoist';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Modal } from '../ui/Modal';
import { LifeShell } from './LifeShell';
import { HabitForm, type HabitDraft } from './HabitForm';
import { SettingsModal } from '../settings/SettingsModal';
import { getActiveHabits } from '../../lib/habits';
import { ensureHabitsProject, resolveHabitProjectId, syncHabitToTodoist } from '../../lib/habitsTodoistSync';
import type { Habit } from '../../types';

interface HabitsLocationState {
    createHabitKind?: HabitDraft['kind'];
}

function recurrenceSummary(h: Habit): string {
    const r = h.recurrence;
    switch (r.kind) {
        case 'daily':
            return 'Daily';
        case 'weekdays':
            return 'Weekdays';
        case 'weekly':
        case 'custom': {
            if (!r.daysOfWeek || r.daysOfWeek.length === 0) return r.kind;
            const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            return r.daysOfWeek.map((d) => labels[d]).join(', ');
        }
    }
}

export function HabitsLibrary() {
    const { life, settings, dispatch } = useDayPlan();
    const todoistActions = useTodoistActions();
    const { projects, taskMap, isConfigured: isTodoistConfigured } = useTodoistData();
    const location = useLocation();
    const navigate = useNavigate();
    const locationState = location.state as HabitsLocationState | null;
    const createHabitKindFromState = locationState?.createHabitKind;
    const [showCreate, setShowCreate] = useState(() => Boolean(createHabitKindFromState));
    const [createInitial, setCreateInitial] = useState<Partial<HabitDraft> | undefined>(() =>
        createHabitKindFromState ? { kind: createHabitKindFromState } : undefined,
    );
    const [editing, setEditing] = useState<Habit | null>(null);
    const [confirmDelete, setConfirmDelete] = useState<Habit | null>(null);
    const [syncError, setSyncError] = useState<string | null>(null);
    const [migrating, setMigrating] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const activeHabitCount = getActiveHabits(life).length;

    useEffect(() => {
        if (!createHabitKindFromState) return;

        navigate(location.pathname, { replace: true, state: null });
    }, [createHabitKindFromState, location.pathname, navigate]);

    const sorted = [...life.habits].sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1;
        if (a.isAnchor !== b.isAnchor) return a.isAnchor ? -1 : 1;
        return a.name.localeCompare(b.name);
    });

    const unsyncedStabilizers = useMemo(
        () => life.habits.filter((h) => h.kind === 'stabilizer' && h.active && !h.todoistTaskId),
        [life.habits],
    );

    const defaultProjectName = useMemo(() => {
        const id = settings.habitsTodoistProjectId;
        if (!id) return undefined;
        return projects.find((p) => p.id === id)?.name;
    }, [settings.habitsTodoistProjectId, projects]);

    const tryDelete = (habit: Habit) => {
        if (habit.isAnchor && habit.active) {
            setConfirmDelete(habit);
            return;
        }
        dispatch({ type: 'DELETE_HABIT', habitId: habit.id });
    };

    const openCreate = (initial?: Partial<HabitDraft>) => {
        setCreateInitial(initial);
        setShowCreate(true);
    };

    const closeCreate = () => {
        setShowCreate(false);
        setCreateInitial(undefined);
    };

    const onUpdateSettings = (updates: Partial<typeof settings>) =>
        dispatch({ type: 'UPDATE_SETTINGS', settings: updates });

    /**
     * Push a stabilizer to Todoist using a pre-resolved default project id and persist the resulting
     * taskId on the habit. No-op for non-stabilizers. The caller resolves the default project once
     * (avoids a stale-closure loop where each iteration would re-create the project).
     */
    const syncStabilizer = async (habit: Habit, defaultProjectId: string): Promise<boolean> => {
        if (habit.kind !== 'stabilizer' || !isTodoistConfigured) return false;
        const projectId = resolveHabitProjectId(habit, defaultProjectId, projects);
        const taskId = await syncHabitToTodoist({
            habit,
            projectId,
            actions: todoistActions,
            taskMap,
        });
        if (!taskId) return false;
        if (taskId !== habit.todoistTaskId) {
            dispatch({ type: 'UPDATE_HABIT', habit: { ...habit, todoistTaskId: taskId } });
        }
        return true;
    };

    /** Resolve (or lazily create) the workspace default Habits project. Returns null on failure. */
    const resolveDefaultProject = async (): Promise<string | null> => {
        return ensureHabitsProject({
            actions: todoistActions,
            settings,
            projects,
            onUpdateSettings,
        });
    };

    const handleCreate = async (draft: HabitDraft) => {
        const newHabit: Habit = {
            ...draft,
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
        };
        dispatch({ type: 'ADD_HABIT', habit: newHabit });
        closeCreate();
        if (newHabit.kind === 'stabilizer' && isTodoistConfigured) {
            const defaultProjectId = await resolveDefaultProject();
            if (!defaultProjectId) {
                setSyncError("Couldn't reach the Habits project in Todoist — the habit is saved locally. Try again later.");
                return;
            }
            const ok = await syncStabilizer(newHabit, defaultProjectId);
            if (!ok) setSyncError("Couldn't sync to Todoist — the habit is saved locally. Try again later.");
        }
    };

    const handleEdit = async (target: Habit, draft: HabitDraft) => {
        const updated: Habit = { ...draft, id: target.id, createdAt: target.createdAt };
        dispatch({ type: 'UPDATE_HABIT', habit: updated });
        setEditing(null);
        if (updated.kind === 'stabilizer' && isTodoistConfigured) {
            const defaultProjectId = await resolveDefaultProject();
            if (!defaultProjectId) {
                setSyncError("Couldn't reach the Habits project in Todoist — the habit is saved locally. Try again later.");
                return;
            }
            const ok = await syncStabilizer(updated, defaultProjectId);
            if (!ok) setSyncError("Couldn't sync to Todoist — the habit is saved locally. Try again later.");
        }
    };

    const handleMigrate = async () => {
        if (!isTodoistConfigured || unsyncedStabilizers.length === 0) return;
        setMigrating(true);
        setSyncError(null);
        // Resolve the default project ONCE — `syncStabilizer` re-uses this id across iterations
        // so we never re-create a project mid-loop (the bug fixed in v6.1).
        const defaultProjectId = await resolveDefaultProject();
        if (!defaultProjectId) {
            setMigrating(false);
            setSyncError("Couldn't reach the Habits project in Todoist. Try again.");
            return;
        }
        let failures = 0;
        for (const habit of unsyncedStabilizers) {
            const ok = await syncStabilizer(habit, defaultProjectId);
            if (!ok) failures += 1;
        }
        setMigrating(false);
        if (failures > 0) {
            setSyncError(
                `Migrated ${unsyncedStabilizers.length - failures} of ${unsyncedStabilizers.length}. Try again to retry the rest.`,
            );
        }
    };

    return (
        <LifeShell
            title="Habits"
            subtitle="Stabilizers sync to Todoist as recurring tasks and surface as session-assigned tasks each day they're due. Light-coherent habits live in the Light Pool."
        >
            {unsyncedStabilizers.length > 0 && (
                <div className="mb-4 rounded-lg border border-accent/30 bg-accent-subtle p-3 flex items-center justify-between gap-3">
                    <div className="text-sm">
                        <strong>
                            {unsyncedStabilizers.length} stabilizer{unsyncedStabilizers.length === 1 ? '' : 's'}
                        </strong>{' '}
                        need to be synced as recurring Todoist tasks.
                        {isTodoistConfigured ? (
                            <span className="text-text-light">
                                {' '}Will sync to{' '}
                                <strong className="text-text">
                                    {defaultProjectName ?? 'a new "Habits" project'}
                                </strong>
                                .
                            </span>
                        ) : (
                            <span className="text-text-light">
                                {' '}Connect Todoist in Settings first.
                            </span>
                        )}
                    </div>
                    {isTodoistConfigured && (
                        <div className="flex items-center gap-2 flex-shrink-0">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setShowSettings(true)}
                                disabled={migrating}
                            >
                                Choose project
                            </Button>
                            <Button size="sm" disabled={migrating} onClick={handleMigrate}>
                                {migrating ? 'Migrating…' : 'Migrate'}
                            </Button>
                        </div>
                    )}
                </div>
            )}

            {syncError && (
                <div className="mb-4 rounded-lg border border-red-300 bg-red-50 dark:bg-red-900/20 p-3 text-sm flex items-center justify-between gap-3">
                    <span>{syncError}</span>
                    <Button variant="ghost" size="sm" onClick={() => setSyncError(null)}>
                        Dismiss
                    </Button>
                </div>
            )}

            <div className="flex items-center justify-between mb-4">
                <p className="text-sm text-text-light">
                    {life.habits.length === 0
                        ? 'No habits yet — start with one anchor habit (sleep, meditation, or gym).'
                        : `${life.habits.length} habit${life.habits.length === 1 ? '' : 's'}, ${activeHabitCount
                        } active.`}
                </p>
                <Button size="sm" onClick={() => openCreate()}>
                    New Habit
                </Button>
            </div>

            <div className="space-y-2">
                {sorted.map((h) => (
                    <Card key={h.id} className="hover:border-accent/40 transition-colors">
                        <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap mb-1">
                                    <h3 className="font-medium">{h.name}</h3>
                                    <span
                                        className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${h.kind === 'stabilizer'
                                                ? 'bg-accent-subtle text-accent'
                                                : 'bg-surface-dark text-text-light'
                                            }`}
                                        title={h.kind === 'stabilizer'
                                            ? 'Synced to Todoist as a recurring task; surfaces as a session-assigned task each day it is due'
                                            : 'Surfaces in the Light Pool; never enters the day plan'}
                                    >
                                        {h.kind === 'stabilizer' ? 'STABILIZER' : 'LIGHT'}
                                    </span>
                                    {h.isAnchor && (
                                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-accent text-white">
                                            ANCHOR
                                        </span>
                                    )}
                                    {!h.active && (
                                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-surface-dark text-text-light">
                                            INACTIVE
                                        </span>
                                    )}
                                    {h.kind === 'stabilizer' && !h.todoistTaskId && h.active && (
                                        <span
                                            className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
                                            title="Not yet synced to Todoist"
                                        >
                                            UNSYNCED
                                        </span>
                                    )}
                                </div>
                                <p className="text-xs text-text-light">
                                    {recurrenceSummary(h)}
                                    {h.targetTime && ` · ${h.targetTime}`}
                                    {h.targetDurationMinutes && ` · ${h.targetDurationMinutes}m`}
                                    {h.minimumViable && ` · MVP: ${h.minimumViable}`}
                                    {h.triggerCue && ` · cue: ${h.triggerCue}`}
                                </p>
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() =>
                                        dispatch({ type: 'TOGGLE_HABIT_ACTIVE', habitId: h.id })
                                    }
                                >
                                    {h.active ? 'Pause' : 'Activate'}
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => setEditing(h)}>
                                    Edit
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => tryDelete(h)}
                                    className="text-red-500 hover:text-red-600"
                                >
                                    Delete
                                </Button>
                            </div>
                        </div>
                    </Card>
                ))}
            </div>

            <Modal open={showCreate} onClose={closeCreate} title="New habit">
                <HabitForm
                    initial={createInitial}
                    seasons={life.seasons}
                    todoistProjects={isTodoistConfigured ? projects : []}
                    defaultProjectName={defaultProjectName}
                    submitLabel="Create"
                    onCancel={closeCreate}
                    onSubmit={handleCreate}
                />
            </Modal>

            <Modal
                open={editing !== null}
                onClose={() => setEditing(null)}
                title={editing ? `Edit ${editing.name}` : ''}
            >
                {editing && (
                    <HabitForm
                        seasons={life.seasons}
                        todoistProjects={isTodoistConfigured ? projects : []}
                        defaultProjectName={defaultProjectName}
                        initial={editing}
                        submitLabel="Save"
                        onCancel={() => setEditing(null)}
                        onSubmit={(draft) => handleEdit(editing, draft)}
                    />
                )}
            </Modal>

            <SettingsModal
                open={showSettings}
                onClose={() => setShowSettings(false)}
            />

            <Modal
                open={confirmDelete !== null}
                onClose={() => setConfirmDelete(null)}
                title="Anchor habit — deactivate first"
            >
                {confirmDelete && (
                    <div>
                        <p className="text-sm text-text-light mb-4">
                            <strong>{confirmDelete.name}</strong> is an active anchor habit.
                            Deactivate it before deleting — anchors are protected on purpose.
                        </p>
                        <div className="flex justify-end gap-2">
                            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(null)}>
                                Cancel
                            </Button>
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => {
                                    dispatch({
                                        type: 'TOGGLE_HABIT_ACTIVE',
                                        habitId: confirmDelete.id,
                                    });
                                    setConfirmDelete(null);
                                }}
                            >
                                Deactivate now
                            </Button>
                        </div>
                    </div>
                )}
            </Modal>
        </LifeShell>
    );
}
