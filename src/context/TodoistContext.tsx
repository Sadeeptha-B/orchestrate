import { createContext, useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from 'react';
import { useDayPlan } from '../hooks/useDayPlan';
import { SessionExpiredError, apiFetch as guardedFetch } from '../lib/identity';
import { API_BASE, TodoistAuthError, getTodoistStatus } from '../lib/todoistApi';
import { collectDescendantIds } from '../lib/tasks';
import type { TodoistTask, TodoistProject, TodoistSection } from '../hooks/useTodoist';

// ─── Constants ───────────────────────────────────────────────────────────────

const TODOIST_CACHE_KEY = 'orchestrate-todoist-cache';
const FOCUS_STALENESS_MS = 30_000;      // 30s — skip focus-refresh if data is this fresh
const CACHE_STALENESS_MS = 5 * 60_000;  // 5min — skip initial fetch if cache is this fresh

// ─── API Utilities ───────────────────────────────────────────────────────────

interface PaginatedResponse<T> { results: T[]; next_cursor: string | null }

// All calls go through the same-origin proxy (`/api/todoist/*`), authenticated by the Cloudflare
// Access session cookie; the Worker injects the caller's Todoist token server-side (see
// lib/todoistApi.ts). The token is never in the browser.
async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
    const res = await guardedFetch(`${API_BASE}${path}`, {
        ...opts,
        headers: {
            'Content-Type': 'application/json',
            ...(opts?.headers ?? {}),
        },
    });
    if (res.status === 401) throw new TodoistAuthError();
    if (!res.ok) throw new Error(`Todoist API ${res.status}: ${res.statusText}`);
    if (res.status === 204) return undefined as unknown as T;
    return res.json();
}

async function fetchAllPages<T>(path: string): Promise<T[]> {
    let all: T[] = [];
    let cursor: string | null = null;
    do {
        const separator = path.includes('?') ? '&' : '?';
        const fullPath: string = cursor ? `${path}${separator}cursor=${cursor}` : path;
        const data: PaginatedResponse<T> = await apiFetch<PaginatedResponse<T>>(fullPath);
        all = [...all, ...data.results];
        cursor = data.next_cursor;
    } while (cursor);
    return all;
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
    content?: string;
    /** v7.11: replaces the task's description (callers merge the habit-id token with any
     *  user-written text themselves — see `withHabitIdToken`). */
    description?: string;
    /** v6.2: explicit `null` clears the field in Todoist (used to unschedule on intention discard). */
    due_datetime?: string | null;
    due_date?: string | null;
    due_string?: string | null;
    due_lang?: string;
    duration?: number | null;
    duration_unit?: string;
    /** v7.11: replaces the task's label set (callers merge with existing labels themselves). */
    labels?: string[];
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
    /** True once the task list has been hydrated from a fresh cache hit or a successful fetch. */
    tasksHydrated: boolean;
    loading: boolean;
    error: string | null;
    isConfigured: boolean;
    /** v7.11: the connected Todoist account's id (from GET /user), or null while unresolved /
     *  disconnected. Compared against `settings.todoistAccount` before any auto-provisioning
     *  write — see ReconciliationProvider's account-mismatch gate. */
    accountId: string | null;
    /** Human-readable label for the connected account (email), for mismatch messages. */
    accountEmail: string | null;
    /** v7.11: true once the identity fetch has settled (success or failure). Lets the reconcile
     *  gate wait for the verdict instead of racing it — while still degrading to ungated behavior
     *  when the fetch fails (accountResolved true, accountId null). */
    accountResolved: boolean;
    /** True once the first /status check has settled — lets gates render neutrally instead of
     *  flashing "not connected" while the check is in flight. */
    statusResolved: boolean;
    /** True when the most recent API call returned 401 (token revoked/expired). Clears on token change. */
    authFailed: boolean;
}

export interface TodoistActionsValue {
    createTask: (content: string, opts?: CreateTaskOpts) => Promise<TodoistTask | null>;
    /** v6.4: returns the server response on success, `null` on failure (with logged + UI error). */
    updateTask: (taskId: string, updates: UpdateTaskOpts) => Promise<TodoistTask | null>;
    moveTask: (taskId: string, projectId: string) => Promise<boolean>;
    /** Reorder sibling tasks by writing new `child_order` values (1-based). Optimistic. */
    reorderTasks: (items: { id: string; child_order: number }[]) => Promise<boolean>;
    completeTask: (taskId: string) => Promise<boolean>;
    reopenTask: (taskId: string) => Promise<void>;
    deleteTask: (taskId: string) => Promise<boolean>;
    createTaskComment: (taskId: string, content: string) => Promise<void>;
    createProject: (name: string, opts?: CreateProjectOpts) => Promise<TodoistProject | null>;
    deleteProject: (projectId: string) => Promise<void>;
    refreshTasks: (opts?: RefreshOpts) => Promise<void>;
    refreshProjects: (opts?: RefreshOpts) => Promise<void>;
    refreshSections: (opts?: RefreshOpts) => Promise<void>;
    /** Re-check whether the Worker holds a Todoist token (after entering the secret / saving / disconnecting a token). */
    refreshConnection: () => Promise<void>;
}

const TodoistDataContext = createContext<TodoistDataValue | null>(null);
const TodoistActionsContext = createContext<TodoistActionsValue | null>(null);

export { TodoistDataContext, TodoistActionsContext };

// ─── Provider ────────────────────────────────────────────────────────────────

export function TodoistProvider({ children }: { children: ReactNode }) {
    const { plan, dispatch } = useDayPlan();

    // ── Initial state from cache ──
    const cache = useRef(loadCache());
    const [tasks, setTasks] = useState<TodoistTask[]>(() => cache.current?.tasks ?? []);
    const [projects, setProjects] = useState<TodoistProject[]>(() => cache.current?.projects ?? []);
    const [sections, setSections] = useState<TodoistSection[]>(() => cache.current?.sections ?? []);
    const [tasksHydrated, setTasksHydrated] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [authFailed, setAuthFailed] = useState(false);

    const hasDataRef = useRef((cache.current?.tasks?.length ?? 0) > 0);
    // v6.4: `completeTask` needs to inspect the task's `due.is_recurring` to decide whether
    // to filter the cache or refetch. A ref avoids stale-closure and avoids dragging `tasks`
    // into `completeTask`'s deps (which would churn the actionsValue useMemo on every task
    // update and re-render every consumer).
    const tasksRef = useRef<TodoistTask[]>(tasks);
    useEffect(() => { tasksRef.current = tasks; }, [tasks]);

    // Connection lives server-side: the Worker either holds this user's Todoist token or it doesn't.
    // `isConfigured` is resolved from /status. A ref mirrors it so the mutation callbacks can
    // early-return when disconnected without taking it as a dep.
    const [isConfigured, setIsConfigured] = useState(false);
    const [statusResolved, setStatusResolved] = useState(false);
    const isConfiguredRef = useRef(false);
    useEffect(() => { isConfiguredRef.current = isConfigured; }, [isConfigured]);

    // v7.11: the connected account's identity (GET /user through the proxy). Best-effort — a
    // failure leaves it null, which downstream reads as "unknown" and skips provenance gating
    // rather than blocking anything. `accountResolved` marks the fetch as settled either way.
    const [account, setAccount] = useState<{ id: string; email: string | null } | null>(null);
    const [accountResolved, setAccountResolved] = useState(false);

    /**
     * Single error-handling funnel: 401s flip `authFailed` and route to a re-auth message;
     * everything else falls through to the call-site's specific fallback.
     *
     * v6.4: always console.error in addition to the UI error state, so debugging is visible
     * without inspecting React state. Per project rule on Todoist/habit integration paths.
     */
    const handleApiError = useCallback((e: unknown, fallback: string) => {
        if (e instanceof SessionExpiredError) {
            console.error('[Todoist] session expired:', e);
            setAuthFailed(true);
            setError('Your session expired — reload the page to sign in again.');
            return;
        }
        if (e instanceof TodoistAuthError) {
            console.error('[Todoist] auth failed (401):', e);
            setAuthFailed(true);
            setError('Todoist authentication failed — reconnect in Settings.');
            return;
        }
        console.error(`[Todoist] ${fallback}:`, e);
        setError(e instanceof Error ? e.message : fallback);
    }, []);

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

    // ── Connection status ──
    const refreshConnection = useCallback(async () => {
        try {
            const { configured } = await getTodoistStatus();
            setIsConfigured(configured);
            setAuthFailed(false);
        } catch (e) {
            setIsConfigured(false);
            if (e instanceof TodoistAuthError || e instanceof SessionExpiredError) setAuthFailed(true);
        } finally {
            setStatusResolved(true);
        }
    }, []);

    // Resolve connection on mount (cache still renders synchronously meanwhile).
    useEffect(() => { void refreshConnection(); }, [refreshConnection]);

    // v7.11: resolve the connected account's identity once per connection; cleared on disconnect.
    // Best-effort — on failure it stays null and provenance gating simply remains inactive.
    useEffect(() => {
        if (!isConfigured) {
            setAccount(null);
            setAccountResolved(false);
            return;
        }
        let cancelled = false;
        void (async () => {
            try {
                const user = await apiFetch<{ id: string | number; email?: string }>('/user');
                if (!cancelled && user && user.id != null) {
                    setAccount({ id: String(user.id), email: user.email ?? null });
                }
            } catch (e) {
                console.error('[Todoist] failed to resolve account identity:', e);
            } finally {
                if (!cancelled) setAccountResolved(true);
            }
        })();
        return () => { cancelled = true; };
    }, [isConfigured]);

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
                if (!isConfiguredRef.current) return;
                if (withLoadingSpinner) setLoading(true);
                if (errorMessage !== undefined) setError(null);
                try {
                    const data = await fetchAllPages<T>(path);
                    setData(data);
                    lastFetchedRef.current[kind] = Date.now();
                } catch (e) {
                    // Auth failures always route through the shared auth funnel, even for silent
                    // project/section refreshes — otherwise a revoked token or expired Access
                    // session would fail in the background without surfacing the real problem.
                    if (e instanceof TodoistAuthError || e instanceof SessionExpiredError) {
                        handleApiError(e, errorMessage ?? 'Failed to refresh Todoist data');
                    } else if (errorMessage !== undefined) {
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
        [handleApiError],
    );

    const refreshTasks = useCallback(
        (opts?: RefreshOpts) => {
            return refreshResource<TodoistTask>({
                kind: 'tasks',
                path: '/tasks',
                setData: (data) => {
                    setTasks(data);
                    hasDataRef.current = data.length > 0;
                    setTasksHydrated(true);
                },
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
            setTasksHydrated(true);
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

    // ── Focus refresh (respects per-resource staleness) ──
    // Refreshes tasks AND projects; both dedupe internally via the 30s staleness window,
    // so a quick tab-switch loop is cheap. Sections are static enough to skip here.
    useEffect(() => {
        if (!isConfigured) return;
        const onFocus = () => {
            refreshTasks();
            refreshProjects();
        };
        window.addEventListener('focus', onFocus);
        return () => window.removeEventListener('focus', onFocus);
    }, [isConfigured, refreshTasks, refreshProjects]);

    // ── Persist cache on data change ──
    useEffect(() => {
        if (!tasksHydrated && tasks.length === 0 && projects.length === 0 && sections.length === 0) return;
        saveCache(tasks, projects, sections);
    }, [tasks, projects, sections, tasksHydrated]);

    // ── Data reconciliation: title snapshot sync ──
    const hasSyncedSnapshots = useRef(false);
    useEffect(() => {
        if (loading || !tasksHydrated || plan.linkedTasks.length === 0) return;
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
    }, [loading, tasks, tasksHydrated, plan.linkedTasks, dispatch]);

    // ── Data reconciliation: stale task cleanup (one-time) ──
    const hasCleanedUp = useRef(false);
    useEffect(() => {
        if (hasCleanedUp.current || loading || !tasksHydrated) return;
        if (!hasSyncedSnapshots.current) return;
        hasCleanedUp.current = true;
        const fetchedIds = new Set(tasks.map((t) => t.id));
        for (const lt of plan.linkedTasks) {
            if (!fetchedIds.has(lt.todoistId) && !lt.completed) {
                dispatch({ type: 'TOGGLE_TASK_COMPLETE', todoistId: lt.todoistId, titleSnapshot: lt.titleSnapshot });
            }
        }
    }, [loading, tasks, tasksHydrated, plan.linkedTasks, dispatch]);

    // ── CRUD mutations ──

    const createTask = useCallback(async (content: string, opts?: CreateTaskOpts): Promise<TodoistTask | null> => {
        if (!isConfiguredRef.current) return null;
        setError(null);
        try {
            const task = await apiFetch<TodoistTask>('/tasks', {
                method: 'POST', body: JSON.stringify({ content, ...opts }),
            });
            setTasks((prev) => [...prev, task]);
            return task;
        } catch (e) {
            handleApiError(e, 'Failed to create task');
            return null;
        }
    }, [handleApiError]);

    const completeTask = useCallback(async (taskId: string): Promise<boolean> => {
        if (!isConfiguredRef.current) {
            setError('Todoist is not connected — reconnect in Settings.');
            return false;
        }
        // Capture recurrence-ness *before* the await so we know whether to drop the cache
        // entry. We use `item_close` (not `item_complete`): it does exactly what the official
        // Todoist clients do when you check a task off — regular tasks are completed, and
        // *recurring* tasks are advanced to their next occurrence rather than ended. The old
        // `item_complete` command terminated the whole recurrence, so completing a recurring
        // habit silently killed its cycle instead of rolling it forward.
        const existing = tasksRef.current.find((t) => t.id === taskId);
        const isRecurring = Boolean(existing?.due?.is_recurring);
        try {
            await apiFetch('/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `commands=${encodeURIComponent(JSON.stringify([
                    { type: 'item_close', uuid: crypto.randomUUID(), args: { id: taskId } },
                ]))}`,
            });
            if (isRecurring) {
                // The task is still alive with an advanced due date. Keep the (now-stale-due-date)
                // entry in cache so it stays visible to the habit filters, and force-refresh so
                // the new due date lands ASAP — otherwise `computeTodaysHabitInstances` /
                // `findOverdueHabits` would be blinded until the 5-min staleness window expires.
                void refreshTasks({ force: true });
            } else {
                setTasks((prev) => prev.filter((t) => t.id !== taskId));
            }
            return true;
        } catch (e) {
            handleApiError(e, 'Failed to complete task');
            return false;
        }
    }, [handleApiError, refreshTasks]);

    const reopenTask = useCallback(async (taskId: string) => {
        if (!isConfiguredRef.current) return;
        try {
            await apiFetch('/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `commands=${encodeURIComponent(JSON.stringify([
                    { type: 'item_uncomplete', uuid: crypto.randomUUID(), args: { id: taskId } },
                ]))}`,
            });
            await refreshTasks({ force: true });
        } catch (e) {
            handleApiError(e, 'Failed to reopen task');
        }
    }, [refreshTasks, handleApiError]);

    const moveTask = useCallback(async (taskId: string, projectId: string): Promise<boolean> => {
        if (!isConfiguredRef.current) return false;
        try {
            await apiFetch('/sync', {
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
            handleApiError(e, 'Failed to move task');
            return false;
        }
    }, [handleApiError]);

    const reorderTasks = useCallback(async (items: { id: string; child_order: number }[]): Promise<boolean> => {
        if (items.length === 0) return true;
        if (!isConfiguredRef.current) return false;
        // Optimistic: patch local child_order so the tree re-sorts immediately.
        const orderById = new Map(items.map((it) => [it.id, it.child_order]));
        setTasks((prev) => prev.map((t) => (orderById.has(t.id) ? { ...t, child_order: orderById.get(t.id)! } : t)));
        try {
            await apiFetch('/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `commands=${encodeURIComponent(JSON.stringify([
                    { type: 'item_reorder', uuid: crypto.randomUUID(), args: { items } },
                ]))}`,
            });
            return true;
        } catch (e) {
            handleApiError(e, 'Failed to reorder tasks');
            // Re-fetch to recover the authoritative ordering after a failed optimistic write.
            void refreshTasks({ force: true });
            return false;
        }
    }, [handleApiError, refreshTasks]);

    const updateTask = useCallback(async (taskId: string, updates: UpdateTaskOpts): Promise<TodoistTask | null> => {
        if (!isConfiguredRef.current) return null;
        setError(null);
        try {
            const updated = await apiFetch<TodoistTask>(`/tasks/${taskId}`, {
                method: 'POST', body: JSON.stringify(updates),
            });
            setTasks((prev) => prev.map((t) => (t.id === taskId ? updated : t)));
            return updated;
        } catch (e) {
            handleApiError(e, 'Failed to update task');
            return null;
        }
    }, [handleApiError]);

    const createTaskComment = useCallback(async (taskId: string, content: string) => {
        if (!isConfiguredRef.current) return;
        try {
            await apiFetch('/comments', {
                method: 'POST',
                body: JSON.stringify({ task_id: taskId, content }),
            });
        } catch (e) {
            handleApiError(e, 'Failed to post comment');
        }
    }, [handleApiError]);

    const deleteTask = useCallback(async (taskId: string): Promise<boolean> => {
        if (!isConfiguredRef.current) return false;
        try {
            await apiFetch(`/tasks/${taskId}`, { method: 'DELETE' });
            setTasks((prev) => {
                const removed = collectDescendantIds(prev, [taskId], (t) => t.parent_id);
                return prev.filter((t) => !removed.has(t.id));
            });
            return true;
        } catch (e) {
            handleApiError(e, 'Failed to delete task');
            return false;
        }
    }, [handleApiError]);

    const createProject = useCallback(async (name: string, opts?: CreateProjectOpts): Promise<TodoistProject | null> => {
        if (!isConfiguredRef.current) return null;
        setError(null);
        try {
            const project = await apiFetch<TodoistProject>('/projects', {
                method: 'POST', body: JSON.stringify({ name, ...opts }),
            });
            setProjects((prev) => [...prev, project]);
            return project;
        } catch (e) {
            handleApiError(e, 'Failed to create project');
            return null;
        }
    }, [handleApiError]);

    const deleteProject = useCallback(async (projectId: string) => {
        if (!isConfiguredRef.current) return;
        try {
            await apiFetch(`/projects/${projectId}`, { method: 'DELETE' });
            const removedProjects = collectDescendantIds(projects, [projectId], (p) => p.parent_id);
            setProjects((prev) => prev.filter((p) => !removedProjects.has(p.id)));
            setTasks((prev) => prev.filter((t) => !removedProjects.has(t.project_id)));
            setSections((prev) => prev.filter((s) => !removedProjects.has(s.project_id)));
        } catch (e) {
            handleApiError(e, 'Failed to delete project');
        }
    }, [projects, handleApiError]);

    // ── Memoized task lookup map ──
    const taskMap = useMemo(
        () => new Map(tasks.map((t) => [t.id, t])),
        [tasks],
    );

    // ── Context values ──
    const dataValue = useMemo<TodoistDataValue>(() => ({
        tasks,
        projects,
        sections,
        taskMap,
        tasksHydrated,
        loading,
        error,
        isConfigured,
        statusResolved,
        authFailed,
        accountId: account?.id ?? null,
        accountEmail: account?.email ?? null,
        accountResolved,
    }), [tasks, projects, sections, taskMap, tasksHydrated, loading, error, isConfigured, statusResolved, authFailed, account, accountResolved]);

    const actionsValue = useMemo<TodoistActionsValue>(() => ({
        createTask, updateTask, moveTask, reorderTasks, completeTask, reopenTask, deleteTask, createTaskComment,
        createProject, deleteProject, refreshTasks, refreshProjects, refreshSections, refreshConnection,
    }), [createTask, updateTask, moveTask, reorderTasks, completeTask, reopenTask, deleteTask, createTaskComment,
        createProject, deleteProject, refreshTasks, refreshProjects, refreshSections, refreshConnection]);

    return (
        <TodoistDataContext.Provider value={dataValue}>
            <TodoistActionsContext.Provider value={actionsValue}>
                {children}
            </TodoistActionsContext.Provider>
        </TodoistDataContext.Provider>
    );
}
