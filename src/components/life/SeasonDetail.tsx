import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useDayPlan } from '../../hooks/useDayPlan';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Modal } from '../ui/Modal';
import { LifeShell } from './LifeShell';
import { SeasonForm } from './SeasonForm';
import { partitionByKind } from '../../lib/habits';
import type { Habit, RecurringFocus } from '../../types';

const FOCUS_DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Compact recurrence label for a recurring focus, e.g. "Daily", "Weekdays", "Mon, Wed". */
function focusRecurrenceLabel(f: RecurringFocus): string {
    const r = f.recurrence;
    if (r.kind === 'daily') return 'Daily';
    if (r.kind === 'weekdays') return 'Weekdays';
    const days = r.daysOfWeek ?? [];
    return days.length > 0 ? days.map((d) => FOCUS_DOW[d]).join(', ') : 'Weekly';
}

function MemberHabitGroup({ label, habits }: { label: string; habits: Habit[] }) {
    if (habits.length === 0) return null;
    return (
        <div>
            <p className="text-[11px] uppercase tracking-wider text-text-light mb-1.5">
                {label} <span className="text-text-light/60">· {habits.length}</span>
            </p>
            <ul className="text-sm space-y-1">
                {habits.map((h) => (
                    <li key={h.id} className="flex items-center gap-2">
                        <span>{h.name}</span>
                        {h.kind === 'habit' && h.targetTime && (
                            <span className="text-[10px] tabular-nums text-text-light">{h.targetTime}</span>
                        )}
                        {h.isAnchor && (
                            <span className="text-[10px] uppercase tracking-wider text-accent">
                                anchor
                            </span>
                        )}
                        {!h.active && (
                            <span className="text-[10px] uppercase tracking-wider text-text-light">
                                inactive
                            </span>
                        )}
                    </li>
                ))}
            </ul>
        </div>
    );
}

function FieldList({ items, empty }: { items: string[]; empty: string }) {
    if (items.length === 0) return <p className="text-xs text-text-light italic">{empty}</p>;
    return (
        <ul className="text-sm space-y-1">
            {items.map((g, i) => (
                <li key={i} className="flex gap-2">
                    <span className="text-text-light">·</span>
                    <span>{g}</span>
                </li>
            ))}
        </ul>
    );
}

export function SeasonDetail() {
    const { id } = useParams<{ id: string }>();
    const { life, dispatch } = useDayPlan();
    const navigate = useNavigate();
    const [editing, setEditing] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);

    const season = life.seasons.find((s) => s.id === id);
    if (!season) {
        return (
            <LifeShell title="Season not found">
                <Button variant="ghost" size="sm" onClick={() => navigate('/season')}>
                    Back to Seasons
                </Button>
            </LifeShell>
        );
    }

    const memberHabits = life.habits.filter((h) => h.seasonIds.includes(season.id));
    const { habits: memberHabitsByKind, microGaps: memberMicroGaps } = partitionByKind(memberHabits);

    return (
        <LifeShell
            title={season.name}
            subtitle={season.primaryTheme || undefined}
            crumbs={[{ label: 'Seasons', to: '/season' }]}
        >
            <div className="flex items-center gap-2 mb-4">
                {!season.active && (
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => dispatch({ type: 'ACTIVATE_SEASON', seasonId: season.id })}
                    >
                        Activate
                    </Button>
                )}
                {season.active && (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => dispatch({ type: 'ACTIVATE_SEASON', seasonId: null })}
                    >
                        Deactivate
                    </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
                    Edit
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmDelete(true)}
                    className="text-red-500 hover:text-red-600"
                >
                    Delete
                </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                    <h4 className="text-xs font-medium uppercase tracking-wider text-text-light mb-2">
                        Window
                    </h4>
                    <p className="text-sm">
                        {season.startDate} → {season.endDate ?? 'open-ended'}
                    </p>
                </Card>

                <Card>
                    <h4 className="text-xs font-medium uppercase tracking-wider text-text-light mb-2">
                        Success criteria
                    </h4>
                    <p className="text-sm whitespace-pre-wrap">
                        {season.successCriteria || (
                            <span className="text-text-light italic">Not set</span>
                        )}
                    </p>
                </Card>

                <Card>
                    <h4 className="text-xs font-medium uppercase tracking-wider text-text-light mb-2">
                        Supporting goals
                    </h4>
                    <FieldList items={season.supportingGoals} empty="No goals yet" />
                </Card>

                <Card>
                    <h4 className="text-xs font-medium uppercase tracking-wider text-text-light mb-2">
                        Recurring focuses
                    </h4>
                    {(season.recurringFocuses ?? []).length === 0 ? (
                        <p className="text-xs text-text-light italic">No recurring focuses</p>
                    ) : (
                        <ul className="text-sm space-y-1">
                            {(season.recurringFocuses ?? []).map((f) => (
                                <li key={f.id} className="flex items-center gap-2">
                                    <span aria-hidden className="text-accent">＋</span>
                                    <span className={f.active ? '' : 'text-text-light line-through'}>{f.title}</span>
                                    <span className="text-[10px] uppercase tracking-wider text-text-light">
                                        {focusRecurrenceLabel(f)}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </Card>

                <Card>
                    <h4 className="text-xs font-medium uppercase tracking-wider text-text-light mb-2">
                        Non-goals
                    </h4>
                    <FieldList items={season.nonGoals} empty="Nothing explicitly out of scope" />
                </Card>

                {season.capacityBudget && (
                    <Card className="md:col-span-2">
                        <h4 className="text-xs font-medium uppercase tracking-wider text-text-light mb-2">
                            Capacity budget
                        </h4>
                        <div className="text-sm space-y-1">
                            {season.capacityBudget.weeklyGrowthHours != null && (
                                <p>
                                    Weekly growth hours (soft cap):{' '}
                                    <span className="font-medium">
                                        {season.capacityBudget.weeklyGrowthHours}h
                                    </span>
                                </p>
                            )}
                            {season.capacityBudget.maxConcurrentHabits != null && (
                                <p>
                                    Max active habits:{' '}
                                    <span className="font-medium">
                                        {season.capacityBudget.maxConcurrentHabits}
                                    </span>
                                </p>
                            )}
                            {season.capacityBudget.notes && (
                                <p className="text-text-light whitespace-pre-wrap mt-2">
                                    {season.capacityBudget.notes}
                                </p>
                            )}
                        </div>
                    </Card>
                )}

                <Card className="md:col-span-2">
                    <div className="flex items-center justify-between mb-2">
                        <h4 className="text-xs font-medium uppercase tracking-wider text-text-light">
                            Member habits
                        </h4>
                        <Button variant="ghost" size="sm" onClick={() => navigate('/habits', { state: { seasonFilter: season.id } })}>
                            Manage habits
                        </Button>
                    </div>
                    {memberHabits.length === 0 ? (
                        <p className="text-xs text-text-light italic">
                            No habits assigned to this season yet.
                        </p>
                    ) : (
                        <div className="space-y-3">
                            <MemberHabitGroup label="Habits" habits={memberHabitsByKind} />
                            <MemberHabitGroup label="Micro-gaps" habits={memberMicroGaps} />
                        </div>
                    )}
                </Card>
            </div>

            <Modal open={editing} onClose={() => setEditing(false)} title="Edit season">
                <SeasonForm
                    initial={season}
                    submitLabel="Save"
                    onCancel={() => setEditing(false)}
                    onSubmit={(draft) => {
                        dispatch({ type: 'UPDATE_SEASON', season: { ...draft, id: season.id } });
                        setEditing(false);
                    }}
                />
            </Modal>

            <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete season?">
                <p className="text-sm text-text-light mb-4">
                    This will remove the season permanently. Habits assigned to it stay, but lose
                    their connection to this season.
                </p>
                <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                        Cancel
                    </Button>
                    <Button
                        size="sm"
                        onClick={() => {
                            dispatch({ type: 'DELETE_SEASON', seasonId: season.id });
                            setConfirmDelete(false);
                            navigate('/season');
                        }}
                        className="bg-red-500 hover:bg-red-600"
                    >
                        Delete
                    </Button>
                </div>
            </Modal>
        </LifeShell>
    );
}
