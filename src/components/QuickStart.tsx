import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDayPlan } from '../hooks/useDayPlan';
import { useTodoistData, useTodoistActions } from '../hooks/useTodoist';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';

interface QuickStartProps {
    open: boolean;
    onClose: () => void;
}

/**
 * v7.4: Low-friction entry that bypasses the 5-step wizard on low-activation days. Pick a few
 * existing Todoist tasks and/or type new ones, then drop straight into Focus on the first.
 *
 * On Start it seeds a minimal plan (one "Today" intention + a main LinkedTask per id, assigned to
 * the session covering now, `setupComplete: true`) via the atomic `QUICK_START` reducer action,
 * engages the first task, and navigates to `/focus`. Free-typed lines become real Todoist tasks so
 * they're valid, schedulable LinkedTasks (Todoist stays the source of truth).
 */
export function QuickStart({ open, onClose }: QuickStartProps) {
    const { dispatch } = useDayPlan();
    const { tasks, isConfigured } = useTodoistData();
    const { createTask } = useTodoistActions();
    const navigate = useNavigate();

    const [freeText, setFreeText] = useState('');
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [search, setSearch] = useState('');
    const [busy, setBusy] = useState(false);

    const openTasks = useMemo(
        () => tasks.filter((t) => !t.checked),
        [tasks],
    );
    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        const list = q ? openTasks.filter((t) => t.content.toLowerCase().includes(q)) : openTasks;
        return list.slice(0, 100);
    }, [openTasks, search]);

    const freeLines = freeText
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);

    const canStart = !busy && (selected.size > 0 || freeLines.length > 0);

    const toggle = (id: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const reset = () => {
        setFreeText('');
        setSelected(new Set());
        setSearch('');
    };

    const handleStart = async () => {
        if (!canStart) return;
        setBusy(true);
        try {
            // Free-typed lines first → real Todoist tasks (preserves Todoist as source of truth).
            const freshIds: string[] = [];
            for (const line of freeLines) {
                const created = await createTask(line);
                if (created) freshIds.push(created.id);
            }
            const todoistIds = [...freshIds, ...selected];
            if (todoistIds.length === 0) {
                setBusy(false);
                return;
            }

            const now = new Date().toISOString();
            dispatch({ type: 'QUICK_START', intentionTitle: 'Today', todoistIds, now });
            dispatch({ type: 'START_TASK_ENGAGEMENT', todoistId: todoistIds[0], now });

            reset();
            onClose();
            navigate('/focus');
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal open={open} onClose={onClose} title="⚡ Quick start">
            {!isConfigured ? (
                <div className="space-y-3">
                    <p className="text-sm text-text-light">
                        Quick start needs Todoist connected — tasks are created and tracked there.
                    </p>
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                            onClose();
                            navigate('/settings?tab=integrations');
                        }}
                    >
                        Connect Todoist →
                    </Button>
                </div>
            ) : (
                <div className="space-y-5">
                    <p className="text-sm text-text-light">
                        Skip planning. Pick or type 1–3 things, and drop straight into Focus on the first.
                    </p>

                    {/* Free-type box */}
                    <div className="space-y-1.5">
                        <span className="text-[10px] font-medium text-text-light uppercase tracking-wider">
                            Type new tasks (one per line)
                        </span>
                        <textarea
                            value={freeText}
                            onChange={(e) => setFreeText(e.target.value)}
                            rows={3}
                            placeholder={'auth refactor\nredis chapter 3'}
                            className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-card focus:border-accent focus:outline-none transition-colors resize-y"
                        />
                    </div>

                    {/* Todoist picker */}
                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] font-medium text-text-light uppercase tracking-wider">
                                Or pick from Todoist
                            </span>
                            <input
                                type="text"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Search…"
                                className="w-28 px-2 py-1 text-xs rounded-lg border border-border bg-card focus:border-accent focus:outline-none"
                            />
                        </div>
                        <div className="max-h-56 overflow-y-auto scrollbar-subtle rounded-lg border border-border divide-y divide-border/60">
                            {filtered.length === 0 ? (
                                <p className="text-xs text-text-light px-3 py-4 text-center">
                                    No open tasks{search ? ' match your search' : ''}.
                                </p>
                            ) : (
                                filtered.map((t) => (
                                    <label
                                        key={t.id}
                                        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-accent/[0.03]"
                                    >
                                        <input
                                            type="checkbox"
                                            checked={selected.has(t.id)}
                                            onChange={() => toggle(t.id)}
                                            className="flex-shrink-0 accent-accent"
                                        />
                                        <span className="text-sm flex-1 min-w-0 truncate">{t.content}</span>
                                    </label>
                                ))
                            )}
                        </div>
                    </div>

                    <div className="flex items-center justify-between gap-3 pt-1">
                        <span className="text-xs text-text-light tabular-nums">
                            {selected.size + freeLines.length} selected
                        </span>
                        <Button onClick={handleStart} disabled={!canStart}>
                            {busy ? 'Starting…' : 'Start → Focus'}
                        </Button>
                    </div>
                </div>
            )}
        </Modal>
    );
}
