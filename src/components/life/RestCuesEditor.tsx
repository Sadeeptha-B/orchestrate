import { useState } from 'react';
import { useDayPlan } from '../../hooks/useDayPlan';
import { restCues as defaultRestCues } from '../../data/restCues';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import type { RestCue } from '../../types';

type Category = RestCue['category'];

const CATEGORY_ORDER: Category[] = ['physical', 'breath', 'sensory'];

const CATEGORY_LABEL: Record<Category, string> = {
    physical: 'Physical',
    breath: 'Breath',
    sensory: 'Sensory',
};

const CATEGORY_CHIP: Record<Category, string> = {
    physical: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    breath: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
    sensory: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
};

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

export function RestCuesEditor() {
    const { life, dispatch } = useDayPlan();
    const effectiveCues = life.restCues ?? defaultRestCues;
    const isCustomized = life.restCues !== undefined;

    const [editing, setEditing] = useState<RestCue | null>(null);
    const [editForm, setEditForm] = useState<CueFormState>(emptyForm());
    const [adding, setAdding] = useState(false);
    const [addForm, setAddForm] = useState<CueFormState>(emptyForm());

    const openEdit = (cue: RestCue) => {
        setEditing(cue);
        setEditForm({ label: cue.label, durationHint: cue.durationHint, category: cue.category });
    };

    const commitEdit = () => {
        if (!editing || !editForm.label.trim()) return;
        dispatch({
            type: 'UPDATE_REST_CUE',
            cue: {
                id: editing.id,
                label: editForm.label.trim(),
                durationHint: editForm.durationHint.trim(),
                category: editForm.category,
            },
        });
        setEditing(null);
    };

    const openAdd = () => {
        setAddForm(emptyForm());
        setAdding(true);
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
        if (editing?.id === cueId) setEditing(null);
    };

    const handleReset = () => {
        dispatch({ type: 'REPLACE_REST_CUES', cues: undefined });
        setEditing(null);
    };

    return (
        <div>
            <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] uppercase tracking-wider text-text-light">
                    {effectiveCues.length} {effectiveCues.length === 1 ? 'cue' : 'cues'}
                    {!isCustomized && ' · defaults'}
                </span>
                <div className="flex items-center gap-2">
                    {isCustomized && (
                        <Button variant="ghost" size="sm" onClick={handleReset}>
                            Reset
                        </Button>
                    )}
                    <Button size="sm" onClick={openAdd}>
                        + Add
                    </Button>
                </div>
            </div>

            {effectiveCues.length === 0 ? (
                <p className="text-sm text-text-light italic">No cues yet.</p>
            ) : (
                <ul className="space-y-0.5 max-h-72 overflow-y-auto scrollbar-subtle -mr-1 pr-1">
                    {effectiveCues.map((cue) => (
                        <li
                            key={cue.id}
                            className="group flex items-center gap-2 px-1.5 py-1.5 rounded hover:bg-surface-dark/50 transition-colors"
                        >
                            <div className="flex-1 min-w-0">
                                <p className="text-sm">{cue.label}</p>
                                <div className="flex items-center gap-1.5 mt-0.5">
                                    {cue.durationHint && (
                                        <span className="text-[11px] text-text-light">{cue.durationHint}</span>
                                    )}
                                    <span className={`text-[10px] px-1 py-px rounded-full ${CATEGORY_CHIP[cue.category]}`}>
                                        {CATEGORY_LABEL[cue.category]}
                                    </span>
                                </div>
                            </div>
                            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity flex-shrink-0">
                                <button
                                    onClick={() => openEdit(cue)}
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
                    ))}
                </ul>
            )}

            <Modal open={adding} onClose={() => setAdding(false)} title="Add rest cue">
                <div className="space-y-4">
                    <CueFormFields form={addForm} onChange={setAddForm} />
                    <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
                            Cancel
                        </Button>
                        <Button size="sm" onClick={commitAdd} disabled={!addForm.label.trim()}>
                            Add
                        </Button>
                    </div>
                </div>
            </Modal>

            <Modal open={editing !== null} onClose={() => setEditing(null)} title="Edit rest cue">
                <div className="space-y-4">
                    <CueFormFields form={editForm} onChange={setEditForm} />
                    <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
                            Cancel
                        </Button>
                        <Button size="sm" onClick={commitEdit} disabled={!editForm.label.trim()}>
                            Save
                        </Button>
                    </div>
                </div>
            </Modal>
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
        <div className="space-y-3">
            <div>
                <label className="block text-xs text-text-light mb-1">Label</label>
                <input
                    className={inputClass}
                    placeholder="e.g. Walk 5 minutes — outside if possible"
                    value={form.label}
                    onChange={(e) => onChange({ ...form, label: e.target.value })}
                    autoFocus
                />
            </div>
            <div className="grid grid-cols-2 gap-3">
                <div>
                    <label className="block text-xs text-text-light mb-1">Duration</label>
                    <input
                        className={inputClass}
                        placeholder="5 min"
                        value={form.durationHint}
                        onChange={(e) => onChange({ ...form, durationHint: e.target.value })}
                    />
                </div>
                <div>
                    <label className="block text-xs text-text-light mb-1">Category</label>
                    <select
                        className={inputClass}
                        value={form.category}
                        onChange={(e) => onChange({ ...form, category: e.target.value as Category })}
                    >
                        {CATEGORY_ORDER.map((c) => (
                            <option key={c} value={c}>
                                {CATEGORY_LABEL[c]}
                            </option>
                        ))}
                    </select>
                </div>
            </div>
        </div>
    );
}
