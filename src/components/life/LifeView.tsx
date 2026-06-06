import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useDayPlan } from '../../hooks/useDayPlan';
import { useHabitForms } from '../../hooks/useHabitForms';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { LifeShell } from './LifeShell';
import { RestCuesEditor } from './RestCuesEditor';
import { findActiveSeason } from '../../lib/seasons';
import { getActiveHabits, partitionByKind } from '../../lib/habits';
import type { Habit } from '../../types';

function PencilIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
        </svg>
    );
}

function PauseIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <line x1="8" y1="5" x2="8" y2="19" />
            <line x1="16" y1="5" x2="16" y2="19" />
        </svg>
    );
}

function TrashIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
        </svg>
    );
}

const anchorFirst = (a: Habit, b: Habit) => {
    if (a.isAnchor !== b.isAnchor) return a.isAnchor ? -1 : 1;
    return a.name.localeCompare(b.name);
};

/** Per-pill habit actions, threaded down from LifeView so pills can mutate without prop-drilling dispatch. */
interface PillActions {
    onEdit: (h: Habit) => void;
    onPause: (h: Habit) => void;
    onDelete: (h: Habit) => void;
}

function HabitPill({ habit, actions }: { habit: Habit; actions: PillActions }) {
    const iconBtn = 'p-0.5 rounded text-text-light transition-colors';
    return (
        <div className="group px-3 py-2 rounded-lg border border-border text-sm flex items-center justify-between gap-2">
            <span className="truncate">{habit.name}</span>
            <span className="flex items-center gap-1.5 flex-shrink-0">
                {habit.kind === 'habit' && habit.targetTime && (
                    <span className="text-[10px] tabular-nums text-text-light">{habit.targetTime}</span>
                )}
                {habit.isAnchor && (
                    <span className="text-[10px] uppercase tracking-wider text-accent">anchor</span>
                )}
                <span className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => actions.onEdit(habit)} className={`${iconBtn} hover:text-accent`} title="Edit habit">
                        <PencilIcon />
                    </button>
                    <button onClick={() => actions.onPause(habit)} className={`${iconBtn} hover:text-accent`} title="Pause habit">
                        <PauseIcon />
                    </button>
                    <button onClick={() => actions.onDelete(habit)} className={`${iconBtn} hover:text-red-500`} title="Delete habit">
                        <TrashIcon />
                    </button>
                </span>
            </span>
        </div>
    );
}

/** One kind bucket (habits or micro-gaps) with a count sub-label + pill grid. */
function KindBucket({ label, habits, actions }: { label: string; habits: Habit[]; actions: PillActions }) {
    if (habits.length === 0) return null;
    const sorted = [...habits].sort(anchorFirst);
    return (
        <div>
            <p className="text-[11px] uppercase tracking-wider text-text-light mb-1.5">
                {label} <span className="text-text-light/60">· {habits.length}</span>
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {sorted.map((h) => <HabitPill key={h.id} habit={h} actions={actions} />)}
            </div>
        </div>
    );
}

/** Both kind buckets for a set of habits. */
function KindGroups({ habits, actions }: { habits: Habit[]; actions: PillActions }) {
    const { habits: habitItems, microGaps } = partitionByKind(habits);
    return (
        <div className="space-y-3">
            <KindBucket label="Habits" habits={habitItems} actions={actions} />
            <KindBucket label="Micro-gaps" habits={microGaps} actions={actions} />
        </div>
    );
}

export function LifeView() {
    const { life, dispatch } = useDayPlan();
    const navigate = useNavigate();
    // Inline habit add/edit/delete — same modals + mutations as the Habits library, minus the
    // Todoist sync banners (those stay in the library). `syncError` still surfaces inline here.
    const { syncError, setSyncError, openCreate, openEdit, requestDelete, modals } = useHabitForms();

    const activeSeason = findActiveSeason(life);
    const activeHabits = getActiveHabits(life);

    // Scoping: always-on habits (no season) first, then each season with ≥1 active member.
    const defaultHabits = activeHabits.filter((h) => h.seasonIds.length === 0);
    const seasonGroups = life.seasons
        .map((s) => ({ season: s, habits: activeHabits.filter((h) => h.seasonIds.includes(s.id)) }))
        .filter((g) => g.habits.length > 0);

    // Collapsible season sections — empty set = all expanded.
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
    const toggleSeason = (id: string) =>
        setCollapsed((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });

    const pillActions: PillActions = {
        onEdit: openEdit,
        onPause: (h) => dispatch({ type: 'TOGGLE_HABIT_ACTIVE', habitId: h.id }),
        onDelete: requestDelete,
    };

    return (
        <LifeShell
            title="Life"
            subtitle="The scaffolding above your day — what season you're in, which habits anchor you."
        >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="font-medium">Active season</h3>
                        <Button variant="ghost" size="sm" onClick={() => navigate('/season')}>
                            Manage
                        </Button>
                    </div>
                    {activeSeason ? (
                        <div>
                            <Link
                                to={`/season/${activeSeason.id}`}
                                className="text-lg text-accent hover:underline inline-flex items-center gap-1 group/link"
                            >
                                {activeSeason.name}
                                <svg className="w-4 h-4 opacity-50 group-hover/link:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                </svg>
                            </Link>
                            {activeSeason.primaryTheme && (
                                <p className="text-sm text-text mt-1">{activeSeason.primaryTheme}</p>
                            )}
                            <p className="text-xs text-text-light mt-2">
                                {activeSeason.startDate} → {activeSeason.endDate ?? 'open-ended'}
                            </p>
                            {activeSeason.supportingGoals.length > 0 && (
                                <ul className="mt-3 text-sm space-y-1 max-h-40 overflow-y-auto scrollbar-subtle">
                                    {activeSeason.supportingGoals.map((g, i) => (
                                        <li key={i} className="flex gap-2">
                                            <span className="text-text-light">·</span>
                                            <span>{g}</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    ) : (
                        <div className="text-sm text-text-light">
                            <p className="mb-3">No active season.</p>
                            <Button size="sm" onClick={() => navigate('/season')}>
                                Set one up
                            </Button>
                        </div>
                    )}
                </Card>

                <Card>
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="font-medium">True Rest cues</h3>
                    </div>
                    <p className="text-xs text-text-light mb-3">
                        Recovery prompts surfaced on the dashboard and during low-energy check-ins.
                    </p>
                    <RestCuesEditor />
                </Card>

                <Card className="md:col-span-2">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="font-medium">Session templates</h3>
                        <Button variant="ghost" size="sm" onClick={() => navigate('/session-templates')}>
                            Manage
                        </Button>
                    </div>
                    <p className="text-xs text-text-light">
                        Reusable layouts of work sessions you can apply in one click when planning a
                        day. {(life.sessionTemplates ?? []).length} saved.
                    </p>
                </Card>

                <Card className="md:col-span-2">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="font-medium">All active habits</h3>
                        <div className="flex items-center gap-2">
                            <Button size="sm" onClick={() => openCreate()}>
                                Add habit
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => navigate('/habits')}>
                                Library
                            </Button>
                        </div>
                    </div>

                    {syncError && (
                        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 dark:bg-red-900/20 p-3 text-sm flex items-center justify-between gap-3">
                            <span>{syncError}</span>
                            <Button variant="ghost" size="sm" onClick={() => setSyncError(null)}>
                                Dismiss
                            </Button>
                        </div>
                    )}

                    {activeHabits.length === 0 ? (
                        <p className="text-sm text-text-light italic">
                            None active. Add one above, or open the Library. Habits surface in Today's
                            Habits (timed on the timeline, or anytime); micro-gaps are repeatable
                            fillers pulled from their own panel.
                        </p>
                    ) : (
                        <div className="space-y-5">
                            {defaultHabits.length > 0 && (
                                <div>
                                    <div className="flex items-center gap-2 mb-2">
                                        <h4 className="text-sm font-medium">Always-on</h4>
                                        <span className="text-[10px] uppercase tracking-wider text-text-light">
                                            every season
                                        </span>
                                    </div>
                                    <KindGroups habits={defaultHabits} actions={pillActions} />
                                </div>
                            )}

                            {seasonGroups.map(({ season, habits }) => {
                                const isCollapsed = collapsed.has(season.id);
                                return (
                                    <div key={season.id} className="border-t border-border pt-4">
                                        <button
                                            onClick={() => toggleSeason(season.id)}
                                            className="flex items-center gap-2 w-full text-left cursor-pointer group"
                                            aria-expanded={!isCollapsed}
                                        >
                                            <svg
                                                className={`w-3 h-3 text-text-light transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
                                                fill="none"
                                                viewBox="0 0 24 24"
                                                stroke="currentColor"
                                                strokeWidth={2}
                                            >
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                            </svg>
                                            <h4 className="text-sm font-medium group-hover:text-accent transition-colors">
                                                {season.name}
                                            </h4>
                                            {season.active && (
                                                <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-accent text-white">
                                                    active
                                                </span>
                                            )}
                                            <span className="text-[10px] uppercase tracking-wider text-text-light">
                                                {habits.length} {habits.length === 1 ? 'habit' : 'habits'}
                                            </span>
                                        </button>
                                        {!isCollapsed && (
                                            <div className="mt-3">
                                                <KindGroups habits={habits} actions={pillActions} />
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </Card>
            </div>

            {modals}
        </LifeShell>
    );
}
