import { useState } from 'react';
import { useDayPlan } from '../../hooks/useDayPlan';
import { LifeShell } from './LifeShell';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { ConfirmModal } from '../ui/ConfirmModal';
import { useConfirmModal } from '../../hooks/useConfirmModal';
import { SessionEditorTimeline } from '../ui/SessionEditorTimeline';
import { defaultSessionSlots } from '../../data/sessions';
import type { SessionSlot, SessionTemplate } from '../../types';

/** Local working copy while adding/editing a template (kept off the store until Save). */
interface Draft {
    id: string | null; // null = creating a new template
    name: string;
    slots: SessionSlot[];
    createdAt?: string;
}

export function SessionTemplatesManager() {
    const { plan, life, settings, dispatch } = useDayPlan();
    const templates = life.sessionTemplates ?? [];
    const [draft, setDraft] = useState<Draft | null>(null);
    const confirmApply = useConfirmModal<SessionTemplate>();
    const confirmDelete = useConfirmModal<SessionTemplate>();

    const startCreate = () =>
        setDraft({ id: null, name: '', slots: defaultSessionSlots.map((s) => ({ ...s, id: crypto.randomUUID() })) });

    const startEdit = (tpl: SessionTemplate) =>
        setDraft({ id: tpl.id, name: tpl.name, slots: tpl.slots.map((s) => ({ ...s })), createdAt: tpl.createdAt });

    const saveDraft = () => {
        if (!draft) return;
        const name = draft.name.trim();
        if (!name) return;
        if (draft.id) {
            dispatch({
                type: 'UPDATE_SESSION_TEMPLATE',
                template: {
                    id: draft.id,
                    name,
                    slots: draft.slots,
                    createdAt: draft.createdAt ?? new Date().toISOString(),
                },
            });
        } else {
            dispatch({ type: 'ADD_SESSION_TEMPLATE', template: { name, slots: draft.slots } });
        }
        setDraft(null);
    };

    // Local (un-persisted) slot mutations on the draft.
    const draftAdd = (session: Omit<SessionSlot, 'id'>) =>
        setDraft((d) => (d ? { ...d, slots: [...d.slots, { ...session, id: crypto.randomUUID() }] } : d));
    const draftUpdate = (session: SessionSlot) =>
        setDraft((d) => (d ? { ...d, slots: d.slots.map((s) => (s.id === session.id ? session : s)) } : d));
    const draftRemove = (sessionId: string) =>
        setDraft((d) => (d ? { ...d, slots: d.slots.filter((s) => s.id !== sessionId) } : d));

    const applyToToday = (tpl: SessionTemplate) => {
        const hasAssignments = Object.values(plan.taskSessions).some((ids) => ids.length > 0);
        if (hasAssignments) confirmApply.open(tpl);
        else dispatch({ type: 'APPLY_SESSION_TEMPLATE', templateId: tpl.id });
    };

    return (
        <LifeShell
            title="Session templates"
            subtitle="Reusable layouts of work sessions. Apply one in a click when planning a day."
            crumbs={[{ label: 'Session templates', to: '/session-templates' }]}
        >
            <div className="mb-4 flex justify-end">
                <Button size="sm" onClick={startCreate} disabled={draft !== null}>
                    + New template
                </Button>
            </div>

            {/* Inline editor */}
            {draft && (
                <Card className="mb-5">
                    <div className="flex items-center gap-2 mb-3">
                        <input
                            autoFocus
                            value={draft.name}
                            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                            placeholder="Template name (e.g. Deep Work Day)"
                            className="flex-1 min-w-0 rounded-md border border-border bg-card px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
                        />
                        <Button size="sm" onClick={saveDraft} disabled={!draft.name.trim()}>
                            {draft.id ? 'Save' : 'Create'}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
                            Cancel
                        </Button>
                    </div>
                    <SessionEditorTimeline
                        slots={draft.slots}
                        onAdd={draftAdd}
                        onUpdate={draftUpdate}
                        onRemove={draftRemove}
                        timelineStartMinutes={settings.timelineStartMinutes}
                        timelineEndMinutes={settings.timelineEndMinutes}
                    />
                </Card>
            )}

            {/* Template list */}
            {templates.length === 0 && !draft ? (
                <Card>
                    <p className="text-sm text-text-light italic">
                        No templates yet. Create one above, or save a layout from the Sessions step
                        while planning a day.
                    </p>
                </Card>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {templates.map((tpl) => (
                        <Card key={tpl.id}>
                            <div className="flex items-center justify-between gap-2 mb-2">
                                <h3 className="font-medium truncate">{tpl.name}</h3>
                                <span className="text-[11px] uppercase tracking-wider text-text-light flex-shrink-0">
                                    {tpl.slots.length} {tpl.slots.length === 1 ? 'session' : 'sessions'}
                                </span>
                            </div>
                            <div className="flex flex-wrap gap-1 mb-3">
                                {tpl.slots.length === 0 ? (
                                    <span className="text-xs text-text-light italic">Empty</span>
                                ) : (
                                    [...tpl.slots]
                                        .sort((a, b) => a.startTime.localeCompare(b.startTime))
                                        .map((s) => (
                                            <span key={s.id} className="px-1.5 py-0.5 text-[10px] rounded-full bg-accent/15 text-accent">
                                                {s.name} · {s.startTime}–{s.endTime}
                                            </span>
                                        ))
                                )}
                            </div>
                            <div className="flex items-center gap-2">
                                <Button variant="secondary" size="sm" onClick={() => applyToToday(tpl)}>
                                    Apply to today
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => startEdit(tpl)} disabled={draft !== null}>
                                    Edit
                                </Button>
                                <button
                                    onClick={() => confirmDelete.open(tpl)}
                                    className="text-xs text-text-light hover:text-red-500 px-1.5 py-0.5 cursor-pointer ml-auto"
                                >
                                    Delete
                                </button>
                            </div>
                        </Card>
                    ))}
                </div>
            )}

            <ConfirmModal
                open={confirmApply.value !== null}
                onClose={confirmApply.close}
                onConfirm={() => {
                    if (confirmApply.value) dispatch({ type: 'APPLY_SESSION_TEMPLATE', templateId: confirmApply.value.id });
                }}
                title="Apply to today?"
                confirmLabel="Apply"
            >
                <p className="text-sm text-text-light mb-4">
                    Applying “{confirmApply.value?.name}” replaces today's sessions and clears the
                    task assignments you've already made. Continue?
                </p>
            </ConfirmModal>

            <ConfirmModal
                open={confirmDelete.value !== null}
                onClose={confirmDelete.close}
                onConfirm={() => {
                    if (confirmDelete.value) dispatch({ type: 'DELETE_SESSION_TEMPLATE', templateId: confirmDelete.value.id });
                }}
                title="Delete template?"
                confirmLabel="Delete"
            >
                <p className="text-sm text-text-light mb-4">
                    Delete “{confirmDelete.value?.name}”? This can't be undone.
                </p>
            </ConfirmModal>
        </LifeShell>
    );
}
