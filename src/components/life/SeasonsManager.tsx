import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDayPlan } from '../../hooks/useDayPlan';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Modal } from '../ui/Modal';
import { LifeShell } from './LifeShell';
import { SeasonForm } from './SeasonForm';
import type { Season } from '../../types';

function formatRange(season: Season): string {
    const start = season.startDate;
    const end = season.endDate ?? '…';
    return `${start} → ${end}`;
}

export function SeasonsManager() {
    const { life, dispatch } = useDayPlan();
    const navigate = useNavigate();
    const [showCreate, setShowCreate] = useState(false);

    const sorted = [...life.seasons].sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1;
        return b.startDate.localeCompare(a.startDate);
    });

    return (
        <LifeShell title="Seasons" subtitle="Medium-horizon focus periods that frame your life right now.">
            <div className="flex items-center justify-between mb-4">
                <p className="text-sm text-text-light">
                    {life.seasons.length === 0
                        ? 'No seasons yet — create one to anchor the next few months.'
                        : `${life.seasons.length} season${life.seasons.length === 1 ? '' : 's'}.`}
                </p>
                <Button size="sm" onClick={() => setShowCreate(true)}>
                    New Season
                </Button>
            </div>

            <div className="space-y-3">
                {sorted.map((s) => (
                    <Card key={s.id} className="hover:border-accent/40 transition-colors">
                        <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                    <h3 className="font-medium truncate">{s.name}</h3>
                                    {s.active && (
                                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-accent text-white">
                                            ACTIVE
                                        </span>
                                    )}
                                    {s.archivedAt && (
                                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-surface-dark text-text-light">
                                            ARCHIVED
                                        </span>
                                    )}
                                </div>
                                {s.primaryTheme && (
                                    <p className="text-sm text-text mb-1">{s.primaryTheme}</p>
                                )}
                                <p className="text-xs text-text-light">{formatRange(s)}</p>
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                                {!s.active && (
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={() =>
                                            dispatch({ type: 'ACTIVATE_SEASON', seasonId: s.id })
                                        }
                                    >
                                        Activate
                                    </Button>
                                )}
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => navigate(`/season/${s.id}`)}
                                >
                                    Open
                                </Button>
                            </div>
                        </div>
                    </Card>
                ))}
            </div>

            <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New season">
                <SeasonForm
                    submitLabel="Create"
                    onCancel={() => setShowCreate(false)}
                    onSubmit={(draft) => {
                        dispatch({ type: 'ADD_SEASON', season: draft });
                        setShowCreate(false);
                    }}
                />
            </Modal>
        </LifeShell>
    );
}
