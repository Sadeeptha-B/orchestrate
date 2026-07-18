import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { useDayPlan } from '../hooks/useDayPlan';
import { useTodoistData } from '../hooks/useTodoist';
import { useGoogleCalendarData } from '../hooks/useGoogleCalendar';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { Logo } from './ui/Logo';
import { HeaderControls } from './ui/HeaderControls';
import { QuickStart } from './QuickStart';
import { RestoreModal } from './RestoreModal';
import { WIZARD_STEPS, TOTAL_STEPS } from '../data/wizardSteps';
import { findActiveSeason } from '../lib/seasons';
import { getActiveHabits, getAnchorHabits } from '../lib/habits';

function getGreeting(): string {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
}

/** Small connected/connect chip for the Welcome integration strip. */
function IntegrationChip({ label, connected, pending, onConnect }: {
    label: string;
    connected: boolean;
    pending?: boolean;
    onConnect: () => void;
}) {
    if (connected) {
        return (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-success/10 text-success text-xs">
                ✓ {label}
            </span>
        );
    }
    if (pending) {
        return (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-dark text-text-light/60 text-xs">
                {label}…
            </span>
        );
    }
    return (
        <button
            onClick={onConnect}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-border text-text-light text-xs hover:text-accent hover:border-accent cursor-pointer"
        >
            {label} — Connect →
        </button>
    );
}

export function Welcome() {
    const { plan, history, life } = useDayPlan();
    const navigate = useNavigate();
    const { isConfigured: todoistConnected, statusResolved } = useTodoistData();
    const { isConnected: calendarConnected } = useGoogleCalendarData();
    const aboutTriggerRef = useRef<(() => void) | null>(null);
    const [quickStartOpen, setQuickStartOpen] = useState(false);
    const [restoreOpen, setRestoreOpen] = useState(false);

    const isResuming = plan.intentions.length > 0 || plan.wizardStep > 1;
    const isFirstEver = !isResuming && history.length === 0;
    // Hard gate: planning is Todoist-driven, so the primary CTA routes to connect when unconfigured.
    const todoistMissing = statusResolved && !todoistConnected;
    const today = format(new Date(), 'EEEE, MMMM d');

    const activeSeason = findActiveSeason(life);
    const anchorHabits = getAnchorHabits(getActiveHabits(life));

    const goPlan = () => navigate('/setup', { state: { fromWelcome: true } });

    const todayStatus = isResuming
        ? `${plan.intentions.length} intention${plan.intentions.length !== 1 ? 's' : ''} set · step ${plan.wizardStep} of ${TOTAL_STEPS}`
        : isFirstEver
            ? "You haven't planned today yet."
            : 'Ready to plan?';

    return (
        <div className="min-h-screen flex flex-col items-center justify-center px-6 py-12">
            {/* Top-right controls */}
            <div className="fixed top-5 right-5 flex gap-1.5 z-10">
                <HeaderControls aboutTriggerRef={aboutTriggerRef} />
            </div>

            <div className="w-full max-w-2xl space-y-8">
                {/* Logo & branding */}
                <div className="space-y-3 text-center">
                    <Logo className="w-14 h-14 mx-auto" />
                    <h1 className="text-2xl font-semibold text-accent">Orchestrate</h1>
                    <div>
                        <p className="text-xl font-medium text-text">{getGreeting()}</p>
                        <p className="text-sm text-text-light">{today}</p>
                    </div>
                </div>

                {/* Hub: Today + Life */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Today card */}
                    <Card className="space-y-5">
                        <div className="space-y-2">
                            <h2 className="text-base font-medium text-text">Today</h2>
                            <p className="text-sm text-text-light">{todayStatus}</p>
                            {/* Integration status strip — the requirements, visible every day. */}
                            <div className="flex flex-wrap gap-1.5 pt-0.5">
                                <IntegrationChip
                                    label="Todoist"
                                    connected={todoistConnected}
                                    pending={!statusResolved}
                                    onConnect={() => navigate('/settings?tab=integrations')}
                                />
                                <IntegrationChip
                                    label="Google Calendar"
                                    connected={calendarConnected}
                                    onConnect={() => navigate('/settings?tab=integrations')}
                                />
                            </div>
                        </div>

                        {todoistMissing ? (
                            <div className="space-y-2">
                                <div className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2.5 text-xs text-amber-900 dark:text-amber-200">
                                    Orchestrate plans your day from your Todoist tasks — connect it to start planning.
                                </div>
                                <Button size="lg" className="w-full" onClick={() => navigate('/settings?tab=integrations')}>
                                    Connect Todoist →
                                </Button>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                <Button size="lg" className="w-full" onClick={goPlan} disabled={!statusResolved}>
                                    {isResuming ? 'Resume Planning' : 'Plan Your Day'}
                                </Button>
                                <button
                                    onClick={() => setQuickStartOpen(true)}
                                    disabled={!statusResolved}
                                    className="w-full text-xs text-text-light hover:text-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer py-1"
                                    title={!statusResolved ? 'Checking Todoist connection…' : undefined}
                                >
                                    ⚡ Quick start — skip planning, drop into Focus
                                </button>
                            </div>
                        )}

                        {/* Step timeline */}
                        <div className="flex items-start w-full">
                            {WIZARD_STEPS.map(({ num: stepNum, label }, i) => {
                                const isDone = stepNum < plan.wizardStep;
                                const isCurrent = stepNum === plan.wizardStep;
                                const isLast = i === WIZARD_STEPS.length - 1;

                                return (
                                    <div key={label} className="flex items-start flex-1">
                                        <div className="flex flex-col items-center flex-1 min-w-0">
                                            <div
                                                className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-[11px] font-medium transition-colors ${isDone
                                                    ? 'bg-accent border-accent text-white'
                                                    : isCurrent
                                                        ? 'border-accent bg-accent/10 text-accent'
                                                        : 'border-border bg-surface text-text-light/40'
                                                    }`}
                                            >
                                                {isDone ? '✓' : stepNum}
                                            </div>
                                            <span
                                                className={`mt-1.5 text-[10px] leading-tight text-center ${isDone
                                                    ? 'text-accent font-medium'
                                                    : isCurrent
                                                        ? 'text-text font-medium'
                                                        : 'text-text-light/40'
                                                    }`}
                                            >
                                                {label}
                                            </span>
                                        </div>
                                        {!isLast && (
                                            <div
                                                className={`h-0.5 mt-[11px] w-4 flex-shrink-0 rounded-full ${isDone ? 'bg-accent' : 'bg-border'}`}
                                            />
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </Card>

                    {/* Life card */}
                    <Card className="space-y-5">
                        <div className="flex items-center justify-between">
                            <h2 className="text-base font-medium text-text">Life</h2>
                            <button
                                onClick={() => navigate('/life')}
                                className="text-xs text-accent hover:underline cursor-pointer"
                            >
                                Open →
                            </button>
                        </div>

                        {/* Active season */}
                        <div>
                            <h3 className="text-[10px] font-semibold text-text-light uppercase tracking-wider mb-2">
                                Active season
                            </h3>
                            {activeSeason ? (
                                <div>
                                    <Link
                                        to={`/season/${activeSeason.id}`}
                                        className="text-base text-accent hover:underline"
                                    >
                                        {activeSeason.name}
                                    </Link>
                                    {activeSeason.primaryTheme && (
                                        <p className="text-sm text-text mt-1">{activeSeason.primaryTheme}</p>
                                    )}
                                    <p className="text-xs text-text-light mt-1">
                                        {activeSeason.startDate} → {activeSeason.endDate ?? 'open-ended'}
                                    </p>
                                </div>
                            ) : (
                                <div className="flex items-center gap-3">
                                    <p className="text-sm text-text-light">None set.</p>
                                    <Button variant="secondary" size="sm" onClick={() => navigate('/season')}>
                                        Set one up
                                    </Button>
                                </div>
                            )}
                        </div>

                        {/* Anchor habits */}
                        <div>
                            <h3 className="text-[10px] font-semibold text-text-light uppercase tracking-wider mb-2">
                                Anchor habits
                            </h3>
                            {anchorHabits.length === 0 ? (
                                <div className="flex items-center gap-3">
                                    <p className="text-sm text-text-light">No anchors yet.</p>
                                    <button
                                        onClick={() => navigate('/habits')}
                                        className="text-sm text-accent hover:underline cursor-pointer"
                                    >
                                        Add an anchor →
                                    </button>
                                </div>
                            ) : (
                                <ul className="flex flex-wrap gap-1.5">
                                    {anchorHabits.map((h) => (
                                        <li
                                            key={h.id}
                                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent-subtle text-accent text-xs"
                                        >
                                            <span aria-hidden>◆</span>
                                            <span>{h.name}</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>

                        {/* Quick links */}
                        <div className="flex gap-4 pt-3 border-t border-border text-xs text-text-light">
                            <button
                                onClick={() => navigate('/habits')}
                                className="hover:text-accent cursor-pointer"
                            >
                                Habits Library
                            </button>
                            <button
                                onClick={() => navigate('/season')}
                                className="hover:text-accent cursor-pointer"
                            >
                                Seasons
                            </button>
                        </div>
                    </Card>
                </div>

                {/* Footer */}
                <div className="text-center space-y-1.5">
                    {isFirstEver ? (
                        <p className="text-xs text-text-light">
                            New here?{' '}
                            <button
                                onClick={() => aboutTriggerRef.current?.()}
                                className="text-accent hover:underline cursor-pointer"
                            >
                                Learn what Orchestrate does
                            </button>
                        </p>
                    ) : (
                        <p className="text-xs text-text-light/60">
                            Counter task blindness. Stay connected to what matters.
                        </p>
                    )}
                    <button
                        onClick={() => setRestoreOpen(true)}
                        className="text-xs text-accent/80 hover:text-accent hover:underline cursor-pointer"
                    >
                        Restore from a backup →
                    </button>
                </div>
            </div>

            <QuickStart open={quickStartOpen} onClose={() => setQuickStartOpen(false)} />
            <RestoreModal open={restoreOpen} onClose={() => setRestoreOpen(false)} />
        </div>
    );
}
