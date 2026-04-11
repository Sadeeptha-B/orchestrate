import { WizardLayout } from './WizardLayout';
import { Card } from '../ui/Card';
import { useDayPlan } from '../../context/DayPlanContext';
import { useCurrentSession } from '../../hooks/useCurrentSession';

export function Step5ScheduleBackground() {
    const { plan, settings, dispatch } = useDayPlan();
    const { remainingSessions } = useCurrentSession(settings.sessionSlots);

    const backgroundIntentions = plan.intentions.filter((i) => i.type === 'background');

    const handleNext = () => {
        dispatch({ type: 'SET_WIZARD_STEP', step: 6 });
    };

    return (
        <WizardLayout onNext={handleNext}>
            <div className="space-y-6 mt-4">
                <div>
                    <h2 className="text-2xl font-semibold mb-2">Schedule nudges &amp; habits</h2>
                    <p className="text-text-light text-sm">
                        Background intentions appear as gentle nudges during your sessions. You can assign
                        each one to <strong>multiple sessions</strong> — they'll remind you throughout the day.
                    </p>
                </div>

                {/* Background intentions overview */}
                {backgroundIntentions.length > 0 && (
                    <div>
                        <h3 className="text-sm font-medium text-text-light mb-2">Your nudges</h3>
                        <div className="flex flex-wrap gap-2">
                            {backgroundIntentions.map((intention) => (
                                <span
                                    key={intention.id}
                                    className="px-3 py-1.5 text-xs rounded-full bg-surface-dark text-text-light border border-border"
                                >
                                    {intention.isHabit && '🔄 '}{intention.title}
                                    {intention.assignedSessions.length > 0 && (
                                        <span className="ml-1 text-accent">
                                            ({intention.assignedSessions.length} session{intention.assignedSessions.length !== 1 ? 's' : ''})
                                        </span>
                                    )}
                                </span>
                            ))}
                        </div>
                    </div>
                )}

                <div className="space-y-4">
                    {remainingSessions.map((session) => {
                        const assignedIds = plan.intentionSessions[session.id] ?? [];
                        const mainInSession = plan.intentions.filter(
                            (i) => i.type === 'main' && assignedIds.includes(i.id),
                        );
                        const bgInSession = backgroundIntentions.filter((i) => assignedIds.includes(i.id));
                        const notInThisSession = backgroundIntentions.filter(
                            (i) => !assignedIds.includes(i.id),
                        );

                        return (
                            <Card key={session.id}>
                                <div className="flex items-center justify-between mb-3">
                                    <h3 className="font-medium text-sm">{session.name}</h3>
                                    <span className="text-xs text-text-light">
                                        {session.startTime} – {session.endTime}
                                    </span>
                                </div>

                                {/* Main intentions (read-only context) */}
                                {mainInSession.length > 0 && (
                                    <div className="flex flex-wrap gap-2 mb-2">
                                        {mainInSession.map((intention) => (
                                            <span
                                                key={intention.id}
                                                className="px-3 py-1.5 text-xs rounded-full bg-accent/10 text-accent"
                                            >
                                                {intention.title}
                                            </span>
                                        ))}
                                    </div>
                                )}

                                {/* Assigned background intentions */}
                                {bgInSession.length > 0 && (
                                    <div className="flex flex-wrap gap-2 mb-3">
                                        {bgInSession.map((intention) => (
                                            <button
                                                key={intention.id}
                                                onClick={() =>
                                                    dispatch({
                                                        type: 'UNASSIGN_INTENTION',
                                                        intentionId: intention.id,
                                                        sessionId: session.id,
                                                    })
                                                }
                                                className="px-3 py-1.5 text-xs rounded-full bg-text-light text-white cursor-pointer hover:bg-muted/80 transition-colors"
                                                title="Click to remove from this session"
                                            >
                                                {intention.isHabit && '🔄 '}{intention.title} ×
                                            </button>
                                        ))}
                                    </div>
                                )}

                                {/* Assign buttons — show all not-yet-in-this-session */}
                                {notInThisSession.length > 0 && (
                                    <div className="flex flex-wrap gap-2">
                                        {notInThisSession.map((intention) => (
                                            <button
                                                key={intention.id}
                                                onClick={() =>
                                                    dispatch({
                                                        type: 'ASSIGN_INTENTION',
                                                        intentionId: intention.id,
                                                        sessionId: session.id,
                                                    })
                                                }
                                                className="px-3 py-1.5 text-xs rounded-full border border-dashed border-border text-text-light hover:border-accent hover:text-accent cursor-pointer transition-colors"
                                            >
                                                + {intention.isHabit && '🔄 '}{intention.title}
                                            </button>
                                        ))}
                                    </div>
                                )}

                                {mainInSession.length === 0 &&
                                    bgInSession.length === 0 &&
                                    notInThisSession.length === 0 && (
                                        <p className="text-xs text-text-light">Empty session</p>
                                    )}
                            </Card>
                        );
                    })}
                </div>

                {remainingSessions.length === 0 && (
                    <p className="text-sm text-text-light">
                        No sessions remaining today. You can still continue.
                    </p>
                )}
            </div>
        </WizardLayout>
    );
}
