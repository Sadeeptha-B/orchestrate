import { useState } from 'react';
import { useTodoist, type TodoistTask } from '../../hooks/useTodoist';

interface TodoistPanelProps {
    mode?: 'compact' | 'full';
    onSetup?: () => void;
}

export function TodoistPanel({ mode = 'full', onSetup }: TodoistPanelProps) {
    const {
        tasks,
        projects,
        loading,
        error,
        isConfigured,
        createTask,
        completeTask,
        refreshTasks,
    } = useTodoist();

    const [newTask, setNewTask] = useState('');
    const [projectFilter, setProjectFilter] = useState<string>('');

    if (!isConfigured) {
        return (
            <div className="flex flex-col items-center justify-center h-full py-8 text-center">
                <p className="text-sm text-text-light mb-3">
                    Connect Todoist to see your tasks here.
                </p>
                {onSetup ? (
                    <button
                        onClick={onSetup}
                        className="text-sm text-accent hover:underline cursor-pointer"
                    >
                        Open Settings →
                    </button>
                ) : (
                    <p className="text-xs text-text-light">
                        Go to Settings → Integrations to connect.
                    </p>
                )}
            </div>
        );
    }

    const filtered = projectFilter
        ? tasks.filter((t) => t.project_id === projectFilter)
        : tasks;

    const handleCreate = async () => {
        if (!newTask.trim()) return;
        const opts = projectFilter ? { project_id: projectFilter } : undefined;
        await createTask(newTask.trim(), opts);
        setNewTask('');
    };

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-text-light uppercase tracking-wider">
                        Todoist
                    </span>
                    {loading && (
                        <span className="text-xs text-text-light animate-pulse">syncing…</span>
                    )}
                </div>
                <button
                    onClick={() => refreshTasks(projectFilter || undefined)}
                    className="text-xs text-accent hover:underline cursor-pointer"
                    title="Refresh"
                >
                    ↻
                </button>
            </div>

            {/* Project filter — full mode only */}
            {mode === 'full' && projects.length > 0 && (
                <div className="px-3 py-2 border-b border-border">
                    <select
                        value={projectFilter}
                        onChange={(e) => {
                            setProjectFilter(e.target.value);
                            refreshTasks(e.target.value || undefined);
                        }}
                        className="w-full text-xs px-2 py-1.5 rounded border border-border bg-card text-text focus:outline-none focus:ring-1 focus:ring-accent/30"
                    >
                        <option value="">All projects</option>
                        {projects.map((p) => (
                            <option key={p.id} value={p.id}>
                                {p.name}
                            </option>
                        ))}
                    </select>
                </div>
            )}

            {/* Error */}
            {error && (
                <div className="px-3 py-2 text-xs text-red-500 bg-red-50 dark:bg-red-900/20">
                    {error}
                </div>
            )}

            {/* Task list */}
            <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
                {filtered.length === 0 && !loading && (
                    <p className="text-xs text-text-light py-4 text-center">No tasks</p>
                )}
                {filtered.map((task) => (
                    <TaskRow key={task.id} task={task} onComplete={completeTask} />
                ))}
            </div>

            {/* Create task input */}
            <div className="px-3 py-2 border-t border-border">
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={newTask}
                        onChange={(e) => setNewTask(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                        placeholder="Add task…"
                        className="flex-1 px-2 py-1.5 text-xs rounded border border-border bg-card text-text focus:outline-none focus:ring-1 focus:ring-accent/30 transition-colors"
                    />
                    <button
                        onClick={handleCreate}
                        disabled={!newTask.trim()}
                        className="px-2.5 py-1.5 text-xs rounded bg-accent text-white hover:bg-accent/80 disabled:opacity-40 transition-colors cursor-pointer"
                    >
                        +
                    </button>
                </div>
            </div>
        </div>
    );
}

function TaskRow({
    task,
    onComplete,
}: {
    task: TodoistTask;
    onComplete: (id: string) => void;
}) {
    return (
        <div className="flex items-start gap-2 py-1.5 group">
            <button
                onClick={() => onComplete(task.id)}
                className="w-4 h-4 mt-0.5 flex-shrink-0 rounded-full border border-border hover:border-accent hover:bg-accent/10 transition-colors cursor-pointer"
                title="Complete"
            />
            <div className="min-w-0 flex-1">
                <p className="text-sm leading-snug">{task.content}</p>
                {task.due && (
                    <p className="text-xs text-text-light mt-0.5">
                        {task.due.date.includes('T')
                            ? new Date(task.due.date).toLocaleString([], {
                                month: 'short',
                                day: 'numeric',
                                hour: 'numeric',
                                minute: '2-digit',
                            })
                            : task.due.date}
                    </p>
                )}
            </div>
        </div>
    );
}
