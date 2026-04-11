import {
    createContext,
    useContext,
    useReducer,
    useEffect,
    type ReactNode,
} from 'react';
import { format } from 'date-fns';
import type { DayPlan, Intention, CheckIn, AppSettings, SavedDayPlan } from '../types';
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
        intentions: [],
        intentionSessions: {},
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

/** Migrate a v1 plan (tasks/taskSessions) to the v2 shape (intentions/intentionSessions). */
function migratePlan(raw: Record<string, unknown>): DayPlan {
    // Wizard was reduced from 6 steps to 5 (old Step 1 & 2 merged).
    // Old step 2+ maps to step N-1; step 1 stays 1.
    // Only apply when plan was saved under the old 6-step layout.
    const needsStepMigration = (raw._wizardSteps as number) !== 5;
    const migrateStep = (s: number) =>
        needsStepMigration ? Math.min(Math.max(s > 1 ? s - 1 : 1, 1), 5) : Math.min(s, 5);

    // Already v2 shape
    if (Array.isArray(raw.intentions)) {
        const plan = raw as unknown as DayPlan;
        return { ...plan, wizardStep: migrateStep(plan.wizardStep) };
    }

    const v1Tasks = (raw.tasks ?? []) as Array<Record<string, unknown>>;
    const intentions: Intention[] = v1Tasks.map((t) => ({
        id: t.id as string,
        title: t.title as string,
        type: (t.type as Intention['type']) ?? 'unclassified',
        assignedSessions: t.assignedSession ? [t.assignedSession as string] : [],
        completed: (t.completed as boolean) ?? false,
        brokenDown: false,
        isHabit: false,
    }));

    return {
        date: raw.date as string,
        intentions,
        intentionSessions: (raw.taskSessions ?? {}) as Record<string, string[]>,
        wizardStep: migrateStep((raw.wizardStep as number) ?? 1),
        setupComplete: (raw.setupComplete as boolean) ?? false,
        checkIns: (raw.checkIns ?? []) as CheckIn[],
        syncChecklist: (raw.syncChecklist ?? {}) as Record<string, boolean>,
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
        const parsed = JSON.parse(raw) as AppSettings & { googleCalendarId?: string };
        // Migrate legacy single-string googleCalendarId → googleCalendarIds array
        if (!parsed.googleCalendarIds && parsed.googleCalendarId) {
            parsed.googleCalendarIds = [parsed.googleCalendarId];
            delete parsed.googleCalendarId;
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

// --------------- actions ---------------

type Action =
    | { type: 'ADD_INTENTION'; title: string }
    | { type: 'REMOVE_INTENTION'; intentionId: string }
    | { type: 'UPDATE_INTENTION'; intention: Intention }
    | { type: 'CATEGORIZE_INTENTION'; intentionId: string; intentionType: Intention['type'] }
    | { type: 'REORDER_INTENTIONS'; intentionIds: string[] }
    | { type: 'REORDER_SESSION_INTENTIONS'; sessionId: string; intentionIds: string[] }
    | { type: 'ASSIGN_INTENTION'; intentionId: string; sessionId: string }
    | { type: 'UNASSIGN_INTENTION'; intentionId: string; sessionId: string }
    | { type: 'TOGGLE_INTENTION_COMPLETE'; intentionId: string }
    | { type: 'MARK_BROKEN_DOWN'; intentionId: string; brokenDown: boolean }
    | { type: 'TOGGLE_HABIT'; intentionId: string }
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
        case 'ADD_INTENTION': {
            const intention: Intention = {
                id: crypto.randomUUID(),
                title: action.title,
                type: 'unclassified',
                assignedSessions: [],
                completed: false,
                brokenDown: false,
                isHabit: false,
            };
            return { ...state, plan: { ...plan, intentions: [...plan.intentions, intention] } };
        }

        case 'REMOVE_INTENTION': {
            const intentions = plan.intentions.filter((i) => i.id !== action.intentionId);
            const intentionSessions = { ...plan.intentionSessions };
            for (const sid of Object.keys(intentionSessions)) {
                intentionSessions[sid] = intentionSessions[sid].filter((id) => id !== action.intentionId);
            }
            return { ...state, plan: { ...plan, intentions, intentionSessions } };
        }

        case 'UPDATE_INTENTION': {
            const intentions = plan.intentions.map((i) =>
                i.id === action.intention.id ? action.intention : i,
            );
            return { ...state, plan: { ...plan, intentions } };
        }

        case 'CATEGORIZE_INTENTION': {
            const intentions = plan.intentions.map((i) =>
                i.id === action.intentionId ? { ...i, type: action.intentionType } : i,
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

        case 'REORDER_SESSION_INTENTIONS': {
            const intentionSessions = {
                ...plan.intentionSessions,
                [action.sessionId]: action.intentionIds,
            };
            return { ...state, plan: { ...plan, intentionSessions } };
        }

        case 'ASSIGN_INTENTION': {
            const intention = plan.intentions.find((i) => i.id === action.intentionId);
            if (!intention) return state;

            const intentionSessions = { ...plan.intentionSessions };

            if (intention.type === 'background') {
                // Background: allow multi-session — just add to the target session
                const current = intentionSessions[action.sessionId] ?? [];
                if (current.includes(action.intentionId)) return state;
                intentionSessions[action.sessionId] = [...current, action.intentionId];
            } else {
                // Main: exclusive — remove from any other session first
                for (const sid of Object.keys(intentionSessions)) {
                    intentionSessions[sid] = intentionSessions[sid].filter((id) => id !== action.intentionId);
                }
                intentionSessions[action.sessionId] = [
                    ...(intentionSessions[action.sessionId] ?? []),
                    action.intentionId,
                ];
            }

            // Update the intention's assignedSessions array
            const newAssigned = Object.entries(intentionSessions)
                .filter(([, ids]) => ids.includes(action.intentionId))
                .map(([sid]) => sid);

            const intentions = plan.intentions.map((i) =>
                i.id === action.intentionId ? { ...i, assignedSessions: newAssigned } : i,
            );

            return { ...state, plan: { ...plan, intentions, intentionSessions } };
        }

        case 'UNASSIGN_INTENTION': {
            const intentionSessions = { ...plan.intentionSessions };
            intentionSessions[action.sessionId] = (intentionSessions[action.sessionId] ?? []).filter(
                (id) => id !== action.intentionId,
            );
            const intentions = plan.intentions.map((i) =>
                i.id === action.intentionId
                    ? { ...i, assignedSessions: i.assignedSessions.filter((s) => s !== action.sessionId) }
                    : i,
            );
            return { ...state, plan: { ...plan, intentions, intentionSessions } };
        }

        case 'TOGGLE_INTENTION_COMPLETE': {
            const intentions = plan.intentions.map((i) =>
                i.id === action.intentionId ? { ...i, completed: !i.completed } : i,
            );
            return { ...state, plan: { ...plan, intentions } };
        }

        case 'MARK_BROKEN_DOWN': {
            const intentions = plan.intentions.map((i) =>
                i.id === action.intentionId ? { ...i, brokenDown: action.brokenDown } : i,
            );
            return { ...state, plan: { ...plan, intentions } };
        }

        case 'TOGGLE_HABIT': {
            const intentions = plan.intentions.map((i) =>
                i.id === action.intentionId ? { ...i, isHabit: !i.isHabit } : i,
            );
            return { ...state, plan: { ...plan, intentions } };
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
            const filtered = state.history.filter((h) => h.plan.date !== plan.date);
            return { ...state, history: [entry, ...filtered] };
        }

        case 'RESTORE_DAY': {
            const saved = state.history.find((h) => h.savedAt === action.savedAt);
            if (!saved) return state;
            const restored = migratePlan(saved.plan as unknown as Record<string, unknown>);
            return { ...state, plan: restored, editingStep: null };
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

    // Persist on every state change (include _wizardSteps marker for migration detection)
    useEffect(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state.plan, _wizardSteps: 5 }));
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
