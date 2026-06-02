import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useDayPlan } from '../../hooks/useDayPlan';
import { useTodoistActions, useTodoistData } from '../../hooks/useTodoist';
import { useHabitReconciliation } from '../../hooks/useHabitReconciliation';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Modal } from '../ui/Modal';
import { LifeShell } from './LifeShell';
import { HabitForm, type HabitDraft } from './HabitForm';
import { getActiveHabits, partitionByKind } from '../../lib/habits';
import { ensureHabitsProject } from '../../lib/habitsTodoistSync';
import { useSyncHabit } from '../../hooks/useSyncHabit';
import type { Habit } from '../../types';

interface HabitsLocationState {
    createHabitKind?: HabitDraft['kind'];
    /** Pre-select a season filter when arriving from a season detail page. */
    seasonFilter?: string;
    /** Open the edit modal for this habit ID immediately on mount. */
    editHabitId?: string;
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

const GROUP_HEADING = 'text-xs font-medium uppercase tracking-wider text-text-light flex items-center gap-2 mb-2';
const CHEVRON_CLS = 'w-3 h-3 text-text-light transition-transform';

export function HabitsLibrary() {
    const { life, settings, dispatch } = useDayPlan();
    const todoistActions = useTodoistActions();
    const { projects, isConfigured: isTodoistConfigured } = useTodoistData();
    const syncHabit = useSyncHabit();
    const {
        needsSyncCount,
        neverSyncedCount,
        missingTaskCount,
        isReconciling,
        lastError: reconcileError,
        clearError,
        triggerReconcile,
    } = useHabitReconciliation();
    const location = useLocation();
    const navigate = useNavigate();
    const locationState = location.state as HabitsLocationState | null;
    const createHabitKindFromState = locationState?.createHabitKind;
    const editHabitIdFromState = locationState?.editHabitId;

    const [showCreate, setShowCreate] = useState(() => Boolean(createHabitKindFromState));
    const [createInitial, setCreateInitial] = useState<Partial<HabitDraft> | undefined>(() =>
        createHabitKindFromState ? { kind: createHabitKindFromState } : undefined,
    );
    const [editing, setEditing] = useState<Habit | null>(() =>
        editHabitIdFromState ? (life.habits.find((h) => h.id === editHabitIdFromState) ?? null) : null,
    );
    const [confirmDelete, setConfirmDelete] = useState<Habit | null>(null);
    const [syncError, setSyncError] = useState<string | null>(null);
    const [refreshingProjects, setRefreshingProjects] = useState(false);
    const [inactiveOpen, setInactiveOpen] = useState(false);

    // Season filter — initialized from navigation state so arriving from a season page
    // pre-filters automatically; the user can then change or clear it via the filter pills.
    const [seasonFilter, setSeasonFilter] = useState<string | null>(
        () => locationState?.seasonFilter ?? null,
    );

    // Clear navigation state after reading so back/forward nav doesn't restore stale filters.
    useEffect(() => {
        if (!createHabitKindFromState && !locationState?.seasonFilter && !editHabitIdFromState) return;
        navigate(location.pathname, { replace: true, state: null });
    }, [createHabitKindFromState, locationState?.seasonFilter, editHabitIdFromState, location.pathname, navigate]);

    const activeHabitCount = getActiveHabits(life).length;

    const defaultProjectName = useMemo(() => {
        const id = settings.habitsTodoistProjectId;
        if (!id) return undefined;
        return projects.find((p) => p.id === id)?.name;
    }, [settings.habitsTodoistProjectId, projects]);

    // Filtered + grouped derivation — stable identity helps avoid render cascades.
    const { habitList, microGapList, inactive } = useMemo(() => {
        const base = seasonFilter
            ? life.habits.filter((h) => h.seasonIds.includes(seasonFilter))
            : life.habits;
        const sorted = [...base].sort((a, b) => {
            if (a.active !== b.active) return a.active ? -1 : 1;
            if (a.isAnchor !== b.isAnchor) return a.isAnchor ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
        const active = sorted.filter((h) => h.active);
        const { habits: habitList, microGaps: microGapList } = partitionByKind(active);
        return { habitList, microGapList, inactive: sorted.filter((h) => !h.active) };
    }, [life.habits, seasonFilter]);

    const handleRefreshProjects = async () => {
        setRefreshingProjects(true);
        try {
            await todoistActions.refreshProjects({ force: true });
        } finally {
            setRefreshingProjects(false);
        }
    };

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

    const resolveDefaultProject = async (): Promise<string | null> =>
        ensureHabitsProject({ actions: todoistActions, settings, projects, onUpdateSettings });

    const handleCreate = async (draft: HabitDraft) => {
        const newHabit: Habit = { ...draft, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
        dispatch({ type: 'ADD_HABIT', habit: newHabit });
        closeCreate();
        // v6.7: only 'habit' kind syncs to Todoist — micro-gaps are local-only.
        if (newHabit.kind === 'habit' && isTodoistConfigured) {
            const defaultProjectId = await resolveDefaultProject();
            if (!defaultProjectId) {
                setSyncError("Couldn't reach the Habits project in Todoist — the habit is saved locally. Try again later.");
                return;
            }
            const taskId = await syncHabit(newHabit, defaultProjectId);
            if (!taskId) setSyncError("Couldn't sync to Todoist — the habit is saved locally. Try again later.");
        }
    };

    const handleEdit = async (target: Habit, draft: HabitDraft) => {
        const updated: Habit = { ...draft, id: target.id, createdAt: target.createdAt };
        dispatch({ type: 'UPDATE_HABIT', habit: updated });
        setEditing(null);
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

    const handleMigrate = () => {
        setSyncError(null);
        void triggerReconcile();
    };

    // Render one habit card — inlined so it can close over dispatch/setEditing/tryDelete
    // without prop-drilling. Called as a function (not a component) to avoid React rules issues.
    const renderCard = (h: Habit) => (
        <Card key={h.id} className="hover:border-accent/40 transition-colors">
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                        <h3 className="font-medium">{h.name}</h3>
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
                        {h.kind === 'habit' && h.active && !h.todoistTaskId && (
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
                        disabled={isReconciling}
                        onClick={() => dispatch({ type: 'TOGGLE_HABIT_ACTIVE', habitId: h.id })}
                    >
                        {h.active ? 'Pause' : 'Activate'}
                    </Button>
                    <Button variant="ghost" size="sm" disabled={isReconciling} onClick={() => setEditing(h)}>
                        Edit
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        disabled={isReconciling}
                        onClick={() => tryDelete(h)}
                        className="text-red-500 hover:text-red-600"
                    >
                        Delete
                    </Button>
                </div>
            </div>
        </Card>
    );

    const activeCount = habitList.length + microGapList.length;

    return (
        <LifeShell
            title="Habits"
            subtitle="Habits sync to Todoist and surface in Today's Habits (timed on the timeline, or anytime). Micro-gaps are light, repeatable fillers — no Todoist, pulled from their own panel when you have a gap."
        >
            {/* ── Sync banner ── */}
            {needsSyncCount > 0 && (
                <div className="mb-4 rounded-lg border border-accent/30 bg-accent-subtle p-3 flex items-center justify-between gap-3">
                    <div className="text-sm">
                        <strong>{needsSyncCount} habit{needsSyncCount === 1 ? '' : 's'}</strong>{' '}
                        {missingTaskCount === 0
                            ? 'need to be synced as recurring Todoist tasks.'
                            : neverSyncedCount === 0
                                ? "have a Todoist task that's gone missing — re-sync to recreate it."
                                : `need syncing (${neverSyncedCount} new, ${missingTaskCount} missing in Todoist).`}
                        {isTodoistConfigured ? (
                            <span className="text-text-light">
                                {' '}Will sync to{' '}
                                <strong className="text-text">{defaultProjectName ?? 'a new "Habits" project'}</strong>.
                            </span>
                        ) : (
                            <span className="text-text-light"> Connect Todoist in Settings first.</span>
                        )}
                    </div>
                    {isTodoistConfigured && (
                        <div className="flex items-center gap-2 flex-shrink-0">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => navigate('/settings?tab=integrations')}
                                disabled={isReconciling}
                            >
                                Choose project
                            </Button>
                            <Button size="sm" disabled={isReconciling} onClick={handleMigrate}>
                                {isReconciling ? 'Syncing…' : missingTaskCount === 0 ? 'Migrate' : 'Re-sync'}
                            </Button>
                        </div>
                    )}
                </div>
            )}

            {(syncError || reconcileError) && (
                <div className="mb-4 rounded-lg border border-red-300 bg-red-50 dark:bg-red-900/20 p-3 text-sm flex items-center justify-between gap-3">
                    <span>{syncError ?? reconcileError}</span>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => { setSyncError(null); clearError(); }}
                    >
                        Dismiss
                    </Button>
                </div>
            )}

            {/* ── Header row ── */}
            <div className="flex items-center justify-between mb-3">
                <p className="text-sm text-text-light">
                    {life.habits.length === 0
                        ? 'No habits yet — start with one anchor habit (sleep, meditation, or gym).'
                        : `${life.habits.length} habit${life.habits.length === 1 ? '' : 's'}, ${activeHabitCount} active.`}
                </p>
                <Button
                    size="sm"
                    onClick={() => openCreate()}
                    disabled={isReconciling}
                    title={isReconciling ? 'Wait for the sync to finish' : undefined}
                >
                    New Habit
                </Button>
            </div>

            {/* ── Season filter pills ── */}
            {life.seasons.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-5">
                    <button
                        type="button"
                        onClick={() => setSeasonFilter(null)}
                        className={`text-xs px-3 py-1 rounded-full border transition-colors cursor-pointer ${
                            !seasonFilter
                                ? 'border-accent bg-accent text-white'
                                : 'border-border text-text-light hover:border-accent/40 hover:text-text'
                        }`}
                    >
                        All seasons
                    </button>
                    {life.seasons.map((s) => (
                        <button
                            key={s.id}
                            type="button"
                            onClick={() => setSeasonFilter(s.id)}
                            className={`text-xs px-3 py-1 rounded-full border transition-colors cursor-pointer flex items-center gap-1.5 ${
                                seasonFilter === s.id
                                    ? 'border-accent bg-accent text-white'
                                    : 'border-border text-text-light hover:border-accent/40 hover:text-text'
                            }`}
                        >
                            {s.name}
                            {s.active && (
                                <span className={`w-1.5 h-1.5 rounded-full ${seasonFilter === s.id ? 'bg-white/70' : 'bg-accent'}`} />
                            )}
                        </button>
                    ))}
                </div>
            )}

            {/* ── Grouped habit list ── */}
            <div className="space-y-6">
                {/* Habits */}
                {habitList.length > 0 && (
                    <div>
                        <h4 className={GROUP_HEADING}>
                            Habits
                            <span className="text-text-light/60 font-normal normal-case tracking-normal">
                                {habitList.length}
                            </span>
                        </h4>
                        <div className="space-y-2">{habitList.map(renderCard)}</div>
                    </div>
                )}

                {/* Micro-gaps */}
                {microGapList.length > 0 && (
                    <div>
                        <h4 className={GROUP_HEADING}>
                            Micro-gaps
                            <span className="text-text-light/60 font-normal normal-case tracking-normal">
                                {microGapList.length}
                            </span>
                        </h4>
                        <div className="space-y-2">{microGapList.map(renderCard)}</div>
                    </div>
                )}

                {/* Empty state */}
                {activeCount === 0 && (
                    <p className="text-sm text-text-light italic">
                        {seasonFilter
                            ? 'No active habits for this season — assign some from the Habits form.'
                            : 'No active habits yet — start with one anchor habit (sleep, meditation, or gym).'}
                    </p>
                )}

                {/* Inactive — collapsible, hidden by default */}
                {inactive.length > 0 && (
                    <div className={activeCount > 0 ? 'border-t border-border pt-5' : ''}>
                        <button
                            type="button"
                            onClick={() => setInactiveOpen((o) => !o)}
                            className="flex items-center gap-2 cursor-pointer group"
                            aria-expanded={inactiveOpen}
                        >
                            <svg
                                className={`${CHEVRON_CLS} ${inactiveOpen ? 'rotate-90' : ''}`}
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                strokeWidth={2}
                            >
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                            </svg>
                            <span className="text-xs font-medium uppercase tracking-wider text-text-light group-hover:text-text transition-colors">
                                Inactive
                            </span>
                            <span className="text-text-light/60 text-xs font-normal normal-case tracking-normal">
                                {inactive.length}
                            </span>
                        </button>
                        {inactiveOpen && (
                            <div className="space-y-2 mt-2">{inactive.map(renderCard)}</div>
                        )}
                    </div>
                )}
            </div>

            {/* ── Modals ── */}
            <Modal open={showCreate} onClose={closeCreate} title="New habit">
                <HabitForm
                    initial={createInitial}
                    seasons={life.seasons}
                    todoistProjects={isTodoistConfigured ? projects : []}
                    defaultProjectName={defaultProjectName}
                    onRefreshProjects={isTodoistConfigured ? handleRefreshProjects : undefined}
                    refreshingProjects={refreshingProjects}
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
                        onRefreshProjects={isTodoistConfigured ? handleRefreshProjects : undefined}
                        refreshingProjects={refreshingProjects}
                        initial={editing}
                        submitLabel="Save"
                        onCancel={() => setEditing(null)}
                        onSubmit={(draft) => handleEdit(editing, draft)}
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
                                    dispatch({ type: 'DELETE_HABIT', habitId: confirmDelete.id });
                                    setConfirmDelete(null);
                                }}
                            >
                                Delete
                            </Button>
                        </div>
                    </div>
                )}
            </Modal>
        </LifeShell>
    );
}
