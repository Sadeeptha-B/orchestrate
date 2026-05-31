import { useState } from 'react';
import { useDayPlan } from '../../hooks/useDayPlan';
import { restCues as defaultRestCues } from '../../data/restCues';
import { Button } from '../ui/Button';
import type { RestCue } from '../../types';

type Category = RestCue['category'];
type Filter = Category | 'all';

const CATEGORY_ORDER: Category[] = ['physical', 'breath', 'sensory'];
const FILTERS: Filter[] = ['all', ...CATEGORY_ORDER];

const CATEGORY_META: Record<Category, { label: string; accent: string; chip: string }> = {
    physical: {
        label: 'Physical',
        accent: 'border-l-emerald-400/70',
        chip: 'bg-emerald-500/10 text-emerald-500',
    },
    breath: {
        label: 'Breath',
        accent: 'border-l-sky-400/70',
        chip: 'bg-sky-500/10 text-sky-500',
    },
    sensory: {
        label: 'Sensory',
        accent: 'border-l-violet-400/70',
        chip: 'bg-violet-500/10 text-violet-500',
    },
};

const filterLabel = (f: Filter) => (f === 'all' ? 'All' : CATEGORY_META[f].label);

interface CueFormState {
    label: string;
    durationHint: string;
    category: Category;
}

const emptyForm = (category: Category = 'physical'): CueFormState => ({
    label: '',
    durationHint: '',
    category,
});

interface RestCuesEditorProps {
    /** Compact mode (embedded in the /life True Rest card): drops the filter chips and
     *  scrolls a shorter list. The full /rest-cues page renders the non-compact form. */
    compact?: boolean;
}

/**
 * Shared True Rest cue editor — the full CRUD surface for `LifeContext.restCues`.
 * Rendered standalone on `/rest-cues` (via `RestCuesManager`) and embedded compactly
 * in the `/life` True Rest card. Does not own a `Card` wrapper; the caller supplies one.
 */
export function RestCuesEditor({ compact = false }: RestCuesEditorProps) {
    const { life, dispatch } = useDayPlan();
    const effectiveCues = life.restCues ?? defaultRestCues;
    const isCustomized = life.restCues !== undefined;

    const [filter, setFilter] = useState<Filter>('all');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editForm, setEditForm] = useState<CueFormState>(emptyForm());
    const [adding, setAdding] = useState(false);
    const [addForm, setAddForm] = useState<CueFormState>(emptyForm());

    const startEdit = (cue: RestCue) => {
        setEditingId(cue.id);
        setEditForm({ label: cue.label, durationHint: cue.durationHint, category: cue.category });
        setAdding(false);
    };

    const commitEdit = () => {
        if (!editingId || !editForm.label.trim()) return;
        dispatch({
            type: 'UPDATE_REST_CUE',
            cue: {
                id: editingId,
                label: editForm.label.trim(),
                durationHint: editForm.durationHint.trim(),
                category: editForm.category,
            },
        });
        setEditingId(null);
    };

    const startAdd = () => {
        const seed = filter === 'all' ? 'physical' : filter;
        setAddForm(emptyForm(seed));
        setAdding(true);
        setEditingId(null);
    };

    const commitAdd = () => {
        if (!addForm.label.trim()) return;
        dispatch({
            type: 'ADD_REST_CUE',
            cue: {
                label: addForm.label.trim(),
                durationHint: addForm.durationHint.trim(),
                category: addForm.category,
            },
        });
        setAdding(false);
    };

    const handleDelete = (cueId: string) => {
        dispatch({ type: 'DELETE_REST_CUE', cueId });
        if (editingId === cueId) setEditingId(null);
    };

    const handleReset = () => {
        dispatch({ type: 'REPLACE_REST_CUES', cues: undefined });
        setEditingId(null);
        setAdding(false);
    };

    // Compact mode always shows everything (no filter chips) so the category chip stays visible.
    const activeFilter: Filter = compact ? 'all' : filter;
    const visibleCues = activeFilter === 'all'
        ? effectiveCues
        : effectiveCues.filter((c) => c.category === activeFilter);

    return (
        <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                {!compact ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                        {FILTERS.map((f) => {
                            const active = filter === f;
                            return (
                                <button
                                    key={f}
                                    type="button"
                                    onClick={() => setFilter(f)}
                                    className={`text-xs px-3 py-1 rounded-full border transition-colors cursor-pointer ${
                                        active
                                            ? 'border-accent bg-accent text-white'
                                            : 'border-border text-text-light hover:border-accent/40 hover:text-text'
                                    }`}
                                >
                                    {filterLabel(f)}
                                </button>
                            );
                        })}
                    </div>
                ) : (
                    <span className="text-[11px] uppercase tracking-wider text-text-light">
                        {effectiveCues.length} {effectiveCues.length === 1 ? 'cue' : 'cues'}
                        {!isCustomized && ' · defaults'}
                    </span>
                )}
                <div className="flex items-center gap-2">
                    {isCustomized && (
                        <Button variant="ghost" size="sm" onClick={handleReset}>
                            Reset
                        </Button>
                    )}
                    <Button size="sm" onClick={startAdd}>
                        + Add cue
                    </Button>
                </div>
            </div>

            {adding && (
                <div className="mb-3 rounded-md border border-accent/40 bg-subtle/50 px-3 py-2">
                    <CueFormFields form={addForm} onChange={setAddForm} />
                    <div className="flex gap-2 mt-2">
                        <Button size="sm" onClick={commitAdd} disabled={!addForm.label.trim()}>
                            Add
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
                            Cancel
                        </Button>
                    </div>
                </div>
            )}

            {visibleCues.length === 0 ? (
                <p className="text-sm text-text-light italic px-1 py-3">
                    {activeFilter === 'all' ? 'No cues yet.' : `No ${filterLabel(activeFilter).toLowerCase()} cues.`}
                </p>
            ) : (
                <ul className={`space-y-1 ${compact ? 'max-h-72 overflow-y-auto scrollbar-subtle -mr-1 pr-1' : ''}`}>
                    {visibleCues.map((cue) => {
                        const meta = CATEGORY_META[cue.category];
                        if (editingId === cue.id) {
                            return (
                                <li key={cue.id} className={`rounded-md border-l-2 ${meta.accent} bg-subtle/50 px-3 py-2`}>
                                    <CueFormFields form={editForm} onChange={setEditForm} />
                                    <div className="flex gap-2 mt-2">
                                        <Button size="sm" onClick={commitEdit} disabled={!editForm.label.trim()}>
                                            Save
                                        </Button>
                                        <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>
                                            Cancel
                                        </Button>
                                    </div>
                                </li>
                            );
                        }
                        return (
                            <li
                                key={cue.id}
                                className={`group flex items-center gap-2 rounded-md border-l-2 ${meta.accent} pl-3 pr-2 py-1.5 hover:bg-subtle/40 transition-colors`}
                            >
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm break-words">{cue.label}</div>
                                    <div className="text-[11px] text-text-light flex items-center gap-2">
                                        {cue.durationHint && <span>{cue.durationHint}</span>}
                                        {activeFilter === 'all' && (
                                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wider ${meta.chip}`}>
                                                {meta.label}
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <div className="flex gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                                    <button
                                        onClick={() => startEdit(cue)}
                                        className="text-xs text-text-light hover:text-accent px-1.5 py-0.5 cursor-pointer"
                                    >
                                        Edit
                                    </button>
                                    <button
                                        onClick={() => handleDelete(cue.id)}
                                        className="text-xs text-text-light hover:text-red-400 px-1.5 py-0.5 cursor-pointer"
                                    >
                                        Delete
                                    </button>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}

            {!compact && (
                <p className="text-xs text-text-light mt-3">
                    {effectiveCues.length} {effectiveCues.length === 1 ? 'cue' : 'cues'} total
                    {!isCustomized && ' · using defaults'}
                </p>
            )}
        </div>
    );
}

interface CueFormFieldsProps {
    form: CueFormState;
    onChange: (f: CueFormState) => void;
}

function CueFormFields({ form, onChange }: CueFormFieldsProps) {
    const inputClass =
        'w-full px-2 py-1.5 text-sm rounded-md border border-border bg-card text-text focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-colors';

    return (
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px_120px] gap-2">
            <input
                className={inputClass}
                placeholder="Label, e.g. Walk 5 minutes — outside if possible"
                value={form.label}
                onChange={(e) => onChange({ ...form, label: e.target.value })}
                autoFocus
            />
            <input
                className={inputClass}
                placeholder="5 min"
                value={form.durationHint}
                onChange={(e) => onChange({ ...form, durationHint: e.target.value })}
            />
            <select
                className={inputClass}
                value={form.category}
                onChange={(e) => onChange({ ...form, category: e.target.value as Category })}
            >
                {CATEGORY_ORDER.map((c) => (
                    <option key={c} value={c}>
                        {CATEGORY_META[c].label}
                    </option>
                ))}
            </select>
        </div>
    );
}
