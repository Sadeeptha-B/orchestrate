import { createContext, useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from 'react';
import { useDayPlan } from '../hooks/useDayPlan';
import { decryptToken } from '../lib/crypto';
import { API_BASE } from '../lib/todoistApi';
import { collectDescendantIds } from '../lib/tasks';
import type { TodoistTask, TodoistProject, TodoistSection } from '../hooks/useTodoist';

// ─── Constants ───────────────────────────────────────────────────────────────

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
    due_datetime?: string; due_string?: string; due_lang?: string;
    priority?: number; labels?: string[]; duration?: number; duration_unit?: string;
}

interface UpdateTaskOpts {
    content?: string; due_datetime?: string; due_date?: string;
    due_string?: string; due_lang?: string;
    duration?: number; duration_unit?: string;
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
    createTask: (content: string, opts?: CreateTaskOpts) => Promise<TodoistTask | null>;
    updateTask: (taskId: string, updates: UpdateTaskOpts) => Promise<void>;
    moveTask: (taskId: string, projectId: string) => Promise<boolean>;
    completeTask: (taskId: string) => Promise<void>;
    reopenTask: (taskId: string) => Promise<void>;
    deleteTask: (taskId: string) => Promise<void>;
    createProject: (name: string, opts?: CreateProjectOpts) => Promise<TodoistProject | null>;
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
    const hasDataRef = useRef((cache.current?.tasks.length ?? 0) > 0);

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

    type ResourceKey = 'tasks' | 'projects' | 'sections';

    /**
     * Generic resource refresher: handles dedup, staleness check, fetch, and lastFetched bookkeeping.
     * `onError` controls whether the failure surfaces in `error` state (tasks: yes, projects/sections: silent).
     * `withLoadingSpinner` is only set for tasks — see `refreshTasks` wrapper.
     */
    const refreshResource = useCallback(
        async <T,>(opts: {
            kind: ResourceKey;
            path: string;
            setData: (data: T[]) => void;
            force?: boolean;
            withLoadingSpinner?: boolean;
            errorMessage?: string;
        }) => {
            const { kind, path, setData, force, withLoadingSpinner, errorMessage } = opts;
            if (!force && Date.now() - lastFetchedRef.current[kind] < FOCUS_STALENESS_MS) return;
            if (inflightRef.current[kind]) return inflightRef.current[kind] ?? undefined;

            const promise = (async () => {
                const token = await resolveToken();
                if (!token) return;
                if (withLoadingSpinner) setLoading(true);
                if (errorMessage !== undefined) setError(null);
                try {
                    const data = await fetchAllPages<T>(token, path);
                    setData(data);
                    lastFetchedRef.current[kind] = Date.now();
                } catch (e) {
                    if (errorMessage !== undefined) {
                        setError(e instanceof Error ? e.message : errorMessage);
                    }
                    // else: silent — projects/sections are optional UI enhancement
                } finally {
                    if (withLoadingSpinner) setLoading(false);
                }
            })();
            inflightRef.current[kind] = promise;
            promise.finally(() => { inflightRef.current[kind] = null; });
            return promise;
        },
        [resolveToken],
    );

    const refreshTasks = useCallback(
        (opts?: RefreshOpts) => {
            return refreshResource<TodoistTask>({
                kind: 'tasks',
                path: '/tasks',
                setData: (data) => { setTasks(data); hasDataRef.current = data.length > 0; },
                force: opts?.force,
                withLoadingSpinner: !hasDataRef.current,
                errorMessage: 'Failed to fetch tasks',
            });
        },
        [refreshResource],
    );

    const refreshProjects = useCallback(
        (opts?: RefreshOpts) =>
            refreshResource<TodoistProject>({
                kind: 'projects',
                path: '/projects',
                setData: setProjects,
                force: opts?.force,
            }),
        [refreshResource],
    );

    const refreshSections = useCallback(
        (opts?: RefreshOpts) =>
            refreshResource<TodoistSection>({
                kind: 'sections',
                path: '/sections',
                setData: setSections,
                force: opts?.force,
            }),
        [refreshResource],
    );

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

    const createTask = useCallback(async (content: string, opts?: CreateTaskOpts): Promise<TodoistTask | null> => {
        const token = await resolveToken();
        if (!token) return null;
        setError(null);
        try {
            const task = await apiFetch<TodoistTask>(token, '/tasks', {
                method: 'POST', body: JSON.stringify({ content, ...opts }),
            });
            setTasks((prev) => [...prev, task]);
            return task;
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to create task');
            return null;
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

    const moveTask = useCallback(async (taskId: string, projectId: string): Promise<boolean> => {
        const token = await resolveToken();
        if (!token) return false;
        try {
            await apiFetch(token, '/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `commands=${encodeURIComponent(JSON.stringify([
                    { type: 'item_move', uuid: crypto.randomUUID(), args: { id: taskId, project_id: projectId } },
                ]))}`,
            });
            // Patch local cache so subsequent reads (e.g. capacity calc) see the new project_id.
            setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, project_id: projectId } : t)));
            return true;
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to move task');
            return false;
        }
    }, [resolveToken]);

    const updateTask = useCallback(async (taskId: string, updates: UpdateTaskOpts) => {
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
                const removed = collectDescendantIds(prev, [taskId], (t) => t.parent_id);
                return prev.filter((t) => !removed.has(t.id));
            });
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to delete task');
        }
    }, [resolveToken]);

    const createProject = useCallback(async (name: string, opts?: CreateProjectOpts): Promise<TodoistProject | null> => {
        const token = await resolveToken();
        if (!token) return null;
        setError(null);
        try {
            const project = await apiFetch<TodoistProject>(token, '/projects', {
                method: 'POST', body: JSON.stringify({ name, ...opts }),
            });
            setProjects((prev) => [...prev, project]);
            return project;
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to create project');
            return null;
        }
    }, [resolveToken]);

    const deleteProject = useCallback(async (projectId: string) => {
        const token = await resolveToken();
        if (!token) return;
        try {
            await apiFetch(token, `/projects/${projectId}`, { method: 'DELETE' });
            const removedProjects = collectDescendantIds(projects, [projectId], (p) => p.parent_id);
            setProjects((prev) => prev.filter((p) => !removedProjects.has(p.id)));
            setTasks((prev) => prev.filter((t) => !removedProjects.has(t.project_id)));
            setSections((prev) => prev.filter((s) => !removedProjects.has(s.project_id)));
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to delete project');
        }
    }, [resolveToken, projects]);

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
        createTask, updateTask, moveTask, completeTask, reopenTask, deleteTask,
        createProject, deleteProject, refreshTasks, refreshProjects, refreshSections,
    }), [createTask, updateTask, moveTask, completeTask, reopenTask, deleteTask,
        createProject, deleteProject, refreshTasks, refreshProjects, refreshSections]);

    return (
        <TodoistDataContext.Provider value={dataValue}>
            <TodoistActionsContext.Provider value={actionsValue}>
                {children}
            </TodoistActionsContext.Provider>
        </TodoistDataContext.Provider>
    );
}
