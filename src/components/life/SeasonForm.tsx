import { useState } from 'react';
import { Button } from '../ui/Button';
import { inputClass, labelClass } from '../ui/formStyles';
import { todayISO } from '../../lib/time';
import type { HabitRecurrenceKind, RecurringFocus, Season, SeasonCapacity } from '../../types';

const FOCUS_DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function splitLines(raw: string) {
    return raw
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
}

function parseOptionalNumber(value: string): number | null {
    if (!value) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

export type SeasonDraft = Omit<Season, 'id'>;

interface SeasonFormProps {
    initial?: Partial<SeasonDraft>;
    submitLabel?: string;
    onSubmit: (draft: SeasonDraft) => void;
    onCancel?: () => void;
}

export function SeasonForm({
    initial,
    submitLabel = 'Save Season',
    onSubmit,
    onCancel,
}: SeasonFormProps) {
    const [name, setName] = useState(initial?.name ?? '');
    const [primaryTheme, setPrimaryTheme] = useState(initial?.primaryTheme ?? '');
    const [startDate, setStartDate] = useState(initial?.startDate ?? todayISO());
    const [endDate, setEndDate] = useState(initial?.endDate ?? '');
    const [supportingGoalsText, setSupportingGoalsText] = useState(
        (initial?.supportingGoals ?? []).join('\n'),
    );
    const [nonGoalsText, setNonGoalsText] = useState((initial?.nonGoals ?? []).join('\n'));
    const [successCriteria, setSuccessCriteria] = useState(initial?.successCriteria ?? '');
    const [active, setActive] = useState(initial?.active ?? false);
    const [weeklyGrowthHours, setWeeklyGrowthHours] = useState<string>(
        initial?.capacityBudget?.weeklyGrowthHours != null
            ? String(initial.capacityBudget.weeklyGrowthHours)
            : '',
    );
    const [maxConcurrentHabits, setMaxConcurrentHabits] = useState<string>(
        initial?.capacityBudget?.maxConcurrentHabits != null
            ? String(initial.capacityBudget.maxConcurrentHabits)
            : '',
    );
    const [capacityNotes, setCapacityNotes] = useState(initial?.capacityBudget?.notes ?? '');
    const [focuses, setFocuses] = useState<RecurringFocus[]>(initial?.recurringFocuses ?? []);

    const addFocus = () =>
        setFocuses((f) => [...f, { id: crypto.randomUUID(), title: '', recurrence: { kind: 'daily' }, active: true }]);
    const updateFocus = (id: string, patch: Partial<RecurringFocus>) =>
        setFocuses((f) => f.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    const setFocusKind = (id: string, kind: HabitRecurrenceKind) =>
        setFocuses((f) => f.map((x) => (x.id === id
            ? { ...x, recurrence: { kind, ...(kind === 'weekly' ? { daysOfWeek: x.recurrence.daysOfWeek ?? [] } : {}) } }
            : x)));
    const toggleFocusDay = (id: string, day: number) =>
        setFocuses((f) => f.map((x) => {
            if (x.id !== id) return x;
            const days = x.recurrence.daysOfWeek ?? [];
            const next = days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort();
            return { ...x, recurrence: { ...x.recurrence, daysOfWeek: next } };
        }));
    const removeFocus = (id: string) => setFocuses((f) => f.filter((x) => x.id !== id));

    const trimmedCapacityNotes = capacityNotes.trim();
    const hasInvalidDateRange = Boolean(endDate && startDate && endDate < startDate);
    const canSubmit = name.trim().length > 0 && startDate.length > 0 && !hasInvalidDateRange;

    const handleSubmit = () => {
        if (!canSubmit) return;
        const capacityBudget: SeasonCapacity | null =
            weeklyGrowthHours || maxConcurrentHabits || trimmedCapacityNotes
                ? {
                    weeklyGrowthHours: parseOptionalNumber(weeklyGrowthHours),
                    maxConcurrentHabits: parseOptionalNumber(maxConcurrentHabits),
                    notes: trimmedCapacityNotes,
                }
                : null;
        onSubmit({
            name: name.trim(),
            primaryTheme: primaryTheme.trim(),
            startDate,
            endDate: endDate || null,
            supportingGoals: splitLines(supportingGoalsText),
            nonGoals: splitLines(nonGoalsText),
            successCriteria: successCriteria.trim(),
            capacityBudget,
            active,
            recurringFocuses: focuses
                .filter((f) => f.title.trim())
                .map((f) => ({ ...f, title: f.title.trim() })),
            ...(initial?.archivedAt ? { archivedAt: initial.archivedAt } : {}),
        });
    };

    return (
        <div className="space-y-4">
            <div>
                <label className={labelClass}>Name</label>
                <input
                    className={inputClass}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Stabilization, Degree Push 2026"
                />
            </div>

            <div>
                <label className={labelClass}>Primary theme</label>
                <input
                    className={inputClass}
                    value={primaryTheme}
                    onChange={(e) => setPrimaryTheme(e.target.value)}
                    placeholder="One line — what is this season about?"
                />
            </div>

            <div className="grid grid-cols-2 gap-3">
                <div>
                    <label className={labelClass}>Start date</label>
                    <input
                        type="date"
                        className={inputClass}
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                    />
                </div>
                <div>
                    <label className={labelClass}>End date (optional)</label>
                    <input
                        type="date"
                        className={inputClass}
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                    />
                    {hasInvalidDateRange && (
                        <p className="mt-1 text-xs text-red-500">
                            End date must be the same as or after the start date.
                        </p>
                    )}
                </div>
            </div>

            <div>
                <label className={labelClass}>Supporting goals (one per line)</label>
                <textarea
                    className={inputClass}
                    rows={3}
                    value={supportingGoalsText}
                    onChange={(e) => setSupportingGoalsText(e.target.value)}
                    placeholder={'Reach gym 4x/week\nFinish module 3 of degree'}
                />
            </div>

            <div>
                <label className={labelClass}>Non-goals (one per line)</label>
                <textarea
                    className={inputClass}
                    rows={2}
                    value={nonGoalsText}
                    onChange={(e) => setNonGoalsText(e.target.value)}
                    placeholder={'No new side projects\nNo art practice this season'}
                />
            </div>

            <div>
                <label className={labelClass}>Success criteria</label>
                <textarea
                    className={inputClass}
                    rows={2}
                    value={successCriteria}
                    onChange={(e) => setSuccessCriteria(e.target.value)}
                    placeholder="What does a successful end of season look like?"
                />
            </div>

            <div>
                <div className="flex items-center justify-between mb-1">
                    <label className={labelClass}>Recurring focuses</label>
                    <Button variant="ghost" size="sm" onClick={addFocus}>+ Add focus</Button>
                </div>
                <p className="text-[11px] text-text-light mb-2">
                    Recurring work-threads (e.g. "Learn redis") that decompose into tasks. On matching days they
                    appear as a "+ Add" chip in the planner — click to seed an intention you then break down.
                </p>
                {focuses.length === 0 ? (
                    <p className="text-xs text-text-light italic">No recurring focuses.</p>
                ) : (
                    <div className="space-y-2">
                        {focuses.map((f) => {
                            const showDays = f.recurrence.kind === 'weekly' || f.recurrence.kind === 'custom';
                            return (
                                <div key={f.id} className="rounded-lg border border-border p-2 space-y-2">
                                    <div className="flex items-center gap-2">
                                        <input
                                            className={inputClass}
                                            value={f.title}
                                            onChange={(e) => updateFocus(f.id, { title: e.target.value })}
                                            placeholder="e.g. Learn redis"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => removeFocus(f.id)}
                                            className="text-text-light hover:text-red-500 text-sm cursor-pointer flex-shrink-0 px-1"
                                            title="Remove focus"
                                            aria-label="Remove focus"
                                        >
                                            &times;
                                        </button>
                                    </div>
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <select
                                            className={`${inputClass} w-auto`}
                                            value={f.recurrence.kind === 'custom' ? 'weekly' : f.recurrence.kind}
                                            onChange={(e) => setFocusKind(f.id, e.target.value as HabitRecurrenceKind)}
                                        >
                                            <option value="daily">Daily</option>
                                            <option value="weekdays">Weekdays</option>
                                            <option value="weekly">Specific days</option>
                                        </select>
                                        {showDays && (
                                            <div className="flex gap-1">
                                                {FOCUS_DAY_LABELS.map((label, idx) => (
                                                    <button
                                                        key={idx}
                                                        type="button"
                                                        onClick={() => toggleFocusDay(f.id, idx)}
                                                        className={`w-7 h-7 text-xs rounded-md border transition-colors cursor-pointer ${
                                                            (f.recurrence.daysOfWeek ?? []).includes(idx)
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
                                        <label className="flex items-center gap-1.5 text-xs text-text-light ml-auto">
                                            <input
                                                type="checkbox"
                                                checked={f.active}
                                                onChange={(e) => updateFocus(f.id, { active: e.target.checked })}
                                            />
                                            Active
                                        </label>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            <details className="rounded-lg border border-border p-3">
                <summary className="text-xs font-medium text-text-light cursor-pointer">
                    Capacity budget (optional)
                </summary>
                <div className="mt-3 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className={labelClass}>Weekly growth hours (soft cap)</label>
                            <input
                                type="number"
                                min={0}
                                className={inputClass}
                                value={weeklyGrowthHours}
                                onChange={(e) => setWeeklyGrowthHours(e.target.value)}
                            />
                        </div>
                        <div>
                            <label className={labelClass}>Max concurrent active habits</label>
                            <input
                                type="number"
                                min={0}
                                className={inputClass}
                                value={maxConcurrentHabits}
                                onChange={(e) => setMaxConcurrentHabits(e.target.value)}
                            />
                        </div>
                    </div>
                    <div>
                        <label className={labelClass}>Notes</label>
                        <textarea
                            className={inputClass}
                            rows={2}
                            value={capacityNotes}
                            onChange={(e) => setCapacityNotes(e.target.value)}
                        />
                    </div>
                </div>
            </details>

            <label className="flex items-center gap-2 text-sm">
                <input
                    type="checkbox"
                    checked={active}
                    onChange={(e) => setActive(e.target.checked)}
                />
                <span>Set as active season {active ? '(any other active season will be deactivated)' : ''}</span>
            </label>

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
