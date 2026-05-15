import { useDayPlan } from '../../hooks/useDayPlan';
import { inputClass, labelClass } from '../ui/formStyles';
import { DEFAULT_SESSION_BUFFER_MINUTES, DEFAULT_TASK_CAPS } from '../../lib/capacity';

/**
 * v6: Session buffer + per-kind task-cap defaults. All advisory — values control
 * the soft caps in Step 2 and the capacity arithmetic surfaced on the timeline.
 */
export function CapacitySettings() {
    const { settings, dispatch } = useDayPlan();
    const caps = settings.taskCapDefaults ?? DEFAULT_TASK_CAPS;
    const buffer = settings.sessionBufferMinutes ?? DEFAULT_SESSION_BUFFER_MINUTES;

    const updateBuffer = (raw: string) => {
        const n = Math.max(0, Math.round(Number(raw) || 0));
        dispatch({ type: 'UPDATE_SETTINGS', settings: { sessionBufferMinutes: n } });
    };

    const updateCap = (key: 'stabilizer' | 'lightCoherent' | 'manualBackground', raw: string) => {
        const n = Math.max(1, Math.round(Number(raw) || 1));
        dispatch({ type: 'UPDATE_SETTINGS', settings: { taskCapDefaults: { ...caps, [key]: n } } });
    };

    return (
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
                        <span className="text-[11px] text-text-light block mb-1">Stabilizer</span>
                        <input
                            type="number"
                            min={1}
                            className={inputClass}
                            value={caps.stabilizer}
                            onChange={(e) => updateCap('stabilizer', e.target.value)}
                        />
                    </div>
                    <div>
                        <span className="text-[11px] text-text-light block mb-1">Light-coherent</span>
                        <input
                            type="number"
                            min={1}
                            className={inputClass}
                            value={caps.lightCoherent}
                            onChange={(e) => updateCap('lightCoherent', e.target.value)}
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
                    Caps applied in Step 2. Habit-derived tasks may override with a per-habit
                    maxBlockMinutes set on the habit itself.
                </p>
            </div>
        </div>
    );
}
