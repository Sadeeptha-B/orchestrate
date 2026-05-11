import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { useDayPlan } from '../../hooks/useDayPlan';
import { CurrentSession, SessionTimeline } from './SessionTimeline';
import { MusicProvider, PlaylistSelector, SpotifyPlayer } from './MusicPanel';
import { SavedSessions } from './SavedSessions';
import { DigitalClock } from './DigitalClock';
import { TransitionTips } from './TransitionTips';
import { CheckInModal } from '../checkin/CheckInModal';
import { TodoistPanel } from '../todoist/TodoistPanel';
import { GoogleCalendarEmbed } from '../todoist/GoogleCalendarEmbed';
import { SettingsModal } from '../settings/SettingsModal';
import { useHourlyCheckin } from '../../hooks/useHourlyCheckin';
import { useResizablePanel } from '../../hooks/useResizablePanel';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Logo } from '../ui/Logo';
import { ThemeToggle } from '../ui/ThemeToggle';
import { AboutContent } from '../ui/AboutContent';
import { ActiveSeasonBadge } from '../life/ActiveSeasonBadge';
import { SeasonContextCard } from '../life/SeasonContextCard';

export function Dashboard() {
    const { plan, settings, dispatch } = useDayPlan();
    const navigate = useNavigate();
    const { showCheckin, dismiss } = useHourlyCheckin(
        settings.sessionSlots,
        plan.setupComplete,
        settings.notificationPreference,
    );

    const [showSaveModal, setShowSaveModal] = useState(false);
    const [saveName, setSaveName] = useState('');
    const [showNewDayModal, setShowNewDayModal] = useState(false);
    const [newDaySaveName, setNewDaySaveName] = useState('');
    const [panelOpen, setPanelOpen] = useState(false);
    const [taskManagerOpen, setTaskManagerOpen] = useState(false);
    const [calendarOpen, setCalendarOpen] = useState(false);
    const [showSettingsModal, setShowSettingsModal] = useState(false);
    const [showAboutModal, setShowAboutModal] = useState(false);

    const { panelWidth, onMouseDown } = useResizablePanel();

    const handleNewDay = () => {
        setNewDaySaveName(format(parseISO(plan.date), 'EEEE, MMM d'));
        setShowNewDayModal(true);
    };

    const confirmNewDay = (save: boolean) => {
        if (save) {
            const label = newDaySaveName.trim() || format(parseISO(plan.date), 'EEEE, MMM d');
            dispatch({ type: 'SAVE_DAY', label });
        }
        setShowNewDayModal(false);
        setNewDaySaveName('');
        dispatch({ type: 'RESET_DAY' });
        navigate('/setup', { state: { fromWelcome: true } });
    };

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
                        <Button variant="ghost" size="sm" onClick={handleNewDay}>
                            Start New Day
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => navigate('/life')}>
                            Life
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setPanelOpen(!panelOpen)}
                        >
                            {panelOpen ? 'Hide Saved' : 'Saved Sessions'}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setShowSettingsModal(true)}>
                            Settings
                        </Button>
                        <button
                            onClick={() => setShowAboutModal(true)}
                            className="p-1.5 rounded-lg text-text-light hover:bg-surface-dark transition-colors cursor-pointer text-sm"
                            title="About Orchestrate"
                        >
                            ?
                        </button>
                        <ThemeToggle />
                    </div>
                </div>
            </header>

            <div className="flex-1 flex">
                {/* Left side panel — saved sessions */}
                {panelOpen && (
                    <aside
                        className="flex-shrink-0 border-r border-border bg-subtle/50 overflow-y-auto relative"
                        style={{ width: panelWidth }}
                    >
                        {/* Drag handle — right edge */}
                        <div
                            onMouseDown={onMouseDown}
                            className="absolute inset-y-0 right-0 w-1.5 cursor-col-resize hover:bg-accent/20 active:bg-accent/30 transition-colors"
                        />
                        <div className="p-5 pt-6">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-sm font-semibold text-text-light uppercase tracking-wider">
                                    Saved Sessions
                                </h3>
                                <button
                                    onClick={() => setPanelOpen(false)}
                                    className="text-text-light hover:text-text transition-colors text-lg leading-none cursor-pointer"
                                    title="Hide panel"
                                >
                                    &times;
                                </button>
                            </div>
                            <SavedSessions hideHeading />
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

                            {/* Row 2: Spotify embed + transition tips */}
                            <div className="flex flex-col lg:flex-row gap-4 lg:items-start">
                                <div className="flex-1 min-w-0">
                                    <SpotifyPlayer />
                                </div>
                                <aside className="lg:w-72 lg:flex-shrink-0">
                                    <TransitionTips />
                                </aside>
                            </div>
                        </MusicProvider>

                        {/* Timeline + Season side rail */}
                        <div className="flex flex-col lg:flex-row gap-4 lg:items-start">
                            <div className="flex-1 min-w-0">
                                <h3 className="text-sm font-semibold text-text-light uppercase tracking-wider mb-3">
                                    Timeline
                                </h3>
                                <SessionTimeline />
                            </div>
                            <aside className="lg:w-72 lg:flex-shrink-0">
                                <SeasonContextCard />
                            </aside>
                        </div>

                        {/* Current session */}
                        <div className="space-y-2">
                            <h3 className="text-sm font-semibold text-text-light uppercase tracking-wider">
                                Current Session
                            </h3>
                            <CurrentSession />
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
                                        onSetup={() => setShowSettingsModal(true)}
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
                                    <GoogleCalendarEmbed height={400} onSetup={() => setShowSettingsModal(true)} />
                                </div>
                            )}
                        </div>
                    </div>
                </main>
            </div>

            <CheckInModal open={showCheckin} onClose={dismiss} onRecontextualize={handleRecontextualize} />

            <Modal
                open={showNewDayModal}
                onClose={() => setShowNewDayModal(false)}
                title="Start New Day"
            >
                <div className="space-y-4">
                    <p className="text-sm text-text-light">
                        Would you like to save your current session before starting fresh?
                    </p>
                    <div>
                        <label htmlFor="new-day-save-name" className="text-sm text-text-light block mb-1.5">
                            Session name
                        </label>
                        <input
                            id="new-day-save-name"
                            type="text"
                            value={newDaySaveName}
                            onChange={(e) => setNewDaySaveName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && confirmNewDay(true)}
                            placeholder="e.g. Thursday, Apr 10"
                            className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-card text-text focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-colors"
                            autoFocus
                        />
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={() => setShowNewDayModal(false)}>
                            Cancel
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => confirmNewDay(false)}>
                            Don&apos;t Save
                        </Button>
                        <Button size="sm" onClick={() => confirmNewDay(true)}>
                            Save &amp; Start New
                        </Button>
                    </div>
                </div>
            </Modal>

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

            <SettingsModal
                open={showSettingsModal}
                onClose={() => setShowSettingsModal(false)}
                onShowSavedSessions={() => {
                    setShowSettingsModal(false);
                    setPanelOpen(true);
                }}
            />

            <Modal open={showAboutModal} onClose={() => setShowAboutModal(false)} title="About Orchestrate">
                <AboutContent />
                <p className="text-xs pt-1 border-t border-border mt-3 text-text-light">
                    Connect Todoist and Google Calendar in{' '}
                    <button
                        onClick={() => { setShowAboutModal(false); setShowSettingsModal(true); }}
                        className="text-accent hover:underline cursor-pointer"
                    >
                        Settings
                    </button>{' '}
                    to get the most out of this app.
                </p>
            </Modal>
        </div>
    );
}
