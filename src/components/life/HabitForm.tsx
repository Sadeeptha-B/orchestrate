import { useState } from 'react';
import { Button } from '../ui/Button';
import type { Habit, HabitRecurrence, HabitRecurrenceKind, Season } from '../../types';

export type HabitDraft = Omit<Habit, 'id' | 'createdAt'>;

interface HabitFormProps {
    initial?: Partial<HabitDraft>;
    seasons: Season[];
    submitLabel?: string;
    onSubmit: (draft: HabitDraft) => void;
    onCancel?: () => void;
}

const inputClass =
    'w-full px-3 py-2 text-sm rounded-lg border border-border bg-card text-text focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-colors';

const labelClass = 'block text-xs font-medium text-text-light mb-1';

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function HabitForm({
    initial,
    seasons,
    submitLabel = 'Save Habit',
    onSubmit,
    onCancel,
}: HabitFormProps) {
    const [name, setName] = useState(initial?.name ?? '');
    const [recurrenceKind, setRecurrenceKind] = useState<HabitRecurrenceKind>(
        initial?.recurrence?.kind ?? 'daily',
    );
    const [daysOfWeek, setDaysOfWeek] = useState<number[]>(
        initial?.recurrence?.daysOfWeek ?? [],
    );
    const [minimumViable, setMinimumViable] = useState(initial?.minimumViable ?? '');
    const [triggerCue, setTriggerCue] = useState(initial?.triggerCue ?? '');
    const [completionRule, setCompletionRule] = useState<Habit['completionRule']>(
        initial?.completionRule ?? 'binary',
    );
    const [failureTolerance, setFailureTolerance] = useState<string>(
        String(initial?.failureTolerance ?? 1),
    );
    const [isAnchor, setIsAnchor] = useState(initial?.isAnchor ?? false);
    const [active, setActive] = useState(initial?.active ?? true);
    const [seasonIds, setSeasonIds] = useState<string[]>(initial?.seasonIds ?? []);
    const [autoLinkTodoistId, setAutoLinkTodoistId] = useState(initial?.autoLinkTodoistId ?? '');

    const toggleDay = (d: number) =>
        setDaysOfWeek((prev) =>
            prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort(),
        );

    const toggleSeason = (id: string) =>
        setSeasonIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

    const showDayPicker = recurrenceKind === 'weekly' || recurrenceKind === 'custom';
    const canSubmit = name.trim().length > 0;

    const handleSubmit = () => {
        if (!canSubmit) return;
        const recurrence: HabitRecurrence = {
            kind: recurrenceKind,
            ...(showDayPicker ? { daysOfWeek } : {}),
        };
        onSubmit({
            name: name.trim(),
            recurrence,
            minimumViable: minimumViable.trim(),
            triggerCue: triggerCue.trim(),
            completionRule,
            failureTolerance: Math.max(0, Number(failureTolerance) || 0),
            isAnchor,
            seasonIds,
            active,
            ...(autoLinkTodoistId.trim()
                ? { autoLinkTodoistId: autoLinkTodoistId.trim() }
                : {}),
        });
    };

    return (
        <div className="space-y-4">
            <div>
                <label className={labelClass}>Habit name</label>
                <input
                    className={inputClass}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Morning meditation, Gym, Evening shutdown"
                />
            </div>

            <div>
                <label className={labelClass}>Recurrence</label>
                <div className="flex gap-1 flex-wrap">
                    {(['daily', 'weekdays', 'weekly', 'custom'] as HabitRecurrenceKind[]).map((k) => (
                        <button
                            key={k}
                            type="button"
                            onClick={() => setRecurrenceKind(k)}
                            className={`px-3 py-1.5 text-xs rounded-lg border transition-colors cursor-pointer ${
                                recurrenceKind === k
                                    ? 'bg-accent-subtle border-accent/30 text-accent'
                                    : 'border-border hover:bg-surface-dark/50'
                            }`}
                        >
                            {k}
                        </button>
                    ))}
                </div>
                {showDayPicker && (
                    <div className="flex gap-1 mt-2">
                        {DAY_LABELS.map((label, idx) => (
                            <button
                                key={idx}
                                type="button"
                                onClick={() => toggleDay(idx)}
                                className={`w-8 h-8 text-xs rounded-md border transition-colors cursor-pointer ${
                                    daysOfWeek.includes(idx)
                                        ? 'bg-accent text-white border-accent'
                                        : 'border-border hover:bg-surface-dark/50'
                                }`}
                                aria-label={`Day ${idx}`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            <div>
                <label className={labelClass}>Minimum viable version</label>
                <input
                    className={inputClass}
                    value={minimumViable}
                    onChange={(e) => setMinimumViable(e.target.value)}
                    placeholder="e.g. 5 min sit, no app required"
                />
            </div>

            <div>
                <label className={labelClass}>Trigger cue</label>
                <input
                    className={inputClass}
                    value={triggerCue}
                    onChange={(e) => setTriggerCue(e.target.value)}
                    placeholder="e.g. After waking, before phone"
                />
            </div>

            <div className="grid grid-cols-2 gap-3">
                <div>
                    <label className={labelClass}>Completion rule</label>
                    <select
                        className={inputClass}
                        value={completionRule}
                        onChange={(e) =>
                            setCompletionRule(e.target.value as Habit['completionRule'])
                        }
                    >
                        <option value="binary">Binary (done / not done)</option>
                        <option value="count">Count</option>
                        <option value="duration">Duration</option>
                    </select>
                </div>
                <div>
                    <label className={labelClass}>Failure tolerance / week</label>
                    <input
                        type="number"
                        min={0}
                        className={inputClass}
                        value={failureTolerance}
                        onChange={(e) => setFailureTolerance(e.target.value)}
                    />
                </div>
            </div>

            {seasons.length > 0 && (
                <div>
                    <label className={labelClass}>Linked seasons (none = always-on)</label>
                    <div className="flex gap-1 flex-wrap">
                        {seasons.map((s) => (
                            <button
                                key={s.id}
                                type="button"
                                onClick={() => toggleSeason(s.id)}
                                className={`px-2 py-1 text-xs rounded-md border transition-colors cursor-pointer ${
                                    seasonIds.includes(s.id)
                                        ? 'bg-accent-subtle border-accent/30 text-accent'
                                        : 'border-border hover:bg-surface-dark/50'
                                }`}
                            >
                                {s.name}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <div>
                <label className={labelClass}>Auto-link Todoist task ID (optional)</label>
                <input
                    className={inputClass}
                    value={autoLinkTodoistId}
                    onChange={(e) => setAutoLinkTodoistId(e.target.value)}
                    placeholder="Leave blank to map manually each day"
                />
                <p className="text-[11px] text-text-light mt-1">
                    Set this to make Step 1 auto-pre-select the same Todoist task each day this
                    habit appears.
                </p>
            </div>

            <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm">
                    <input
                        type="checkbox"
                        checked={isAnchor}
                        onChange={(e) => setIsAnchor(e.target.checked)}
                    />
                    <span>
                        Anchor habit{' '}
                        <span className="text-text-light text-xs">
                            (sleep / meditation / gym / shutdown / review — gets extra protection)
                        </span>
                    </span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                    <input
                        type="checkbox"
                        checked={active}
                        onChange={(e) => setActive(e.target.checked)}
                    />
                    <span>
                        Active{' '}
                        <span className="text-text-light text-xs">
                            (inactive habits are hidden until re-enabled)
                        </span>
                    </span>
                </label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
                {onCancel && (
                    <Button variant="ghost" size="sm" onClick={onCancel}>
                        Cancel
                    </Button>
                )}
                <Button size="sm" disabled={!canSubmit} onClick={handleSubmit}>
                    {submitLabel}
                </Button>
            </div>
        </div>
    );
}
