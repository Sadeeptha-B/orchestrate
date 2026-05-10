import { useState } from 'react';
import { Button } from '../ui/Button';
import type { Season, SeasonCapacity } from '../../types';

export type SeasonDraft = Omit<Season, 'id'>;

interface SeasonFormProps {
    initial?: Partial<SeasonDraft>;
    submitLabel?: string;
    onSubmit: (draft: SeasonDraft) => void;
    onCancel?: () => void;
}

function todayISO(): string {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
}

const inputClass =
    'w-full px-3 py-2 text-sm rounded-lg border border-border bg-card text-text focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-colors';

const labelClass = 'block text-xs font-medium text-text-light mb-1';

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

    const splitLines = (raw: string) =>
        raw
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean);

    const canSubmit = name.trim().length > 0 && startDate.length > 0;

    const handleSubmit = () => {
        if (!canSubmit) return;
        const capacityBudget: SeasonCapacity | null =
            weeklyGrowthHours || maxConcurrentHabits || capacityNotes
                ? {
                    weeklyGrowthHours: weeklyGrowthHours ? Number(weeklyGrowthHours) : null,
                    maxConcurrentHabits: maxConcurrentHabits ? Number(maxConcurrentHabits) : null,
                    notes: capacityNotes,
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
