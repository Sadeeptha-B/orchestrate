import { useState, useRef, useCallback, useMemo } from 'react';
import confetti from 'canvas-confetti';
import { useTodoistData, useTodoistActions } from '../../hooks/useTodoist';
import type { TodoistTask, TodoistProject, TodoistSection } from '../../hooks/useTodoist';
import { useDayPlan } from '../../hooks/useDayPlan';
import { addMinutesToTime, timeToMinutes, todayISO } from '../../lib/time';
import { collectDescendantIds } from '../../lib/tasks';
import type { LinkedTask } from '../../types';

// --- Todoist color map (color name → hex) ---
const TODOIST_COLORS: Record<string, string> = {
    berry_red: '#B8255F', red: '#DC4C3E', orange: '#C77100', yellow: '#B29104',
    olive_green: '#949C31', lime_green: '#65A33A', green: '#369307', mint_green: '#4FA87A',
    teal: '#2EA09F', sky_blue: '#5AAFE5', light_blue: '#6988A4', blue: '#4180FF',
    grape: '#692EC2', violet: '#CA3FEE', lavender: '#A4698C', magenta: '#E05095',
    salmon: '#E8937C', charcoal: '#808080', grey: '#B8B8B8', taupe: '#CCAB93',
};

// --- Tree building utilities ---

interface ProjectNode {
    project: TodoistProject;
    children: ProjectNode[];
    sections: TodoistSection[];
    tasks: TodoistTask[];
}

function buildProjectTree(
    projects: TodoistProject[],
    tasks: TodoistTask[],
    sections: TodoistSection[],
): ProjectNode[] {
    const sorted = [...projects].sort((a, b) => a.child_order - b.child_order);
    const nodeMap = new Map<string, ProjectNode>();

    for (const p of sorted) {
        nodeMap.set(p.id, { project: p, children: [], sections: [], tasks: [] });
    }

    // Attach sections to projects
    const sortedSections = [...sections].sort((a, b) => a.section_order - b.section_order);
    for (const s of sortedSections) {
        nodeMap.get(s.project_id)?.sections.push(s);
    }

    // Attach root-level tasks (no parent_id) to projects
    const sortedTasks = [...tasks].sort((a, b) => a.child_order - b.child_order);
    for (const t of sortedTasks) {
        if (!t.parent_id) {
            nodeMap.get(t.project_id)?.tasks.push(t);
        }
    }

    // Build parent-child relationships
    const roots: ProjectNode[] = [];
    for (const p of sorted) {
        const node = nodeMap.get(p.id)!;
        if (p.parent_id && nodeMap.has(p.parent_id)) {
            nodeMap.get(p.parent_id)!.children.push(node);
        } else {
            roots.push(node);
        }
    }

    return roots;
}

function countTasksInNode(node: ProjectNode): number {
    let count = node.tasks.length;
    for (const child of node.children) {
        count += countTasksInNode(child);
    }
    return count;
}

// --- Component ---

interface LinkingProps {
    linkingIntentionId: string;
    linkedTaskIds: string[];                  // IDs linked to the current intention (pre-checked)
    allLinkedTasks: LinkedTask[];             // all linked tasks across intentions (for "(linked to: X)" labels)
    intentionTitles: Record<string, string>;  // intentionId → title lookup
    onLinkTask: (todoistId: string) => void;
    onUnlinkTask: (todoistId: string) => void;
}

interface TodoistPanelProps {
    mode?: 'compact' | 'full';
    onSetup?: () => void;
    linking?: LinkingProps;
    /** When set, only show projects that contain tasks with these IDs (plus their ancestors). */
    filterToTaskIds?: Set<string>;
    /** Show an "All Tasks / Linked Tasks" toggle in the header. Overrides filterToTaskIds. */
    showFilterToggle?: boolean;
    /** Default state for the filter toggle (default: false = show all). */
    defaultFiltered?: boolean;
}

/** Prune a project tree to only include nodes that contain (directly or via descendants) at least one task in `taskIds`. */
function pruneTree(nodes: ProjectNode[], taskIds: Set<string>): ProjectNode[] {
    const result: ProjectNode[] = [];
    for (const node of nodes) {
        const prunedChildren = pruneTree(node.children, taskIds);
        const hasMatchingTasks = node.tasks.some((t) => taskIds.has(t.id));
        if (hasMatchingTasks || prunedChildren.length > 0) {
            result.push({
                ...node,
                children: prunedChildren,
                tasks: hasMatchingTasks ? node.tasks : [],
                sections: hasMatchingTasks
                    ? node.sections
                    : [],
            });
        }
    }
    return result;
}

// --- Sibling reorder (drag-and-drop) ---

interface RowDragProps {
    draggable: boolean;
    onDragStart: (e: React.DragEvent) => void;
    onDragOver: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
    onDragEnd: () => void;
}

interface RowReorderState {
    isDragging: boolean;
    isDragOver: boolean;
    dragHandleProps?: RowDragProps;
}

/**
 * Drag-reorder state for one sibling group (tasks sharing a parent + section). `orderedIds`
 * is the current visible order; `onCommit` receives the new order on drop. `rowPropsFor`
 * yields the per-row drag handlers + styling flags — pass `enabled: false` to opt a row out
 * (e.g. a singleton list, or while inline-editing).
 */
function useRowReorder(orderedIds: string[], onCommit: (ids: string[]) => void) {
    const [dragId, setDragId] = useState<string | null>(null);
    const [overId, setOverId] = useState<string | null>(null);
    const reset = useCallback(() => { setDragId(null); setOverId(null); }, []);

    const handleDrop = useCallback((targetId: string) => {
        setDragId((dId) => {
            if (dId && dId !== targetId) {
                const ids = [...orderedIds];
                const from = ids.indexOf(dId);
                const to = ids.indexOf(targetId);
                if (from !== -1 && to !== -1) {
                    ids.splice(from, 1);
                    ids.splice(to, 0, dId);
                    onCommit(ids);
                }
            }
            return null;
        });
        setOverId(null);
    }, [orderedIds, onCommit]);

    const rowPropsFor = useCallback((id: string, enabled: boolean): RowReorderState => ({
        isDragging: dragId === id,
        isDragOver: overId === id && dragId !== id,
        dragHandleProps: enabled ? {
            draggable: true,
            onDragStart: (e) => { e.stopPropagation(); setDragId(id); e.dataTransfer.effectAllowed = 'move'; },
            onDragOver: (e) => { e.preventDefault(); e.stopPropagation(); setOverId(id === dragId ? null : id); },
            onDrop: (e) => { e.preventDefault(); e.stopPropagation(); handleDrop(id); },
            onDragEnd: reset,
        } : undefined,
    }), [dragId, overId, handleDrop, reset]);

    return rowPropsFor;
}

export function TodoistPanel({ mode = 'full', onSetup, linking, filterToTaskIds, showFilterToggle, defaultFiltered = false }: TodoistPanelProps) {
    const {
        tasks,
        projects,
        sections,
        loading,
        error,
        isConfigured,
    } = useTodoistData();
    const {
        createTask,
        updateTask,
        completeTask,
        deleteTask,
        reorderTasks,
        createProject,
        deleteProject,
        refreshTasks,
        refreshProjects,
        refreshSections,
    } = useTodoistActions();

    const { plan, life, dispatch } = useDayPlan();

    // Persistent map: todoistId → intention title (always available, not just in linking mode).
    // v6.1: orphan habit-tasks (intentionId === undefined) are skipped — they have no intention to label.
    const persistentLinks = useMemo(() => {
        const map = new Map<string, string>();
        const intentionMap = new Map(plan.intentions.map((i) => [i.id, i.title]));
        for (const lt of plan.linkedTasks) {
            if (lt.intentionId === undefined) continue;
            const title = intentionMap.get(lt.intentionId);
            if (title) map.set(lt.todoistId, title);
        }
        return map;
    }, [plan.linkedTasks, plan.intentions]);

    // Persistent map: todoistId → estimatedMinutes (for auto-filling schedule end times)
    const estimateMap = useMemo(() => {
        const map = new Map<string, number>();
        for (const lt of plan.linkedTasks) {
            if (lt.estimatedMinutes) {
                map.set(lt.todoistId, lt.estimatedMinutes);
            }
        }
        return map;
    }, [plan.linkedTasks]);

    // Todoist task ids backed by an active 'habit'-kind habit. Source of truth for the 🔁 Habit
    // label (shown on every mount, not just linking mode). Derived from `life.habits` rather than
    // `plan.todaysHabits` so the label still shows when no instance fired today — e.g. a habit
    // scheduled to an already-passed time with a strict window, which (correctly) never produces a
    // today-instance but is still a habit-managed task in the panel.
    const habitTodoistIds = useMemo(
        () => new Set(
            life.habits
                .filter((h) => h.active && h.kind === 'habit' && h.todoistTaskId)
                .map((h) => h.todoistTaskId as string),
        ),
        [life.habits],
    );
    // Lookup: todoistId → non-terminal habit instance id (for COMPLETE_HABIT_INSTANCE on panel complete).
    const habitInstanceByTodoistId = useMemo(() => {
        const map = new Map<string, string>();
        for (const i of plan.todaysHabits) {
            if (i.todoistTaskId && i.status !== 'completed' && i.status !== 'skipped') {
                map.set(i.todoistTaskId, i.id);
            }
        }
        return map;
    }, [plan.todaysHabits]);

    // Internal filter toggle state
    const [filterToggleActive, setFilterToggleActive] = useState(defaultFiltered);
    const internalLinkedTaskIds = useMemo(
        () => new Set(plan.linkedTasks.map((lt) => lt.todoistId)),
        [plan.linkedTasks],
    );
    const hasLinkedTasks = internalLinkedTaskIds.size > 0;
    const effectiveFilterIds = showFilterToggle
        ? (filterToggleActive ? internalLinkedTaskIds : undefined)
        : filterToTaskIds;

    const [newProjectName, setNewProjectName] = useState('');
    const [newProjectParentId, setNewProjectParentId] = useState<string>('');
    const [showNewProject, setShowNewProject] = useState(false);

    const fullTree = useMemo(
        () => buildProjectTree(projects, tasks, sections),
        [projects, tasks, sections],
    );

    const tree = useMemo(
        () => effectiveFilterIds ? pruneTree(fullTree, effectiveFilterIds) : fullTree,
        [fullTree, effectiveFilterIds],
    );

    // Build sub-task lookup: parent_id → child tasks
    const subTaskMap = useMemo(() => {
        const map = new Map<string, TodoistTask[]>();
        for (const t of tasks) {
            if (t.parent_id) {
                const list = map.get(t.parent_id) ?? [];
                list.push(t);
                map.set(t.parent_id, list);
            }
        }
        // Sort children
        for (const [, list] of map) {
            list.sort((a, b) => a.child_order - b.child_order);
        }
        return map;
    }, [tasks]);

    // Flatten projects for the "add task" project picker
    const flatProjects = useMemo(() => {
        const result: { id: string; name: string; depth: number }[] = [];
        function walk(nodes: ProjectNode[], depth: number) {
            for (const n of nodes) {
                result.push({ id: n.project.id, name: n.project.name, depth });
                walk(n.children, depth + 1);
            }
        }
        walk(tree, 0);
        return result;
    }, [tree]);

    // Wrap complete/delete to also update the day plan
    const handleCompleteTask = useCallback(
        async (taskId: string) => {
            const linked = plan.linkedTasks.find((lt) => lt.todoistId === taskId);
            if (linked && !linked.completed) {
                // Snapshot the title before Todoist removes it from active tasks
                const title = tasks.find((t) => t.id === taskId)?.content;
                dispatch({ type: 'TOGGLE_TASK_COMPLETE', todoistId: taskId, titleSnapshot: title });
            }
            const instanceId = habitInstanceByTodoistId.get(taskId);
            const completed = await completeTask(taskId);
            // If this task backs a habit instance, keep the Habits surface in sync only after the
            // recurring Todoist occurrence actually advanced.
            if (instanceId && completed) {
                dispatch({ type: 'COMPLETE_HABIT_INSTANCE', instanceId, now: new Date().toISOString() });
            }
        },
        [completeTask, plan.linkedTasks, tasks, dispatch, habitInstanceByTodoistId],
    );

    const handleDeleteTask = useCallback(
        (taskId: string) => {
            const toRemove = collectDescendantIds(tasks, [taskId], (t) => t.parent_id);
            void deleteTask(taskId).then((deleted) => {
                // Only unlink once the delete actually landed — a failed delete leaves the task
                // alive in Todoist, and silently unlinking it would orphan a live task.
                if (!deleted) return;
                for (const id of toRemove) {
                    if (plan.linkedTasks.some((lt) => lt.todoistId === id)) {
                        dispatch({ type: 'UNLINK_TASK', todoistId: id });
                    }
                }
            });
        },
        [deleteTask, tasks, plan.linkedTasks, dispatch],
    );

    // Reorder a sibling group: permute the group's *existing* child_order values among the
    // new id order. Reusing the existing values keeps the change local to the group and can't
    // collide with sibling groups (sections / other parents) that we don't touch.
    const childOrderById = useMemo(
        () => new Map(tasks.map((t) => [t.id, t.child_order])),
        [tasks],
    );
    const handleReorderSiblings = useCallback(
        (orderedIds: string[]) => {
            const orders = orderedIds
                .map((id) => childOrderById.get(id) ?? 0)
                .sort((a, b) => a - b);
            const items = orderedIds.map((id, idx) => ({ id, child_order: orders[idx] }));
            void reorderTasks(items);
        },
        [childOrderById, reorderTasks],
    );

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

    const handleRefresh = () => {
        refreshTasks({ force: true });
        refreshProjects({ force: true });
        refreshSections({ force: true });
    };

    const handleCreateProject = async () => {
        if (!newProjectName.trim()) return;
        const opts = newProjectParentId ? { parent_id: newProjectParentId } : undefined;
        await createProject(newProjectName.trim(), opts);
        setNewProjectName('');
        setNewProjectParentId('');
        setShowNewProject(false);
    };

    const handleDeleteProject = async (projectId: string) => {
        await deleteProject(projectId);
    };

    const handleSchedule = async (taskId: string, startTime: string, endTime: string) => {
        const durationMinutes = timeToMinutes(endTime) - timeToMinutes(startTime);
        if (durationMinutes <= 0) return;
        await updateTask(taskId, {
            due_datetime: `${todayISO()}T${startTime}:00`,
            duration: durationMinutes,
            duration_unit: 'minute',
        });
    };

    const handleClearSchedule = async (taskId: string) => {
        await updateTask(taskId, { due_date: todayISO() });
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
                    {showFilterToggle && hasLinkedTasks && (
                        <div className="flex items-center gap-1 ml-1">
                            <button
                                onClick={() => setFilterToggleActive(false)}
                                className={`px-2 py-0.5 text-[10px] rounded-full border transition-colors cursor-pointer ${!filterToggleActive
                                    ? 'bg-accent text-white border-accent'
                                    : 'border-border text-text-light hover:border-accent hover:text-accent'
                                    }`}
                            >
                                All Tasks
                            </button>
                            <button
                                onClick={() => setFilterToggleActive(true)}
                                className={`px-2 py-0.5 text-[10px] rounded-full border transition-colors cursor-pointer ${filterToggleActive
                                    ? 'bg-accent text-white border-accent'
                                    : 'border-border text-text-light hover:border-accent hover:text-accent'
                                    }`}
                            >
                                Linked Tasks
                            </button>
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <a
                        href="todoist://"
                        className="text-xs text-accent hover:underline cursor-pointer"
                        title="Open in Todoist desktop app"
                    >
                        Open in Todoist ↗
                    </a>
                    <button
                        onClick={handleRefresh}
                        className="text-xs text-accent hover:underline cursor-pointer"
                        title="Refresh"
                    >
                        ↻
                    </button>
                </div>
            </div>

            {/* Error */}
            {error && (
                <div className="px-3 py-2 text-xs text-red-500 bg-red-50 dark:bg-red-900/20">
                    {error}
                </div>
            )}

            {/* Project tree */}
            <div className="flex-1 overflow-y-auto scrollbar-subtle py-1">
                {tree.length === 0 && !loading && (
                    <p className="text-xs text-text-light py-4 text-center">No projects</p>
                )}
                {tree.map((node) => (
                    <ProjectTreeNode
                        key={node.project.id}
                        node={node}
                        depth={0}
                        onComplete={handleCompleteTask}
                        onCreateTask={createTask}
                        onDeleteTask={handleDeleteTask}
                        onDeleteProject={handleDeleteProject}
                        onSchedule={handleSchedule}
                        onClearSchedule={handleClearSchedule}
                        onEditContent={(taskId, content) => updateTask(taskId, { content })}
                        onReorderSiblings={handleReorderSiblings}
                        subTaskMap={subTaskMap}
                        compact={mode === 'compact'}
                        linking={linking}
                        persistentLinks={persistentLinks}
                        estimateMap={estimateMap}
                        habitTodoistIds={habitTodoistIds}
                    />
                ))}
            </div>

            {/* Create project input */}
            {mode === 'full' && (
                <div className="px-3 py-2 border-t border-border space-y-1.5">
                    {showNewProject ? (
                        <div className="space-y-1.5">
                            <select
                                value={newProjectParentId}
                                onChange={(e) => setNewProjectParentId(e.target.value)}
                                className="w-full text-xs px-2 py-1 rounded border border-border bg-card text-text focus:outline-none focus:ring-1 focus:ring-accent/30"
                            >
                                <option value="">Root project</option>
                                {flatProjects.map((p) => (
                                    <option key={p.id} value={p.id}>
                                        {'  '.repeat(p.depth)}↳ {p.name}
                                    </option>
                                ))}
                            </select>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={newProjectName}
                                    onChange={(e) => setNewProjectName(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') handleCreateProject();
                                        if (e.key === 'Escape') { setShowNewProject(false); setNewProjectName(''); setNewProjectParentId(''); }
                                    }}
                                    placeholder="Project name…"
                                    className="flex-1 px-2 py-1.5 text-xs rounded border border-border bg-card text-text focus:outline-none focus:ring-1 focus:ring-accent/30 transition-colors"
                                    autoFocus
                                />
                                <button
                                    onClick={handleCreateProject}
                                    disabled={!newProjectName.trim()}
                                    className="px-2.5 py-1.5 text-xs rounded bg-accent text-white hover:bg-accent/80 disabled:opacity-40 transition-colors cursor-pointer"
                                >
                                    +
                                </button>
                                <button
                                    onClick={() => { setShowNewProject(false); setNewProjectName(''); setNewProjectParentId(''); }}
                                    className="px-2 py-1.5 text-xs text-text-light hover:text-text cursor-pointer"
                                >
                                    ✕
                                </button>
                            </div>
                        </div>
                    ) : (
                        <button
                            onClick={() => setShowNewProject(true)}
                            className="w-full text-xs text-text-light hover:text-accent py-1 cursor-pointer text-left"
                        >
                            + New project
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

// --- Project tree node (recursive) ---

function ProjectTreeNode({
    node,
    depth,
    onComplete,
    onCreateTask,
    onDeleteTask,
    onDeleteProject,
    onSchedule,
    onClearSchedule,
    onEditContent,
    onReorderSiblings,
    subTaskMap,
    compact,
    linking,
    persistentLinks,
    estimateMap,
    habitTodoistIds,
}: {
    node: ProjectNode;
    depth: number;
    onComplete: (id: string) => void;
    onCreateTask: (content: string, opts?: { project_id?: string }) => Promise<unknown>;
    onDeleteTask: (id: string) => void;
    onDeleteProject: (id: string) => void;
    onSchedule: (taskId: string, startTime: string, endTime: string) => void;
    onClearSchedule: (taskId: string) => void;
    onEditContent: (taskId: string, content: string) => void;
    onReorderSiblings: (orderedIds: string[]) => void;
    subTaskMap: Map<string, TodoistTask[]>;
    compact: boolean;
    linking?: LinkingProps;
    persistentLinks: Map<string, string>;
    estimateMap: Map<string, number>;
    habitTodoistIds: Set<string>;
}) {
    const [collapsed, setCollapsed] = useState(depth > 0);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [showAddTask, setShowAddTask] = useState(false);
    const [newTaskContent, setNewTaskContent] = useState('');
    const taskCount = countTasksInNode(node);
    const hasContent = taskCount > 0 || node.children.length > 0;
    const colorHex = TODOIST_COLORS[node.project.color] ?? TODOIST_COLORS.charcoal;

    // Group tasks by section
    const unsectionedTasks = node.tasks.filter((t) => !t.section_id);
    const unsectionedReorder = useRowReorder(
        unsectionedTasks.map((t) => t.id),
        onReorderSiblings,
    );
    const tasksBySection = new Map<string, TodoistTask[]>();
    for (const t of node.tasks) {
        if (t.section_id) {
            const list = tasksBySection.get(t.section_id) ?? [];
            list.push(t);
            tasksBySection.set(t.section_id, list);
        }
    }

    return (
        <div>
            {/* Project header */}
            <button
                onClick={() => setCollapsed((c) => !c)}
                className="w-full flex items-center gap-1.5 px-2 py-1.5 hover:bg-border/30 transition-colors cursor-pointer group"
                style={{ paddingLeft: `${8 + depth * 16}px` }}
            >
                {/* Collapse chevron */}
                <span
                    className="text-[10px] text-text-light transition-transform w-3 flex-shrink-0"
                    style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}
                >
                    ▼
                </span>
                {/* Color dot */}
                <span
                    className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                    style={{ backgroundColor: colorHex }}
                />
                {/* Project name */}
                <span className={`text-sm font-medium truncate flex-1 text-left ${depth === 0 ? '' : 'text-text-light'}`}>
                    {node.project.name}
                </span>
                {/* Task count badge */}
                {taskCount > 0 && (
                    <span className="text-xs text-text-light tabular-nums ml-auto">
                        {taskCount}
                    </span>
                )}
                {/* Add task button (hover) */}
                <span
                    className="text-xs text-text-light opacity-0 group-hover:opacity-100 hover:!text-accent transition-opacity ml-1 flex-shrink-0"
                    role="button"
                    tabIndex={0}
                    title="Add task"
                    onClick={(e) => { e.stopPropagation(); setShowAddTask(true); setCollapsed(false); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); setShowAddTask(true); setCollapsed(false); } }}
                >
                    +
                </span>
                {/* Delete project button (hover) */}
                <span
                    className="text-xs text-text-light opacity-0 group-hover:opacity-100 hover:!text-red-500 transition-opacity ml-1 flex-shrink-0"
                    role="button"
                    tabIndex={0}
                    title="Delete project"
                    onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); setConfirmDelete(true); } }}
                >
                    ✕
                </span>
            </button>

            {/* Delete confirmation */}
            {confirmDelete && (
                <div
                    className="flex items-center gap-2 px-3 py-1.5 bg-red-50 dark:bg-red-900/20 text-xs"
                    style={{ paddingLeft: `${24 + depth * 16}px` }}
                >
                    <span className="text-red-600 dark:text-red-400">Delete &ldquo;{node.project.name}&rdquo;?</span>
                    <button
                        onClick={() => { onDeleteProject(node.project.id); setConfirmDelete(false); }}
                        className="text-red-600 dark:text-red-400 font-medium hover:underline cursor-pointer"
                    >
                        Yes
                    </button>
                    <button
                        onClick={() => setConfirmDelete(false)}
                        className="text-text-light hover:underline cursor-pointer"
                    >
                        No
                    </button>
                </div>
            )}

            {/* Inline add-task input */}
            {showAddTask && (
                <div
                    className="flex items-center gap-2 px-2 py-1.5"
                    style={{ paddingLeft: `${24 + depth * 16}px` }}
                >
                    <input
                        type="text"
                        value={newTaskContent}
                        onChange={(e) => setNewTaskContent(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && newTaskContent.trim()) {
                                onCreateTask(newTaskContent.trim(), { project_id: node.project.id });
                                setNewTaskContent('');
                                setShowAddTask(false);
                            }
                            if (e.key === 'Escape') { setShowAddTask(false); setNewTaskContent(''); }
                        }}
                        placeholder="Add task…"
                        className="flex-1 px-2 py-1 text-xs rounded border border-border bg-card text-text focus:outline-none focus:ring-1 focus:ring-accent/30 transition-colors"
                        autoFocus
                    />
                    <button
                        onClick={() => {
                            if (!newTaskContent.trim()) return;
                            onCreateTask(newTaskContent.trim(), { project_id: node.project.id });
                            setNewTaskContent('');
                            setShowAddTask(false);
                        }}
                        disabled={!newTaskContent.trim()}
                        className="px-2 py-1 text-xs rounded bg-accent text-white hover:bg-accent/80 disabled:opacity-40 transition-colors cursor-pointer"
                    >
                        +
                    </button>
                    <button
                        onClick={() => { setShowAddTask(false); setNewTaskContent(''); }}
                        className="text-xs text-text-light hover:text-text cursor-pointer"
                    >
                        ✕
                    </button>
                </div>
            )}

            {/* Expanded content */}
            {!collapsed && hasContent && (
                <div>
                    {/* Unsectioned tasks */}
                    {unsectionedTasks.map((task) => (
                        <TaskRow
                            key={task.id}
                            task={task}
                            depth={depth + 1}
                            onComplete={onComplete}
                            onDelete={onDeleteTask}
                            onSchedule={onSchedule}
                            onClearSchedule={onClearSchedule}
                            onEditContent={onEditContent}
                            onReorderSiblings={onReorderSiblings}
                            reorder={unsectionedReorder(task.id, unsectionedTasks.length > 1)}
                            subTaskMap={subTaskMap}
                            compact={compact}
                            linking={linking}
                            persistentLinks={persistentLinks}
                            estimateMap={estimateMap}
                            habitTodoistIds={habitTodoistIds}
                        />
                    ))}

                    {/* Sections with their tasks */}
                    {node.sections.map((section) => {
                        const sectionTasks = tasksBySection.get(section.id) ?? [];
                        if (sectionTasks.length === 0) return null;
                        return (
                            <SectionGroup
                                key={section.id}
                                linking={linking}
                                section={section}
                                tasks={sectionTasks}
                                depth={depth + 1}
                                onComplete={onComplete}
                                onDelete={onDeleteTask}
                                onSchedule={onSchedule}
                                onClearSchedule={onClearSchedule}
                                onEditContent={onEditContent}
                                onReorderSiblings={onReorderSiblings}
                                subTaskMap={subTaskMap}
                                compact={compact}
                                persistentLinks={persistentLinks}
                                estimateMap={estimateMap}
                                habitTodoistIds={habitTodoistIds}
                            />
                        );
                    })}

                    {/* Child projects */}
                    {node.children.map((child) => (
                        <ProjectTreeNode
                            key={child.project.id}
                            node={child}
                            depth={depth + 1}
                            onComplete={onComplete}
                            onCreateTask={onCreateTask}
                            onDeleteTask={onDeleteTask}
                            onDeleteProject={onDeleteProject}
                            onSchedule={onSchedule}
                            onClearSchedule={onClearSchedule}
                            onEditContent={onEditContent}
                            onReorderSiblings={onReorderSiblings}
                            subTaskMap={subTaskMap}
                            compact={compact}
                            linking={linking}
                            persistentLinks={persistentLinks}
                            estimateMap={estimateMap}
                            habitTodoistIds={habitTodoistIds}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

// --- Section group ---

function SectionGroup({
    section,
    tasks,
    depth,
    onComplete,
    onDelete,
    onSchedule,
    onClearSchedule,
    onEditContent,
    onReorderSiblings,
    subTaskMap,
    compact,
    linking,
    persistentLinks,
    estimateMap,
    habitTodoistIds,
}: {
    section: TodoistSection;
    tasks: TodoistTask[];
    depth: number;
    onComplete: (id: string) => void;
    onDelete: (id: string) => void;
    onSchedule: (taskId: string, startTime: string, endTime: string) => void;
    onClearSchedule: (taskId: string) => void;
    onEditContent: (taskId: string, content: string) => void;
    onReorderSiblings: (orderedIds: string[]) => void;
    subTaskMap: Map<string, TodoistTask[]>;
    compact: boolean;
    linking?: LinkingProps;
    persistentLinks: Map<string, string>;
    estimateMap: Map<string, number>;
    habitTodoistIds: Set<string>;
}) {
    const [collapsed, setCollapsed] = useState(false);
    const reorder = useRowReorder(tasks.map((t) => t.id), onReorderSiblings);

    return (
        <div>
            <button
                onClick={() => setCollapsed((c) => !c)}
                className="w-full flex items-center gap-1.5 px-2 py-1 hover:bg-border/30 transition-colors cursor-pointer"
                style={{ paddingLeft: `${8 + depth * 16}px` }}
            >
                <span
                    className="text-[10px] text-text-light transition-transform w-3 flex-shrink-0"
                    style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}
                >
                    ▼
                </span>
                <span className="text-xs font-semibold text-text-light uppercase tracking-wider truncate">
                    {section.name}
                </span>
                <span className="text-xs text-text-light tabular-nums ml-auto">
                    {tasks.length}
                </span>
            </button>
            {!collapsed &&
                tasks.map((task) => (
                    <TaskRow
                        key={task.id}
                        task={task}
                        depth={depth + 1}
                        onComplete={onComplete}
                        onDelete={onDelete}
                        onSchedule={onSchedule}
                        onClearSchedule={onClearSchedule}
                        onEditContent={onEditContent}
                        onReorderSiblings={onReorderSiblings}
                        reorder={reorder(task.id, tasks.length > 1)}
                        subTaskMap={subTaskMap}
                        compact={compact}
                        linking={linking}
                        persistentLinks={persistentLinks}
                        estimateMap={estimateMap}
                        habitTodoistIds={habitTodoistIds}
                    />
                ))}
        </div>
    );
}

// --- Task row (with recursive sub-tasks) ---

function TaskRow({
    task,
    depth,
    onComplete,
    onDelete,
    onSchedule,
    onClearSchedule,
    onEditContent,
    onReorderSiblings,
    reorder,
    subTaskMap,
    compact,
    linking,
    persistentLinks,
    estimateMap,
    habitTodoistIds,
}: {
    task: TodoistTask;
    depth: number;
    onComplete: (id: string) => void;
    onDelete: (id: string) => void;
    onSchedule: (taskId: string, startTime: string, endTime: string) => void;
    onClearSchedule: (taskId: string) => void;
    onEditContent: (taskId: string, content: string) => void;
    onReorderSiblings: (orderedIds: string[]) => void;
    /** Drag state + handlers for this row within its sibling group. */
    reorder?: RowReorderState;
    subTaskMap: Map<string, TodoistTask[]>;
    compact: boolean;
    linking?: LinkingProps;
    persistentLinks: Map<string, string>;
    estimateMap: Map<string, number>;
    habitTodoistIds: Set<string>;
}) {
    const children = subTaskMap.get(task.id);
    const childReorder = useRowReorder((children ?? []).map((c) => c.id), onReorderSiblings);
    const [childrenCollapsed, setChildrenCollapsed] = useState(false);
    const [showTimePicker, setShowTimePicker] = useState(false);
    const [pickerStart, setPickerStart] = useState('');
    const [pickerEnd, setPickerEnd] = useState('');
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState('');
    const editInputRef = useRef<HTMLInputElement>(null);

    const startEditing = useCallback(() => {
        setIsEditing(true);
        setEditValue(task.content);
        requestAnimationFrame(() => editInputRef.current?.focus());
    }, [task.content]);

    const commitEdit = useCallback(() => {
        const trimmed = editValue.trim();
        if (trimmed && trimmed !== task.content) {
            onEditContent(task.id, trimmed);
        }
        setIsEditing(false);
        setEditValue('');
    }, [editValue, task.content, task.id, onEditContent]);

    const cancelEdit = useCallback(() => {
        setIsEditing(false);
        setEditValue('');
    }, []);

    // Parse existing schedule for today
    const todayStr = todayISO();
    const hasDueTime = task.due?.date?.includes('T') ?? false;
    const isDueToday = task.due?.date?.startsWith(todayStr) ?? false;
    const scheduledStart = hasDueTime && isDueToday
        ? task.due!.date.slice(11, 16)
        : null;
    const durationMinutes = task.duration?.unit === 'minute' ? task.duration.amount : null;
    const scheduledEnd = scheduledStart && durationMinutes
        ? addMinutesToTime(scheduledStart, durationMinutes)
        : null;
    const isScheduled = scheduledStart !== null;

    const formatTime = (hhmm: string) => {
        const [h, m] = hhmm.split(':').map(Number);
        const d = new Date();
        d.setHours(h, m);
        return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    };

    const handleOpenPicker = () => {
        setPickerStart(scheduledStart ?? '');
        setPickerEnd(scheduledEnd ?? '');
        setShowTimePicker(true);
    };

    const handleSubmitSchedule = () => {
        if (!pickerStart || !pickerEnd) return;
        const [sh, sm] = pickerStart.split(':').map(Number);
        const [eh, em] = pickerEnd.split(':').map(Number);
        if (eh * 60 + em <= sh * 60 + sm) return;
        onSchedule(task.id, pickerStart, pickerEnd);
        setShowTimePicker(false);
    };

    // Linking mode state
    const isLinkedToCurrentIntention = linking?.linkedTaskIds.includes(task.id) ?? false;
    // Detect habit-backed Todoist tasks. Shown on every mount (not just linking) as a 🔁 Habit
    // label; the Link affordance + Delete action are suppressed for these rows.
    const isHabitBacked = habitTodoistIds.has(task.id);
    const linkedToOther = linking && !isHabitBacked
        ? linking.allLinkedTasks.find(
            (lt) => lt.todoistId === task.id
                && lt.intentionId !== undefined
                && lt.intentionId !== linking.linkingIntentionId,
        )
        : null;
    const linkedToOtherTitle = linkedToOther && linkedToOther.intentionId
        ? linking!.intentionTitles[linkedToOther.intentionId]
        : null;

    // Persistent link label (when not in linking mode, or linked to current intention in linking mode)
    const persistentLinkTitle = !linking ? persistentLinks.get(task.id) : null;

    // Drag-reorder: the whole row is the drag surface (a grip is shown for affordance).
    // Disabled while inline-editing so text selection in the input still works.
    const rowDrag = isEditing ? undefined : reorder?.dragHandleProps;

    return (
        <div>
            <div
                {...rowDrag}
                className={`flex items-start gap-2 py-1 px-2 group ${(isLinkedToCurrentIntention || persistentLinkTitle) ? 'bg-accent/5 border-l-2 border-accent' : ''} ${reorder?.isDragging ? 'opacity-40' : ''} ${reorder?.isDragOver ? 'border-t-2 border-accent' : ''}`}
                style={{ paddingLeft: `${8 + depth * 16}px` }}
            >
                {/* Drag handle (affordance only — the whole row is draggable) */}
                {rowDrag && (
                    <span
                        className="cursor-grab active:cursor-grabbing text-text-light/40 hover:text-text-light opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-1 select-none"
                        title="Drag to reorder"
                        aria-hidden
                    >
                        <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor">
                            <circle cx="3.5" cy="2" r="1.2" />
                            <circle cx="8.5" cy="2" r="1.2" />
                            <circle cx="3.5" cy="6" r="1.2" />
                            <circle cx="8.5" cy="6" r="1.2" />
                            <circle cx="3.5" cy="10" r="1.2" />
                            <circle cx="8.5" cy="10" r="1.2" />
                        </svg>
                    </span>
                )}
                {/* Sub-task toggle */}
                {children && children.length > 0 ? (
                    <button
                        onClick={() => setChildrenCollapsed((c) => !c)}
                        className="w-3 mt-1 flex-shrink-0 text-[10px] text-text-light cursor-pointer"
                        style={{ transform: childrenCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}
                    >
                        ▼
                    </button>
                ) : (
                    <span className="w-3 flex-shrink-0" />
                )}
                {/* Completion button (always visible) */}
                <button
                    onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        confetti({
                            particleCount: 40,
                            spread: 60,
                            startVelocity: 20,
                            gravity: 1.2,
                            scalar: 0.7,
                            ticks: 80,
                            origin: {
                                x: rect.left / window.innerWidth,
                                y: rect.top / window.innerHeight,
                            },
                        });
                        onComplete(task.id);
                    }}
                    className="w-4 h-4 mt-0.5 flex-shrink-0 rounded-full border border-border hover:border-accent hover:bg-accent/10 transition-colors cursor-pointer"
                    title="Complete"
                />
                <div className="min-w-0 flex-1">
                    {isEditing ? (
                        <input
                            ref={editInputRef}
                            type="text"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
                                if (e.key === 'Escape') cancelEdit();
                            }}
                            onBlur={commitEdit}
                            className="w-full text-sm px-1 py-0.5 -ml-1 rounded border border-accent/30 bg-accent-subtle/30 focus:outline-none focus:ring-1 focus:ring-accent/30"
                        />
                    ) : (
                        <p
                            className="text-sm leading-snug cursor-text rounded px-1 -ml-1 hover:bg-surface-dark/40 transition-colors"
                            onClick={startEditing}
                            title="Click to edit"
                        >
                            {task.content}
                        </p>
                    )}
                    {(linkedToOtherTitle || persistentLinkTitle) && (
                        <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5">
                            linked to: {linkedToOtherTitle || persistentLinkTitle}
                        </p>
                    )}
                    {!compact && task.due && (
                        <p className="text-xs text-text-light mt-0.5">
                            {isScheduled
                                ? `${formatTime(scheduledStart!)}${scheduledEnd ? ` – ${formatTime(scheduledEnd)}` : ''}`
                                : task.due.date.startsWith(todayStr)
                                    ? 'Today'
                                    : task.due.date.includes('T')
                                        ? new Date(task.due.date).toLocaleString([], {
                                            month: 'short',
                                            day: 'numeric',
                                            hour: 'numeric',
                                            minute: '2-digit',
                                        })
                                        : task.due.date}
                        </p>
                    )}
                    {compact && isScheduled && (
                        <span className="text-[10px] text-accent">
                            {formatTime(scheduledStart!)}{scheduledEnd ? ` – ${formatTime(scheduledEnd)}` : ''}
                        </span>
                    )}
                </div>
                {/* Habit-backed tasks render a non-actionable 🔁 Habit label on every mount.
                    Otherwise, in linking mode, the Link/Unlink button. */}
                {isHabitBacked ? (
                    <span
                        className="text-[10px] flex-shrink-0 mt-0.5 px-1.5 py-0.5 rounded-full bg-accent-subtle text-accent font-medium"
                        title="Habit-derived task — managed via the Habits library"
                    >
                        🔁 Habit
                    </span>
                ) : linking ? (
                    <button
                        onClick={() => {
                            if (isLinkedToCurrentIntention) {
                                linking.onUnlinkTask(task.id);
                            } else {
                                linking.onLinkTask(task.id);
                            }
                        }}
                        className={`text-xs flex-shrink-0 mt-0.5 cursor-pointer transition-colors font-medium ${isLinkedToCurrentIntention
                            ? 'text-accent hover:text-red-500'
                            : 'text-text-light opacity-0 group-hover:opacity-100 hover:!text-accent'
                            }`}
                        title={isLinkedToCurrentIntention ? 'Unlink from intention' : 'Link to intention'}
                    >
                        {isLinkedToCurrentIntention ? 'Unlink' : 'Link'}
                    </button>
                ) : null}
                {/* Schedule button (hover) */}
                <button
                    onClick={handleOpenPicker}
                    className={`text-xs flex-shrink-0 mt-0.5 cursor-pointer transition-opacity ${isScheduled
                        ? 'text-accent opacity-100'
                        : 'text-text-light opacity-0 group-hover:opacity-100 hover:!text-accent'
                        }`}
                    title={isScheduled ? `${scheduledStart}${scheduledEnd ? ` – ${scheduledEnd}` : ''}` : 'Schedule for today'}
                >
                    ⏱
                </button>
                {/* Delete task button (hover) — hidden for habit-backed rows (deleting the
                    Todoist task would dangle the habit's sync link; manage via the Habits library). */}
                {!isHabitBacked && (
                    <button
                        onClick={() => onDelete(task.id)}
                        className="text-xs text-text-light opacity-0 group-hover:opacity-100 hover:!text-red-500 transition-opacity flex-shrink-0 mt-0.5 cursor-pointer"
                        title="Delete task"
                    >
                        ✕
                    </button>
                )}
            </div>
            {/* Inline time range picker */}
            {showTimePicker && (
                <div
                    className="flex items-center gap-1.5 px-2 py-1"
                    style={{ paddingLeft: `${52 + depth * 16}px` }}
                >
                    <input
                        type="time"
                        value={pickerStart}
                        onChange={(e) => {
                            const val = e.target.value;
                            setPickerStart(val);
                            const est = estimateMap.get(task.id);
                            if (est && val) {
                                setPickerEnd(addMinutesToTime(val, est));
                            }
                        }}
                        className="px-1.5 py-0.5 text-xs rounded border border-border bg-card text-text focus:outline-none focus:ring-1 focus:ring-accent/30 dark:[color-scheme:dark]"
                        autoFocus
                    />
                    <span className="text-xs text-text-light">–</span>
                    <input
                        type="time"
                        value={pickerEnd}
                        onChange={(e) => setPickerEnd(e.target.value)}
                        className="px-1.5 py-0.5 text-xs rounded border border-border bg-card text-text focus:outline-none focus:ring-1 focus:ring-accent/30 dark:[color-scheme:dark]"
                    />
                    <button
                        onClick={handleSubmitSchedule}
                        disabled={!pickerStart || !pickerEnd}
                        className="px-2 py-0.5 text-xs rounded bg-accent text-white hover:bg-accent/80 disabled:opacity-40 transition-colors cursor-pointer"
                    >
                        Set
                    </button>
                    {isScheduled && (
                        <button
                            onClick={() => {
                                onClearSchedule(task.id);
                                setShowTimePicker(false);
                            }}
                            className="text-xs text-text-light hover:text-red-500 cursor-pointer"
                            title="Remove schedule"
                        >
                            Clear
                        </button>
                    )}
                    <button
                        onClick={() => setShowTimePicker(false)}
                        className="text-xs text-text-light hover:text-text cursor-pointer"
                    >
                        ✕
                    </button>
                </div>
            )}
            {/* Sub-tasks */}
            {children && !childrenCollapsed &&
                children.map((child) => (
                    <TaskRow
                        key={child.id}
                        task={child}
                        depth={depth + 1}
                        onComplete={onComplete}
                        onDelete={onDelete}
                        onSchedule={onSchedule}
                        onClearSchedule={onClearSchedule}
                        onEditContent={onEditContent}
                        onReorderSiblings={onReorderSiblings}
                        reorder={childReorder(child.id, children.length > 1)}
                        subTaskMap={subTaskMap}
                        compact={compact}
                        linking={linking}
                        persistentLinks={persistentLinks}
                        estimateMap={estimateMap}
                        habitTodoistIds={habitTodoistIds}
                    />
                ))}
        </div>
    );
}
