import { useDayPlan } from '../../hooks/useDayPlan';
import { inputClass, labelClass } from '../ui/formStyles';
import { DEFAULT_SESSION_BUFFER_MINUTES, DEFAULT_TASK_CAPS } from '../../lib/capacity';
import { DEFAULT_TIMELINE_START_MINUTES, DEFAULT_TIMELINE_END_MINUTES } from '../../lib/timeline';
import { DEFAULT_RECONTEXT_CADENCE_MINUTES, DEFAULT_ENGAGEMENT_NUDGE_MINUTES } from '../../lib/reminders';

/** minutes (e.g. 270, or 1440 for midnight) → "HH:MM" for <input type="time"> */
function minutesToTimeInput(minutes: number): string {
    const m = minutes % (24 * 60); // 1440 → 0 (midnight shows as "00:00")
    const h = Math.floor(m / 60);
    const min = m % 60;
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** "HH:MM" → minutes; end-time "00:00" is treated as midnight (1440). */
function timeInputToMinutes(value: string, isEnd: boolean): number {
    const [h, m] = value.split(':').map(Number);
    const total = h * 60 + m;
    return isEnd && total === 0 ? 24 * 60 : total;
}

function SectionHeading({ children }: { children: React.ReactNode }) {
    return (
        <h3 className="text-xs font-semibold text-text-light uppercase tracking-wider mb-3">
            {children}
        </h3>
    );
}

export function ConfigurationSettings() {
    const { settings, dispatch } = useDayPlan();
    const caps = settings.taskCapDefaults ?? DEFAULT_TASK_CAPS;
    const buffer = settings.sessionBufferMinutes ?? DEFAULT_SESSION_BUFFER_MINUTES;
    const tlStart = settings.timelineStartMinutes ?? DEFAULT_TIMELINE_START_MINUTES;
    const tlEnd = settings.timelineEndMinutes ?? DEFAULT_TIMELINE_END_MINUTES;
    const cadence = settings.recontextualizationCadenceMinutes ?? DEFAULT_RECONTEXT_CADENCE_MINUTES;
    const engagementNudge = settings.engagementNudgeMinutes ?? DEFAULT_ENGAGEMENT_NUDGE_MINUTES;

    const updateBuffer = (raw: string) => {
        const n = Math.max(0, Math.round(Number(raw) || 0));
        dispatch({ type: 'UPDATE_SETTINGS', settings: { sessionBufferMinutes: n } });
    };

    const updateCap = (key: 'habit' | 'microGap' | 'manualBackground', raw: string) => {
        const n = Math.max(1, Math.round(Number(raw) || 1));
        dispatch({ type: 'UPDATE_SETTINGS', settings: { taskCapDefaults: { ...caps, [key]: n } } });
    };

    const updateTimelineStart = (value: string) => {
        dispatch({ type: 'UPDATE_SETTINGS', settings: { timelineStartMinutes: timeInputToMinutes(value, false) } });
    };

    const updateTimelineEnd = (value: string) => {
        dispatch({ type: 'UPDATE_SETTINGS', settings: { timelineEndMinutes: timeInputToMinutes(value, true) } });
    };

    const updateCadence = (raw: string) => {
        const n = Math.max(0, Math.round(Number(raw) || 0));
        dispatch({ type: 'UPDATE_SETTINGS', settings: { recontextualizationCadenceMinutes: n } });
    };

    const updateEngagementNudge = (raw: string) => {
        const n = Math.max(0, Math.round(Number(raw) || 0));
        dispatch({ type: 'UPDATE_SETTINGS', settings: { engagementNudgeMinutes: n } });
    };

    return (
        <div className="space-y-8">
            {/* ── Reminders ─────────────────────────────────────────────── */}
            <section>
                <SectionHeading>Reminders</SectionHeading>
                <div className="space-y-4">
                    <div>
                        <label className={labelClass}>Recontextualization cadence (minutes)</label>
                        <input
                            type="number"
                            min={0}
                            className={inputClass}
                            value={cadence}
                            onChange={(e) => updateCadence(e.target.value)}
                        />
                        <p className="text-[11px] text-text-light mt-1">
                            How often, while you're inside a session, Orchestrate prompts you to check in and
                            recontextualize. Fires on the cadence boundary (e.g. 30 → on the hour and half-hour).
                            Set to <code>0</code> to turn the check-in off.
                        </p>
                    </div>

                    <div>
                        <label className={labelClass}>Engagement reminder (minutes idle)</label>
                        <input
                            type="number"
                            min={0}
                            className={inputClass}
                            value={engagementNudge}
                            onChange={(e) => updateEngagementNudge(e.target.value)}
                        />
                        <p className="text-[11px] text-text-light mt-1">
                            How long you can sit in an active session without engaging anything before Orchestrate
                            nudges you. A notification fires at the threshold, then a banner stays on the dashboard
                            until you re-engage (re-nudging every 30 min). Set to <code>0</code> to turn it off.
                        </p>
                    </div>
                </div>
            </section>

            {/* ── Capacity ──────────────────────────────────────────────── */}
            <section>
                <SectionHeading>Capacity</SectionHeading>
                <div className="space-y-4">
                    <div>
                        <label className={labelClass}>Session buffer (minutes)</label>
                        <input
                            type="number"
                            min={0}
                            className={inputClass}
                            value={buffer}
                            onChange={(e) => updateBuffer(e.target.value)}
                        />
                        <p className="text-[11px] text-text-light mt-1">
                            Subtracted from each session's wall-clock length when computing capacity.
                            Acts as a buffer for transitions, slip, and breaks.
                        </p>
                    </div>

                    <div>
                        <label className={labelClass}>Per-task duration caps</label>
                        <div className="grid grid-cols-3 gap-3">
                            <div>
                                <span className="text-[11px] text-text-light block mb-1">Habit</span>
                                <input
                                    type="number"
                                    min={1}
                                    className={inputClass}
                                    value={caps.habit}
                                    onChange={(e) => updateCap('habit', e.target.value)}
                                />
                            </div>
                            <div>
                                <span className="text-[11px] text-text-light block mb-1">Micro-gap</span>
                                <input
                                    type="number"
                                    min={1}
                                    className={inputClass}
                                    value={caps.microGap}
                                    onChange={(e) => updateCap('microGap', e.target.value)}
                                />
                            </div>
                            <div>
                                <span className="text-[11px] text-text-light block mb-1">Manual background</span>
                                <input
                                    type="number"
                                    min={1}
                                    className={inputClass}
                                    value={caps.manualBackground}
                                    onChange={(e) => updateCap('manualBackground', e.target.value)}
                                />
                            </div>
                        </div>
                        <p className="text-[11px] text-text-light mt-1">
                            Caps applied in Step 2 to manually-categorized background tasks. Habit
                            instances use the per-habit <code>targetDurationMinutes</code> instead.
                        </p>
                    </div>
                </div>
            </section>

            {/* ── Timeline ──────────────────────────────────────────────── */}
            <section>
                <SectionHeading>Timeline</SectionHeading>
                <div>
                    <label className={labelClass}>Timeline hours</label>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <span className="text-[11px] text-text-light block mb-1">Start</span>
                            <input
                                type="time"
                                className={inputClass}
                                value={minutesToTimeInput(tlStart)}
                                onChange={(e) => updateTimelineStart(e.target.value)}
                            />
                        </div>
                        <div>
                            <span className="text-[11px] text-text-light block mb-1">End</span>
                            <input
                                type="time"
                                className={inputClass}
                                value={minutesToTimeInput(tlEnd)}
                                onChange={(e) => updateTimelineEnd(e.target.value)}
                            />
                        </div>
                    </div>
                    <p className="text-[11px] text-text-light mt-1">
                        Left and right edges of the day timeline. Set end to 12:00 AM (00:00) for midnight.
                    </p>
                </div>
            </section>
        </div>
    );
}
