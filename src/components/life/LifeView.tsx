import { Link, useNavigate } from 'react-router-dom';
import { useDayPlan } from '../../context/DayPlanContext';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { LifeShell } from './LifeShell';

export function LifeView() {
    const { life } = useDayPlan();
    const navigate = useNavigate();
    const activeSeason = life.seasons.find((s) => s.id === life.activeSeasonId);
    const activeHabits = life.habits.filter((h) => h.active);
    const anchorHabits = activeHabits.filter((h) => h.isAnchor);

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
                                className="text-lg text-accent hover:underline"
                            >
                                {activeSeason.name}
                            </Link>
                            {activeSeason.primaryTheme && (
                                <p className="text-sm text-text mt-1">{activeSeason.primaryTheme}</p>
                            )}
                            <p className="text-xs text-text-light mt-2">
                                {activeSeason.startDate} → {activeSeason.endDate ?? 'open-ended'}
                            </p>
                            {activeSeason.supportingGoals.length > 0 && (
                                <ul className="mt-3 text-sm space-y-1">
                                    {activeSeason.supportingGoals.slice(0, 3).map((g, i) => (
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
                        <h3 className="font-medium">Anchor habits</h3>
                        <Button variant="ghost" size="sm" onClick={() => navigate('/habits')}>
                            Manage
                        </Button>
                    </div>
                    {anchorHabits.length === 0 ? (
                        <div className="text-sm text-text-light">
                            <p className="mb-3">
                                No anchor habits set. Anchors (sleep, meditation, gym, shutdown) are
                                the foundation that protects everything else.
                            </p>
                            <Button size="sm" onClick={() => navigate('/habits')}>
                                Add an anchor
                            </Button>
                        </div>
                    ) : (
                        <ul className="text-sm space-y-1.5">
                            {anchorHabits.map((h) => (
                                <li key={h.id} className="flex items-center gap-2">
                                    <span className="text-accent">◆</span>
                                    <span>{h.name}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </Card>

                <Card className="md:col-span-2">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="font-medium">All active habits</h3>
                        <Button variant="ghost" size="sm" onClick={() => navigate('/habits')}>
                            Library
                        </Button>
                    </div>
                    {activeHabits.length === 0 ? (
                        <p className="text-sm text-text-light italic">
                            None active. Active habits appear as intentions in your daily wizard.
                        </p>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                            {activeHabits.map((h) => (
                                <div
                                    key={h.id}
                                    className="px-3 py-2 rounded-lg border border-border text-sm flex items-center justify-between"
                                >
                                    <span className="truncate">{h.name}</span>
                                    {h.isAnchor && (
                                        <span className="text-[10px] uppercase tracking-wider text-accent ml-2">
                                            anchor
                                        </span>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </Card>
            </div>
        </LifeShell>
    );
}
