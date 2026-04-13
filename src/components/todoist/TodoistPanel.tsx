import { useState, useMemo } from 'react';
import { format } from 'date-fns';
import { useTodoist, type TodoistTask, type TodoistProject, type TodoistSection } from '../../hooks/useTodoist';
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
}

export function TodoistPanel({ mode = 'full', onSetup, linking }: TodoistPanelProps) {
    const {
        tasks,
        projects,
        sections,
        loading,
        error,
        isConfigured,
        createTask,
        updateTask,
        completeTask,
        deleteTask,
        createProject,
        deleteProject,
        refreshTasks,
        refreshProjects,
        refreshSections,
    } = useTodoist();

    const [newProjectName, setNewProjectName] = useState('');
    const [newProjectParentId, setNewProjectParentId] = useState<string>('');
    const [showNewProject, setShowNewProject] = useState(false);

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
        const today = format(new Date(), 'yyyy-MM-dd');
        const [sh, sm] = startTime.split(':').map(Number);
        const [eh, em] = endTime.split(':').map(Number);
        const durationMinutes = (eh * 60 + em) - (sh * 60 + sm);
        if (durationMinutes <= 0) return;
        await updateTask(taskId, {
            due_datetime: `${today}T${startTime}:00`,
            duration: durationMinutes,
            duration_unit: 'minute',
        });
    };

    const handleClearSchedule = async (taskId: string) => {
        const today = format(new Date(), 'yyyy-MM-dd');
        await updateTask(taskId, { due_date: today });
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
                        onCreateTask={createTask}
                        onDeleteTask={deleteTask}
                        onDeleteProject={handleDeleteProject}
                        onSchedule={handleSchedule}
                        onClearSchedule={handleClearSchedule}
                        subTaskMap={subTaskMap}
                        compact={mode === 'compact'}
                        linking={linking}
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
    subTaskMap,
    compact,
    linking,
}: {
    node: ProjectNode;
    depth: number;
    onComplete: (id: string) => void;
    onCreateTask: (content: string, opts?: { project_id?: string }) => Promise<void>;
    onDeleteTask: (id: string) => void;
    onDeleteProject: (id: string) => void;
    onSchedule: (taskId: string, startTime: string, endTime: string) => void;
    onClearSchedule: (taskId: string) => void;
    subTaskMap: Map<string, TodoistTask[]>;
    compact: boolean;
    linking?: LinkingProps;
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
                            subTaskMap={subTaskMap}
                            compact={compact}
                            linking={linking}
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
                            onCreateTask={onCreateTask}
                            onDeleteTask={onDeleteTask}
                            onDeleteProject={onDeleteProject}
                            onSchedule={onSchedule}
                            onClearSchedule={onClearSchedule}
                            subTaskMap={subTaskMap}
                            compact={compact}
                            linking={linking}
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
    subTaskMap,
    compact,
    linking,
}: {
    section: TodoistSection;
    tasks: TodoistTask[];
    depth: number;
    onComplete: (id: string) => void;
    onDelete: (id: string) => void;
    onSchedule: (taskId: string, startTime: string, endTime: string) => void;
    onClearSchedule: (taskId: string) => void;
    subTaskMap: Map<string, TodoistTask[]>;
    compact: boolean;
    linking?: LinkingProps;
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
                        onDelete={onDelete}
                        onSchedule={onSchedule}
                        onClearSchedule={onClearSchedule}
                        subTaskMap={subTaskMap}
                        compact={compact}
                        linking={linking}
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
    subTaskMap,
    compact,
    linking,
}: {
    task: TodoistTask;
    depth: number;
    onComplete: (id: string) => void;
    onDelete: (id: string) => void;
    onSchedule: (taskId: string, startTime: string, endTime: string) => void;
    onClearSchedule: (taskId: string) => void;
    subTaskMap: Map<string, TodoistTask[]>;
    compact: boolean;
    linking?: LinkingProps;
}) {
    const children = subTaskMap.get(task.id);
    const [childrenCollapsed, setChildrenCollapsed] = useState(false);
    const [showTimePicker, setShowTimePicker] = useState(false);
    const [pickerStart, setPickerStart] = useState('');
    const [pickerEnd, setPickerEnd] = useState('');

    // Parse existing schedule for today
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const hasDueTime = task.due?.date?.includes('T') ?? false;
    const isDueToday = task.due?.date?.startsWith(todayStr) ?? false;
    const scheduledStart = hasDueTime && isDueToday
        ? task.due!.date.slice(11, 16)
        : null;
    const durationMinutes = task.duration?.unit === 'minute' ? task.duration.amount : null;
    const scheduledEnd = scheduledStart && durationMinutes
        ? (() => {
            const [h, m] = scheduledStart.split(':').map(Number);
            const total = h * 60 + m + durationMinutes;
            return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
        })()
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
    const linkedToOther = linking
        ? linking.allLinkedTasks.find(
            (lt) => lt.todoistId === task.id && lt.intentionId !== linking.linkingIntentionId,
        )
        : null;
    const linkedToOtherTitle = linkedToOther
        ? linking!.intentionTitles[linkedToOther.intentionId]
        : null;

    return (
        <div>
            <div
                className={`flex items-start gap-2 py-1 px-2 group ${isLinkedToCurrentIntention ? 'bg-accent/5 border-l-2 border-accent' : ''}`}
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
                {/* Linking checkbox (when in linking mode) */}
                {linking && (
                    <input
                        type="checkbox"
                        checked={isLinkedToCurrentIntention}
                        onChange={() => {
                            if (isLinkedToCurrentIntention) {
                                linking.onUnlinkTask(task.id);
                            } else {
                                linking.onLinkTask(task.id);
                            }
                        }}
                        className="w-4 h-4 mt-0.5 flex-shrink-0 accent-accent cursor-pointer"
                        title={isLinkedToCurrentIntention ? 'Unlink from intention' : 'Link to intention'}
                    />
                )}
                {/* Completion button (hidden in linking mode) */}
                {!linking && (
                    <button
                        onClick={() => onComplete(task.id)}
                        className="w-4 h-4 mt-0.5 flex-shrink-0 rounded-full border border-border hover:border-accent hover:bg-accent/10 transition-colors cursor-pointer"
                        title="Complete"
                    />
                )}
                <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug">{task.content}</p>
                    {linkedToOtherTitle && (
                        <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5">
                            linked to: {linkedToOtherTitle}
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
                {/* Delete task button (hover) */}
                <button
                    onClick={() => onDelete(task.id)}
                    className="text-xs text-text-light opacity-0 group-hover:opacity-100 hover:!text-red-500 transition-opacity flex-shrink-0 mt-0.5 cursor-pointer"
                    title="Delete task"
                >
                    ✕
                </button>
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
                        onChange={(e) => setPickerStart(e.target.value)}
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
                        subTaskMap={subTaskMap}
                        compact={compact}
                        linking={linking}
                    />
                ))}
        </div>
    );
}
