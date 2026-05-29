/**
 * v6.5: inline time editor for rescheduling a `TodaysHabitInstance`. Presentational —
 * state lives in `useHabitReschedule`. Shared by the dashboard `HabitInstanceCard` and
 * the wizard's `Step3HabitsPanel` so the time-input + Save/Cancel markup isn't duplicated.
 */
export function HabitTimeEditor({
    value,
    onChange,
    onSave,
    onCancel,
}: {
    value: string;
    onChange: (next: string) => void;
    onSave: () => void;
    onCancel: () => void;
}) {
    return (
        <span className="flex items-center gap-1 flex-shrink-0">
            <input
                type="time"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="px-1 py-0.5 text-xs rounded border border-border bg-card"
            />
            <button
                onClick={onSave}
                className="px-2 py-0.5 text-[10px] rounded bg-accent text-white hover:bg-accent/80 cursor-pointer"
            >
                Save
            </button>
            <button
                onClick={onCancel}
                className="px-2 py-0.5 text-[10px] rounded text-text-light hover:bg-surface-dark cursor-pointer"
            >
                Cancel
            </button>
        </span>
    );
}
