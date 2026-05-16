import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ProgressBar } from '../ui/ProgressBar';
import { Button } from '../ui/Button';
import { useDayPlan } from '../../hooks/useDayPlan';
import { useResizablePanel } from '../../hooks/useResizablePanel';
import { HistorySidebar, type HistoryTab } from '../dashboard/HistorySidebar';
import { Logo } from '../ui/Logo';
import { HeaderControls } from '../ui/HeaderControls';
import { ActiveSeasonBadge } from '../life/ActiveSeasonBadge';
import { WIZARD_STEPS, TOTAL_STEPS } from '../../data/wizardSteps';

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
    const { plan, life, editingStep, dispatch } = useDayPlan();
    const navigate = useNavigate();
    const step = plan.wizardStep;
    const isEditing = editingStep !== null;
    const [panelOpen, setPanelOpen] = useState(true);
    const [panelTab, setPanelTab] = useState<HistoryTab>('sessions');
    const backlogCount = life.backlog?.length ?? 0;
    const openPanel = (next: HistoryTab) => {
        if (panelOpen && panelTab === next) {
            setPanelOpen(false);
        } else {
            setPanelTab(next);
            setPanelOpen(true);
        }
    };
    const { panelWidth, onMouseDown } = useResizablePanel();

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
            {/* Left sidebar — saved sessions */}
            {panelOpen && (
                <aside
                    className="flex-shrink-0 border-r border-border bg-subtle/50 overflow-y-auto scrollbar-subtle relative"
                    style={{ width: panelWidth }}
                >
                    {/* Drag handle */}
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

            {/* Main wizard area */}
            <div className="flex-1 flex flex-col min-w-0">
                <header className={`px-6 pt-6 pb-4 mx-auto w-full ${wide ? 'max-w-6xl' : 'max-w-2xl'}`}>
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3 min-w-0">
                            <h1 className="text-xl font-semibold text-accent">
                                <button
                                    onClick={() => navigate('/')}
                                    className="flex items-center gap-2 hover:opacity-80 transition-opacity cursor-pointer"
                                    title={plan.setupComplete ? 'Back to Dashboard' : 'Back to Welcome'}
                                >
                                    <Logo />
                                    Orchestrate
                                </button>
                            </h1>
                            <ActiveSeasonBadge />
                        </div>
                        <div className="flex gap-2">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openPanel('sessions')}
                            >
                                {panelOpen && panelTab === 'sessions' ? 'Hide Saved' : 'Saved Sessions'}
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openPanel('backlog')}
                                title="Intentions backlog"
                            >
                                {panelOpen && panelTab === 'backlog'
                                    ? 'Hide Backlog'
                                    : <>📥 Backlog{backlogCount > 0 ? ` (${backlogCount})` : ''}</>}
                            </Button>
                            {isEditing && (
                                <Button variant="ghost" size="sm" onClick={goToDashboard}>
                                    Back to Dashboard
                                </Button>
                            )}
                            <HeaderControls />
                        </div>
                    </div>
                    <ProgressBar current={step} total={TOTAL_STEPS} />
                    {/* Step navigation pills — always visible */}
                    <div className="flex gap-1.5 mt-3 flex-wrap">
                        {WIZARD_STEPS.map(({ num: stepNum, label }) => {
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
        </div>
    );
}
