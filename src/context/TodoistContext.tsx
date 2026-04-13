import { createContext, useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from 'react';
import { useDayPlan } from './DayPlanContext';
import { decryptToken } from '../lib/crypto';
import type { TodoistTask, TodoistProject, TodoistSection } from '../hooks/useTodoist';

// ─── Constants ───────────────────────────────────────────────────────────────

const API_BASE = import.meta.env.DEV
    ? '/api/todoist/api/v1'
    : 'https://api.todoist.com/api/v1';

const TODOIST_CACHE_KEY = 'orchestrate-todoist-cache';
const FOCUS_STALENESS_MS = 30_000;      // 30s — skip focus-refresh if data is this fresh
const CACHE_STALENESS_MS = 5 * 60_000;  // 5min — skip initial fetch if cache is this fresh

// ─── API Utilities ───────────────────────────────────────────────────────────

interface PaginatedResponse<T> { results: T[]; next_cursor: string | null }

async function apiFetch<T>(token: string, path: string, opts?: RequestInit): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`, {
        ...opts,
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...(opts?.headers ?? {}),
        },
    });
    if (!res.ok) throw new Error(`Todoist API ${res.status}: ${res.statusText}`);
    if (res.status === 204) return undefined as unknown as T;
    return res.json();
}

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

async function getToken(settings: {
    todoistToken?: string; todoistTokenIV?: string; todoistTokenKey?: string;
}): Promise<string | null> {
    if (!settings.todoistToken || !settings.todoistTokenIV || !settings.todoistTokenKey) return null;
    try { return await decryptToken(settings.todoistToken, settings.todoistTokenIV, settings.todoistTokenKey); }
    catch { return null; }
}

// ─── Cache ───────────────────────────────────────────────────────────────────

interface TodoistCache {
    tasks: TodoistTask[];
    projects: TodoistProject[];
    sections: TodoistSection[];
    fetchedAt: number;
}

function loadCache(): TodoistCache | null {
    try {
        const raw = localStorage.getItem(TODOIST_CACHE_KEY);
        if (!raw) return null;
        return JSON.parse(raw) as TodoistCache;
    } catch { return null; }
}

function saveCache(tasks: TodoistTask[], projects: TodoistProject[], sections: TodoistSection[]) {
    try {
        localStorage.setItem(TODOIST_CACHE_KEY, JSON.stringify({ tasks, projects, sections, fetchedAt: Date.now() } satisfies TodoistCache));
    } catch { /* quota exceeded — non-critical */ }
}

// ─── Context Definitions ─────────────────────────────────────────────────────

interface CreateTaskOpts {
    description?: string; project_id?: string; due_date?: string;
    due_datetime?: string; priority?: number; labels?: string[];
}

interface CreateProjectOpts {
    parent_id?: string; color?: string; is_favorite?: boolean; view_style?: string;
}

interface RefreshOpts { force?: boolean }

export interface TodoistDataValue {
    tasks: TodoistTask[];
    projects: TodoistProject[];
    sections: TodoistSection[];
    taskMap: Map<string, TodoistTask>;
    loading: boolean;
    error: string | null;
    isConfigured: boolean;
}

export interface TodoistActionsValue {
    createTask: (content: string, opts?: CreateTaskOpts) => Promise<void>;
    updateTask: (taskId: string, updates: { content?: string; due_datetime?: string; due_date?: string; duration?: number; duration_unit?: string }) => Promise<void>;
    completeTask: (taskId: string) => Promise<void>;
    reopenTask: (taskId: string) => Promise<void>;
    deleteTask: (taskId: string) => Promise<void>;
    createProject: (name: string, opts?: CreateProjectOpts) => Promise<void>;
    deleteProject: (projectId: string) => Promise<void>;
    refreshTasks: (opts?: RefreshOpts) => Promise<void>;
    refreshProjects: (opts?: RefreshOpts) => Promise<void>;
    refreshSections: (opts?: RefreshOpts) => Promise<void>;
}

const TodoistDataContext = createContext<TodoistDataValue | null>(null);
const TodoistActionsContext = createContext<TodoistActionsValue | null>(null);

export { TodoistDataContext, TodoistActionsContext };

// ─── Provider ────────────────────────────────────────────────────────────────

export function TodoistProvider({ children }: { children: ReactNode }) {
    const { settings, plan, dispatch } = useDayPlan();

    // ── Initial state from cache ──
    const cache = useRef(loadCache());
    const [tasks, setTasks] = useState<TodoistTask[]>(() => cache.current?.tasks ?? []);
    const [projects, setProjects] = useState<TodoistProject[]>(() => cache.current?.projects ?? []);
    const [sections, setSections] = useState<TodoistSection[]>(() => cache.current?.sections ?? []);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const tokenRef = useRef<string | null>(null);

    const isConfigured = Boolean(
        settings.todoistToken && settings.todoistTokenIV && settings.todoistTokenKey,
    );

    // ── Staleness & dedup tracking ──
    const lastFetchedRef = useRef({
        tasks: cache.current?.fetchedAt ?? 0,
        projects: cache.current?.fetchedAt ?? 0,
        sections: cache.current?.fetchedAt ?? 0,
    });
    const inflightRef = useRef<{
        tasks: Promise<void> | null;
        projects: Promise<void> | null;
        sections: Promise<void> | null;
    }>({ tasks: null, projects: null, sections: null });

    // ── Token resolution ──
    const resolveToken = useCallback(async () => {
        if (tokenRef.current) return tokenRef.current;
        const t = await getToken(settings);
        tokenRef.current = t;
        return t;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [settings.todoistToken, settings.todoistTokenIV, settings.todoistTokenKey]);

    useEffect(() => { tokenRef.current = null; }, [settings.todoistToken, settings.todoistTokenIV, settings.todoistTokenKey]);

    // ── Refresh functions with dedup + staleness ──

    const refreshTasks = useCallback(async (opts?: RefreshOpts) => {
        if (!opts?.force && Date.now() - lastFetchedRef.current.tasks < FOCUS_STALENESS_MS) return;
        if (inflightRef.current.tasks) return inflightRef.current.tasks;

        const hasExistingData = tasks.length > 0 || (cache.current?.tasks.length ?? 0) > 0;
        const promise = (async () => {
            const token = await resolveToken();
            if (!token) return;
            // Only show loading spinner if no cached data available
            if (!hasExistingData) { setLoading(true); }
            setError(null);
            try {
                const allTasks = await fetchAllPages<TodoistTask>(token, '/tasks');
                setTasks(allTasks);
                lastFetchedRef.current.tasks = Date.now();
            } catch (e) {
                setError(e instanceof Error ? e.message : 'Failed to fetch tasks');
            } finally {
                if (!hasExistingData) { setLoading(false); }
            }
        })();
        inflightRef.current.tasks = promise;
        promise.finally(() => { inflightRef.current.tasks = null; });
        return promise;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resolveToken]);

    const refreshProjects = useCallback(async (opts?: RefreshOpts) => {
        if (!opts?.force && Date.now() - lastFetchedRef.current.projects < FOCUS_STALENESS_MS) return;
        if (inflightRef.current.projects) return inflightRef.current.projects;

        const promise = (async () => {
            const token = await resolveToken();
            if (!token) return;
            try {
                const allProjects = await fetchAllPages<TodoistProject>(token, '/projects');
                setProjects(allProjects);
                lastFetchedRef.current.projects = Date.now();
            } catch { /* silently fail — projects are optional UI enhancement */ }
        })();
        inflightRef.current.projects = promise;
        promise.finally(() => { inflightRef.current.projects = null; });
        return promise;
    }, [resolveToken]);

    const refreshSections = useCallback(async (opts?: RefreshOpts) => {
        if (!opts?.force && Date.now() - lastFetchedRef.current.sections < FOCUS_STALENESS_MS) return;
        if (inflightRef.current.sections) return inflightRef.current.sections;

        const promise = (async () => {
            const token = await resolveToken();
            if (!token) return;
            try {
                const allSections = await fetchAllPages<TodoistSection>(token, '/sections');
                setSections(allSections);
                lastFetchedRef.current.sections = Date.now();
            } catch { /* silently fail */ }
        })();
        inflightRef.current.sections = promise;
        promise.finally(() => { inflightRef.current.sections = null; });
        return promise;
    }, [resolveToken]);

    // ── Initial fetch (respects cache TTL) ──
    useEffect(() => {
        if (!isConfigured) return;
        const cacheAge = cache.current ? Date.now() - cache.current.fetchedAt : Infinity;
        if (cacheAge < CACHE_STALENESS_MS) {
            // Cache is fresh enough — skip initial fetch
            lastFetchedRef.current = {
                tasks: cache.current!.fetchedAt,
                projects: cache.current!.fetchedAt,
                sections: cache.current!.fetchedAt,
            };
            return;
        }
        // Cache is stale or missing — fetch
        refreshTasks({ force: true });
        refreshProjects({ force: true });
        refreshSections({ force: true });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isConfigured]);

    // ── Focus refresh (tasks only, respects staleness) ──
    useEffect(() => {
        if (!isConfigured) return;
        const onFocus = () => { refreshTasks(); };
        window.addEventListener('focus', onFocus);
        return () => window.removeEventListener('focus', onFocus);
    }, [isConfigured, refreshTasks]);

    // ── Persist cache on data change ──
    useEffect(() => {
        if (tasks.length === 0 && projects.length === 0 && sections.length === 0) return;
        saveCache(tasks, projects, sections);
    }, [tasks, projects, sections]);

    // ── Data reconciliation: title snapshot sync ──
    const hasSyncedSnapshots = useRef(false);
    useEffect(() => {
        if (loading || tasks.length === 0 || plan.linkedTasks.length === 0) return;
        const snapshots: Record<string, string> = {};
        for (const lt of plan.linkedTasks) {
            const t = tasks.find((task) => task.id === lt.todoistId);
            if (t && t.content !== lt.titleSnapshot) {
                snapshots[lt.todoistId] = t.content;
            }
        }
        if (Object.keys(snapshots).length > 0) {
            dispatch({ type: 'SYNC_TASK_SNAPSHOTS', snapshots });
        }
        hasSyncedSnapshots.current = true;
    }, [loading, tasks, plan.linkedTasks, dispatch]);

    // ── Data reconciliation: stale task cleanup (one-time) ──
    const hasCleanedUp = useRef(false);
    useEffect(() => {
        if (hasCleanedUp.current || loading || tasks.length === 0) return;
        if (!hasSyncedSnapshots.current) return;
        hasCleanedUp.current = true;
        const fetchedIds = new Set(tasks.map((t) => t.id));
        for (const lt of plan.linkedTasks) {
            if (!fetchedIds.has(lt.todoistId) && !lt.completed) {
                dispatch({ type: 'TOGGLE_TASK_COMPLETE', todoistId: lt.todoistId, titleSnapshot: lt.titleSnapshot });
            }
        }
    }, [loading, tasks, plan.linkedTasks, dispatch]);

    // ── CRUD mutations ──

    const createTask = useCallback(async (content: string, opts?: CreateTaskOpts) => {
        const token = await resolveToken();
        if (!token) return;
        setError(null);
        try {
            const task = await apiFetch<TodoistTask>(token, '/tasks', {
                method: 'POST', body: JSON.stringify({ content, ...opts }),
            });
            setTasks((prev) => [...prev, task]);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to create task');
        }
    }, [resolveToken]);

    const completeTask = useCallback(async (taskId: string) => {
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
    }, [resolveToken]);

    const reopenTask = useCallback(async (taskId: string) => {
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
            await refreshTasks({ force: true });
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to reopen task');
        }
    }, [resolveToken, refreshTasks]);

    const updateTask = useCallback(async (taskId: string, updates: { content?: string; due_datetime?: string; due_date?: string; duration?: number; duration_unit?: string }) => {
        const token = await resolveToken();
        if (!token) return;
        setError(null);
        try {
            const updated = await apiFetch<TodoistTask>(token, `/tasks/${taskId}`, {
                method: 'POST', body: JSON.stringify(updates),
            });
            setTasks((prev) => prev.map((t) => (t.id === taskId ? updated : t)));
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to update task');
        }
    }, [resolveToken]);

    const deleteTask = useCallback(async (taskId: string) => {
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
    }, [resolveToken]);

    const createProject = useCallback(async (name: string, opts?: CreateProjectOpts) => {
        const token = await resolveToken();
        if (!token) return;
        setError(null);
        try {
            const project = await apiFetch<TodoistProject>(token, '/projects', {
                method: 'POST', body: JSON.stringify({ name, ...opts }),
            });
            setProjects((prev) => [...prev, project]);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to create project');
        }
    }, [resolveToken]);

    const deleteProject = useCallback(async (projectId: string) => {
        const token = await resolveToken();
        if (!token) return;
        try {
            await apiFetch(token, `/projects/${projectId}`, { method: 'DELETE' });
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
    }, [resolveToken]);

    // ── Memoized task lookup map ──
    const taskMap = useMemo(
        () => new Map(tasks.map((t) => [t.id, t])),
        [tasks],
    );

    // ── Context values ──
    const dataValue = useMemo<TodoistDataValue>(() => ({
        tasks, projects, sections, taskMap, loading, error, isConfigured,
    }), [tasks, projects, sections, taskMap, loading, error, isConfigured]);

    const actionsValue = useMemo<TodoistActionsValue>(() => ({
        createTask, updateTask, completeTask, reopenTask, deleteTask,
        createProject, deleteProject, refreshTasks, refreshProjects, refreshSections,
    }), [createTask, updateTask, completeTask, reopenTask, deleteTask,
        createProject, deleteProject, refreshTasks, refreshProjects, refreshSections]);

    return (
        <TodoistDataContext.Provider value={dataValue}>
            <TodoistActionsContext.Provider value={actionsValue}>
                {children}
            </TodoistActionsContext.Provider>
        </TodoistDataContext.Provider>
    );
}
