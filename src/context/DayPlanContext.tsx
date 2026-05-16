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
    HabitTaskInjection,
    RestCue,
    BacklogEntry,
} from '../types';
import { defaultSessionSlots } from '../data/sessions';
import { todayISO } from '../lib/time';
import { DEFAULT_SESSION_BUFFER_MINUTES, DEFAULT_TASK_CAPS } from '../lib/capacity';
import { restCues as defaultRestCues } from '../data/restCues';
import {
    buildAutoSaveEntry,
    buildBacklogEntry,
    harvestStalePlan,
    rebuildLinkedTasksForBacklogEntry,
} from '../lib/backlog';

// --------------- helpers ---------------

const STORAGE_KEY = 'orchestrate-day-plan';
const SETTINGS_KEY = 'orchestrate-settings';
const HISTORY_KEY = 'orchestrate-history';
const LIFE_KEY = 'orchestrate-life-context';
const SCHEMA_VERSION = 6.2;
/** Wizard step count stamped on persisted plans for the migration chain to detect old layouts. */
const WIZARD_STEPS_COUNT = 4;

function freshPlan(): DayPlan {
    return {
        date: todayISO(),
        intentions: [],
        linkedTasks: [],
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
        // Already v4 shape — ensure estimatedMinutes exists on all LinkedTask entries (v4.1 migration).
        // v6.1: re-anchor any tasks under a (now removed) habit-derived intention as orphans
        // with `sourceHabitId` set + type 'background'.
        const migratedLinkedTasks = (raw.linkedTasks as Array<Record<string, unknown>>).map((lt) => {
            const intentionId = lt.intentionId as string | undefined;
            const habitId = intentionId ? habitIdByIntentionId.get(intentionId) : undefined;
            if (habitId) {
                return {
                    todoistId: lt.todoistId as string,
                    sourceHabitId: habitId,
                    type: 'background' as const,
                    assignedSessions: (lt.assignedSessions as string[]) ?? [],
                    completed: (lt.completed as boolean) ?? false,
                    estimatedMinutes: (lt.estimatedMinutes as number | null) ?? null,
                    ...(lt.titleSnapshot ? { titleSnapshot: lt.titleSnapshot as string } : {}),
                } satisfies LinkedTask;
            }
            return {
                ...(lt as unknown as LinkedTask),
                estimatedMinutes: (lt.estimatedMinutes as number | null) ?? null,
            };
        });
        return {
            date: raw.date as string,
            intentions,
            linkedTasks: migratedLinkedTasks,
            taskSessions: raw.taskSessions as Record<string, string[]>,
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
 * v6.2: coordinated initial-state loader. Handles the day-rollover migration:
 * on cold start with a stale persisted plan, auto-saves the stale plan into history
 * (authoritative — replaces any prior same-date entry) and harvests its unfinished
 * intentions into `life.backlog`. Returns the four-slice initial state for `useReducer`.
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

    // Stale plan: auto-save it (authoritative — replaces any existing same-date entry),
    // harvest unfinished intentions into the backlog, then return a fresh plan.
    const autoSave = buildAutoSaveEntry(raw, WIZARD_STEPS_COUNT, SCHEMA_VERSION);
    const history = [autoSave, ...baseHistory.filter((h) => h.plan.date !== raw.date)];
    const harvested = harvestStalePlan(raw);
    const life: LifeContext = harvested.length === 0
        ? baseLife
        : { ...baseLife, backlog: [...(baseLife.backlog ?? []), ...harvested] };

    return {
        plan: freshPlan(),
        settings,
        editingStep: null,
        history,
        life,
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
    | { type: 'INJECT_HABIT_TASKS'; entries: HabitTaskInjection[] }
    | { type: 'SKIP_HABIT_TASK'; todoistId: string }
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
    | { type: 'RESTORE_FROM_BACKLOG'; backlogId: string; taskCache: Record<string, string> }
    | { type: 'DELETE_BACKLOG_ENTRY'; backlogId: string }
    | { type: 'BACKLOG_HARVEST'; entries: BacklogEntry[] };

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
            // Remove all linked tasks belonging to this intention
            const removedTaskIds = new Set(
                plan.linkedTasks
                    .filter((lt) => lt.intentionId === action.intentionId)
                    .map((lt) => lt.todoistId),
            );
            const linkedTasks = plan.linkedTasks.filter((lt) => lt.intentionId !== action.intentionId);
            const taskSessions = { ...plan.taskSessions };
            for (const sid of Object.keys(taskSessions)) {
                taskSessions[sid] = taskSessions[sid].filter((id) => !removedTaskIds.has(id));
            }
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
                lt.todoistId === todoistId ? { ...lt, intentionId } : lt,
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
            const linkedTasks = plan.linkedTasks.filter((lt) => lt.todoistId !== todoistId);
            const intentions = plan.intentions.map((i) => ({
                ...i,
                linkedTaskIds: i.linkedTaskIds.filter((id) => id !== todoistId),
            }));
            const taskSessions = { ...plan.taskSessions };
            for (const sid of Object.keys(taskSessions)) {
                taskSessions[sid] = taskSessions[sid].filter((id) => id !== todoistId);
            }
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
                for (const sid of Object.keys(taskSessions)) {
                    taskSessions[sid] = taskSessions[sid].filter((id) => id !== action.todoistId);
                }
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
            const linkedTasks = plan.linkedTasks.map((lt) =>
                lt.todoistId === action.todoistId
                    ? {
                        ...lt,
                        completed: !lt.completed,
                        ...(action.titleSnapshot ? { titleSnapshot: action.titleSnapshot } : {}),
                    }
                    : lt,
            );
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
            // v6.1: also drop any orphan habit-tasks belonging to this habit from today's plan.
            const orphanTaskIds = new Set(
                plan.linkedTasks
                    .filter((lt) => lt.sourceHabitId === action.habitId)
                    .map((lt) => lt.todoistId),
            );
            const linkedTasks = plan.linkedTasks.filter((lt) => lt.sourceHabitId !== action.habitId);
            const taskSessions = { ...plan.taskSessions };
            if (orphanTaskIds.size > 0) {
                for (const sid of Object.keys(taskSessions)) {
                    taskSessions[sid] = taskSessions[sid].filter((id) => !orphanTaskIds.has(id));
                }
            }
            return {
                ...state,
                life: { ...state.life, habits },
                plan: { ...plan, linkedTasks, taskSessions },
            };
        }

        case 'TOGGLE_HABIT_ACTIVE': {
            const habits = state.life.habits.map((h) =>
                h.id === action.habitId ? { ...h, active: !h.active } : h,
            );
            return { ...state, life: { ...state.life, habits } };
        }

        case 'INJECT_HABIT_TASKS': {
            // v6.1: append habit-tasks pre-computed by `computeHabitTasksToInject`. Idempotent —
            // any entry whose `habitId` is already present in `plan.linkedTasks` is skipped.
            const existingHabitIds = new Set(
                plan.linkedTasks
                    .map((lt) => lt.sourceHabitId)
                    .filter((id): id is string => Boolean(id)),
            );
            const fresh = action.entries.filter((e) => !existingHabitIds.has(e.habitId));
            if (fresh.length === 0) return state;
            const newTasks: LinkedTask[] = fresh.map((e) => ({
                todoistId: e.todoistId,
                sourceHabitId: e.habitId,
                type: 'background',
                assignedSessions: e.sessionId ? [e.sessionId] : [],
                completed: false,
                estimatedMinutes: e.estimatedMinutes,
                titleSnapshot: e.name,
            }));
            const taskSessions = { ...plan.taskSessions };
            for (const e of fresh) {
                if (e.sessionId) {
                    const current = taskSessions[e.sessionId] ?? [];
                    if (!current.includes(e.todoistId)) {
                        taskSessions[e.sessionId] = [...current, e.todoistId];
                    }
                }
            }
            return {
                ...state,
                plan: {
                    ...plan,
                    linkedTasks: [...plan.linkedTasks, ...newTasks],
                    taskSessions,
                },
            };
        }

        case 'SKIP_HABIT_TASK': {
            // v6.1: mark a habit-task as skipped for today. The LinkedTask is kept so
            // `computeHabitTasksToInject` (which dedupes by sourceHabitId presence) won't
            // re-add it later in the same day. `completed` stays false — a skip is a deliberate
            // "not today", not a completion, and shouldn't inflate the done-counter.
            const linkedTasks = plan.linkedTasks.map((lt) =>
                lt.todoistId === action.todoistId && lt.sourceHabitId
                    ? { ...lt, skippedForToday: true, assignedSessions: [] }
                    : lt,
            );
            const taskSessions = { ...plan.taskSessions };
            for (const sid of Object.keys(taskSessions)) {
                taskSessions[sid] = taskSessions[sid].filter((id) => id !== action.todoistId);
            }
            return { ...state, plan: { ...plan, linkedTasks, taskSessions } };
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
            const removedTaskIds = new Set(
                plan.linkedTasks
                    .filter((lt) => lt.intentionId === action.intentionId)
                    .map((lt) => lt.todoistId),
            );
            const linkedTasks = plan.linkedTasks.filter((lt) => lt.intentionId !== action.intentionId);
            const taskSessions = { ...plan.taskSessions };
            for (const sid of Object.keys(taskSessions)) {
                taskSessions[sid] = taskSessions[sid].filter((id) => !removedTaskIds.has(id));
            }
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
            const restoredTasks = rebuildLinkedTasksForBacklogEntry(entry, action.taskCache);
            // Avoid re-introducing a LinkedTask for any todoistId already in the plan (e.g. linked to a different intention).
            const existingTaskIds = new Set(plan.linkedTasks.map((lt) => lt.todoistId));
            const freshTasks = restoredTasks.filter((lt) => !existingTaskIds.has(lt.todoistId));
            return {
                ...state,
                plan: {
                    ...plan,
                    intentions: [...plan.intentions, entry.intention],
                    linkedTasks: [...plan.linkedTasks, ...freshTasks],
                },
                life: { ...state.life, backlog: backlog.filter((e) => e.id !== action.backlogId) },
            };
        }

        case 'DELETE_BACKLOG_ENTRY': {
            const backlog = (state.life.backlog ?? []).filter((e) => e.id !== action.backlogId);
            return { ...state, life: { ...state.life, backlog } };
        }

        case 'BACKLOG_HARVEST': {
            if (action.entries.length === 0) return state;
            return {
                ...state,
                life: {
                    ...state.life,
                    backlog: [...(state.life.backlog ?? []), ...action.entries],
                },
            };
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

