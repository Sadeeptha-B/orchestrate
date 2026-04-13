import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useDayPlan } from '../context/DayPlanContext';
import { decryptToken } from '../lib/crypto';

// In development, route through Vite proxy to avoid potential CORS issues.
// In production (GitHub Pages), call Todoist API directly (v1 supports CORS).
const API_BASE = import.meta.env.DEV
    ? '/api/todoist/api/v1'
    : 'https://api.todoist.com/api/v1';

export interface TodoistTask {
    id: string;
    content: string;
    description: string;
    checked: boolean;
    due: {
        date: string;
        timezone: string | null;
        is_recurring: boolean;
        string: string;
        lang: string;
    } | null;
    duration: {
        amount: number;
        unit: string;
    } | null;
    priority: number;
    project_id: string;
    section_id: string | null;
    parent_id: string | null;
    labels: string[];
    child_order: number;
}

export interface TodoistProject {
    id: string;
    name: string;
    color: string;
    parent_id: string | null;
    child_order: number;
    is_collapsed: boolean;
}

export interface TodoistSection {
    id: string;
    name: string;
    project_id: string;
    section_order: number;
}

/** Paginated response shape from Todoist API v1 */
interface PaginatedResponse<T> {
    results: T[];
    next_cursor: string | null;
}

interface CreateTaskOpts {
    description?: string;
    project_id?: string;
    due_date?: string;
    due_datetime?: string;
    priority?: number;
    labels?: string[];
}

interface CreateProjectOpts {
    parent_id?: string;
    color?: string;
    is_favorite?: boolean;
    view_style?: string;
}

async function getToken(settings: {
    todoistToken?: string;
    todoistTokenIV?: string;
    todoistTokenKey?: string;
}): Promise<string | null> {
    if (!settings.todoistToken || !settings.todoistTokenIV || !settings.todoistTokenKey) {
        return null;
    }
    try {
        return await decryptToken(
            settings.todoistToken,
            settings.todoistTokenIV,
            settings.todoistTokenKey,
        );
    } catch {
        return null;
    }
}

async function apiFetch<T>(
    token: string,
    path: string,
    opts?: RequestInit,
): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`, {
        ...opts,
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...(opts?.headers ?? {}),
        },
    });
    if (!res.ok) {
        throw new Error(`Todoist API ${res.status}: ${res.statusText}`);
    }
    if (res.status === 204) return undefined as unknown as T;
    return res.json();
}

/** Fetch all pages from a paginated Todoist API v1 endpoint. */
async function fetchAllPages<T>(token: string, path: string): Promise<T[]> {
    let all: T[] = [];
    let cursor: string | null = null;
    do {
        const separator = path.includes('?') ? '&' : '?';
        const fullPath: string = cursor ? `${path}${separator}cursor=${cursor}` : path;
        const data: PaginatedResponse<T> = await apiFetch<PaginatedResponse<T>>(token, fullPath);
        all = [...all, ...data.results];
        cursor = data.next_cursor;
    } while (cursor);
    return all;
}

export function useTodoist() {
    const { settings } = useDayPlan();
    const [tasks, setTasks] = useState<TodoistTask[]>([]);
    const [projects, setProjects] = useState<TodoistProject[]>([]);
    const [sections, setSections] = useState<TodoistSection[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const tokenRef = useRef<string | null>(null);

    const isConfigured = Boolean(
        settings.todoistToken &&
        settings.todoistTokenIV &&
        settings.todoistTokenKey,
    );

    const resolveToken = useCallback(async () => {
        if (tokenRef.current) return tokenRef.current;
        const t = await getToken(settings);
        tokenRef.current = t;
        return t;
    }, [settings.todoistToken, settings.todoistTokenIV, settings.todoistTokenKey]);

    // Clear cached token when settings change
    useEffect(() => {
        tokenRef.current = null;
    }, [settings.todoistToken, settings.todoistTokenIV, settings.todoistTokenKey]);

    const refreshTasks = useCallback(
        async (projectId?: string) => {
            const token = await resolveToken();
            if (!token) return;
            setLoading(true);
            setError(null);
            try {
                const params = projectId ? `?project_id=${projectId}` : '';
                const allTasks = await fetchAllPages<TodoistTask>(token, `/tasks${params}`);
                setTasks(allTasks);
            } catch (e) {
                setError(e instanceof Error ? e.message : 'Failed to fetch tasks');
            } finally {
                setLoading(false);
            }
        },
        [resolveToken],
    );

    const refreshProjects = useCallback(async () => {
        const token = await resolveToken();
        if (!token) return;
        try {
            const allProjects = await fetchAllPages<TodoistProject>(token, '/projects');
            setProjects(allProjects);
        } catch {
            // silently fail — projects are optional UI enhancement
        }
    }, [resolveToken]);

    const refreshSections = useCallback(async () => {
        const token = await resolveToken();
        if (!token) return;
        try {
            const allSections = await fetchAllPages<TodoistSection>(token, '/sections');
            setSections(allSections);
        } catch {
            // silently fail
        }
    }, [resolveToken]);

    // Auto-fetch on mount and window focus
    useEffect(() => {
        if (!isConfigured) return;
        refreshTasks();
        refreshProjects();
        refreshSections();

        const onFocus = () => {
            refreshTasks();
        };
        window.addEventListener('focus', onFocus);
        return () => window.removeEventListener('focus', onFocus);
    }, [isConfigured, refreshTasks, refreshProjects, refreshSections]);

    const createTask = useCallback(
        async (content: string, opts?: CreateTaskOpts) => {
            const token = await resolveToken();
            if (!token) return;
            setError(null);
            try {
                const task = await apiFetch<TodoistTask>(token, '/tasks', {
                    method: 'POST',
                    body: JSON.stringify({ content, ...opts }),
                });
                setTasks((prev) => [...prev, task]);
            } catch (e) {
                setError(e instanceof Error ? e.message : 'Failed to create task');
            }
        },
        [resolveToken],
    );

    const completeTask = useCallback(
        async (taskId: string) => {
            const token = await resolveToken();
            if (!token) return;
            try {
                await apiFetch(token, '/sync', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: `commands=${encodeURIComponent(JSON.stringify([
                        { type: 'item_complete', uuid: crypto.randomUUID(), args: { id: taskId } },
                    ]))}`,
                });
                setTasks((prev) => prev.filter((t) => t.id !== taskId));
            } catch (e) {
                setError(e instanceof Error ? e.message : 'Failed to complete task');
            }
        },
        [resolveToken],
    );

    const reopenTask = useCallback(
        async (taskId: string) => {
            const token = await resolveToken();
            if (!token) return;
            try {
                await apiFetch(token, '/sync', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: `commands=${encodeURIComponent(JSON.stringify([
                        { type: 'item_uncomplete', uuid: crypto.randomUUID(), args: { id: taskId } },
                    ]))}`,
                });
                await refreshTasks();
            } catch (e) {
                setError(e instanceof Error ? e.message : 'Failed to reopen task');
            }
        },
        [resolveToken, refreshTasks],
    );

    const updateTask = useCallback(
        async (taskId: string, updates: { due_datetime?: string; due_date?: string; duration?: number; duration_unit?: string }) => {
            const token = await resolveToken();
            if (!token) return;
            setError(null);
            try {
                const updated = await apiFetch<TodoistTask>(token, `/tasks/${taskId}`, {
                    method: 'POST',
                    body: JSON.stringify(updates),
                });
                setTasks((prev) => prev.map((t) => (t.id === taskId ? updated : t)));
            } catch (e) {
                setError(e instanceof Error ? e.message : 'Failed to update task');
            }
        },
        [resolveToken],
    );

    const deleteTask = useCallback(
        async (taskId: string) => {
            const token = await resolveToken();
            if (!token) return;
            try {
                await apiFetch(token, `/tasks/${taskId}`, { method: 'DELETE' });
                setTasks((prev) => {
                    const removed = new Set<string>([taskId]);
                    let changed = true;
                    while (changed) {
                        changed = false;
                        for (const t of prev) {
                            if (!removed.has(t.id) && t.parent_id && removed.has(t.parent_id)) {
                                removed.add(t.id);
                                changed = true;
                            }
                        }
                    }
                    return prev.filter((t) => !removed.has(t.id));
                });
            } catch (e) {
                setError(e instanceof Error ? e.message : 'Failed to delete task');
            }
        },
        [resolveToken],
    );

    const createProject = useCallback(
        async (name: string, opts?: CreateProjectOpts) => {
            const token = await resolveToken();
            if (!token) return;
            setError(null);
            try {
                const project = await apiFetch<TodoistProject>(token, '/projects', {
                    method: 'POST',
                    body: JSON.stringify({ name, ...opts }),
                });
                setProjects((prev) => [...prev, project]);
            } catch (e) {
                setError(e instanceof Error ? e.message : 'Failed to create project');
            }
        },
        [resolveToken],
    );

    const deleteProject = useCallback(
        async (projectId: string) => {
            const token = await resolveToken();
            if (!token) return;
            try {
                await apiFetch(token, `/projects/${projectId}`, { method: 'DELETE' });
                // Collect all descendant project IDs for cascading removal
                const removedProjects = new Set<string>([projectId]);
                setProjects((prev) => {
                    let changed = true;
                    while (changed) {
                        changed = false;
                        for (const p of prev) {
                            if (!removedProjects.has(p.id) && p.parent_id && removedProjects.has(p.parent_id)) {
                                removedProjects.add(p.id);
                                changed = true;
                            }
                        }
                    }
                    return prev.filter((p) => !removedProjects.has(p.id));
                });
                setTasks((prev) => prev.filter((t) => !removedProjects.has(t.project_id)));
                setSections((prev) => prev.filter((s) => !removedProjects.has(s.project_id)));
            } catch (e) {
                setError(e instanceof Error ? e.message : 'Failed to delete project');
            }
        },
        [resolveToken],
    );

    /** Memoized lookup map: todoistId → TodoistTask for O(1) resolution. */
    const taskMap = useMemo(
        () => new Map(tasks.map((t) => [t.id, t])),
        [tasks],
    );

    return {
        tasks,
        projects,
        sections,
        taskMap,
        loading,
        error,
        isConfigured,
        createTask,
        updateTask,
        completeTask,
        reopenTask,
        deleteTask,
        createProject,
        deleteProject,
        refreshTasks,
        refreshProjects,
        refreshSections,
    };
}

/** Validate a Todoist API token by hitting the projects endpoint. */
export async function validateTodoistToken(token: string): Promise<boolean> {
    try {
        const res = await fetch(`${API_BASE}/projects`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
            console.warn(`Todoist token validation failed: ${res.status} ${res.statusText}`);
        }
        return res.ok;
    } catch (err) {
        console.error('Todoist token validation error:', err);
        return false;
    }
}
