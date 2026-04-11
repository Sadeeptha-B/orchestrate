import { WizardLayout } from './WizardLayout';
import { Card } from '../ui/Card';
import { useDayPlan } from '../../context/DayPlanContext';
import { useCurrentSession } from '../../hooks/useCurrentSession';

const TREVOR_URL = 'https://app.trevorai.com/app/';

export function Step4ScheduleMain() {
    const { plan, settings, dispatch } = useDayPlan();
    const { remainingSessions } = useCurrentSession(settings.sessionSlots);

    const mainIntentions = plan.intentions.filter((i) => i.type === 'main');

    const handleNext = () => {
        dispatch({ type: 'SET_WIZARD_STEP', step: 5 });
    };

    return (
        <WizardLayout onNext={handleNext} wide>
            <div className="flex flex-col lg:flex-row gap-6 mt-4" style={{ minHeight: '60vh' }}>
                {/* Left panel: session scheduling */}
                <div className="lg:w-1/2 flex-shrink-0 space-y-5 overflow-y-auto">
                    <div>
                        <h2 className="text-2xl font-semibold mb-2">Schedule main intentions</h2>
                        <p className="text-text-light text-sm">
                            Assign your main intentions to sessions. Use the task manager on the right
                            to schedule the broken-down tasks into specific time slots.
                        </p>
                    </div>

                    {/* Unassigned main intentions */}
                    {mainIntentions.filter((i) => i.assignedSessions.length === 0).length > 0 && (
                        <div>
                            <h3 className="text-sm font-medium text-text-light mb-2">Unassigned</h3>
                            <div className="flex flex-wrap gap-2">
                                {mainIntentions
                                    .filter((i) => i.assignedSessions.length === 0)
                                    .map((intention) => (
                                        <span
                                            key={intention.id}
                                            className="px-3 py-1.5 text-xs rounded-full bg-accent-subtle text-accent border border-accent/20"
                                        >
                                            {intention.title}
                                        </span>
                                    ))}
                            </div>
                        </div>
                    )}

                    {/* Session slots */}
                    <div className="space-y-4">
                        {remainingSessions.map((session) => {
                            const assignedIds = plan.intentionSessions[session.id] ?? [];
                            const assigned = mainIntentions.filter((i) => assignedIds.includes(i.id));
                            const unassigned = mainIntentions.filter((i) => i.assignedSessions.length === 0);

                            return (
                                <Card key={session.id}>
                                    <div className="flex items-center justify-between mb-3">
                                        <h3 className="font-medium text-sm">{session.name}</h3>
                                        <span className="text-xs text-text-light">
                                            {session.startTime} – {session.endTime}
                                        </span>
                                    </div>

                                    {assigned.length > 0 && (
                                        <div className="flex flex-wrap gap-2 mb-3">
                                            {assigned.map((intention) => (
                                                <button
                                                    key={intention.id}
                                                    onClick={() =>
                                                        dispatch({
                                                            type: 'UNASSIGN_INTENTION',
                                                            intentionId: intention.id,
                                                            sessionId: session.id,
                                                        })
                                                    }
                                                    className="px-3 py-1.5 text-xs rounded-full bg-accent text-white cursor-pointer hover:bg-accent/80 transition-colors"
                                                    title="Click to unassign"
                                                >
                                                    {intention.title} ×
                                                </button>
                                            ))}
                                        </div>
                                    )}

                                    {unassigned.length > 0 && (
                                        <div className="flex flex-wrap gap-2">
                                            {unassigned.map((intention) => (
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
                                                    + {intention.title}
                                                </button>
                                            ))}
                                        </div>
                                    )}

                                    {assigned.length === 0 && unassigned.length === 0 && (
                                        <p className="text-xs text-text-light">No main intentions to assign</p>
                                    )}
                                </Card>
                            );
                        })}
                    </div>

                    {remainingSessions.length === 0 && (
                        <p className="text-sm text-text-light">
                            No sessions remaining today. You can still continue to the next step.
                        </p>
                    )}
                </div>

                {/* Right panel: Trevor AI iframe */}
                <div className="flex-1 min-w-0 flex flex-col">
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="text-sm font-medium text-text-light">Schedule tasks in calendar</h3>
                        <a
                            href={TREVOR_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-accent hover:underline"
                        >
                            Open in new tab ↗
                        </a>
                    </div>
                    <div className="flex-1 rounded-lg border border-border overflow-hidden bg-white" style={{ minHeight: 500 }}>
                        <iframe
                            src={TREVOR_URL}
                            title="Trevor AI — Calendar Scheduling"
                            className="w-full h-full border-0"
                            style={{ minHeight: 500 }}
                            sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
                        />
                    </div>
                </div>
            </div>
        </WizardLayout>
    );
}
