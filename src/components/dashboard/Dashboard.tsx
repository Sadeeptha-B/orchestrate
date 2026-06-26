import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { useDayPlan } from '../../hooks/useDayPlan';
import { useTodaysHabitsSync } from '../../hooks/useTodaysHabitsSync';
import { CurrentSession, SessionTimeline, AnytimeTray } from './SessionTimeline';
import { SessionEditorTimeline } from '../ui/SessionEditorTimeline';
import { HistorySidebar, type HistoryTab } from './HistorySidebar';
import { DigitalClock } from './DigitalClock';
import { CheckInModal } from '../checkin/CheckInModal';
import { SessionStartPrompt } from './SessionStartPrompt';
import { TodoistPanel } from '../todoist/TodoistPanel';
import { RenderedCalendar } from '../todoist/RenderedCalendar';
import { useHourlyCheckin } from '../../hooks/useHourlyCheckin';
import { useEngagementBanner } from '../../hooks/useEngagementNudge';
import { useResizablePanel } from '../../hooks/useResizablePanel';
import { DEFAULT_RECONTEXT_CADENCE_MINUTES } from '../../lib/reminders';
import { formatDuration } from '../../lib/time';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Logo } from '../ui/Logo';
import { HeaderControls } from '../ui/HeaderControls';
import { CollapsibleSection } from '../ui/CollapsibleSection';
import { ActiveSeasonBadge } from '../life/ActiveSeasonBadge';
import { SeasonContextCard } from '../life/SeasonContextCard';
import { HabitInstanceCard, MicroGapCard } from './HabitInstanceCard';
import { TrueRestCard } from './TrueRestCard';
import { useCurrentSession } from '../../hooks/useCurrentSession';
import { isSessionLocked } from '../../lib/sessionCalendar';

const DAY_CLOSES = [
    'Make the most of today.',       // Sun
    'Set the week\'s tone.',          // Mon
    'Keep the momentum going.',       // Tue
    'Midweek — stay the course.',     // Wed
    'One more push.',                 // Thu
    'Finish the week strong.',        // Fri
    'Recharge and reflect.',          // Sat
];

function greeting(name: string | undefined, now: Date): string {
    const hour = now.getHours();
    const period = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
    const close = DAY_CLOSES[now.getDay()];
    return name ? `Good ${period}, ${name}. ${close}` : `Good ${period}. ${close}`;
}

export function Dashboard() {
    const { plan, settings, life, dispatch } = useDayPlan();
    const navigate = useNavigate();
    const { showCheckin, dismiss } = useHourlyCheckin(
        plan.sessionSlots,
        plan.setupComplete,
        settings.notificationPreference,
        settings.recontextualizationCadenceMinutes ?? DEFAULT_RECONTEXT_CADENCE_MINUTES,
    );
    const { nextSessionStartsWithin } = useCurrentSession(plan.sessionSlots);
    const engagementBanner = useEngagementBanner(plan, settings);

    // v6.7: keep `plan.todaysHabits` in sync with the library while on the dashboard, so a habit
    // created/edited/deleted in /habits is reflected without re-running the wizard.
    useTodaysHabitsSync();

    const [showSaveModal, setShowSaveModal] = useState(false);
    const [saveName, setSaveName] = useState('');
    const [panelOpen, setPanelOpen] = useState(false);
    const [panelTab, setPanelTab] = useState<HistoryTab>('sessions');
    // v7.x: in-dashboard session adjustment for day-drift (reuses the wizard's editor; templates stay in the wizard).
    const [adjustingDay, setAdjustingDay] = useState(false);
    const backlogCount = life.backlog?.length ?? 0;
    // Shared between the timeline (click to pin) and the carousel (prev/next, ↩ to unpin).
    const [pinnedSessionId, setPinnedSessionId] = useState<string | null>(null);
    const lockedSessionIds = useMemo(
        () => new Set(plan.sessionSlots.filter((s) => isSessionLocked(s, plan.sessionStarts)).map((s) => s.id)),
        [plan.sessionSlots, plan.sessionStarts],
    );

    const { panelWidth, onMouseDown } = useResizablePanel();

    const handleEditPlan = () => {
        dispatch({ type: 'SET_EDITING_STEP', step: 1 });
        dispatch({ type: 'SET_WIZARD_STEP', step: 1 });
        navigate('/setup');
    };

    const handleRecontextualize = () => {
        // Re-do scheduling — Schedule is step 4 in the Sessions → Intentions → Refine → Schedule flow.
        dispatch({ type: 'SET_EDITING_STEP', step: 4 });
        dispatch({ type: 'SET_WIZARD_STEP', step: 4 });
        navigate('/setup');
    };

    const openSaveModal = () => {
        setSaveName(format(parseISO(plan.date), 'EEEE, MMM d'));
        setShowSaveModal(true);
    };

    const handleSaveDay = () => {
        const label = saveName.trim() || format(parseISO(plan.date), 'EEEE, MMM d');
        dispatch({ type: 'SAVE_DAY', label });
        setShowSaveModal(false);
        setSaveName('');
    };

    const completedCount = plan.linkedTasks.filter((lt) => lt.completed).length;
    const totalCount = plan.linkedTasks.length;

    return (
        <div className="min-h-screen flex flex-col">
            <header className="px-6 py-4 border-b border-border">
                <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-y-2 gap-x-3">
                    <div className="flex items-center gap-3 min-w-0">
                        <h1 className="text-xl font-semibold text-accent flex items-center gap-2">
                            <Logo />
                            Orchestrate
                        </h1>
                        <ActiveSeasonBadge />
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-y-2 gap-x-3">
                        <span className="text-xs text-text-light">
                            {completedCount}/{totalCount} done
                        </span>
                        <Button variant="secondary" size="sm" onClick={openSaveModal}>
                            Save Day
                        </Button>
                        <Button variant="ghost" size="sm" onClick={handleEditPlan}>
                            Edit Plan
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => navigate('/life')}>
                            Life
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => navigate('/focus')} title="Enter Focus Mode">
                            ◎ Focus
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setPanelOpen((open) => !open)}
                            title="Saved sessions and intentions backlog"
                        >
                            {panelOpen
                                ? 'Hide Work Items'
                                : `Work Items${backlogCount > 0 ? ` (${backlogCount})` : ''}`}
                        </Button>
                        <HeaderControls />
                    </div>
                </div>
            </header>

            <div className="flex-1 flex">
                {/* Left side panel — saved sessions */}
                {panelOpen && (
                    <aside
                        className="flex-shrink-0 border-r border-border bg-subtle/50 overflow-y-auto scrollbar-subtle relative"
                        style={{ width: panelWidth }}
                    >
                        {/* Drag handle — right edge */}
                        <div
                            onMouseDown={onMouseDown}
                            className="absolute inset-y-0 right-0 w-1.5 cursor-col-resize hover:bg-accent/20 active:bg-accent/30 transition-colors"
                        />
                        <div className="p-5 pt-6">
                            <div className="flex items-center justify-end mb-3">
                                <button
                                    onClick={() => setPanelOpen(false)}
                                    className="text-text-light hover:text-text transition-colors text-lg leading-none cursor-pointer"
                                    title="Hide panel"
                                >
                                    &times;
                                </button>
                            </div>
                            <HistorySidebar tab={panelTab} onTabChange={setPanelTab} />
                        </div>
                    </aside>
                )}

                <main className="flex-1 px-6 py-6 min-w-0">
                    <div className="max-w-6xl mx-auto space-y-8">
                        <section className="bg-subtle/30 rounded-xl p-5 flex items-center justify-between gap-4">
                            <p className="text-2xl font-semibold text-text">
                                {greeting(settings.userName, new Date())}
                            </p>
                            <DigitalClock />
                        </section>

                        {engagementBanner && (
                            <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-accent/10 border border-accent/30 text-sm text-accent">
                                <span aria-hidden className="text-base leading-none">◎</span>
                                <span>
                                    It's been {formatDuration(engagementBanner.minutes)} since your last engagement in{' '}
                                    <span className="font-medium">{engagementBanner.sessionName}</span>. Press ▶ on a task
                                    to start one.
                                </span>
                            </div>
                        )}
                        <SeasonContextCard variant="inline" />

                        <section>
                            <div className="flex items-center justify-between gap-3">
                                <h3 className="text-sm font-semibold text-text-light uppercase tracking-wider">
                                    Today
                                </h3>
                                <div className="flex items-center gap-2">
                                    {/* v7.5: Focus Mode strictness — when strict, the first-action note (start) and
                                        the next-step note (Stop / Exit) are required; relaxed makes them optional. */}
                                    <button
                                        onClick={() =>
                                            dispatch({ type: 'UPDATE_SETTINGS', settings: { focusStrict: !(settings.focusStrict ?? true) } })
                                        }
                                        className={`hidden md:inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full border transition-colors cursor-pointer ${(settings.focusStrict ?? true)
                                            ? 'border-accent bg-accent/10 text-accent'
                                            : 'border-border bg-card text-text-light hover:text-accent hover:border-accent'}`}
                                        title={(settings.focusStrict ?? true)
                                            ? 'Focus is strict: a first-action note and a next-step note are required. Click to relax.'
                                            : 'Focus is relaxed: start/next-step notes are optional. Click to make them required.'}
                                    >
                                        {(settings.focusStrict ?? true) ? '🔒 Focus: Strict' : '🔓 Focus: Relaxed'}
                                    </button>
                                    <button
                                        onClick={() => setAdjustingDay((a) => !a)}
                                        className={`hidden md:inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full border transition-colors cursor-pointer ${adjustingDay
                                            ? 'border-accent bg-accent/10 text-accent'
                                            : 'border-border bg-card text-text-light hover:text-accent hover:border-accent'}`}
                                        title="Move, resize, or add/remove today's sessions"
                                    >
                                        {adjustingDay ? '✓ Done adjusting' : '✎ Adjust day'}
                                    </button>
                                </div>
                            </div>

                            <div className="mt-6 hidden md:block border border-border rounded-xl overflow-hidden px-4 py-1">
                                {adjustingDay ? (
                                    <div className="py-3">
                                        <SessionEditorTimeline
                                            slots={plan.sessionSlots}
                                            onAdd={(session) => dispatch({ type: 'ADD_DAY_SESSION', session })}
                                            onUpdate={(session) => dispatch({ type: 'UPDATE_DAY_SESSION', session })}
                                            onRemove={(sessionId) => dispatch({ type: 'REMOVE_DAY_SESSION', sessionId })}
                                            timelineStartMinutes={settings.timelineStartMinutes}
                                            timelineEndMinutes={settings.timelineEndMinutes}
                                            blocklistOptions={settings.blocklists ?? []}
                                            lockedSessionIds={lockedSessionIds}
                                        />
                                        <p className="mt-2 text-[11px] text-text-light">
                                            Drag to add a block, drag a block to move, drag edges to resize, click to rename or delete.
                                            Removing a session sends its tasks to Anytime. Templates live in Edit Plan.
                                        </p>
                                    </div>
                                ) : (
                                    <SessionTimeline
                                        pinnedSessionId={pinnedSessionId}
                                        onSelectSession={setPinnedSessionId}
                                    />
                                )}
                            </div>

                            {nextSessionStartsWithin(60) && (
                                <div className="mt-4">
                                    <TrueRestCard variant="banner" />
                                </div>
                            )}

                            <div className="mt-10 flex flex-col lg:flex-row gap-6 lg:items-start">
                                <div className="flex-1 min-w-0 space-y-6">
                                    {/* Current session */}
                                    <div className="space-y-2">
                                        <h3 className="text-sm font-semibold text-text-light uppercase tracking-wider">
                                            Current Session
                                        </h3>
                                        <CurrentSession
                                            pinnedSessionId={pinnedSessionId}
                                            onPinnedChange={setPinnedSessionId}
                                        />
                                    </div>

                                    {/* Anytime today — committed tasks not tied to a session */}
                                    <AnytimeTray />

                                    {/* Task Manager (Todoist) — collapsible */}
                                    <CollapsibleSection title="Task Manager">
                                        <div className="mt-2 rounded-lg border border-border overflow-hidden bg-card" style={{ height: 400 }}>
                                            <TodoistPanel
                                                mode="full"
                                                onSetup={() => navigate('/settings?tab=integrations')}
                                                showFilterToggle
                                                defaultFiltered
                                            />
                                        </div>
                                    </CollapsibleSection>

                                    {/* Calendar (Google) — collapsible */}
                                    <CollapsibleSection title="Calendar">
                                        <div className="mt-3">
                                            <RenderedCalendar height={640} onSetup={() => navigate('/settings?tab=integrations')} />
                                        </div>
                                    </CollapsibleSection>
                                </div>

                                <aside className="lg:w-96 lg:flex-shrink-0 space-y-6">
                                    <HabitInstanceCard />
                                    <MicroGapCard />
                                    <TrueRestCard variant="card" defaultCollapsed />
                                </aside>
                            </div>
                        </section>
                    </div>
                </main>
            </div>

            <CheckInModal open={showCheckin} onClose={dismiss} onRecontextualize={handleRecontextualize} />

            <SessionStartPrompt />

            <Modal
                open={showSaveModal}
                onClose={() => setShowSaveModal(false)}
                title="Save session"
            >
                <div className="space-y-4">
                    <div>
                        <label htmlFor="save-name" className="text-sm text-text-light block mb-1.5">
                            Give this session a name
                        </label>
                        <input
                            id="save-name"
                            type="text"
                            value={saveName}
                            onChange={(e) => setSaveName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSaveDay()}
                            placeholder="e.g. Thursday, Apr 10"
                            className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-card text-text focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-colors"
                            autoFocus
                        />
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={() => setShowSaveModal(false)}>
                            Cancel
                        </Button>
                        <Button size="sm" onClick={handleSaveDay}>
                            Save
                        </Button>
                    </div>
                </div>
            </Modal>
        </div>
    );
}
