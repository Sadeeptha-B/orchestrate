import { useState } from 'react';
import { Button } from '../ui/Button';
import { inputClass, labelClass } from '../ui/formStyles';
import type { TodoistProject } from '../../hooks/useTodoist';
import type {
    Habit,
    HabitKind,
    HabitRecurrence,
    HabitRecurrenceKind,
    HabitWindowBehavior,
    Season,
} from '../../types';

export type HabitDraft = Omit<Habit, 'id' | 'createdAt'>;

interface HabitFormProps {
    initial?: Partial<HabitDraft>;
    seasons: Season[];
    /** v6.1: Todoist projects for the per-habit project picker. Empty when Todoist isn't configured. */
    todoistProjects?: TodoistProject[];
    /** v6.1: name of the workspace default project, shown next to the "Use default" option. */
    defaultProjectName?: string;
    /** Optional: trigger a refresh of the Todoist project list. When provided, renders a refresh affordance. */
    onRefreshProjects?: () => void;
    /** True while a project-list refresh is in flight; disables the refresh affordance and shows a label. */
    refreshingProjects?: boolean;
    submitLabel?: string;
    onSubmit: (draft: HabitDraft) => void;
    onCancel?: () => void;
}

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function HabitForm({
    initial,
    seasons,
    todoistProjects = [],
    defaultProjectName,
    onRefreshProjects,
    refreshingProjects,
    submitLabel = 'Save Habit',
    onSubmit,
    onCancel,
}: HabitFormProps) {
    const [name, setName] = useState(initial?.name ?? '');
    const [kind, setKind] = useState<HabitKind>(initial?.kind ?? 'stabilizer');
    const [recurrenceKind, setRecurrenceKind] = useState<HabitRecurrenceKind>(
        initial?.recurrence?.kind ?? 'daily',
    );
    const [daysOfWeek, setDaysOfWeek] = useState<number[]>(
        initial?.recurrence?.daysOfWeek ?? [],
    );
    const [targetTime, setTargetTime] = useState<string>(initial?.targetTime ?? '');
    const [targetDurationMinutes, setTargetDurationMinutes] = useState<string>(
        initial?.targetDurationMinutes !== undefined
            ? String(initial.targetDurationMinutes)
            : initial?.maxBlockMinutes !== undefined
                ? String(initial.maxBlockMinutes)
                : '',
    );
    const [windowBehavior, setWindowBehavior] = useState<HabitWindowBehavior>(
        initial?.windowBehavior ?? 'lenient',
    );
    const [todoistProjectId, setTodoistProjectId] = useState<string>(initial?.todoistProjectId ?? '');
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

    const toggleDay = (d: number) =>
        setDaysOfWeek((prev) =>
            prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort(),
        );

    const toggleSeason = (id: string) =>
        setSeasonIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

    const showDayPicker = recurrenceKind === 'weekly' || recurrenceKind === 'custom';
    const isStabilizer = kind === 'stabilizer';
    const canSubmit = name.trim().length > 0;

    // v6.1: detect a stale per-habit override — the project this habit previously pointed at
    // no longer exists in Todoist (deleted out-of-band). We only flag once a project list is loaded.
    const overrideIsStale = Boolean(
        todoistProjectId
            && todoistProjects.length > 0
            && !todoistProjects.some((p) => p.id === todoistProjectId),
    );

    const handleSubmit = () => {
        if (!canSubmit) return;
        const recurrence: HabitRecurrence = {
            kind: recurrenceKind,
            ...(showDayPicker ? { daysOfWeek } : {}),
        };
        const parsedDuration = Number(targetDurationMinutes);
        const trimmedTime = targetTime.trim();
        onSubmit({
            name: name.trim(),
            kind,
            recurrence,
            minimumViable: minimumViable.trim(),
            triggerCue: triggerCue.trim(),
            completionRule,
            failureTolerance: Math.max(0, Number(failureTolerance) || 0),
            isAnchor,
            seasonIds,
            active,
            // v6.1: schedule fields preserve `todoistTaskId` from initial (set by the sync layer).
            ...(initial?.todoistTaskId ? { todoistTaskId: initial.todoistTaskId } : {}),
            ...(isStabilizer && todoistProjectId ? { todoistProjectId } : {}),
            ...(isStabilizer && trimmedTime ? { targetTime: trimmedTime } : {}),
            ...(isStabilizer
                && targetDurationMinutes.trim()
                && Number.isFinite(parsedDuration)
                && parsedDuration > 0
                ? { targetDurationMinutes: Math.round(parsedDuration) }
                : {}),
            ...(isStabilizer ? { windowBehavior } : {}),
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
                <label className={labelClass}>Kind</label>
                <div className="flex gap-1 flex-wrap">
                    {(['stabilizer', 'light-coherent'] as HabitKind[]).map((k) => (
                        <button
                            key={k}
                            type="button"
                            onClick={() => setKind(k)}
                            className={`px-3 py-1.5 text-xs rounded-lg border transition-colors cursor-pointer ${
                                kind === k
                                    ? 'bg-accent-subtle border-accent/30 text-accent'
                                    : 'border-border hover:bg-surface-dark/50'
                            }`}
                        >
                            {k === 'stabilizer' ? 'Stabilizer' : 'Light-coherent'}
                        </button>
                    ))}
                </div>
                <p className="text-[11px] text-text-light mt-1">
                    {kind === 'stabilizer'
                        ? 'Anchor-style ritual — synced to Todoist as a recurring task. Surfaces directly as a session-assigned task each day it is due.'
                        : 'Micro-gap filler — surfaces in the Light Pool and is logged opportunistically. Never enters the day plan.'}
                </p>
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

            {isStabilizer && (
                <div className="rounded-lg border border-border p-3 space-y-3 bg-surface-dark/20">
                    <div className="text-xs font-medium text-text-light uppercase tracking-wide">Schedule</div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className={labelClass}>Target time (optional)</label>
                            <input
                                type="time"
                                className={inputClass}
                                value={targetTime}
                                onChange={(e) => setTargetTime(e.target.value)}
                            />
                            <p className="text-[11px] text-text-light mt-1">
                                Pushed to Todoist; drives session auto-assignment.
                            </p>
                        </div>
                        <div>
                            <label className={labelClass}>Duration (minutes)</label>
                            <input
                                type="number"
                                min={1}
                                className={inputClass}
                                value={targetDurationMinutes}
                                onChange={(e) => setTargetDurationMinutes(e.target.value)}
                                placeholder="e.g. 10"
                            />
                            <p className="text-[11px] text-text-light mt-1">
                                Used as the task estimate.
                            </p>
                        </div>
                    </div>
                    {todoistProjects.length > 0 && (
                        <div>
                            <div className="flex items-center justify-between">
                                <label className={labelClass}>Todoist project</label>
                                {onRefreshProjects && (
                                    <button
                                        type="button"
                                        onClick={onRefreshProjects}
                                        disabled={refreshingProjects}
                                        className="text-[11px] text-text-light hover:text-accent cursor-pointer disabled:opacity-50 disabled:cursor-default"
                                        title="Re-fetch your Todoist project list"
                                    >
                                        {refreshingProjects ? 'Refreshing…' : '↻ Refresh'}
                                    </button>
                                )}
                            </div>
                            {overrideIsStale && (
                                <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-1">
                                    ⚠ The previously-selected project no longer exists in Todoist.
                                    Saving will fall back to the workspace default.
                                </p>
                            )}
                            <select
                                className={inputClass}
                                value={overrideIsStale ? '' : todoistProjectId}
                                onChange={(e) => setTodoistProjectId(e.target.value)}
                            >
                                <option value="">
                                    Use default{defaultProjectName ? ` (${defaultProjectName})` : ''}
                                </option>
                                {todoistProjects.map((p) => (
                                    <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                            </select>
                            <p className="text-[11px] text-text-light mt-1">
                                Pick a specific project for this habit's recurring task. Changing this on
                                an already-synced habit moves the existing task in Todoist.
                            </p>
                        </div>
                    )}
                    <div>
                        <label className={labelClass}>If I'm planning past the target window</label>
                        <div className="flex gap-1 flex-wrap">
                            {([
                                ['lenient', 'Surface anyway'],
                                ['strict', 'Hide for today'],
                            ] as Array<[HabitWindowBehavior, string]>).map(([value, label]) => (
                                <button
                                    key={value}
                                    type="button"
                                    onClick={() => setWindowBehavior(value)}
                                    className={`px-3 py-1.5 text-xs rounded-lg border transition-colors cursor-pointer ${
                                        windowBehavior === value
                                            ? 'bg-accent-subtle border-accent/30 text-accent'
                                            : 'border-border hover:bg-surface-dark/50'
                                    }`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                        <p className="text-[11px] text-text-light mt-1">
                            {windowBehavior === 'strict'
                                ? 'Hidden from today if the current time is past the target window.'
                                : 'Always surfaced as long as the Todoist task is due today and unchecked.'}
                        </p>
                    </div>
                    {initial?.todoistTaskId && (
                        <div className="text-[11px] text-text-light">
                            Synced to Todoist · task <code className="font-mono">{initial.todoistTaskId}</code>
                        </div>
                    )}
                </div>
            )}

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
