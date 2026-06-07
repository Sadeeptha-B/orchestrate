import { useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useDayPlan } from '../../hooks/useDayPlan';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { LifeShell } from './LifeShell';
import { SeasonForm } from './SeasonForm';
import { partitionByKind } from '../../lib/habits';
import { getSeasonProgress } from '../../lib/seasons';
import type { Habit, RecurringFocus } from '../../types';

const FOCUS_DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function focusRecurrenceLabel(f: RecurringFocus): string {
    const r = f.recurrence;
    if (r.kind === 'daily') return 'Daily';
    if (r.kind === 'weekdays') return 'Weekdays';
    const days = r.daysOfWeek ?? [];
    return days.length > 0 ? days.map((d) => FOCUS_DOW[d]).join(', ') : 'Weekly';
}

function SectionLabel({ children }: { children: React.ReactNode }) {
    return (
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-text-light mb-3">
            {children}
        </h4>
    );
}

function InfoCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
    return (
        <div className={`bg-card rounded-xl border border-border p-5 ${className}`}>
            {children}
        </div>
    );
}

function HabitRow({ habit }: { habit: Habit }) {
    return (
        <li className="flex items-center gap-2 py-1 px-2 rounded-lg hover:bg-subtle/40 transition-colors">
            <span className="text-xs text-accent flex-shrink-0" aria-hidden>◉</span>
            <span className="flex-1 min-w-0 text-sm truncate">{habit.name}</span>
            <div className="flex items-center gap-1 flex-shrink-0">
                {habit.kind === 'habit' && habit.targetTime && (
                    <span className="text-[10px] tabular-nums px-1.5 py-px rounded-full bg-surface-dark text-text-light">
                        {habit.targetTime}
                    </span>
                )}
                {habit.isAnchor && (
                    <span className="text-[10px] uppercase tracking-wider px-1.5 py-px rounded-full bg-accent/15 text-accent font-medium">
                        anchor
                    </span>
                )}
                {!habit.active && (
                    <span className="text-[10px] uppercase tracking-wider px-1.5 py-px rounded-full bg-surface-dark text-text-light/60">
                        inactive
                    </span>
                )}
            </div>
        </li>
    );
}

export function SeasonDetail() {
    const { id } = useParams<{ id: string }>();
    const { life, dispatch } = useDayPlan();
    const navigate = useNavigate();
    const location = useLocation();
    const [editing, setEditing] = useState(
        (location.state as { openEdit?: boolean } | null)?.openEdit ?? false,
    );
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
    const progress = getSeasonProgress(season, new Date().toISOString().slice(0, 10));
    const activeFocuses = (season.recurringFocuses ?? []).filter((f) => f.active);
    const inactiveFocuses = (season.recurringFocuses ?? []).filter((f) => !f.active);

    return (
        <LifeShell
            title={season.name}
            subtitle={season.primaryTheme || undefined}
            crumbs={[{ label: 'Seasons', to: '/season' }]}
        >
            {/* Status bar */}
            <div className="flex flex-wrap items-center gap-2 mb-6">
                {season.active ? (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-accent text-white text-[11px] font-semibold uppercase tracking-wide">
                        <span className="w-1.5 h-1.5 rounded-full bg-white/80 animate-pulse" aria-hidden />
                        Active
                    </span>
                ) : (
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-surface-dark text-text-light text-[11px] font-semibold uppercase tracking-wide">
                        Inactive
                    </span>
                )}
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

            {/* Progress banner for active seasons with dates */}
            {season.startDate && (
                <div className={`rounded-xl border p-4 mb-6 ${season.active ? 'bg-accent/5 border-accent/25' : 'bg-subtle/30 border-border'}`}>
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                        <div className="flex items-center gap-3">
                            <span className="text-sm font-medium text-text tabular-nums">
                                {season.startDate}
                            </span>
                            <span className="text-text-light text-xs">→</span>
                            <span className="text-sm font-medium text-text tabular-nums">
                                {season.endDate ?? 'open-ended'}
                            </span>
                        </div>
                        {progress && (
                            <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-accent-subtle text-accent text-[11px] font-semibold">
                                Week {progress.weekNumber} of {progress.totalWeeks}
                            </span>
                        )}
                    </div>
                    {progress && (
                        <div className="relative h-1.5 rounded-full bg-border overflow-hidden">
                            <div
                                className="absolute inset-y-0 left-0 rounded-full bg-accent transition-all"
                                style={{ width: `${Math.round(progress.percentDone * 100)}%` }}
                            />
                        </div>
                    )}
                    {progress && (
                        <p className="text-[11px] text-text-light mt-1.5 tabular-nums">
                            {Math.round(progress.percentDone * 100)}% complete
                        </p>
                    )}
                </div>
            )}

            <div className="space-y-4">
                {/* Row 1: Success criteria + Supporting goals */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <InfoCard>
                        <SectionLabel>Success Criteria</SectionLabel>
                        {season.successCriteria ? (
                            <p className="text-sm text-text whitespace-pre-wrap leading-relaxed">
                                {season.successCriteria}
                            </p>
                        ) : (
                            <p className="text-xs text-text-light italic">Not set</p>
                        )}
                    </InfoCard>

                    <InfoCard>
                        <SectionLabel>Supporting Goals</SectionLabel>
                        {season.supportingGoals.length === 0 ? (
                            <p className="text-xs text-text-light italic">No goals yet</p>
                        ) : (
                            <ul className="space-y-2">
                                {season.supportingGoals.map((g, i) => (
                                    <li key={i} className="flex items-start gap-2.5">
                                        <span className="text-accent text-xs mt-0.5 flex-shrink-0" aria-hidden>◆</span>
                                        <span className="text-sm text-text leading-snug">{g}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </InfoCard>
                </div>

                {/* Row 2: Recurring focuses */}
                {((season.recurringFocuses ?? []).length > 0) && (
                    <InfoCard>
                        <SectionLabel>Recurring Focuses</SectionLabel>
                        <div className="flex flex-wrap gap-2">
                            {activeFocuses.map((f) => (
                                <div
                                    key={f.id}
                                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-subtle border border-border text-sm"
                                >
                                    <span aria-hidden className="text-[10px] text-accent">◉</span>
                                    <span>{f.title}</span>
                                    <span className="text-[10px] px-1.5 py-px rounded-full bg-accent/15 text-accent font-medium uppercase tracking-wide">
                                        {focusRecurrenceLabel(f)}
                                    </span>
                                </div>
                            ))}
                            {inactiveFocuses.map((f) => (
                                <div
                                    key={f.id}
                                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-subtle border border-border text-sm opacity-50"
                                >
                                    <span aria-hidden className="text-[10px] text-text-light">◯</span>
                                    <span className="line-through text-text-light">{f.title}</span>
                                    <span className="text-[10px] px-1.5 py-px rounded-full bg-surface-dark text-text-light uppercase tracking-wide">
                                        {focusRecurrenceLabel(f)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </InfoCard>
                )}

                {/* Row 3: Non-goals + Member habits side by side */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <InfoCard>
                        <SectionLabel>Non-Goals</SectionLabel>
                        {season.nonGoals.length === 0 ? (
                            <p className="text-xs text-text-light italic">Nothing explicitly out of scope</p>
                        ) : (
                            <ul className="space-y-2">
                                {season.nonGoals.map((g, i) => (
                                    <li key={i} className="flex items-start gap-2.5 opacity-70">
                                        <span className="text-text-light text-xs mt-0.5 flex-shrink-0 font-medium" aria-hidden>—</span>
                                        <span className="text-sm text-text-light leading-snug">{g}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </InfoCard>

                    <InfoCard>
                        <div className="flex items-center justify-between mb-3">
                            <SectionLabel>Member Habits</SectionLabel>
                            <button
                                type="button"
                                onClick={() => navigate('/habits', { state: { seasonFilter: season.id } })}
                                className="text-xs text-accent hover:underline cursor-pointer -mt-3"
                            >
                                Manage →
                            </button>
                        </div>
                        {memberHabits.length === 0 ? (
                            <p className="text-xs text-text-light italic">No habits assigned to this season yet.</p>
                        ) : (
                            <div className="space-y-3">
                                {memberHabitsByKind.length > 0 && (
                                    <div>
                                        {(memberHabitsByKind.length > 0 && memberMicroGaps.length > 0) && (
                                            <p className="text-[10px] uppercase tracking-wider text-text-light/60 mb-1 px-2">
                                                Habits
                                            </p>
                                        )}
                                        <ul className="space-y-0.5">
                                            {memberHabitsByKind.map((h) => <HabitRow key={h.id} habit={h} />)}
                                        </ul>
                                    </div>
                                )}
                                {memberMicroGaps.length > 0 && (
                                    <div>
                                        {(memberHabitsByKind.length > 0 && memberMicroGaps.length > 0) && (
                                            <p className="text-[10px] uppercase tracking-wider text-text-light/60 mb-1 px-2">
                                                Micro-gaps
                                            </p>
                                        )}
                                        <ul className="space-y-0.5">
                                            {memberMicroGaps.map((h) => <HabitRow key={h.id} habit={h} />)}
                                        </ul>
                                    </div>
                                )}
                            </div>
                        )}
                    </InfoCard>
                </div>

                {/* Capacity budget (full width, only if set) */}
                {season.capacityBudget && (
                    <InfoCard>
                        <SectionLabel>Capacity Budget</SectionLabel>
                        <div className="flex flex-wrap gap-4">
                            {season.capacityBudget.weeklyGrowthHours != null && (
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-text-light">Weekly growth hours</span>
                                    <span className="px-2.5 py-1 rounded-lg bg-subtle border border-border text-sm font-semibold tabular-nums">
                                        {season.capacityBudget.weeklyGrowthHours}h
                                    </span>
                                    <span className="text-[10px] text-text-light/60 italic">soft cap</span>
                                </div>
                            )}
                            {season.capacityBudget.maxConcurrentHabits != null && (
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-text-light">Max active habits</span>
                                    <span className="px-2.5 py-1 rounded-lg bg-subtle border border-border text-sm font-semibold tabular-nums">
                                        {season.capacityBudget.maxConcurrentHabits}
                                    </span>
                                </div>
                            )}
                            {season.capacityBudget.notes && (
                                <p className="w-full text-sm text-text-light whitespace-pre-wrap mt-1">
                                    {season.capacityBudget.notes}
                                </p>
                            )}
                        </div>
                    </InfoCard>
                )}
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
