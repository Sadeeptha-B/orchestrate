import { useState, useEffect, useCallback, useRef } from 'react';
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
    priority: number;
    project_id: string;
    labels: string[];
    child_order: number;
}

export interface TodoistProject {
    id: string;
    name: string;
    color: string;
    child_order: number;
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

export function useTodoist() {
    const { settings } = useDayPlan();
    const [tasks, setTasks] = useState<TodoistTask[]>([]);
    const [projects, setProjects] = useState<TodoistProject[]>([]);
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
                const data = await apiFetch<PaginatedResponse<TodoistTask>>(token, `/tasks${params}`);
                setTasks(data.results);
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
            const data = await apiFetch<PaginatedResponse<TodoistProject>>(token, '/projects');
            setProjects(data.results);
        } catch {
            // silently fail — projects are optional UI enhancement
        }
    }, [resolveToken]);

    // Auto-fetch on mount and window focus
    useEffect(() => {
        if (!isConfigured) return;
        refreshTasks();
        refreshProjects();

        const onFocus = () => {
            refreshTasks();
        };
        window.addEventListener('focus', onFocus);
        return () => window.removeEventListener('focus', onFocus);
    }, [isConfigured, refreshTasks, refreshProjects]);

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

    return {
        tasks,
        projects,
        loading,
        error,
        isConfigured,
        createTask,
        completeTask,
        reopenTask,
        refreshTasks,
        refreshProjects,
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
