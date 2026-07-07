// First-run onboarding — the holistic setup journey shown at `/` until completed once per account
// (`settings.onboardingComplete`, synced via D1 so it doesn't re-run per device).
//
// Three steps: what Orchestrate is → connect Todoist (required — the app plans *from* your Todoist
// tasks, so planning is unusable without it) → connect Google Calendar (encouraged but skippable).
// Steps auto-reflect already-connected integrations, so an existing account clicks straight through.
// The Google OAuth kick-off uses `returnTo: 'home'`, so the callback redirects back here (`/?gcal=…`)
// and the GoogleConnectCard's useGcalCallback processes it — the flow resumes on the calendar step.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDayPlan } from '../../hooks/useDayPlan';
import { useTodoistData } from '../../hooks/useTodoist';
import { useGoogleCalendarData } from '../../hooks/useGoogleCalendar';
import { AboutContent } from '../ui/AboutContent';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Logo } from '../ui/Logo';
import { ThemeToggle } from '../ui/ThemeToggle';
import { TodoistConnectCard } from '../todoist/TodoistConnectCard';
import { GoogleConnectCard } from '../settings/GoogleConnectCard';

type OnboardingStep = 'intro' | 'todoist' | 'calendar';

const STEP_ORDER: OnboardingStep[] = ['intro', 'todoist', 'calendar'];

export function Onboarding() {
    const { dispatch } = useDayPlan();
    const navigate = useNavigate();
    const { isConfigured: todoistConnected, statusResolved } = useTodoistData();
    const { isConnected: calendarConnected } = useGoogleCalendarData();

    // Returning from the Google consent redirect (`/?gcal=…`) resumes on the calendar step, where
    // the mounted GoogleConnectCard handles the callback params.
    const [step, setStep] = useState<OnboardingStep>(() =>
        new URLSearchParams(window.location.search).has('gcal') ? 'calendar' : 'intro',
    );

    const finish = () => {
        dispatch({ type: 'UPDATE_SETTINGS', settings: { onboardingComplete: true } });
    };

    return (
        <div className="min-h-screen flex flex-col items-center justify-center px-6 py-12">
            <div className="fixed top-5 right-5 z-10">
                <ThemeToggle />
            </div>

            <div className="w-full max-w-xl space-y-6">
                <div className="space-y-3 text-center">
                    <Logo className="w-14 h-14 mx-auto" />
                    <h1 className="text-2xl font-semibold text-accent">Orchestrate</h1>
                    <p className="text-sm text-text-light">Let's get you set up — it takes a minute.</p>
                </div>

                {/* Step dots */}
                <div className="flex items-center justify-center gap-2">
                    {STEP_ORDER.map((s, i) => {
                        const activeIndex = STEP_ORDER.indexOf(step);
                        return (
                            <span
                                key={s}
                                className={`h-1.5 rounded-full transition-all ${
                                    i === activeIndex ? 'w-6 bg-accent' : i < activeIndex ? 'w-3 bg-accent/50' : 'w-3 bg-border'
                                }`}
                            />
                        );
                    })}
                </div>

                {step === 'intro' && (
                    <Card className="space-y-4">
                        <AboutContent onOpenGuide={() => navigate('/guide')} />
                        <div className="rounded-lg border border-border bg-surface-dark/40 px-3 py-2.5 text-xs text-text-light space-y-1">
                            <p>
                                <strong className="text-text">Todoist is required</strong> — it stays the source of
                                truth for your tasks; Orchestrate plans your day from it.
                            </p>
                            <p>
                                <strong className="text-text">Google Calendar is strongly recommended</strong> — your
                                meetings shape where work sessions go, and sessions sync back to a dedicated calendar.
                            </p>
                        </div>
                        <Button size="lg" className="w-full" onClick={() => setStep('todoist')}>
                            Get started
                        </Button>
                    </Card>
                )}

                {step === 'todoist' && (
                    <Card className="space-y-4">
                        <div className="space-y-1">
                            <h2 className="text-base font-medium text-text">Connect Todoist</h2>
                            <p className="text-sm text-text-light">
                                Orchestrate doesn't keep its own task list — intentions are mapped to your real
                                Todoist tasks, and completing work here completes it there. This one is required.
                            </p>
                        </div>
                        <TodoistConnectCard />
                        <div className="flex items-center justify-between pt-1">
                            <button
                                onClick={() => setStep('intro')}
                                className="text-xs text-text-light hover:text-accent cursor-pointer"
                            >
                                ← Back
                            </button>
                            <Button onClick={() => setStep('calendar')} disabled={!todoistConnected}>
                                {todoistConnected ? 'Continue' : statusResolved ? 'Connect Todoist to continue' : 'Checking…'}
                            </Button>
                        </div>
                    </Card>
                )}

                {step === 'calendar' && (
                    <Card className="space-y-4">
                        <div className="space-y-1">
                            <h2 className="text-base font-medium text-text">Connect Google Calendar</h2>
                            <p className="text-sm text-text-light">
                                Strongly recommended: your meetings appear right where you shape the day's work
                                sessions, scheduled tasks can be time-blocked against them, and your sessions sync
                                back to a dedicated "Orchestrate" calendar.
                            </p>
                        </div>
                        <GoogleConnectCard
                            returnTo="home"
                            description="Sign in with Google to bring your calendar in. The connection is held securely on the server and persists across devices."
                        />
                        <div className="flex items-center justify-between pt-1">
                            <button
                                onClick={() => setStep('todoist')}
                                className="text-xs text-text-light hover:text-accent cursor-pointer"
                            >
                                ← Back
                            </button>
                            {calendarConnected ? (
                                <Button onClick={finish}>Finish setup</Button>
                            ) : (
                                <button
                                    onClick={finish}
                                    className="text-xs text-text-light hover:text-accent cursor-pointer py-2"
                                >
                                    Skip for now — you can connect later in Settings
                                </button>
                            )}
                        </div>
                    </Card>
                )}
            </div>
        </div>
    );
}
