import { useState, useMemo } from 'react';
import { useTodoist, type TodoistTask, type TodoistProject, type TodoistSection } from '../../hooks/useTodoist';

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

interface TodoistPanelProps {
    mode?: 'compact' | 'full';
    onSetup?: () => void;
}

export function TodoistPanel({ mode = 'full', onSetup }: TodoistPanelProps) {
    const {
        tasks,
        projects,
        sections,
        loading,
        error,
        isConfigured,
        createTask,
        completeTask,
        refreshTasks,
        refreshProjects,
        refreshSections,
    } = useTodoist();

    const [newTask, setNewTask] = useState('');
    const [createProjectId, setCreateProjectId] = useState<string>('');

    const tree = useMemo(
        () => buildProjectTree(projects, tasks, sections),
        [projects, tasks, sections],
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
        refreshTasks();
        refreshProjects();
        refreshSections();
    };

    const handleCreate = async () => {
        if (!newTask.trim()) return;
        const opts = createProjectId ? { project_id: createProjectId } : undefined;
        await createTask(newTask.trim(), opts);
        setNewTask('');
    };

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
                    onClick={handleRefresh}
                    className="text-xs text-accent hover:underline cursor-pointer"
                    title="Refresh"
                >
                    ↻
                </button>
            </div>

            {/* Error */}
            {error && (
                <div className="px-3 py-2 text-xs text-red-500 bg-red-50 dark:bg-red-900/20">
                    {error}
                </div>
            )}

            {/* Project tree */}
            <div className="flex-1 overflow-y-auto py-1">
                {tree.length === 0 && !loading && (
                    <p className="text-xs text-text-light py-4 text-center">No projects</p>
                )}
                {tree.map((node) => (
                    <ProjectTreeNode
                        key={node.project.id}
                        node={node}
                        depth={0}
                        onComplete={completeTask}
                        subTaskMap={subTaskMap}
                        compact={mode === 'compact'}
                    />
                ))}
            </div>

            {/* Create task input */}
            {mode === 'full' && (
                <div className="px-3 py-2 border-t border-border space-y-1.5">
                    <select
                        value={createProjectId}
                        onChange={(e) => setCreateProjectId(e.target.value)}
                        className="w-full text-xs px-2 py-1 rounded border border-border bg-card text-text focus:outline-none focus:ring-1 focus:ring-accent/30"
                    >
                        <option value="">Inbox</option>
                        {flatProjects.map((p) => (
                            <option key={p.id} value={p.id}>
                                {'  '.repeat(p.depth)}{p.name}
                            </option>
                        ))}
                    </select>
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
            )}
        </div>
    );
}

// --- Project tree node (recursive) ---

function ProjectTreeNode({
    node,
    depth,
    onComplete,
    subTaskMap,
    compact,
}: {
    node: ProjectNode;
    depth: number;
    onComplete: (id: string) => void;
    subTaskMap: Map<string, TodoistTask[]>;
    compact: boolean;
}) {
    const [collapsed, setCollapsed] = useState(depth > 0);
    const taskCount = countTasksInNode(node);
    const hasContent = taskCount > 0 || node.children.length > 0;
    const colorHex = TODOIST_COLORS[node.project.color] ?? TODOIST_COLORS.charcoal;

    // Group tasks by section
    const unsectionedTasks = node.tasks.filter((t) => !t.section_id);
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
            </button>

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
                            subTaskMap={subTaskMap}
                            compact={compact}
                        />
                    ))}

                    {/* Sections with their tasks */}
                    {node.sections.map((section) => {
                        const sectionTasks = tasksBySection.get(section.id) ?? [];
                        if (sectionTasks.length === 0) return null;
                        return (
                            <SectionGroup
                                key={section.id}
                                section={section}
                                tasks={sectionTasks}
                                depth={depth + 1}
                                onComplete={onComplete}
                                subTaskMap={subTaskMap}
                                compact={compact}
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
                            subTaskMap={subTaskMap}
                            compact={compact}
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
    subTaskMap,
    compact,
}: {
    section: TodoistSection;
    tasks: TodoistTask[];
    depth: number;
    onComplete: (id: string) => void;
    subTaskMap: Map<string, TodoistTask[]>;
    compact: boolean;
}) {
    const [collapsed, setCollapsed] = useState(false);

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
                        subTaskMap={subTaskMap}
                        compact={compact}
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
    subTaskMap,
    compact,
}: {
    task: TodoistTask;
    depth: number;
    onComplete: (id: string) => void;
    subTaskMap: Map<string, TodoistTask[]>;
    compact: boolean;
}) {
    const children = subTaskMap.get(task.id);
    const [childrenCollapsed, setChildrenCollapsed] = useState(false);

    return (
        <div>
            <div
                className="flex items-start gap-2 py-1 px-2 group"
                style={{ paddingLeft: `${8 + depth * 16}px` }}
            >
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
                <button
                    onClick={() => onComplete(task.id)}
                    className="w-4 h-4 mt-0.5 flex-shrink-0 rounded-full border border-border hover:border-accent hover:bg-accent/10 transition-colors cursor-pointer"
                    title="Complete"
                />
                <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug">{task.content}</p>
                    {!compact && task.due && (
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
            {/* Sub-tasks */}
            {children && !childrenCollapsed &&
                children.map((child) => (
                    <TaskRow
                        key={child.id}
                        task={child}
                        depth={depth + 1}
                        onComplete={onComplete}
                        subTaskMap={subTaskMap}
                        compact={compact}
                    />
                ))}
        </div>
    );
}
