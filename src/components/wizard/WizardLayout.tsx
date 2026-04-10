import { useState, useRef, useCallback, useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ProgressBar } from '../ui/ProgressBar';
import { Button } from '../ui/Button';
import { useDayPlan } from '../../context/DayPlanContext';
import { useTheme } from '../../hooks/useTheme';
import { SavedSessions } from '../dashboard/SavedSessions';

const TOTAL_STEPS = 6;
const PANEL_MIN = 220;
const PANEL_MAX = 480;
const PANEL_DEFAULT = 288;

const STEP_LABELS = [
    'Priorities',
    'Todolist Sync',
    'Categorize',
    'Main Tasks',
    'Background Tasks',
    'Music',
];

interface WizardLayoutProps {
    children: ReactNode;
    canAdvance?: boolean;
    onNext?: () => void;
    nextLabel?: string;
    hideBack?: boolean;
    hideNext?: boolean;
}

export function WizardLayout({
    children,
    canAdvance = true,
    onNext,
    nextLabel = 'Continue',
    hideBack = false,
    hideNext = false,
}: WizardLayoutProps) {
    const { plan, editingStep, history, dispatch } = useDayPlan();
    const navigate = useNavigate();
    const { theme, toggle: toggleTheme } = useTheme();
    const step = plan.wizardStep;
    const isEditing = editingStep !== null;
    const hasSavedSessions = history.length > 0;
    const showSidebar = hasSavedSessions && !isEditing;
    const [panelOpen, setPanelOpen] = useState(showSidebar);
    const [panelWidth, setPanelWidth] = useState(PANEL_DEFAULT);
    const dragging = useRef(false);
    const startX = useRef(0);
    const startWidth = useRef(PANEL_DEFAULT);

    const onMouseDown = useCallback((e: React.MouseEvent) => {
        dragging.current = true;
        startX.current = e.clientX;
        startWidth.current = panelWidth;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    }, [panelWidth]);

    useEffect(() => {
        const onMouseMove = (e: MouseEvent) => {
            if (!dragging.current) return;
            // Dragging left edge: moving left = wider, moving right = narrower
            const delta = startX.current - e.clientX;
            const next = Math.min(PANEL_MAX, Math.max(PANEL_MIN, startWidth.current + delta));
            setPanelWidth(next);
        };
        const onMouseUp = () => {
            if (!dragging.current) return;
            dragging.current = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
        return () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };
    }, []);

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
            {/* Main wizard area */}
            <div className="flex-1 flex flex-col min-w-0">
                <header className="px-6 pt-6 pb-4 max-w-2xl mx-auto w-full">
                    <div className="flex items-center justify-between mb-4">
                        <h1 className="text-xl font-semibold text-accent">Orchestrate</h1>
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
                            const canClick = plan.setupComplete && !isCurrent;

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

                <main className="flex-1 px-6 pb-6 max-w-2xl mx-auto w-full">
                    <div className="transition-opacity duration-300">{children}</div>
                </main>

                <footer className="px-6 py-4 border-t border-border max-w-2xl mx-auto w-full flex justify-between">
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

            {/* Right sidebar — saved sessions */}
            {showSidebar && panelOpen && (
                <aside
                    className="flex-shrink-0 border-l border-border bg-subtle/50 overflow-y-auto relative"
                    style={{ width: panelWidth }}
                >
                    {/* Drag handle */}
                    <div
                        onMouseDown={onMouseDown}
                        className="absolute inset-y-0 left-0 w-1.5 cursor-col-resize hover:bg-accent/20 active:bg-accent/30 transition-colors"
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
        </div>
    );
}
