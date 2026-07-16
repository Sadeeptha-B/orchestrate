import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useDayPlan } from '../../hooks/useDayPlan';
import { useHabitReconciliation } from '../../hooks/useHabitReconciliation';
import { useHabitForms } from '../../hooks/useHabitForms';
import { AccountMismatchBanner } from '../ui/AccountMismatchBanner';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Modal } from '../ui/Modal';
import { LifeShell } from './LifeShell';
import { getActiveHabits, partitionByKind } from '../../lib/habits';
import type { HabitDraft } from './HabitForm';
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
    const { life, dispatch } = useDayPlan();
    const location = useLocation();
    const navigate = useNavigate();
    const locationState = location.state as HabitsLocationState | null;
    const createHabitKindFromState = locationState?.createHabitKind;
    const editHabitIdFromState = locationState?.editHabitId;

    const {
        isTodoistConfigured,
        defaultProjectName,
        syncError,
        setSyncError,
        deleteHabit,
        openCreate,
        openEdit,
        requestDelete,
        modals,
    } = useHabitForms({
        initialShowCreate: Boolean(createHabitKindFromState),
        initialCreateDraft: createHabitKindFromState ? { kind: createHabitKindFromState } : undefined,
        initialEditing: editHabitIdFromState
            ? (life.habits.find((h) => h.id === editHabitIdFromState) ?? null)
            : null,
    });
    const {
        needsSyncCount,
        needsSyncHabits,
        neverSyncedCount,
        missingTaskCount,
        isReconciling,
        lastError: reconcileError,
        accountMismatch,
        adoptCurrentAccount,
        clearError,
        triggerReconcile,
        recreateHabitTask,
    } = useHabitReconciliation();

    const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
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

    const handleMigrate = () => {
        setSyncError(null);
        // The explicit Re-sync button is the consent to re-*create* missing tasks (R4) —
        // automatic passes only adopt for previously-linked habits.
        void triggerReconcile({ recreateMissing: true });
    };

    // Delete every habit currently flagged as needing sync — the escape hatch for habits the
    // user doesn't actually want pushed to Todoist. Removes each locally (and its task, if any).
    const handleBulkDeleteNeedsSync = () => {
        for (const { habit } of needsSyncHabits) deleteHabit(habit);
        setConfirmBulkDelete(false);
    };

    // Render one habit card — inlined so it can close over dispatch/openEdit/requestDelete
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
                    <Button variant="ghost" size="sm" disabled={isReconciling} onClick={() => openEdit(h)}>
                        Edit
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        disabled={isReconciling}
                        onClick={() => requestDelete(h)}
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
            {/* ── v7.11: account-mismatch banner — sync is paused; outranks the needs-sync banner
                 (whose counts are meaningless against a foreign account). ── */}
            {accountMismatch && (
                <div className="mb-4">
                    <AccountMismatchBanner
                        provider="Todoist"
                        mismatch={accountMismatch}
                        intro="These habits were synced against"
                        paused="Habit sync is paused so nothing gets duplicated in the wrong account."
                        guidance="Reconnect the original account in Settings → Integrations, or adopt the current one. Adopting re-points these habits here — re-syncing will then create their recurring tasks in this account (fine if that's the intent, e.g. a sandbox)."
                        onAdopt={adoptCurrentAccount}
                    />
                </div>
            )}

            {/* ── Sync banner ── */}
            {!accountMismatch && needsSyncCount > 0 && (
                <div className="mb-4 rounded-lg border border-accent/30 bg-accent-subtle p-3 space-y-2.5">
                    <div className="text-sm">
                        <strong>{needsSyncCount} habit{needsSyncCount === 1 ? '' : 's'}</strong>{' '}
                        {missingTaskCount === 0
                            ? 'need to be synced as recurring Todoist tasks.'
                            : neverSyncedCount === 0
                                ? "have a Todoist task that's gone missing — Re-sync recreates it."
                                : `need syncing (${neverSyncedCount} new, ${missingTaskCount} missing in Todoist — Re-sync recreates missing tasks).`}
                        {isTodoistConfigured ? (
                            <span className="text-text-light">
                                {' '}Will sync to{' '}
                                <strong className="text-text">{defaultProjectName ?? 'a new "Habits" project'}</strong>.
                            </span>
                        ) : (
                            <span className="text-text-light"> Connect Todoist in Settings first.</span>
                        )}
                        {missingTaskCount > 0 && (
                            <span className="text-text-light">
                                {' '}Missing tasks are never recreated automatically — if you deleted
                                one in Todoist on purpose, deactivate or delete its habit here instead
                                of re-syncing.
                            </span>
                        )}
                    </div>

                    {/* Name the habits so it's clear exactly what will be synced or deleted.
                        Missing ones get a per-row recreate (R4) so a mixed batch — some deleted
                        deliberately, some lost — doesn't force the all-or-nothing Re-sync. */}
                    <div className="flex flex-wrap gap-1.5">
                        {needsSyncHabits.map(({ habit, reason }) => (
                            <span
                                key={habit.id}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-card border border-border text-xs text-text-light"
                                title={reason === 'missing-in-todoist'
                                    ? 'Its Todoist task has gone missing'
                                    : 'Not yet synced to Todoist'}
                            >
                                <span className="truncate max-w-[12rem]">{habit.name}</span>
                                {reason === 'missing-in-todoist' && (
                                    <>
                                        <span aria-hidden className="text-amber-600 dark:text-amber-400">⚠</span>
                                        <button
                                            onClick={() => {
                                                setSyncError(null);
                                                void recreateHabitTask(habit.id);
                                            }}
                                            disabled={isReconciling || !isTodoistConfigured}
                                            className="text-accent hover:underline cursor-pointer disabled:opacity-50 disabled:cursor-default disabled:no-underline"
                                            title={`Recreate only "${habit.name}" in Todoist`}
                                        >
                                            recreate
                                        </button>
                                    </>
                                )}
                            </span>
                        ))}
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                        {isTodoistConfigured && (
                            <>
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
                            </>
                        )}
                        <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-500 hover:text-red-600"
                            disabled={isReconciling}
                            onClick={() => setConfirmBulkDelete(true)}
                        >
                            Delete habit{needsSyncCount === 1 ? '' : 's'}
                        </Button>
                    </div>
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
            {/* Create / edit / anchor-delete confirm are shared with LifeView via useHabitForms. */}
            {modals}

            {/* Bulk needs-sync delete is library-only (driven by the sync banner above). */}
            <Modal
                open={confirmBulkDelete}
                onClose={() => setConfirmBulkDelete(false)}
                title={`Delete ${needsSyncCount} habit${needsSyncCount === 1 ? '' : 's'}?`}
            >
                <div>
                    <p className="text-sm text-text-light mb-3">
                        {needsSyncCount === 1 ? 'This habit hasn’t' : 'These habits haven’t'} been synced
                        to Todoist. Deleting removes {needsSyncCount === 1 ? 'it' : 'them'} from Orchestrate
                        entirely — use this if you don’t want {needsSyncCount === 1 ? 'it' : 'them'} pushed
                        over. This can’t be undone.
                    </p>
                    <ul className="mb-4 space-y-1 max-h-40 overflow-y-auto scrollbar-subtle">
                        {needsSyncHabits.map(({ habit }) => (
                            <li key={habit.id} className="text-sm flex items-center gap-2">
                                <span className="w-1 h-1 rounded-full bg-border flex-shrink-0" />
                                <span className="truncate">{habit.name}</span>
                                {habit.isAnchor && (
                                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-accent text-white flex-shrink-0">
                                        ANCHOR
                                    </span>
                                )}
                            </li>
                        ))}
                    </ul>
                    <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={() => setConfirmBulkDelete(false)}>
                            Cancel
                        </Button>
                        <Button
                            variant="secondary"
                            size="sm"
                            className="text-red-500 hover:text-red-600"
                            onClick={handleBulkDeleteNeedsSync}
                        >
                            Delete {needsSyncCount === 1 ? 'habit' : 'all'}
                        </Button>
                    </div>
                </div>
            </Modal>
        </LifeShell>
    );
}
