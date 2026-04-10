import {
    createContext,
    useContext,
    useReducer,
    useEffect,
    type ReactNode,
} from 'react';
import { format } from 'date-fns';
import type { DayPlan, Task, CheckIn, AppSettings, SavedDayPlan } from '../types';
import { defaultSessionSlots } from '../data/sessions';

// --------------- helpers ---------------

const STORAGE_KEY = 'orchestrate-day-plan';
const SETTINGS_KEY = 'orchestrate-settings';
const HISTORY_KEY = 'orchestrate-history';

function todayISO(): string {
    return format(new Date(), 'yyyy-MM-dd');
}

function freshPlan(): DayPlan {
    return {
        date: todayISO(),
        tasks: [],
        taskSessions: {},
        wizardStep: 1,
        setupComplete: false,
        checkIns: [],
        syncChecklist: {
            reviewTodolist: false,
            createEvents: false,
            breakDownTasks: false,
        },
    };
}

function loadPlan(): DayPlan {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return freshPlan();
        const parsed = JSON.parse(raw) as DayPlan;
        if (parsed.date !== todayISO()) return freshPlan();
        return parsed;
    } catch {
        return freshPlan();
    }
}

function loadSettings(): AppSettings {
    try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (!raw) return { notificationPreference: 'both', sessionSlots: defaultSessionSlots };
        return JSON.parse(raw) as AppSettings;
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

// --------------- actions ---------------

type Action =
    | { type: 'ADD_TASK'; title: string }
    | { type: 'REMOVE_TASK'; taskId: string }
    | { type: 'UPDATE_TASK'; task: Task }
    | { type: 'CATEGORIZE_TASK'; taskId: string; taskType: Task['type'] }
    | { type: 'REORDER_TASKS'; taskIds: string[] }
    | { type: 'REORDER_SESSION_TASKS'; sessionId: string; taskIds: string[] }
    | { type: 'ASSIGN_TASK'; taskId: string; sessionId: string }
    | { type: 'UNASSIGN_TASK'; taskId: string; sessionId: string }
    | { type: 'TOGGLE_TASK_COMPLETE'; taskId: string }
    | { type: 'SET_WIZARD_STEP'; step: number }
    | { type: 'COMPLETE_SETUP' }
    | { type: 'ADD_CHECKIN'; checkIn: CheckIn }
    | { type: 'TOGGLE_SYNC_ITEM'; key: string }
    | { type: 'RESET_DAY' }
    | { type: 'UPDATE_SETTINGS'; settings: Partial<AppSettings> }
    | { type: 'SET_EDITING_STEP'; step: number | null }
    | { type: 'SAVE_DAY'; label: string }
    | { type: 'RESTORE_DAY'; savedAt: string }
    | { type: 'DELETE_SAVED_DAY'; savedAt: string }
    | { type: 'IMPORT_SESSIONS'; sessions: SavedDayPlan[] };

interface State {
    plan: DayPlan;
    settings: AppSettings;
    editingStep: number | null; // non-null when revisiting a wizard step from dashboard
    history: SavedDayPlan[];
}

function reducer(state: State, action: Action): State {
    const { plan, settings } = state;

    switch (action.type) {
        case 'ADD_TASK': {
            const task: Task = {
                id: crypto.randomUUID(),
                title: action.title,
                type: 'unclassified',
                completed: false,
            };
            return { ...state, plan: { ...plan, tasks: [...plan.tasks, task] } };
        }

        case 'REMOVE_TASK': {
            const tasks = plan.tasks.filter((t) => t.id !== action.taskId);
            const taskSessions = { ...plan.taskSessions };
            for (const sid of Object.keys(taskSessions)) {
                taskSessions[sid] = taskSessions[sid].filter((id) => id !== action.taskId);
            }
            return { ...state, plan: { ...plan, tasks, taskSessions } };
        }

        case 'UPDATE_TASK': {
            const tasks = plan.tasks.map((t) => (t.id === action.task.id ? action.task : t));
            return { ...state, plan: { ...plan, tasks } };
        }

        case 'CATEGORIZE_TASK': {
            const tasks = plan.tasks.map((t) =>
                t.id === action.taskId ? { ...t, type: action.taskType } : t,
            );
            return { ...state, plan: { ...plan, tasks } };
        }

        case 'REORDER_TASKS': {
            const taskMap = new Map(plan.tasks.map((t) => [t.id, t]));
            const reordered = action.taskIds
                .map((id) => taskMap.get(id))
                .filter((t): t is Task => t !== undefined);
            return { ...state, plan: { ...plan, tasks: reordered } };
        }

        case 'REORDER_SESSION_TASKS': {
            const taskSessions = {
                ...plan.taskSessions,
                [action.sessionId]: action.taskIds,
            };
            return { ...state, plan: { ...plan, taskSessions } };
        }

        case 'ASSIGN_TASK': {
            const current = plan.taskSessions[action.sessionId] ?? [];
            if (current.includes(action.taskId)) return state;
            // Remove from any other session first
            const taskSessions = { ...plan.taskSessions };
            for (const sid of Object.keys(taskSessions)) {
                taskSessions[sid] = taskSessions[sid].filter((id) => id !== action.taskId);
            }
            taskSessions[action.sessionId] = [...(taskSessions[action.sessionId] ?? []), action.taskId];
            const tasks = plan.tasks.map((t) =>
                t.id === action.taskId ? { ...t, assignedSession: action.sessionId } : t,
            );
            return { ...state, plan: { ...plan, tasks, taskSessions } };
        }

        case 'UNASSIGN_TASK': {
            const taskSessions = { ...plan.taskSessions };
            taskSessions[action.sessionId] = (taskSessions[action.sessionId] ?? []).filter(
                (id) => id !== action.taskId,
            );
            const tasks = plan.tasks.map((t) =>
                t.id === action.taskId ? { ...t, assignedSession: undefined } : t,
            );
            return { ...state, plan: { ...plan, tasks, taskSessions } };
        }

        case 'TOGGLE_TASK_COMPLETE': {
            const tasks = plan.tasks.map((t) =>
                t.id === action.taskId ? { ...t, completed: !t.completed } : t,
            );
            return { ...state, plan: { ...plan, tasks } };
        }

        case 'SET_WIZARD_STEP':
            return { ...state, plan: { ...plan, wizardStep: action.step } };

        case 'COMPLETE_SETUP':
            return { ...state, plan: { ...plan, setupComplete: true } };

        case 'ADD_CHECKIN':
            return {
                ...state,
                plan: { ...plan, checkIns: [...plan.checkIns, action.checkIn] },
            };

        case 'TOGGLE_SYNC_ITEM':
            return {
                ...state,
                plan: {
                    ...plan,
                    syncChecklist: {
                        ...plan.syncChecklist,
                        [action.key]: !plan.syncChecklist[action.key],
                    },
                },
            };

        case 'RESET_DAY':
            return { ...state, plan: freshPlan(), editingStep: null };

        case 'UPDATE_SETTINGS':
            return { ...state, settings: { ...settings, ...action.settings } };

        case 'SET_EDITING_STEP':
            return { ...state, editingStep: action.step };

        case 'SAVE_DAY': {
            const entry: SavedDayPlan = {
                plan: structuredClone(plan),
                savedAt: new Date().toISOString(),
                label: action.label,
            };
            // Replace if same date already saved, otherwise prepend
            const filtered = state.history.filter((h) => h.plan.date !== plan.date);
            return { ...state, history: [entry, ...filtered] };
        }

        case 'RESTORE_DAY': {
            const saved = state.history.find((h) => h.savedAt === action.savedAt);
            if (!saved) return state;
            return { ...state, plan: structuredClone(saved.plan), editingStep: null };
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
    dispatch: React.Dispatch<Action>;
}

const DayPlanContext = createContext<DayPlanContextValue | null>(null);

export function DayPlanProvider({ children }: { children: ReactNode }) {
    const [state, dispatch] = useReducer(reducer, null, () => ({
        plan: loadPlan(),
        settings: loadSettings(),
        editingStep: null,
        history: loadHistory(),
    }));

    // Persist on every state change
    useEffect(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state.plan));
    }, [state.plan]);

    useEffect(() => {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
    }, [state.settings]);

    useEffect(() => {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history));
    }, [state.history]);

    return (
        <DayPlanContext.Provider
            value={{
                plan: state.plan,
                settings: state.settings,
                editingStep: state.editingStep,
                history: state.history,
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
