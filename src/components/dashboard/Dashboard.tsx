import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { useDayPlan } from '../../hooks/useDayPlan';
import { useTodoistData } from '../../hooks/useTodoist';
import { computeTodaysMicroGapInstances } from '../../lib/habits';
import { computeTodaysHabitInstances } from '../../lib/habitsTodoistSync';
import { DEFAULT_TASK_CAPS } from '../../lib/capacity';
import { CurrentSession, SessionTimeline } from './SessionTimeline';
import { MusicProvider, PlaylistSelector, SpotifyPlayer } from './MusicPanel';
import { HistorySidebar, type HistoryTab } from './HistorySidebar';
import { DigitalClock } from './DigitalClock';
import { InsightCard } from './InsightCard';
import { CheckInModal } from '../checkin/CheckInModal';
import { TodoistPanel } from '../todoist/TodoistPanel';
import { GoogleCalendarEmbed } from '../todoist/GoogleCalendarEmbed';
import { useHourlyCheckin } from '../../hooks/useHourlyCheckin';
import { useResizablePanel } from '../../hooks/useResizablePanel';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Logo } from '../ui/Logo';
import { HeaderControls } from '../ui/HeaderControls';
import { ActiveSeasonBadge } from '../life/ActiveSeasonBadge';
import { SeasonContextCard } from '../life/SeasonContextCard';
import { HabitInstanceCard, MicroGapCard, EngagementLogCard } from './HabitInstanceCard';
import { TrueRestCard } from './TrueRestCard';
import { useCurrentSession } from '../../hooks/useCurrentSession';

export function Dashboard() {
    const { plan, settings, life, dispatch } = useDayPlan();
    const navigate = useNavigate();
    const { showCheckin, dismiss } = useHourlyCheckin(
        settings.sessionSlots,
        plan.setupComplete,
        settings.notificationPreference,
    );
    const { nextSessionStartsWithin } = useCurrentSession(settings.sessionSlots);
    const { taskMap } = useTodoistData();

    // v6.7: keep `plan.todaysHabits` in sync with the library while on the dashboard, so a habit
    // created/edited/deleted in /habits is reflected without re-running the wizard:
    //  - compute today's 'habit' (Todoist-gated) + 'micro-gap' (no-Todoist) instances and append
    //    them (REFRESH_TODAYS_HABITS dedupes by habitId — safe to re-fire);
    //  - prune any instance whose habit was deleted (defensive — DELETE_HABIT already prunes, this
    //    catches anything that slipped through so deleted habits never linger on the dashboard).
    useEffect(() => {
        const taskCaps = settings.taskCapDefaults ?? DEFAULT_TASK_CAPS;
        const instances = [
            ...computeTodaysHabitInstances({ life, plan, taskMap, now: new Date(), taskCaps }),
            ...computeTodaysMicroGapInstances({ life, plan, taskCaps }),
        ];
        if (instances.length > 0) dispatch({ type: 'REFRESH_TODAYS_HABITS', instances });
        if (plan.todaysHabits.some((i) => !life.habits.some((h) => h.id === i.habitId))) {
            dispatch({ type: 'PRUNE_TODAYS_HABITS' });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [taskMap, life.habits, life.activeSeasonId, plan.todaysHabits, plan.date, settings.taskCapDefaults, dispatch]);

    const [showSaveModal, setShowSaveModal] = useState(false);
    const [saveName, setSaveName] = useState('');
    const [panelOpen, setPanelOpen] = useState(false);
    const [panelTab, setPanelTab] = useState<HistoryTab>('sessions');
    const backlogCount = life.backlog?.length ?? 0;
    const [taskManagerOpen, setTaskManagerOpen] = useState(false);
    const [calendarOpen, setCalendarOpen] = useState(false);
    // Shared between the timeline (click to pin) and the carousel (prev/next, ↩ to unpin).
    const [pinnedSessionId, setPinnedSessionId] = useState<string | null>(null);

    const { panelWidth, onMouseDown } = useResizablePanel();

    const handleEditPlan = () => {
        dispatch({ type: 'SET_EDITING_STEP', step: 1 });
        dispatch({ type: 'SET_WIZARD_STEP', step: 1 });
        navigate('/setup');
    };

    const handleRecontextualize = () => {
        dispatch({ type: 'SET_EDITING_STEP', step: 3 });
        dispatch({ type: 'SET_WIZARD_STEP', step: 3 });
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
                    <div className="max-w-6xl mx-auto space-y-6">
                        <MusicProvider>
                            {/* Row 1: playlist buttons + clock */}
                            <div className="flex flex-col lg:flex-row gap-4 lg:items-start">
                                <div className="flex-1 min-w-0">
                                    <PlaylistSelector />
                                </div>
                                <div className="lg:w-72 lg:flex-shrink-0">
                                    <DigitalClock />
                                </div>
                            </div>

                            {/* Row 2: Spotify embed + insight card */}
                            <div className="flex flex-col lg:flex-row gap-4 lg:items-start">
                                <div className="flex-1 min-w-0">
                                    <SpotifyPlayer />
                                </div>
                                <aside className="lg:w-72 lg:flex-shrink-0">
                                    <InsightCard />
                                </aside>
                            </div>
                        </MusicProvider>

                        {/* Timeline + Season side rail */}
                        <div className="flex flex-col lg:flex-row gap-4 lg:gap-8 lg:items-start">
                            <div className="flex-1 min-w-0">
                                <h3 className="text-sm font-semibold text-text-light uppercase tracking-wider mb-3">
                                    Timeline
                                </h3>
                                <SessionTimeline
                                    pinnedSessionId={pinnedSessionId}
                                    onSelectSession={setPinnedSessionId}
                                />
                            </div>
                            <aside className="lg:w-72 lg:flex-shrink-0 space-y-3">
                                <SeasonContextCard />
                            </aside>
                        </div>

                        {/* Between-session True Rest cue (v6) — only when no active session and next within 60 min */}
                        {nextSessionStartsWithin(60) && <TrueRestCard variant="banner" />}

                        {/* v6.4: two-column lower region. The habit card is a right rail spanning the
                            whole left column (session + task manager + calendar), so its
                            height — especially the engagement log — is absorbed beside that column
                            instead of pushing the task manager/calendar down. Task Manager + Calendar
                            therefore take the Current Session width. Stacks on small screens. */}
                        <div className="flex flex-col lg:flex-row gap-6 lg:items-start bg-subtle/30 rounded-xl border border-border p-5">
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

                                {/* Task Manager (Todoist) — collapsible */}
                                <div>
                                    <button
                                        onClick={() => setTaskManagerOpen(!taskManagerOpen)}
                                        className="flex items-center gap-2 text-sm font-semibold text-text-light uppercase tracking-wider hover:text-accent transition-colors cursor-pointer"
                                    >
                                        <svg
                                            className={`w-3 h-3 transition-transform ${taskManagerOpen ? 'rotate-90' : ''}`}
                                            fill="none"
                                            viewBox="0 0 24 24"
                                            stroke="currentColor"
                                            strokeWidth={2}
                                        >
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                        </svg>
                                        Task Manager
                                    </button>
                                    {taskManagerOpen && (
                                        <div className="mt-2 rounded-lg border border-border overflow-hidden bg-card" style={{ height: 400 }}>
                                            <TodoistPanel
                                                mode="full"
                                                onSetup={() => navigate('/settings?tab=integrations')}
                                                showFilterToggle
                                                defaultFiltered
                                            />
                                        </div>
                                    )}
                                </div>

                                {/* Calendar (Google) — collapsible */}
                                <div>
                                    <button
                                        onClick={() => setCalendarOpen(!calendarOpen)}
                                        className="flex items-center gap-2 text-sm font-semibold text-text-light uppercase tracking-wider hover:text-accent transition-colors cursor-pointer"
                                    >
                                        <svg
                                            className={`w-3 h-3 transition-transform ${calendarOpen ? 'rotate-90' : ''}`}
                                            fill="none"
                                            viewBox="0 0 24 24"
                                            stroke="currentColor"
                                            strokeWidth={2}
                                        >
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                        </svg>
                                        Calendar
                                    </button>
                                    {calendarOpen && (
                                        <div className="mt-3">
                                            <GoogleCalendarEmbed height={400} onSetup={() => navigate('/settings?tab=integrations')} />
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* v6.3/v6.4: right rail beside the whole left column — today's habits
                                and the engagement log as two independent, self-headed cards. Each
                                hides itself when empty. */}
                            <aside className="lg:w-96 lg:flex-shrink-0 space-y-6">
                                <HabitInstanceCard />
                                <MicroGapCard />
                                <EngagementLogCard />
                            </aside>
                        </div>
                    </div>
                </main>
            </div>

            <CheckInModal open={showCheckin} onClose={dismiss} onRecontextualize={handleRecontextualize} />

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
