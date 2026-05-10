import {
    createContext,
    useContext,
    useReducer,
    useEffect,
    type ReactNode,
} from 'react';
import { format } from 'date-fns';
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
} from '../types';
import { defaultSessionSlots } from '../data/sessions';
import { habitMatchesDate } from '../lib/habits';

// --------------- helpers ---------------

const STORAGE_KEY = 'orchestrate-day-plan';
const SETTINGS_KEY = 'orchestrate-settings';
const HISTORY_KEY = 'orchestrate-history';
const LIFE_KEY = 'orchestrate-life-context';
const SCHEMA_VERSION = 5;

function todayISO(): string {
    return format(new Date(), 'yyyy-MM-dd');
}

function freshPlan(): DayPlan {
    return {
        date: todayISO(),
        intentions: [],
        linkedTasks: [],
        taskSessions: {},
        wizardStep: 1,
        setupComplete: false,
        checkIns: [],
    };
}

/** Migrate a plan through the version chain: v1 (tasks) → v2 (intentions) → v4 (linkedTasks). */
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

    // --- v1 → v2: convert tasks to intentions ---
    let intentions: Intention[];
    let intentionSessions: Record<string, string[]>;

    if (Array.isArray(raw.intentions)) {
        // Already v2+ shape — extract intentions
        intentions = (raw.intentions as Array<Record<string, unknown>>).map((i) => ({
            id: i.id as string,
            title: i.title as string,
            linkedTaskIds: (i.linkedTaskIds as string[]) ?? [],
            completed: (i.completed as boolean) ?? false,
            brokenDown: (i.brokenDown as boolean) ?? false,
            isHabit: (i.isHabit as boolean) ?? false,
            ...(i.sourceHabitId ? { sourceHabitId: i.sourceHabitId as string } : {}),
            ...(i.skippedForToday ? { skippedForToday: i.skippedForToday as boolean } : {}),
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
            isHabit: false,
        }));
        intentionSessions = (raw.taskSessions ?? {}) as Record<string, string[]>;
    }

    // --- v2/v3 → v4: if plan has intentionSessions but no taskSessions/linkedTasks ---
    if (Array.isArray(raw.linkedTasks) && raw.taskSessions !== undefined) {
        // Already v4 shape — ensure estimatedMinutes exists on all LinkedTask entries (v4.1 migration)
        const migratedLinkedTasks = (raw.linkedTasks as Array<Record<string, unknown>>).map((lt) => ({
            ...(lt as unknown as LinkedTask),
            estimatedMinutes: (lt.estimatedMinutes as number | null) ?? null,
        }));
        return {
            date: raw.date as string,
            intentions,
            linkedTasks: migratedLinkedTasks,
            taskSessions: raw.taskSessions as Record<string, string[]>,
            wizardStep: migrateStep((raw.wizardStep as number) ?? 1),
            setupComplete: (raw.setupComplete as boolean) ?? false,
            checkIns: (raw.checkIns ?? []) as CheckIn[],
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
    };
}

function loadPlan(): DayPlan {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return freshPlan();
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if (parsed.date !== todayISO()) return freshPlan();
        return migratePlan(parsed);
    } catch {
        return freshPlan();
    }
}

function loadSettings(): AppSettings {
    try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (!raw) return { notificationPreference: 'both', sessionSlots: defaultSessionSlots };
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
        return parsed;
    } catch {
        return { notificationPreference: 'both', sessionSlots: defaultSessionSlots };
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
    return { seasons: [], habits: [], activeSeasonId: null };
}

function loadLifeContext(): LifeContext {
    try {
        const raw = localStorage.getItem(LIFE_KEY);
        if (!raw) return emptyLifeContext();
        const parsed = JSON.parse(raw) as Partial<LifeContext> & { _schemaVersion?: number };
        return {
            seasons: parsed.seasons ?? [],
            habits: parsed.habits ?? [],
            activeSeasonId: parsed.activeSeasonId ?? null,
            backfilledFromIsHabit: parsed.backfilledFromIsHabit,
        };
    } catch {
        return emptyLifeContext();
    }
}

/**
 * One-time backfill: if the user has any legacy intentions/tasks flagged as habits
 * (via the deprecated `isHabit` flag), surface them as inactive Habit candidates so
 * the user can promote them in the Habits Library. Idempotent — guarded by
 * `LifeContext.backfilledFromIsHabit`.
 */
function backfillHabitsFromLegacy(life: LifeContext, plan: DayPlan, history: SavedDayPlan[]): LifeContext {
    if (life.backfilledFromIsHabit) return life;

    const seenNames = new Set(life.habits.map((h) => h.name.toLowerCase()));
    const candidates: Habit[] = [];
    const nowISO = new Date().toISOString();

    const considerIntention = (i: Intention) => {
        if (!i.isHabit) return;
        const key = i.title.trim().toLowerCase();
        if (!key || seenNames.has(key)) return;
        seenNames.add(key);
        candidates.push({
            id: crypto.randomUUID(),
            name: i.title.trim(),
            recurrence: { kind: 'daily' },
            minimumViable: '',
            triggerCue: '',
            completionRule: 'binary',
            failureTolerance: 1,
            isAnchor: false,
            seasonIds: [],
            active: false,
            createdAt: nowISO,
        });
    };

    plan.intentions.forEach(considerIntention);
    history.forEach((h) => h.plan?.intentions?.forEach?.(considerIntention));

    return {
        ...life,
        habits: [...life.habits, ...candidates],
        backfilledFromIsHabit: true,
    };
}


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
    | { type: 'TOGGLE_TASK_HABIT'; todoistId: string }
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
    | { type: 'ADD_HABIT'; habit: Omit<Habit, 'id' | 'createdAt'> }
    | { type: 'UPDATE_HABIT'; habit: Habit }
    | { type: 'DELETE_HABIT'; habitId: string }
    | { type: 'TOGGLE_HABIT_ACTIVE'; habitId: string }
    | { type: 'INJECT_HABIT_INTENTIONS' }
    | { type: 'SKIP_HABIT_INTENTION'; intentionId: string }
    | { type: 'IMPORT_BACKUP'; settings?: AppSettings; life?: LifeContext; history?: SavedDayPlan[] };

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
                isHabit: false,
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
            // Also toggle all linked tasks
            const linkedTasks = plan.linkedTasks.map((lt) =>
                lt.intentionId === action.intentionId ? { ...lt, completed: newCompleted } : lt,
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
            // If already linked to another intention, move it
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
                    isHabit: false,
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

        case 'TOGGLE_TASK_HABIT': {
            const linkedTasks = plan.linkedTasks.map((lt) =>
                lt.todoistId === action.todoistId ? { ...lt, isHabit: !lt.isHabit } : lt,
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
                plan: { ...structuredClone(plan), _wizardSteps: 4, _schemaVersion: SCHEMA_VERSION } as DayPlan,
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
            const seasons = state.life.seasons.map((s) =>
                s.id === action.season.id ? action.season : s,
            );
            return { ...state, life: { ...state.life, seasons } };
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
            const habit: Habit = {
                ...action.habit,
                id: crypto.randomUUID(),
                createdAt: new Date().toISOString(),
            };
            return { ...state, life: { ...state.life, habits: [...state.life.habits, habit] } };
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
            // Also clear sourceHabitId from any intentions that referenced it
            const intentions = plan.intentions.map((i) =>
                i.sourceHabitId === action.habitId ? { ...i, sourceHabitId: undefined } : i,
            );
            return {
                ...state,
                life: { ...state.life, habits },
                plan: { ...plan, intentions },
            };
        }

        case 'TOGGLE_HABIT_ACTIVE': {
            const habits = state.life.habits.map((h) =>
                h.id === action.habitId ? { ...h, active: !h.active } : h,
            );
            return { ...state, life: { ...state.life, habits } };
        }

        case 'INJECT_HABIT_INTENTIONS': {
            // Idempotent: skip habits that already have an intention today.
            const existingHabitIds = new Set(
                plan.intentions
                    .map((i) => i.sourceHabitId)
                    .filter((id): id is string => Boolean(id)),
            );
            const toInject = state.life.habits
                .filter((h) => h.active)
                .filter((h) => !existingHabitIds.has(h.id))
                .filter((h) => habitMatchesDate(h, plan.date));
            if (toInject.length === 0) return state;
            const newIntentions: Intention[] = toInject.map((h) => ({
                id: crypto.randomUUID(),
                title: h.name,
                linkedTaskIds: [],
                completed: false,
                brokenDown: false,
                isHabit: false,
                sourceHabitId: h.id,
            }));
            return {
                ...state,
                plan: { ...plan, intentions: [...newIntentions, ...plan.intentions] },
            };
        }

        case 'SKIP_HABIT_INTENTION': {
            const intentions = plan.intentions.map((i) =>
                i.id === action.intentionId
                    ? { ...i, completed: true, skippedForToday: true, brokenDown: true }
                    : i,
            );
            return { ...state, plan: { ...plan, intentions } };
        }

        case 'IMPORT_BACKUP': {
            const next: State = { ...state };
            if (action.settings) next.settings = { ...state.settings, ...action.settings };
            if (action.life) {
                // Merge by id — never overwrite existing entries; append new ones.
                const existingSeasonIds = new Set(state.life.seasons.map((s) => s.id));
                const existingHabitIds = new Set(state.life.habits.map((h) => h.id));
                next.life = {
                    seasons: [
                        ...state.life.seasons,
                        ...action.life.seasons.filter((s) => !existingSeasonIds.has(s.id)),
                    ],
                    habits: [
                        ...state.life.habits,
                        ...action.life.habits.filter((h) => !existingHabitIds.has(h.id)),
                    ],
                    activeSeasonId: state.life.activeSeasonId ?? action.life.activeSeasonId,
                    backfilledFromIsHabit:
                        state.life.backfilledFromIsHabit || action.life.backfilledFromIsHabit,
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

        default:
            return state;
    }
}

// --------------- context ---------------

interface DayPlanContextValue {
    plan: DayPlan;
    settings: AppSettings;
    editingStep: number | null;
    history: SavedDayPlan[];
    life: LifeContext;
    dispatch: React.Dispatch<Action>;
}

const DayPlanContext = createContext<DayPlanContextValue | null>(null);

export function DayPlanProvider({ children }: { children: ReactNode }) {
    const [state, dispatch] = useReducer(reducer, null, () => {
        const plan = loadPlan();
        const history = loadHistory();
        const rawLife = loadLifeContext();
        const life = backfillHabitsFromLegacy(rawLife, plan, history);
        return {
            plan,
            settings: loadSettings(),
            editingStep: null,
            history,
            life,
        };
    });

    // Persist on every state change (include schema markers for migration detection)
    useEffect(() => {
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ ...state.plan, _wizardSteps: 4, _schemaVersion: SCHEMA_VERSION }),
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

export function useDayPlan(): DayPlanContextValue {
    const ctx = useContext(DayPlanContext);
    if (!ctx) throw new Error('useDayPlan must be used within DayPlanProvider');
    return ctx;
}
