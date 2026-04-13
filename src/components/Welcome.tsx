import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { useDayPlan } from '../context/DayPlanContext';
import { useTheme } from '../hooks/useTheme';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { Modal } from './ui/Modal';
import { AboutContent } from './ui/AboutContent';

function getGreeting(): string {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
}

const STEP_LABELS = ['Intentions', 'Categorize', 'Main Schedule', 'Nudges', 'Music'];

export function Welcome() {
    const { plan, history } = useDayPlan();
    const navigate = useNavigate();
    const { theme, toggle: toggleTheme } = useTheme();
    const [showAbout, setShowAbout] = useState(false);

    const isResuming = plan.intentions.length > 0 || plan.wizardStep > 1;
    const isFirstEver = !isResuming && history.length === 0;
    const today = format(new Date(), 'EEEE, MMMM d');

    return (
        <div className="min-h-screen flex flex-col items-center justify-center px-6 py-12">
            {/* Top-right controls */}
            <div className="fixed top-5 right-5 flex gap-1.5">
                <button
                    onClick={() => setShowAbout(true)}
                    className="p-2 rounded-lg text-text-light hover:bg-surface-dark transition-colors cursor-pointer text-sm"
                    title="About Orchestrate"
                >
                    ?
                </button>
                <button
                    onClick={toggleTheme}
                    className="p-2 rounded-lg text-text-light hover:bg-surface-dark transition-colors cursor-pointer"
                    title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                >
                    {theme === 'dark' ? '☀️' : '🌙'}
                </button>
            </div>

            <div className="w-full max-w-md space-y-8 text-center">
                {/* Logo & branding */}
                <div className="space-y-3">
                    <img
                        src={import.meta.env.BASE_URL + 'favicon.svg'}
                        alt=""
                        className="w-14 h-14 mx-auto"
                    />
                    <h1 className="text-2xl font-semibold text-accent">Orchestrate</h1>
                </div>

                {/* Greeting & date */}
                <div className="space-y-1">
                    <p className="text-xl font-medium text-text">
                        {getGreeting()}
                    </p>
                    <p className="text-sm text-text-light">{today}</p>
                </div>

                {/* Main card */}
                <Card className="text-left space-y-5">
                    <div className="space-y-2">
                        <h2 className="text-base font-medium text-text">
                            {isResuming ? 'Pick up where you left off' : 'Start your day with clarity'}
                        </h2>
                        <p className="text-sm text-text-light">
                            {isResuming
                                ? "You've started planning your day. Continue setting your intentions and scheduling your sessions."
                                : 'Take a few minutes to set your intentions, organize your sessions, and contextualize what matters today.'}
                        </p>
                    </div>

                    {plan.intentions.length > 0 && (
                        <p className="text-xs text-text-light">
                            {plan.intentions.length} intention{plan.intentions.length !== 1 ? 's' : ''} set
                        </p>
                    )}

                    <Button
                        size="lg"
                        className="w-full"
                        onClick={() => navigate('/setup', { state: { fromWelcome: true } })}
                    >
                        {isResuming ? 'Resume Planning' : 'Plan Your Day'}
                    </Button>
                </Card>

                {/* Step timeline */}
                <div className="flex items-start justify-center gap-0">
                    {STEP_LABELS.map((label, i) => {
                        const stepNum = i + 1;
                        const isDone = stepNum < plan.wizardStep;
                        const isCurrent = stepNum === plan.wizardStep;
                        const isLast = i === STEP_LABELS.length - 1;

                        return (
                            <div key={label} className="flex items-start">
                                <div className="flex flex-col items-center" style={{ width: 72 }}>
                                    {/* Circle */}
                                    <div
                                        className={`w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs font-medium transition-colors ${isDone
                                            ? 'bg-accent border-accent text-white'
                                            : isCurrent
                                                ? 'border-accent bg-accent/10 text-accent'
                                                : 'border-border bg-surface text-text-light/40'
                                            }`}
                                    >
                                        {isDone ? '\u2713' : stepNum}
                                    </div>
                                    {/* Label */}
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
                                {/* Connecting line */}
                                {!isLast && (
                                    <div
                                        className={`h-0.5 mt-[13px] flex-shrink-0 rounded-full ${isDone ? 'bg-accent' : 'bg-border'
                                            }`}
                                        style={{ width: 24 }}
                                    />
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* Tagline / first-time nudge */}
                {isFirstEver ? (
                    <p className="text-xs text-text-light">
                        New here?{' '}
                        <button
                            onClick={() => setShowAbout(true)}
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
            </div>

            {/* About modal */}
            <Modal open={showAbout} onClose={() => setShowAbout(false)} title="About Orchestrate">
                <AboutContent />
            </Modal>
        </div>
    );
}
