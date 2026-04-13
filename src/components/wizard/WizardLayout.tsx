import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ProgressBar } from '../ui/ProgressBar';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { useDayPlan } from '../../context/DayPlanContext';
import { useTheme } from '../../hooks/useTheme';
import { useResizablePanel } from '../../hooks/useResizablePanel';
import { SavedSessions } from '../dashboard/SavedSessions';
import { TodoistSetup } from '../todoist/TodoistSetup';
import { AboutContent } from '../ui/AboutContent';

const TOTAL_STEPS = 4;

const STEP_LABELS = [
    'Intentions',
    'Refine',
    'Schedule',
    'Music',
];

interface WizardLayoutProps {
    children: ReactNode;
    canAdvance?: boolean;
    onNext?: () => void;
    nextLabel?: string;
    hideBack?: boolean;
    hideNext?: boolean;
    /** When true, removes the max-w-2xl constraint for iframe-heavy steps */
    wide?: boolean;
}

export function WizardLayout({
    children,
    canAdvance = true,
    onNext,
    nextLabel = 'Continue',
    hideBack = false,
    hideNext = false,
    wide = false,
}: WizardLayoutProps) {
    const { plan, editingStep, dispatch } = useDayPlan();
    const navigate = useNavigate();
    const { theme, toggle: toggleTheme } = useTheme();
    const step = plan.wizardStep;
    const isEditing = editingStep !== null;
    const showSidebar = !isEditing;
    const [panelOpen, setPanelOpen] = useState(showSidebar);
    const { panelWidth, onMouseDown } = useResizablePanel();
    const [showSettings, setShowSettings] = useState(false);
    const [showAbout, setShowAbout] = useState(false);

    const goBack = () => {
        if (step > 1) dispatch({ type: 'SET_WIZARD_STEP', step: step - 1 });
    };

    const goNext = () => {
        if (onNext) {
            onNext();
        } else if (step < TOTAL_STEPS) {
            dispatch({ type: 'SET_WIZARD_STEP', step: step + 1 });
        }
    };

    const goToDashboard = () => {
        dispatch({ type: 'SET_EDITING_STEP', step: null });
        navigate('/');
    };

    const jumpToStep = (s: number) => {
        dispatch({ type: 'SET_WIZARD_STEP', step: s });
    };

    return (
        <div className="min-h-screen flex">
            {/* Left sidebar — saved sessions & import */}
            {showSidebar && panelOpen && (
                <aside
                    className="flex-shrink-0 border-r border-border bg-subtle/50 overflow-y-auto relative"
                    style={{ width: panelWidth }}
                >
                    {/* Drag handle */}
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
                        <SavedSessions compact hideHeading />
                    </div>
                </aside>
            )}

            {/* Main wizard area */}
            <div className="flex-1 flex flex-col min-w-0">
                <header className={`px-6 pt-6 pb-4 mx-auto w-full ${wide ? 'max-w-6xl' : 'max-w-2xl'}`}>
                    <div className="flex items-center justify-between mb-4">
                        <h1 className="text-xl font-semibold text-accent flex items-center gap-2">
                            <img src={import.meta.env.BASE_URL + 'favicon.svg'} alt="" className="w-6 h-6" />
                            Orchestrate
                        </h1>
                        <div className="flex gap-2">
                            {showSidebar && !panelOpen && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setPanelOpen(true)}
                                >
                                    Saved Sessions
                                </Button>
                            )}
                            {isEditing && (
                                <Button variant="ghost" size="sm" onClick={goToDashboard}>
                                    Back to Dashboard
                                </Button>
                            )}
                            <button
                                onClick={() => setShowAbout(true)}
                                className="p-1.5 rounded-lg text-text-light hover:bg-surface-dark transition-colors cursor-pointer text-sm"
                                title="About Orchestrate"
                            >
                                ?
                            </button>
                            <button
                                onClick={() => setShowSettings(true)}
                                className="p-1.5 rounded-lg text-text-light hover:bg-surface-dark transition-colors cursor-pointer"
                                title="Integrations"
                            >
                                ⚙
                            </button>
                            <button
                                onClick={toggleTheme}
                                className="p-1.5 rounded-lg text-text-light hover:bg-surface-dark transition-colors cursor-pointer"
                                title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                            >
                                {theme === 'dark' ? '☀️' : '🌙'}
                            </button>
                        </div>
                    </div>
                    <ProgressBar current={step} total={TOTAL_STEPS} />
                    {/* Step navigation pills — always visible */}
                    <div className="flex gap-1.5 mt-3 flex-wrap">
                        {STEP_LABELS.map((label, i) => {
                            const stepNum = i + 1;
                            const isCurrent = step === stepNum;
                            const isReachable = plan.setupComplete || stepNum <= step;
                            const canClick = plan.setupComplete
                                ? !isCurrent
                                : (stepNum < step) || (stepNum === step + 1 && canAdvance);

                            return (
                                <button
                                    key={label}
                                    onClick={() => canClick && jumpToStep(stepNum)}
                                    disabled={!canClick}
                                    className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${isCurrent
                                        ? 'bg-accent text-white border-accent'
                                        : canClick
                                            ? 'border-border text-text-light hover:border-accent hover:text-accent cursor-pointer'
                                            : isReachable
                                                ? 'border-border text-text-light'
                                                : 'border-border/50 text-text-light/40'
                                        } ${!canClick && !isCurrent ? 'cursor-default' : ''}`}
                                >
                                    {label}
                                </button>
                            );
                        })}
                    </div>
                </header>

                <main className={`flex-1 px-6 pb-6 mx-auto w-full ${wide ? 'max-w-6xl' : 'max-w-2xl'}`}>
                    <div className="transition-opacity duration-300">{children}</div>
                </main>

                <footer className={`px-6 py-4 border-t border-border mx-auto w-full flex justify-between ${wide ? 'max-w-6xl' : 'max-w-2xl'}`}>
                    {!hideBack && step > 1 ? (
                        <Button variant="ghost" onClick={goBack}>
                            Back
                        </Button>
                    ) : (
                        <div />
                    )}
                    <div className="flex gap-2">
                        {isEditing && (
                            <Button variant="secondary" onClick={goToDashboard}>
                                Done
                            </Button>
                        )}
                        {!hideNext && (
                            <Button onClick={goNext} disabled={!canAdvance}>
                                {nextLabel}
                            </Button>
                        )}
                    </div>
                </footer>
            </div>

            {/* Settings modal */}
            <Modal open={showSettings} onClose={() => setShowSettings(false)} title="Integrations">
                <TodoistSetup />
            </Modal>

            {/* About modal */}
            <Modal open={showAbout} onClose={() => setShowAbout(false)} title="About Orchestrate">
                <AboutContent />
                <p className="text-xs pt-1 border-t border-border mt-3 text-text-light">
                    Connect Todoist and Google Calendar in{' '}
                    <button
                        onClick={() => { setShowAbout(false); setShowSettings(true); }}
                        className="text-accent hover:underline cursor-pointer"
                    >
                        Integrations
                    </button>{' '}
                    to get the most out of this app.
                </p>
            </Modal>
        </div>
    );
}
