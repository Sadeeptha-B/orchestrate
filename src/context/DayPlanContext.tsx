import {
    createContext,
    useReducer,
    useEffect,
    type ReactNode,
} from 'react';
import type {
    DayPlan,
    Intention,
    LinkedTask,
    CheckIn,
    AppSettings,
    SavedDayPlan,
    LifeContext,
    Season,
    Habit,
    HabitLogEntry,
    RestCue,
    BacklogEntry,
    TodaysHabitInstance,
    EngagementRecord,
} from '../types';
import { defaultSessionSlots } from '../data/sessions';
import { todayISO } from '../lib/time';
import { DEFAULT_SESSION_BUFFER_MINUTES, DEFAULT_TASK_CAPS } from '../lib/capacity';
import { restCues as defaultRestCues } from '../data/restCues';
import {
    buildBacklogEntry,
    harvestStalePlan,
    rebuildLinkedTasksForBacklogEntry,
} from '../lib/backlog';

// --------------- helpers ---------------

const STORAGE_KEY = 'orchestrate-day-plan';
const SETTINGS_KEY = 'orchestrate-settings';
const HISTORY_KEY = 'orchestrate-history';
const LIFE_KEY = 'orchestrate-life-context';
const SCHEMA_VERSION = 6.3;
/** Wizard step count stamped on persisted plans for the migration chain to detect old layouts. */
const WIZARD_STEPS_COUNT = 4;

function freshPlan(): DayPlan {
    return {
        date: todayISO(),
        intentions: [],
        linkedTasks: [],
        todaysHabits: [],
        taskSessions: {},
        wizardStep: 1,
        setupComplete: false,
        checkIns: [],
        habitLog: [],
    };
}

/** Migrate a plan through the version chain: v1 (tasks) → v2 (intentions) → v4 (linkedTasks) → v6.1 (habit-as-task decoupling). */
function migratePlan(raw: Record<string, unknown>): DayPlan {
    // Wizard was reduced from 6 steps to 5 (old Step 1 & 2 merged).
    // Old step 2+ maps to step N-1; step 1 stays 1.
    // Only apply when plan was saved under the old 6-step layout.
    const wizardSteps = raw._wizardSteps as number;
    const migrateStep = (s: number) => {
        // v1 (6 steps) → v2 (5 steps): step 2+ maps to step N-1
        if (wizardSteps !== 5 && wizardSteps !== 4) {
            s = Math.max(s > 1 ? s - 1 : 1, 1);
        }
        // v3/v4 (5 steps) → v4 (4 steps): old step 4 (nudges) merged into 3, step 5 → 4
        if (wizardSteps === 5) {
            if (s === 4) s = 3;
            else if (s === 5) s = 4;
        }
        return Math.min(s, 4);
    };

    // v6 → v6.1: identify habit-derived intentions (to be dropped) and the habit ID per intention,
    // so any LinkedTasks under them can be re-anchored as orphan habit-tasks with `sourceHabitId`.
    const habitIdByIntentionId = new Map<string, string>();
    if (Array.isArray(raw.intentions)) {
        for (const i of raw.intentions as Array<Record<string, unknown>>) {
            if (i.sourceHabitId) {
                habitIdByIntentionId.set(i.id as string, i.sourceHabitId as string);
            }
        }
    }

    // --- v1 → v2: convert tasks to intentions ---
    let intentions: Intention[];
    let intentionSessions: Record<string, string[]>;

    if (Array.isArray(raw.intentions)) {
        // Already v2+ shape — extract intentions. v6.1: drop habit-derived intentions entirely
        // (their tasks become orphan habit-tasks below). Strip the deprecated sourceHabitId /
        // skippedForToday fields from any remaining entries.
        intentions = (raw.intentions as Array<Record<string, unknown>>)
            .filter((i) => !habitIdByIntentionId.has(i.id as string))
            .map((i) => ({
                id: i.id as string,
                title: i.title as string,
                linkedTaskIds: (i.linkedTaskIds as string[]) ?? [],
                completed: (i.completed as boolean) ?? false,
                brokenDown: (i.brokenDown as boolean) ?? false,
            }));
        intentionSessions = (raw.intentionSessions ?? {}) as Record<string, string[]>;
    } else {
        // v1: tasks → intentions
        const v1Tasks = (raw.tasks ?? []) as Array<Record<string, unknown>>;
        intentions = v1Tasks.map((t) => ({
            id: t.id as string,
            title: t.title as string,
            linkedTaskIds: [],
            completed: (t.completed as boolean) ?? false,
            brokenDown: false,
        }));
        intentionSessions = (raw.taskSessions ?? {}) as Record<string, string[]>;
    }

    // --- v2/v3 → v4: if plan has intentionSessions but no taskSessions/linkedTasks ---
    if (Array.isArray(raw.linkedTasks) && raw.taskSessions !== undefined) {
        // Already v4+ shape. v6.3: stabilizers leave LinkedTask entirely — any row with
        // `sourceHabitId` (legacy v6.1/v6.2 shape, or rebuilt via the habit-derived-intention
        // path above) becomes a synthetic TodaysHabitInstance, then is dropped from linkedTasks.
        const harvestedInstances: TodaysHabitInstance[] = [];
        const droppedHabitTaskIds = new Set<string>();
        const v62LinkedTasks: Array<Record<string, unknown>> = [];
        for (const lt of raw.linkedTasks as Array<Record<string, unknown>>) {
            const intentionId = lt.intentionId as string | undefined;
            const inferredHabitId = intentionId ? habitIdByIntentionId.get(intentionId) : undefined;
            const habitId = (lt.sourceHabitId as string | undefined) ?? inferredHabitId;
            if (habitId) {
                const todoistId = lt.todoistId as string;
                droppedHabitTaskIds.add(todoistId);
                const completed = (lt.completed as boolean) ?? false;
                const skipped = (lt.skippedForToday as boolean) ?? false;
                harvestedInstances.push({
                    id: crypto.randomUUID(),
                    habitId,
                    todoistTaskId: todoistId,
                    titleSnapshot: (lt.titleSnapshot as string | undefined) ?? todoistId,
                    durationMinutes: (lt.estimatedMinutes as number | null) ?? 30,
                    status: completed ? 'completed' : skipped ? 'skipped' : 'planned',
                });
                continue;
            }
            v62LinkedTasks.push(lt);
        }

        // v6.3: stamp `status` on remaining LinkedTasks (mirror of `completed`).
        const migratedLinkedTasks: LinkedTask[] = v62LinkedTasks.map((lt) => {
            const completed = (lt.completed as boolean) ?? false;
            const out: LinkedTask = {
                todoistId: lt.todoistId as string,
                intentionId: lt.intentionId as string | undefined,
                type: (lt.type as LinkedTask['type']) ?? 'unclassified',
                assignedSessions: (lt.assignedSessions as string[]) ?? [],
                completed,
                estimatedMinutes: (lt.estimatedMinutes as number | null) ?? null,
                status: (lt.status as LinkedTask['status']) ?? (completed ? 'completed' : 'pending'),
                ...(lt.titleSnapshot ? { titleSnapshot: lt.titleSnapshot as string } : {}),
                ...(lt.engagement ? { engagement: lt.engagement as EngagementRecord } : {}),
                ...(lt.rescheduledFromTodoistId ? { rescheduledFromTodoistId: lt.rescheduledFromTodoistId as string } : {}),
                ...(lt.rescheduledAt ? { rescheduledAt: lt.rescheduledAt as string } : {}),
            };
            return out;
        });

        const rawTaskSessions = raw.taskSessions as Record<string, string[]>;
        const taskSessions = droppedHabitTaskIds.size > 0
            ? Object.fromEntries(
                Object.entries(rawTaskSessions).map(([sid, ids]) => [
                    sid,
                    ids.filter((id) => !droppedHabitTaskIds.has(id)),
                ]),
            )
            : rawTaskSessions;

        const existingTodaysHabits = (raw.todaysHabits as TodaysHabitInstance[] | undefined) ?? [];
        const knownHabitIds = new Set(existingTodaysHabits.map((i) => i.habitId));
        const todaysHabits = [
            ...existingTodaysHabits,
            ...harvestedInstances.filter((i) => !knownHabitIds.has(i.habitId)),
        ];

        return {
            date: raw.date as string,
            intentions,
            linkedTasks: migratedLinkedTasks,
            todaysHabits,
            taskSessions,
            wizardStep: migrateStep((raw.wizardStep as number) ?? 1),
            setupComplete: (raw.setupComplete as boolean) ?? false,
            checkIns: (raw.checkIns ?? []) as CheckIn[],
            // v5 → v6: initialize habitLog if missing.
            habitLog: ((raw.habitLog as HabitLogEntry[] | undefined) ?? []),
        };
    }

    // v2/v3 → v4: no Todoist task IDs exist, so we can't auto-create LinkedTask entries.
    // Preserve intentions, initialize empty task structures.
    // Ignore intentionSessions (they referenced intentions, not tasks).
    void intentionSessions; // intentionally unused in v4
    return {
        date: raw.date as string,
        intentions,
        linkedTasks: [],
        todaysHabits: [],
        taskSessions: {},
        wizardStep: migrateStep((raw.wizardStep as number) ?? 1),
        setupComplete: (raw.setupComplete as boolean) ?? false,
        checkIns: (raw.checkIns ?? []) as CheckIn[],
        habitLog: [],
    };
}

function withV6SettingsDefaults(s: AppSettings): AppSettings {
    return {
        ...s,
        taskCapDefaults: s.taskCapDefaults ?? { ...DEFAULT_TASK_CAPS },
        sessionBufferMinutes: s.sessionBufferMinutes ?? DEFAULT_SESSION_BUFFER_MINUTES,
    };
}

function loadSettings(): AppSettings {
    try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (!raw) return withV6SettingsDefaults({ notificationPreference: 'both', sessionSlots: defaultSessionSlots });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const parsed = JSON.parse(raw) as AppSettings & { googleCalendarId?: string } & { googleCalendarIds?: any };
        // Migrate legacy single-string googleCalendarId → googleCalendarIds array
        if (!parsed.googleCalendarIds && parsed.googleCalendarId) {
            parsed.googleCalendarIds = [{ id: parsed.googleCalendarId }];
            delete parsed.googleCalendarId;
        }
        // Migrate legacy string[] googleCalendarIds → GoogleCalendarEntry[]
        if (Array.isArray(parsed.googleCalendarIds) && parsed.googleCalendarIds.length > 0 && typeof parsed.googleCalendarIds[0] === 'string') {
            parsed.googleCalendarIds = (parsed.googleCalendarIds as unknown as string[]).map((id) => ({ id }));
        }
        return withV6SettingsDefaults(parsed);
    } catch {
        return withV6SettingsDefaults({ notificationPreference: 'both', sessionSlots: defaultSessionSlots });
    }
}

function loadHistory(): SavedDayPlan[] {
    try {
        const raw = localStorage.getItem(HISTORY_KEY);
        if (!raw) return [];
        return JSON.parse(raw) as SavedDayPlan[];
    } catch {
        return [];
    }
}

function emptyLifeContext(): LifeContext {
    return { seasons: [], habits: [], activeSeasonId: null, backlog: [] };
}

/**
 * Per-habit schema migration:
 *  - v5 → v6: ensure `kind`, defaulting legacy habits to `'stabilizer'`.
 *  - v6 → v6.1: fold `autoLinkTodoistId` → `todoistTaskId`, `maxBlockMinutes` → `targetDurationMinutes`,
 *    default `windowBehavior` to `'lenient'`. The deprecated fields are stripped so storage doesn't
 *    accumulate cruft — they only need to round-trip once.
 *
 * Called from both `loadLifeContext` (initial localStorage load) and the `IMPORT_BACKUP` reducer
 * case (so imported v6 payloads also get the v6.1 shape applied).
 */
function migrateHabit(h: Habit): Habit {
    const { autoLinkTodoistId, maxBlockMinutes, ...rest } = h;
    const kind = rest.kind ?? 'stabilizer';
    const migrated: Habit = { ...rest, kind };
    if (kind === 'stabilizer') {
        if (autoLinkTodoistId && !rest.todoistTaskId) {
            migrated.todoistTaskId = autoLinkTodoistId;
        }
        if (maxBlockMinutes && migrated.targetDurationMinutes === undefined) {
            migrated.targetDurationMinutes = maxBlockMinutes;
        }
        if (!rest.windowBehavior) {
            migrated.windowBehavior = 'lenient';
        }
    }
    return migrated;
}

function loadLifeContext(): LifeContext {
    try {
        const raw = localStorage.getItem(LIFE_KEY);
        if (!raw) return emptyLifeContext();
        const parsed = JSON.parse(raw) as Partial<LifeContext> & { _schemaVersion?: number };
        return {
            seasons: parsed.seasons ?? [],
            habits: (parsed.habits ?? []).map(migrateHabit),
            activeSeasonId: parsed.activeSeasonId ?? null,
            restCues: parsed.restCues,
            backlog: parsed.backlog ?? [],
        };
    } catch {
        return emptyLifeContext();
    }
}

/**
 * v6.2: peek at the raw persisted plan *without* the date-freshness gate that `loadPlan` applies.
 * Used by `loadInitialState` so we can harvest a stale plan before discarding it.
 */
function peekRawPlan(): DayPlan | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        return migratePlan(parsed);
    } catch {
        return null;
    }
}

/**
 * v6.2: coordinated initial-state loader. On cold start with a stale persisted plan,
 * harvests its unfinished intentions into `life.backlog` and returns a fresh plan.
 * The history list is left untouched — `SavedDayPlan` is now a manual-save-only construct
 * since the backlog already preserves the meaningful part of yesterday (unfinished intentions).
 */
function loadInitialState(): State {
    const settings = loadSettings();
    const baseHistory = loadHistory();
    const baseLife = loadLifeContext();
    const raw = peekRawPlan();

    if (!raw || raw.date === todayISO()) {
        return {
            plan: raw ?? freshPlan(),
            settings,
            editingStep: null,
            history: baseHistory,
            life: baseLife,
        };
    }

    // Stale plan: harvest unfinished intentions into the backlog, then return a fresh plan.
    const harvested = harvestStalePlan(raw);
    const life: LifeContext = harvested.length === 0
        ? baseLife
        : { ...baseLife, backlog: [...(baseLife.backlog ?? []), ...harvested] };

    return {
        plan: freshPlan(),
        settings,
        editingStep: null,
        history: baseHistory,
        life,
    };
}

function removeTaskIdsFromSessions(
    taskSessions: Record<string, string[]>,
    taskIds: Iterable<string>,
): Record<string, string[]> {
    const removedIds = new Set(taskIds);
    if (removedIds.size === 0) return taskSessions;

    const next: Record<string, string[]> = {};
    for (const [sessionId, ids] of Object.entries(taskSessions)) {
        next[sessionId] = ids.filter((id) => !removedIds.has(id));
    }
    return next;
}

function removeLinkedTasksFromPlan(
    plan: DayPlan,
    shouldRemove: (task: LinkedTask) => boolean,
): Pick<DayPlan, 'linkedTasks' | 'taskSessions'> {
    const removedIds = new Set(
        plan.linkedTasks
            .filter(shouldRemove)
            .map((task) => task.todoistId),
    );

    if (removedIds.size === 0) {
        return {
            linkedTasks: plan.linkedTasks,
            taskSessions: plan.taskSessions,
        };
    }

    return {
        linkedTasks: plan.linkedTasks.filter((task) => !removedIds.has(task.todoistId)),
        taskSessions: removeTaskIdsFromSessions(plan.taskSessions, removedIds),
    };
}

function setIntentionOwner(task: LinkedTask, intentionId: string): LinkedTask {
    return { ...task, intentionId };
}

/**
 * v6.3: close an open engagement record. If the record already has an `endedAt`, returns it unchanged.
 * Otherwise stamps `endedAt = nowISO` and adds the elapsed minutes to `totalMinutes`.
 */
function closeEngagement(record: EngagementRecord, nowISO: string): EngagementRecord {
    if (record.endedAt) return record;
    const elapsed = Math.max(
        0,
        Math.round((Date.parse(nowISO) - Date.parse(record.startedAt)) / 60000),
    );
    return {
        ...record,
        endedAt: nowISO,
        totalMinutes: (record.totalMinutes ?? 0) + elapsed,
    };
}

// v6: `backfillHabitsFromLegacy` was removed — the deprecated `isHabit` flag is no longer
// readable from the type system. Any legacy data was already surfaced during v5.

// --------------- actions ---------------

type Action =
    | { type: 'ADD_INTENTION'; title: string }
    | { type: 'REMOVE_INTENTION'; intentionId: string }
    | { type: 'UPDATE_INTENTION'; intention: Intention }
    | { type: 'REORDER_INTENTIONS'; intentionIds: string[] }
    | { type: 'TOGGLE_INTENTION_COMPLETE'; intentionId: string }
    | { type: 'MARK_BROKEN_DOWN'; intentionId: string; brokenDown: boolean }
    | { type: 'LINK_TASK'; intentionId: string; todoistId: string }
    | { type: 'UNLINK_TASK'; todoistId: string }
    | { type: 'CATEGORIZE_TASK'; todoistId: string; taskType: LinkedTask['type'] }
    | { type: 'SET_TASK_ESTIMATE'; todoistId: string; minutes: number }
    | { type: 'ASSIGN_TASK'; todoistId: string; sessionId: string }
    | { type: 'UNASSIGN_TASK'; todoistId: string; sessionId: string }
    | { type: 'TOGGLE_TASK_COMPLETE'; todoistId: string; titleSnapshot?: string }
    | { type: 'SYNC_TASK_SNAPSHOTS'; snapshots: Record<string, string> }
    | { type: 'REORDER_SESSION_TASKS'; sessionId: string; taskIds: string[] }
    | { type: 'SET_WIZARD_STEP'; step: number }
    | { type: 'COMPLETE_SETUP' }
    | { type: 'ADD_CHECKIN'; checkIn: CheckIn }
    | { type: 'RESET_DAY' }
    | { type: 'UPDATE_SETTINGS'; settings: Partial<AppSettings> }
    | { type: 'SET_EDITING_STEP'; step: number | null }
    | { type: 'SAVE_DAY'; label: string }
    | { type: 'RESTORE_DAY'; savedAt: string }
    | { type: 'DELETE_SAVED_DAY'; savedAt: string }
    | { type: 'IMPORT_SESSIONS'; sessions: SavedDayPlan[] }
    // ---- v5: Life scaffolding ----
    | { type: 'ADD_SEASON'; season: Omit<Season, 'id'> }
    | { type: 'UPDATE_SEASON'; season: Season }
    | { type: 'DELETE_SEASON'; seasonId: string }
    | { type: 'ACTIVATE_SEASON'; seasonId: string | null }
    | { type: 'ADD_HABIT'; habit: Habit }
    | { type: 'UPDATE_HABIT'; habit: Habit }
    | { type: 'DELETE_HABIT'; habitId: string }
    | { type: 'TOGGLE_HABIT_ACTIVE'; habitId: string }
    | { type: 'IMPORT_BACKUP'; settings?: AppSettings; life?: LifeContext; history?: SavedDayPlan[] }
    // ---- v6: Light Pool log actions ----
    | { type: 'LOG_HABIT_START'; habitId: string; sessionId?: string }
    | { type: 'LOG_HABIT_COMPLETE'; entryId: string; durationMinutes?: number }
    | { type: 'DELETE_HABIT_LOG_ENTRY'; entryId: string }
    // ---- True Rest cue customization ----
    | { type: 'ADD_REST_CUE'; cue: Omit<RestCue, 'id'> }
    | { type: 'UPDATE_REST_CUE'; cue: RestCue }
    | { type: 'DELETE_REST_CUE'; cueId: string }
    | { type: 'REPLACE_REST_CUES'; cues: RestCue[] | undefined }
    // ---- v6.2: Intentions backlog ----
    | { type: 'MOVE_INTENTION_TO_BACKLOG'; intentionId: string; reason?: BacklogEntry['reason'] }
    | { type: 'RESTORE_FROM_BACKLOG'; backlogId: string; taskCache: Record<string, string>; now?: string }
    | { type: 'DELETE_BACKLOG_ENTRY'; backlogId: string }
    // ---- v6.3: TodaysHabitInstance lifecycle ----
    | { type: 'REFRESH_TODAYS_HABITS'; instances: TodaysHabitInstance[] }
    | { type: 'START_HABIT_INSTANCE'; instanceId: string; now: string }
    | { type: 'STOP_HABIT_INSTANCE'; instanceId: string; now: string }
    | { type: 'COMPLETE_HABIT_INSTANCE'; instanceId: string; now: string }
    | { type: 'SKIP_HABIT_INSTANCE'; instanceId: string }
    | { type: 'RESCHEDULE_HABIT_INSTANCE'; instanceId: string; newTargetTime?: string; now: string }
    // ---- v6.3: Task engagement ----
    | { type: 'START_TASK_ENGAGEMENT'; todoistId: string; now: string }
    | { type: 'STOP_TASK_ENGAGEMENT'; todoistId: string; now: string };

interface State {
    plan: DayPlan;
    settings: AppSettings;
    editingStep: number | null; // non-null when revisiting a wizard step from dashboard
    history: SavedDayPlan[];
    life: LifeContext;
}

function reducer(state: State, action: Action): State {
    const { plan, settings } = state;

    switch (action.type) {
        case 'ADD_INTENTION': {
            const intention: Intention = {
                id: crypto.randomUUID(),
                title: action.title,
                linkedTaskIds: [],
                completed: false,
                brokenDown: false,
            };
            return { ...state, plan: { ...plan, intentions: [...plan.intentions, intention] } };
        }

        case 'REMOVE_INTENTION': {
            const intentions = plan.intentions.filter((i) => i.id !== action.intentionId);
            const { linkedTasks, taskSessions } = removeLinkedTasksFromPlan(
                plan,
                (task) => task.intentionId === action.intentionId,
            );
            return { ...state, plan: { ...plan, intentions, linkedTasks, taskSessions } };
        }

        case 'UPDATE_INTENTION': {
            const intentions = plan.intentions.map((i) =>
                i.id === action.intention.id ? action.intention : i,
            );
            return { ...state, plan: { ...plan, intentions } };
        }

        case 'REORDER_INTENTIONS': {
            const intentionMap = new Map(plan.intentions.map((i) => [i.id, i]));
            const reordered = action.intentionIds
                .map((id) => intentionMap.get(id))
                .filter((i): i is Intention => i !== undefined);
            return { ...state, plan: { ...plan, intentions: reordered } };
        }

        case 'TOGGLE_INTENTION_COMPLETE': {
            const intention = plan.intentions.find((i) => i.id === action.intentionId);
            if (!intention) return state;
            const newCompleted = !intention.completed;
            const intentions = plan.intentions.map((i) =>
                i.id === action.intentionId ? { ...i, completed: newCompleted } : i,
            );
            // Also toggle all linked tasks belonging to this intention (orphan habit-tasks are untouched).
            const linkedTasks = plan.linkedTasks.map((lt) =>
                lt.intentionId !== undefined && lt.intentionId === action.intentionId
                    ? { ...lt, completed: newCompleted }
                    : lt,
            );
            return { ...state, plan: { ...plan, intentions, linkedTasks } };
        }

        case 'MARK_BROKEN_DOWN': {
            const intentions = plan.intentions.map((i) =>
                i.id === action.intentionId ? { ...i, brokenDown: action.brokenDown } : i,
            );
            return { ...state, plan: { ...plan, intentions } };
        }

        // ---- Task-level actions (v4) ----

        case 'LINK_TASK': {
            const { intentionId, todoistId } = action;
            // If already linked to another intention, move it.
            let linkedTasks = plan.linkedTasks.map((lt) =>
                lt.todoistId === todoistId ? setIntentionOwner(lt, intentionId) : lt,
            );
            const intentions = plan.intentions.map((i) => {
                if (i.id === intentionId) {
                    // Add to target if not already there
                    const ids = i.linkedTaskIds.includes(todoistId)
                        ? i.linkedTaskIds
                        : [...i.linkedTaskIds, todoistId];
                    return { ...i, linkedTaskIds: ids };
                }
                // Remove from previous owner (if moving)
                return { ...i, linkedTaskIds: i.linkedTaskIds.filter((id) => id !== todoistId) };
            });
            // Create new LinkedTask if it doesn't exist yet
            const existing = linkedTasks.find((lt) => lt.todoistId === todoistId);
            if (!existing) {
                linkedTasks = [...linkedTasks, {
                    todoistId,
                    intentionId,
                    type: 'unclassified',
                    assignedSessions: [],
                    completed: false,
                    estimatedMinutes: null,
                }];
            }
            return { ...state, plan: { ...plan, intentions, linkedTasks } };
        }

        case 'UNLINK_TASK': {
            const { todoistId } = action;
            const { linkedTasks, taskSessions } = removeLinkedTasksFromPlan(
                plan,
                (task) => task.todoistId === todoistId,
            );
            const intentions = plan.intentions.map((i) => ({
                ...i,
                linkedTaskIds: i.linkedTaskIds.filter((id) => id !== todoistId),
            }));
            return { ...state, plan: { ...plan, intentions, linkedTasks, taskSessions } };
        }

        case 'CATEGORIZE_TASK': {
            const linkedTasks = plan.linkedTasks.map((lt) =>
                lt.todoistId === action.todoistId ? { ...lt, type: action.taskType } : lt,
            );
            return { ...state, plan: { ...plan, linkedTasks } };
        }

        case 'SET_TASK_ESTIMATE': {
            const linkedTasks = plan.linkedTasks.map((lt) =>
                lt.todoistId === action.todoistId ? { ...lt, estimatedMinutes: action.minutes } : lt,
            );
            return { ...state, plan: { ...plan, linkedTasks } };
        }

        case 'ASSIGN_TASK': {
            const task = plan.linkedTasks.find((lt) => lt.todoistId === action.todoistId);
            if (!task) return state;

            const taskSessions = { ...plan.taskSessions };

            if (task.type === 'background') {
                // Background: allow multi-session — just add to the target session
                const current = taskSessions[action.sessionId] ?? [];
                if (current.includes(action.todoistId)) return state;
                taskSessions[action.sessionId] = [...current, action.todoistId];
            } else {
                // Main: exclusive — remove from any other session first
                Object.assign(taskSessions, removeTaskIdsFromSessions(taskSessions, [action.todoistId]));
                taskSessions[action.sessionId] = [
                    ...(taskSessions[action.sessionId] ?? []),
                    action.todoistId,
                ];
            }

            // Update the task's assignedSessions array
            const newAssigned = Object.entries(taskSessions)
                .filter(([, ids]) => ids.includes(action.todoistId))
                .map(([sid]) => sid);

            const linkedTasks = plan.linkedTasks.map((lt) =>
                lt.todoistId === action.todoistId ? { ...lt, assignedSessions: newAssigned } : lt,
            );

            return { ...state, plan: { ...plan, linkedTasks, taskSessions } };
        }

        case 'UNASSIGN_TASK': {
            const taskSessions = { ...plan.taskSessions };
            taskSessions[action.sessionId] = (taskSessions[action.sessionId] ?? []).filter(
                (id) => id !== action.todoistId,
            );
            const linkedTasks = plan.linkedTasks.map((lt) =>
                lt.todoistId === action.todoistId
                    ? { ...lt, assignedSessions: lt.assignedSessions.filter((s) => s !== action.sessionId) }
                    : lt,
            );
            return { ...state, plan: { ...plan, linkedTasks, taskSessions } };
        }

        case 'TOGGLE_TASK_COMPLETE': {
            const nowISO = new Date().toISOString();
            const linkedTasks = plan.linkedTasks.map((lt) => {
                if (lt.todoistId !== action.todoistId) return lt;
                const completed = !lt.completed;
                const engagement = lt.engagement && !lt.engagement.endedAt
                    ? closeEngagement(lt.engagement, nowISO)
                    : lt.engagement;
                return {
                    ...lt,
                    completed,
                    status: completed ? ('completed' as const) : ('pending' as const),
                    ...(engagement ? { engagement } : {}),
                    ...(action.titleSnapshot ? { titleSnapshot: action.titleSnapshot } : {}),
                };
            });
            return { ...state, plan: { ...plan, linkedTasks } };
        }

        case 'SYNC_TASK_SNAPSHOTS': {
            const { snapshots } = action;
            const linkedTasks = plan.linkedTasks.map((lt) =>
                snapshots[lt.todoistId] && snapshots[lt.todoistId] !== lt.titleSnapshot
                    ? { ...lt, titleSnapshot: snapshots[lt.todoistId] }
                    : lt,
            );
            return { ...state, plan: { ...plan, linkedTasks } };
        }

        case 'REORDER_SESSION_TASKS': {
            const taskSessions = {
                ...plan.taskSessions,
                [action.sessionId]: action.taskIds,
            };
            return { ...state, plan: { ...plan, taskSessions } };
        }

        // ---- Wizard / global actions ----

        case 'SET_WIZARD_STEP':
            return { ...state, plan: { ...plan, wizardStep: action.step } };

        case 'COMPLETE_SETUP':
            return { ...state, plan: { ...plan, setupComplete: true } };

        case 'ADD_CHECKIN':
            return {
                ...state,
                plan: { ...plan, checkIns: [...plan.checkIns, action.checkIn] },
            };

        case 'RESET_DAY':
            return { ...state, plan: freshPlan(), editingStep: null };

        case 'UPDATE_SETTINGS':
            return { ...state, settings: { ...settings, ...action.settings } };

        case 'SET_EDITING_STEP':
            return { ...state, editingStep: action.step };

        case 'SAVE_DAY': {
            const entry: SavedDayPlan = {
                plan: { ...structuredClone(plan), _wizardSteps: WIZARD_STEPS_COUNT, _schemaVersion: SCHEMA_VERSION } as DayPlan,
                savedAt: new Date().toISOString(),
                label: action.label,
            };
            const filtered = state.history.filter((h) => h.plan.date !== plan.date);
            return { ...state, history: [entry, ...filtered] };
        }

        case 'RESTORE_DAY': {
            const saved = state.history.find((h) => h.savedAt === action.savedAt);
            if (!saved) return state;
            const restored = migratePlan(saved.plan as unknown as Record<string, unknown>);
            return { ...state, plan: { ...restored, date: todayISO() }, editingStep: null };
        }

        case 'DELETE_SAVED_DAY':
            return {
                ...state,
                history: state.history.filter((h) => h.savedAt !== action.savedAt),
            };

        case 'IMPORT_SESSIONS': {
            const existing = new Set(state.history.map((h) => h.savedAt));
            const newEntries = action.sessions.filter((s) => !existing.has(s.savedAt));
            return { ...state, history: [...newEntries, ...state.history] };
        }

        // ---- v5: Life scaffolding ----

        case 'ADD_SEASON': {
            const season: Season = { ...action.season, id: crypto.randomUUID() };
            // If incoming is active, deactivate any existing active season
            const seasons = season.active
                ? state.life.seasons.map((s) => ({ ...s, active: false })).concat(season)
                : [...state.life.seasons, season];
            const activeSeasonId = season.active ? season.id : state.life.activeSeasonId;
            return { ...state, life: { ...state.life, seasons, activeSeasonId } };
        }

        case 'UPDATE_SEASON': {
            // Enforce single-active-season invariant when the form flips `active`.
            const incoming = action.season;
            let seasons = state.life.seasons.map((s) =>
                s.id === incoming.id ? incoming : s,
            );
            let activeSeasonId = state.life.activeSeasonId;
            if (incoming.active) {
                seasons = seasons.map((s) =>
                    s.id === incoming.id ? s : { ...s, active: false },
                );
                activeSeasonId = incoming.id;
            } else if (activeSeasonId === incoming.id) {
                activeSeasonId = null;
            }
            return { ...state, life: { ...state.life, seasons, activeSeasonId } };
        }

        case 'DELETE_SEASON': {
            const seasons = state.life.seasons.filter((s) => s.id !== action.seasonId);
            const activeSeasonId =
                state.life.activeSeasonId === action.seasonId ? null : state.life.activeSeasonId;
            // Drop the season from any habits' seasonIds
            const habits = state.life.habits.map((h) =>
                h.seasonIds.includes(action.seasonId)
                    ? { ...h, seasonIds: h.seasonIds.filter((id) => id !== action.seasonId) }
                    : h,
            );
            return { ...state, life: { ...state.life, seasons, habits, activeSeasonId } };
        }

        case 'ACTIVATE_SEASON': {
            const { seasonId } = action;
            const seasons = state.life.seasons.map((s) => ({
                ...s,
                active: s.id === seasonId,
            }));
            return { ...state, life: { ...state.life, seasons, activeSeasonId: seasonId } };
        }

        case 'ADD_HABIT': {
            return {
                ...state,
                life: { ...state.life, habits: [...state.life.habits, action.habit] },
            };
        }

        case 'UPDATE_HABIT': {
            const habits = state.life.habits.map((h) =>
                h.id === action.habit.id ? action.habit : h,
            );
            return { ...state, life: { ...state.life, habits } };
        }

        case 'DELETE_HABIT': {
            const habit = state.life.habits.find((h) => h.id === action.habitId);
            // Anchor habits cannot be deleted while active — caller must deactivate first.
            if (habit?.isAnchor && habit.active) return state;
            const habits = state.life.habits.filter((h) => h.id !== action.habitId);
            // v6.3: also drop today's instances for this habit from `plan.todaysHabits`.
            const todaysHabits = plan.todaysHabits.filter((i) => i.habitId !== action.habitId);
            return {
                ...state,
                life: { ...state.life, habits },
                plan: { ...plan, todaysHabits },
            };
        }

        case 'TOGGLE_HABIT_ACTIVE': {
            const habits = state.life.habits.map((h) =>
                h.id === action.habitId ? { ...h, active: !h.active } : h,
            );
            return { ...state, life: { ...state.life, habits } };
        }

        case 'REFRESH_TODAYS_HABITS': {
            // v6.3: merge by habitId. For each incoming instance:
            //   - no existing match → append.
            //   - existing match is `planned` and not user-rescheduled → refresh `targetTime`,
            //     `durationMinutes`, `titleSnapshot` from the helper (picks up habit-form edits).
            //   - existing match is `planned` and user-rescheduled (`rescheduledAt` set) → only
            //     refresh `durationMinutes` + `titleSnapshot`. Preserve the user's chosen time.
            //   - existing match is in any other status → leave alone (engaged/completed/skipped
            //     state lives only here).
            const incomingByHabitId = new Map(action.instances.map((i) => [i.habitId, i]));
            const seenHabitIds = new Set<string>();
            const merged = plan.todaysHabits.map((existing) => {
                const incoming = incomingByHabitId.get(existing.habitId);
                if (!incoming) return existing;
                seenHabitIds.add(existing.habitId);
                if (existing.status !== 'planned') return existing;
                const userRescheduled = Boolean(existing.rescheduledAt);
                return {
                    ...existing,
                    durationMinutes: incoming.durationMinutes,
                    titleSnapshot: incoming.titleSnapshot,
                    ...(userRescheduled
                        ? {}
                        : incoming.targetTime !== undefined
                            ? { targetTime: incoming.targetTime }
                            : { targetTime: undefined }),
                };
            });
            const appended = action.instances.filter((i) => !seenHabitIds.has(i.habitId));
            if (appended.length === 0 && merged.every((m, idx) => m === plan.todaysHabits[idx])) {
                return state;
            }
            return {
                ...state,
                plan: { ...plan, todaysHabits: [...merged, ...appended] },
            };
        }

        case 'START_HABIT_INSTANCE': {
            // v6.3: starting (or resuming after a stop) opens a fresh segment. We update
            // `startedAt` to `now` on every Start so the next `closeEngagement` measures
            // only the current segment — previous cycles are already in `totalMinutes`.
            const todaysHabits = plan.todaysHabits.map((i) => {
                if (i.id !== action.instanceId) return i;
                const engagement: EngagementRecord = i.engagement
                    ? { ...i.engagement, startedAt: action.now, endedAt: undefined }
                    : { startedAt: action.now };
                return { ...i, status: 'engaged' as const, engagement };
            });
            return { ...state, plan: { ...plan, todaysHabits } };
        }

        case 'STOP_HABIT_INSTANCE': {
            // v6.3: stopping closes the current segment AND returns the instance to `planned`
            // so the toggle button flips back to ▶ Start. Resuming (Start again) preserves the
            // existing `totalMinutes` and opens a new segment.
            const todaysHabits = plan.todaysHabits.map((i) => {
                if (i.id !== action.instanceId || !i.engagement) return i;
                const engagement = closeEngagement(i.engagement, action.now);
                return { ...i, status: 'planned' as const, engagement };
            });
            return { ...state, plan: { ...plan, todaysHabits } };
        }

        case 'COMPLETE_HABIT_INSTANCE': {
            const todaysHabits = plan.todaysHabits.map((i) => {
                if (i.id !== action.instanceId) return i;
                const engagement = i.engagement && !i.engagement.endedAt
                    ? closeEngagement(i.engagement, action.now)
                    : i.engagement;
                return {
                    ...i,
                    status: 'completed' as const,
                    completedAt: action.now,
                    ...(engagement ? { engagement } : {}),
                };
            });
            return { ...state, plan: { ...plan, todaysHabits } };
        }

        case 'SKIP_HABIT_INSTANCE': {
            const todaysHabits = plan.todaysHabits.map((i) =>
                i.id === action.instanceId ? { ...i, status: 'skipped' as const } : i,
            );
            return { ...state, plan: { ...plan, todaysHabits } };
        }

        case 'RESCHEDULE_HABIT_INSTANCE': {
            // v6.3 (revised): in-place update. The instance keeps its id, its engagement record,
            // and its status. Only `targetTime` changes. `rescheduledAt` is stamped so a later
            // `REFRESH_TODAYS_HABITS` won't clobber the user's chosen time. No clone trail, no
            // strikethrough — rescheduling is just moving the instance on the timeline.
            const target = plan.todaysHabits.find((i) => i.id === action.instanceId);
            if (!target) return state;
            if (target.status !== 'planned' && target.status !== 'engaged') return state;
            const todaysHabits = plan.todaysHabits.map((i) => {
                if (i.id !== action.instanceId) return i;
                return {
                    ...i,
                    ...(action.newTargetTime
                        ? { targetTime: action.newTargetTime }
                        : { targetTime: undefined }),
                    rescheduledAt: action.now,
                };
            });
            return { ...state, plan: { ...plan, todaysHabits } };
        }

        case 'START_TASK_ENGAGEMENT': {
            const linkedTasks = plan.linkedTasks.map((lt) => {
                if (lt.todoistId !== action.todoistId) return lt;
                const engagement: EngagementRecord = lt.engagement
                    ? { ...lt.engagement, endedAt: undefined }
                    : { startedAt: action.now };
                return { ...lt, status: 'engaged' as const, engagement };
            });
            return { ...state, plan: { ...plan, linkedTasks } };
        }

        case 'STOP_TASK_ENGAGEMENT': {
            const linkedTasks = plan.linkedTasks.map((lt) => {
                if (lt.todoistId !== action.todoistId || !lt.engagement) return lt;
                return { ...lt, engagement: closeEngagement(lt.engagement, action.now) };
            });
            return { ...state, plan: { ...plan, linkedTasks } };
        }

        // ---- v6: Light Pool log actions ----

        case 'LOG_HABIT_START': {
            const entry: HabitLogEntry = {
                id: crypto.randomUUID(),
                habitId: action.habitId,
                startedAt: new Date().toISOString(),
                ...(action.sessionId ? { sessionId: action.sessionId } : {}),
            };
            return { ...state, plan: { ...plan, habitLog: [...plan.habitLog, entry] } };
        }

        case 'LOG_HABIT_COMPLETE': {
            const nowISO = new Date().toISOString();
            const habitLog = plan.habitLog.map((e) => {
                if (e.id !== action.entryId) return e;
                // If durationMinutes wasn't supplied, derive from start → now.
                const derivedMinutes = action.durationMinutes
                    ?? Math.max(0, Math.round((Date.parse(nowISO) - Date.parse(e.startedAt)) / 60000));
                return {
                    ...e,
                    completedAt: nowISO,
                    durationMinutes: derivedMinutes,
                };
            });
            return { ...state, plan: { ...plan, habitLog } };
        }

        case 'DELETE_HABIT_LOG_ENTRY': {
            return {
                ...state,
                plan: { ...plan, habitLog: plan.habitLog.filter((e) => e.id !== action.entryId) },
            };
        }

        case 'ADD_REST_CUE': {
            const newCue: RestCue = { ...action.cue, id: crypto.randomUUID() };
            const base = state.life.restCues ?? defaultRestCues;
            return { ...state, life: { ...state.life, restCues: [...base, newCue] } };
        }

        case 'UPDATE_REST_CUE': {
            const base = state.life.restCues ?? defaultRestCues;
            const restCues = base.map((c) => (c.id === action.cue.id ? action.cue : c));
            return { ...state, life: { ...state.life, restCues } };
        }

        case 'DELETE_REST_CUE': {
            const base = state.life.restCues ?? defaultRestCues;
            const restCues = base.filter((c) => c.id !== action.cueId);
            return { ...state, life: { ...state.life, restCues } };
        }

        case 'REPLACE_REST_CUES':
            return { ...state, life: { ...state.life, restCues: action.cues } };

        case 'IMPORT_BACKUP': {
            const next: State = { ...state };
            if (action.settings) next.settings = { ...state.settings, ...action.settings };
            if (action.life) {
                // Merge by id — never overwrite existing entries; append new ones.
                // Imported habits go through `migrateHabit` so a v6 backup picks up the v6.1 shape.
                const existingSeasonIds = new Set(state.life.seasons.map((s) => s.id));
                const existingHabitIds = new Set(state.life.habits.map((h) => h.id));
                const existingBacklogIds = new Set((state.life.backlog ?? []).map((e) => e.id));
                next.life = {
                    seasons: [
                        ...state.life.seasons,
                        ...action.life.seasons.filter((s) => !existingSeasonIds.has(s.id)),
                    ],
                    habits: [
                        ...state.life.habits,
                        ...action.life.habits
                            .filter((h) => !existingHabitIds.has(h.id))
                            .map(migrateHabit),
                    ],
                    activeSeasonId: state.life.activeSeasonId ?? action.life.activeSeasonId,
                    restCues: state.life.restCues ?? action.life.restCues,
                    backlog: [
                        ...(state.life.backlog ?? []),
                        ...(action.life.backlog ?? []).filter((e) => !existingBacklogIds.has(e.id)),
                    ],
                };
            }
            if (action.history) {
                const existing = new Set(state.history.map((h) => h.savedAt));
                next.history = [
                    ...state.history,
                    ...action.history.filter((h) => !existing.has(h.savedAt)),
                ];
            }
            return next;
        }

        // ---- v6.2: Intentions backlog ----

        case 'MOVE_INTENTION_TO_BACKLOG': {
            const intention = plan.intentions.find((i) => i.id === action.intentionId);
            if (!intention) return state;
            // Build backlog entry from current LinkedTask state (captures titleSnapshots).
            const entry = buildBacklogEntry(intention, plan, action.reason ?? 'manual');
            // Remove the intention + its linked tasks (same logic as REMOVE_INTENTION).
            const intentions = plan.intentions.filter((i) => i.id !== action.intentionId);
            const { linkedTasks, taskSessions } = removeLinkedTasksFromPlan(
                plan,
                (task) => task.intentionId === action.intentionId,
            );
            return {
                ...state,
                plan: { ...plan, intentions, linkedTasks, taskSessions },
                life: { ...state.life, backlog: [...(state.life.backlog ?? []), entry] },
            };
        }

        case 'RESTORE_FROM_BACKLOG': {
            const backlog = state.life.backlog ?? [];
            const entry = backlog.find((e) => e.id === action.backlogId);
            if (!entry) return state;
            // Skip if an intention with the same id is already present (e.g. double-click).
            if (plan.intentions.some((i) => i.id === entry.intention.id)) {
                return { ...state, life: { ...state.life, backlog: backlog.filter((e) => e.id !== action.backlogId) } };
            }
            const nowISO = action.now ?? new Date().toISOString();
            const restoredTasks = rebuildLinkedTasksForBacklogEntry(entry, action.taskCache, nowISO);
            // Avoid re-introducing a LinkedTask for any todoistId already in the plan (e.g. linked to a different intention).
            const existingTaskIds = new Set(plan.linkedTasks.map((lt) => lt.todoistId));
            const freshTasks = restoredTasks.filter((lt) => !existingTaskIds.has(lt.todoistId));
            const restoredIntention: Intention = {
                ...entry.intention,
                linkedTaskIds: freshTasks.map((task) => task.todoistId),
            };
            return {
                ...state,
                plan: {
                    ...plan,
                    intentions: [...plan.intentions, restoredIntention],
                    linkedTasks: [...plan.linkedTasks, ...freshTasks],
                },
                life: { ...state.life, backlog: backlog.filter((e) => e.id !== action.backlogId) },
            };
        }

        case 'DELETE_BACKLOG_ENTRY': {
            const backlog = (state.life.backlog ?? []).filter((e) => e.id !== action.backlogId);
            return { ...state, life: { ...state.life, backlog } };
        }

        default:
            return state;
    }
}

// --------------- context ---------------

export interface DayPlanContextValue {
    plan: DayPlan;
    settings: AppSettings;
    editingStep: number | null;
    history: SavedDayPlan[];
    life: LifeContext;
    dispatch: React.Dispatch<Action>;
}

const DayPlanContext = createContext<DayPlanContextValue | null>(null);
export { DayPlanContext };

export function DayPlanProvider({ children }: { children: ReactNode }) {
    const [state, dispatch] = useReducer(reducer, null, loadInitialState);

    // Persist on every state change (include schema markers for migration detection)
    useEffect(() => {
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ ...state.plan, _wizardSteps: WIZARD_STEPS_COUNT, _schemaVersion: SCHEMA_VERSION }),
        );
    }, [state.plan]);

    useEffect(() => {
        localStorage.setItem(
            SETTINGS_KEY,
            JSON.stringify({ ...state.settings, _schemaVersion: SCHEMA_VERSION }),
        );
    }, [state.settings]);

    useEffect(() => {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history));
    }, [state.history]);

    useEffect(() => {
        localStorage.setItem(
            LIFE_KEY,
            JSON.stringify({ ...state.life, _schemaVersion: SCHEMA_VERSION }),
        );
    }, [state.life]);

    return (
        <DayPlanContext.Provider
            value={{
                plan: state.plan,
                settings: state.settings,
                editingStep: state.editingStep,
                history: state.history,
                life: state.life,
                dispatch,
            }}
        >
            {children}
        </DayPlanContext.Provider>
    );
}

