import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WizardLayout } from './WizardLayout';
import { SessionEditorTimeline } from '../ui/SessionEditorTimeline';
import { ConfirmModal } from '../ui/ConfirmModal';
import { useConfirmModal } from '../../hooks/useConfirmModal';
import { useDayPlan } from '../../hooks/useDayPlan';
import { useDayCalendarEvents } from '../../hooks/useDayCalendarEvents';
import { useGoogleCalendarData } from '../../hooks/useGoogleCalendar';
import { useTodaysHabitsSync } from '../../hooks/useTodaysHabitsSync';
import { isSessionLocked } from '../../lib/sessionCalendar';
import { habitKindOf } from '../../lib/habits';
import { SeasonFocusBanner } from '../life/SeasonFocusBanner';
import type { SessionSlot, SessionTemplate } from '../../types';

export function Step1Sessions() {
    const { plan, life, settings, dispatch } = useDayPlan();
    const navigate = useNavigate();
    // v7.9: Sessions is now step 1, so the day's recurring context (season + habits) is surfaced
    // here for scoping. Keep today's habit instances in sync as the source for the banner.
    useTodaysHabitsSync();
    const { events: externalEvents } = useDayCalendarEvents(plan.date);
    const { isConnected: gcalConnected } = useGoogleCalendarData();
    const templates = life.sessionTemplates ?? [];
    const hasAssignments = Object.values(plan.taskSessions).some((ids) => ids.length > 0);
    const confirmApply = useConfirmModal<SessionTemplate>();
    const [saving, setSaving] = useState(false);
    const [templateName, setTemplateName] = useState('');
    const lockedSessionIds = useMemo(
        () => new Set(plan.sessionSlots.filter((s) => isSessionLocked(s, plan.sessionStarts)).map((s) => s.id)),
        [plan.sessionSlots, plan.sessionStarts],
    );
    // v6.7: timeline-habit instances (exclude micro-gaps / skipped) shown in the context banner.
    const todaysHabitInstances = useMemo(
        () => plan.todaysHabits.filter((i) => i.status !== 'skipped' && habitKindOf(life, i) === 'habit'),
        [plan.todaysHabits, life],
    );

    const handleNext = () => {
        dispatch({ type: 'SET_WIZARD_STEP', step: 2 });
    };

    const applyTemplate = (tpl: SessionTemplate) => {
        if (hasAssignments) confirmApply.open(tpl);
        else dispatch({ type: 'APPLY_SESSION_TEMPLATE', templateId: tpl.id });
    };

    const saveAsTemplate = () => {
        const name = templateName.trim();
        if (!name || plan.sessionSlots.length === 0) return;
        // Persist a copy of today's slots; APPLY_SESSION_TEMPLATE stamps fresh ids when used.
        const slots: SessionSlot[] = plan.sessionSlots.map((s) => ({ ...s }));
        dispatch({ type: 'ADD_SESSION_TEMPLATE', template: { name, slots } });
        setTemplateName('');
        setSaving(false);
    };

    return (
        <WizardLayout wide onNext={handleNext}>
            <div className="space-y-5 mt-4">
                {/* Today's context — season arc + recurring habits up top, framing the day before
                    you shape it. */}
                <SeasonFocusBanner todaysHabits={todaysHabitInstances} />

                <div>
                    <h2 className="text-2xl font-semibold mb-2">Let's shape your day</h2>
                    <p className="text-text-light text-sm">
                        Start by blocking out today's work sessions — the rhythm everything else
                        follows. Drag on an empty area to add a block, drag a block to move it, drag
                        its edges to resize, and click a block to rename or delete it.
                    </p>
                </div>

                {/* Calendar nudge — this is the surface where the connection pays off (meetings
                    render right above the session track), so encourage it here until connected. */}
                {!gcalConnected && !settings.calendarNudgeDismissed && (
                    <div className="rounded-lg border border-accent/30 bg-accent-subtle/20 px-4 py-3 flex items-start gap-3">
                        <span className="text-lg leading-none mt-0.5">📅</span>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm text-text">
                                <strong>Connect Google Calendar</strong> to see today's meetings right here while
                                you shape your sessions.
                            </p>
                            <div className="flex gap-3 mt-1.5 text-xs">
                                <button
                                    onClick={() => navigate('/settings?tab=integrations')}
                                    className="text-accent hover:underline cursor-pointer font-medium"
                                >
                                    Connect →
                                </button>
                                <button
                                    onClick={() => dispatch({ type: 'UPDATE_SETTINGS', settings: { calendarNudgeDismissed: true } })}
                                    className="text-text-light hover:text-accent cursor-pointer"
                                >
                                    Don't show again
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Quick-apply templates */}
                {templates.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] uppercase tracking-wider text-text-light mr-1">
                            Templates
                        </span>
                        {templates.map((tpl) => (
                            <button
                                key={tpl.id}
                                type="button"
                                onClick={() => applyTemplate(tpl)}
                                className="px-2.5 py-1 text-xs rounded-full border border-border bg-card text-text-light hover:text-accent hover:border-accent transition-colors cursor-pointer"
                                title={`Apply "${tpl.name}" (${tpl.slots.length} session${tpl.slots.length === 1 ? '' : 's'})`}
                            >
                                {tpl.name}
                                <span className="ml-1 text-text-light/60 tabular-nums">{tpl.slots.length}</span>
                            </button>
                        ))}
                    </div>
                )}

                <SessionEditorTimeline
                    slots={plan.sessionSlots}
                    onAdd={(session) => dispatch({ type: 'ADD_DAY_SESSION', session })}
                    onUpdate={(session) => dispatch({ type: 'UPDATE_DAY_SESSION', session })}
                    onRemove={(sessionId) => dispatch({ type: 'REMOVE_DAY_SESSION', sessionId })}
                    timelineStartMinutes={settings.timelineStartMinutes}
                    timelineEndMinutes={settings.timelineEndMinutes}
                    blocklistOptions={settings.blocklists ?? []}
                    lockedSessionIds={lockedSessionIds}
                    externalEvents={gcalConnected ? externalEvents : undefined}
                    dateISO={plan.date}
                />

                {plan.sessionSlots.length === 0 && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                        No sessions yet — you can still continue, but you'll have nowhere to place
                        tasks in the next step.
                    </p>
                )}

                {/* Save current layout as a reusable template */}
                <div className="flex items-center gap-2 pt-1">
                    {saving ? (
                        <>
                            <input
                                autoFocus
                                value={templateName}
                                onChange={(e) => setTemplateName(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') saveAsTemplate(); }}
                                placeholder="Template name"
                                className="rounded-md border border-border bg-card px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
                            />
                            <button
                                type="button"
                                onClick={saveAsTemplate}
                                disabled={!templateName.trim() || plan.sessionSlots.length === 0}
                                className="text-xs px-2.5 py-1 rounded-md bg-accent text-white hover:bg-accent/90 disabled:opacity-50 cursor-pointer"
                            >
                                Save
                            </button>
                            <button
                                type="button"
                                onClick={() => { setSaving(false); setTemplateName(''); }}
                                className="text-xs px-2.5 py-1 rounded-md border border-border text-text-light hover:border-accent cursor-pointer"
                            >
                                Cancel
                            </button>
                        </>
                    ) : (
                        <button
                            type="button"
                            onClick={() => setSaving(true)}
                            disabled={plan.sessionSlots.length === 0}
                            className="text-xs text-text-light hover:text-accent disabled:opacity-50 cursor-pointer"
                        >
                            + Save as template
                        </button>
                    )}
                </div>
            </div>

            <ConfirmModal
                open={confirmApply.value !== null}
                onClose={confirmApply.close}
                onConfirm={() => {
                    if (confirmApply.value) {
                        dispatch({ type: 'APPLY_SESSION_TEMPLATE', templateId: confirmApply.value.id });
                    }
                }}
                title="Apply template?"
                confirmLabel="Apply"
            >
                <p className="text-sm text-text-light mb-4">
                    Applying “{confirmApply.value?.name}” replaces today's sessions and clears the
                    task assignments you've already made. Continue?
                </p>
            </ConfirmModal>
        </WizardLayout>
    );
}
