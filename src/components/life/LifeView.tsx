import { Link, useNavigate } from 'react-router-dom';
import { useDayPlan } from '../../hooks/useDayPlan';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { LifeShell } from './LifeShell';
import { LightPoolSection } from './LightPoolSection';
import { findActiveSeason } from '../../lib/seasons';
import { getActiveHabits } from '../../lib/habits';
import { restCues as defaultRestCues } from '../../data/restCues';

export function LifeView() {
    const { life } = useDayPlan();
    const navigate = useNavigate();
    const activeSeason = findActiveSeason(life);
    const activeHabits = getActiveHabits(life);
    // Anchors are the load-bearing habits — float them to the front of the list so they read
    // as foundational without needing a separate card.
    const sortedActiveHabits = [...activeHabits].sort((a, b) => {
        if (a.isAnchor !== b.isAnchor) return a.isAnchor ? -1 : 1;
        return a.name.localeCompare(b.name);
    });
    const isCustomized = life.restCues !== undefined;
    const restCueCount = (life.restCues ?? defaultRestCues).length;

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

                <LightPoolSection />

                <Card>
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="font-medium">True Rest cues</h3>
                        <Button variant="ghost" size="sm" onClick={() => navigate('/rest-cues')}>
                            Manage
                        </Button>
                    </div>
                    <p className="text-sm text-text-light">
                        {restCueCount} {restCueCount === 1 ? 'cue' : 'cues'}
                        {!isCustomized && ' · using defaults'}
                    </p>
                    <p className="text-xs text-text-light mt-1">
                        Recovery prompts surfaced on the dashboard and during low-energy check-ins.
                    </p>
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
                            None active. Stabilizers surface as session-assigned tasks each day they're due;
                            light-coherent habits live in the Light Pool.
                        </p>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                            {sortedActiveHabits.map((h) => (
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
