import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useDayPlan } from '../../hooks/useDayPlan';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Modal } from '../ui/Modal';
import { LifeShell } from './LifeShell';
import { HabitForm, type HabitDraft } from './HabitForm';
import { getActiveHabits } from '../../lib/habits';
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
    const { life, dispatch } = useDayPlan();
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

    return (
        <LifeShell
            title="Habits"
            subtitle="Stabilizers auto-inject as daily intentions; light-coherent habits surface in the Light Pool for opportunistic pulls."
        >
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
                                            ? 'Auto-injects as a daily intention'
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
                                </div>
                                <p className="text-xs text-text-light">
                                    {recurrenceSummary(h)}
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
                    submitLabel="Create"
                    onCancel={closeCreate}
                    onSubmit={(draft) => {
                        dispatch({ type: 'ADD_HABIT', habit: draft });
                        closeCreate();
                    }}
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
                        initial={editing}
                        submitLabel="Save"
                        onCancel={() => setEditing(null)}
                        onSubmit={(draft) => {
                            dispatch({
                                type: 'UPDATE_HABIT',
                                habit: { ...draft, id: editing.id, createdAt: editing.createdAt },
                            });
                            setEditing(null);
                        }}
                    />
                )}
            </Modal>

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
