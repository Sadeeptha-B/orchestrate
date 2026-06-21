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
    SessionSlot,
    SessionTemplate,
    SavedDayPlan,
    LifeContext,
    Season,
    Habit,
    TaskCapDefaults,
    RestCue,
    BacklogEntry,
    TodaysHabitInstance,
    EngagementSegment,
    RescheduleEventEntry,
    ContextNote,
    EngagementRecord,
} from '../types';
import { defaultSessionSlots } from '../data/sessions';
import { todayISO, minutesOfDay, pickSessionIdForTime } from '../lib/time';
import { DEFAULT_SESSION_BUFFER_MINUTES, DEFAULT_TASK_CAPS } from '../lib/capacity';
import { restCues as defaultRestCues } from '../data/restCues';
import {
    buildBacklogEntry,
    harvestStalePlan,
    rebuildLinkedTasksForBacklogEntry,
} from '../lib/backlog';
import { SCHEMA_VERSION, isSupportedSchema, migrateToCurrent } from '../lib/schema';
import { openSegment } from '../lib/engagement';
import { habitKindOf } from '../lib/habits';
import {
    buildRecordFromClosedSegment,
    appendEngagementRecord,
    pruneEngagementHistory,
} from '../lib/engagementHistory';

// --------------- helpers ---------------

const STORAGE_KEY = 'orchestrate-day-plan';
const SETTINGS_KEY = 'orchestrate-settings';
const HISTORY_KEY = 'orchestrate-history';
const LIFE_KEY = 'orchestrate-life-context';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isCurrentSavedPlan(value: unknown): value is SavedDayPlan {
    if (!isRecord(value)) return false;
    if (typeof value.savedAt !== 'string' || typeof value.label !== 'string') return false;
    const plan = value.plan;
    return isRecord(plan)
        && isSupportedSchema(plan)
        && Array.isArray((plan as { intentions?: unknown }).intentions);
}

function freshPlan(seed?: SessionSlot[]): DayPlan {
    return {
        date: todayISO(),
        intentions: [],
        linkedTasks: [],
        todaysHabits: [],
        sessionSlots: seed ?? [],
        taskSessions: {},
        wizardStep: 1,
        setupComplete: false,
        checkIns: [],
    };
}

/** Deep-copy session slots with fresh ids — keeps days independent (no shared object refs / ids). */
function cloneSessionSlots(slots: SessionSlot[]): SessionSlot[] {
    return slots.map((s) => ({ ...s, id: crypto.randomUUID() }));
}

/**
 * v7.1: pick the session slots a new day should start from. Prefers the most-recent persisted
 * plan's sessions (continuity), then the legacy global `settings.sessionSlots`, then built-in
 * defaults. Returns fresh-id copies so the new day owns its own slot objects.
 */
function seedSessionSlots(prevPlan: DayPlan | null | undefined, settings: AppSettings): SessionSlot[] {
    const source = prevPlan?.sessionSlots?.length
        ? prevPlan.sessionSlots
        : settings.sessionSlots?.length
            ? settings.sessionSlots
            : defaultSessionSlots;
    return cloneSessionSlots(source);
}

/**
 * Strip the persisted schema marker from a plan object. The caller has already guarded the version
 * (`isSupportedSchema`) and brought it up to the current shape (`migrateToCurrent`).
 */
function stripPlanMarkers(raw: Record<string, unknown>): DayPlan {
    const { _schemaVersion: _s, ...plan } = raw;
    void _s;
    return plan as unknown as DayPlan;
}

function withSettingsDefaults(s: AppSettings): AppSettings {
    return {
        ...s,
        taskCapDefaults: fillTaskCaps(s.taskCapDefaults),
        sessionBufferMinutes: s.sessionBufferMinutes ?? DEFAULT_SESSION_BUFFER_MINUTES,
        focusStrict: s.focusStrict ?? true,
    };
}

/** Fill absent optional per-kind caps from defaults. */
function fillTaskCaps(caps: AppSettings['taskCapDefaults']): TaskCapDefaults {
    if (!caps) return { ...DEFAULT_TASK_CAPS };
    return {
        habit: caps.habit ?? DEFAULT_TASK_CAPS.habit,
        microGap: caps.microGap ?? DEFAULT_TASK_CAPS.microGap,
        manualBackground: caps.manualBackground ?? DEFAULT_TASK_CAPS.manualBackground,
    };
}

function defaultSettings(): AppSettings {
    return withSettingsDefaults({ notificationPreference: 'both', sessionSlots: defaultSessionSlots });
}

function loadSettings(): AppSettings {
    try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (!raw) return defaultSettings();
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        // Schema guard: reject below the floor; migrate supported-but-older forward.
        if (!isSupportedSchema(parsed)) return defaultSettings();
        const { _schemaVersion: _s, ...settings } = migrateToCurrent(parsed, 'settings');
        void _s;
        return withSettingsDefaults(settings as unknown as AppSettings);
    } catch {
        return defaultSettings();
    }
}

/**
 * v7.4 Phase 2: bring a saved plan's embedded `plan` up to the current shape (saved plans share the
 * plan migration) and re-stamp it. Shared by `loadHistory` + the import actions so both routes apply
 * the same forward migration as the live loaders.
 */
function migrateSavedPlan(entry: SavedDayPlan): SavedDayPlan {
    return {
        ...entry,
        plan: {
            ...migrateToCurrent(entry.plan as unknown as Record<string, unknown>, 'plan'),
            _schemaVersion: SCHEMA_VERSION,
        } as unknown as DayPlan,
    };
}

function loadHistory(): SavedDayPlan[] {
    try {
        const raw = localStorage.getItem(HISTORY_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw) as SavedDayPlan[];
        // Schema guard: keep saved plans whose stamp is in range, then migrate each plan forward.
        return parsed.filter(isCurrentSavedPlan).map(migrateSavedPlan);
    } catch {
        return [];
    }
}

function emptyLifeContext(): LifeContext {
    return { seasons: [], habits: [], activeSeasonId: null, backlog: [], sessionTemplates: [], engagementHistory: [] };
}

function loadLifeContext(): LifeContext {
    try {
        const raw = localStorage.getItem(LIFE_KEY);
        if (!raw) return emptyLifeContext();
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        // Schema guard: reject below the floor; migrate supported-but-older forward.
        if (!isSupportedSchema(parsed)) return emptyLifeContext();
        const life = migrateToCurrent(parsed, 'life') as unknown as Partial<LifeContext>;
        return {
            seasons: life.seasons ?? [],
            habits: life.habits ?? [],
            activeSeasonId: life.activeSeasonId ?? null,
            restCues: life.restCues,
            backlog: life.backlog ?? [],
            sessionTemplates: life.sessionTemplates ?? [],
            // v7.4 Phase 2: bound the durable engagement archive to its rolling window on load.
            engagementHistory: pruneEngagementHistory(life.engagementHistory),
        };
    } catch {
        return emptyLifeContext();
    }
}

/**
 * Read the persisted plan *without* the date-freshness gate (so `loadInitialState` can harvest a
 * stale plan before discarding it). Schema guard: anything stamped below the supported floor is
 * treated as absent; supported-but-older is migrated forward. Returns the plan with markers stripped.
 */
function loadPlan(): DayPlan | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if (!isSupportedSchema(parsed)) return null;
        return stripPlanMarkers(migrateToCurrent(parsed, 'plan'));
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
    const raw = loadPlan();

    if (!raw || raw.date === todayISO()) {
        // Same-day reload: use the persisted plan as-is.
        // Cold start: seed a fresh day's sessions from settings/defaults.
        return {
            plan: raw ?? freshPlan(seedSessionSlots(undefined, settings)),
            settings,
            editingStep: null,
            history: baseHistory,
            life: baseLife,
        };
    }

    // Stale plan: harvest unfinished intentions into the backlog, then return a fresh plan
    // seeded from the previous day's sessions (continuity).
    const harvested = harvestStalePlan(raw);
    const life: LifeContext = harvested.length === 0
        ? baseLife
        : { ...baseLife, backlog: [...(baseLife.backlog ?? []), ...harvested] };

    return {
        plan: freshPlan(seedSessionSlots(raw, settings)),
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
 * v6.4: open a new engagement segment (Start). Pushes `{ startedAt: nowISO }`. If there's
 * already an open segment (no `endedAt`), returns the list unchanged — Start is a no-op while
 * already engaged.
 */
function openEngagementSegment(segments: EngagementSegment[] | undefined, nowISO: string): EngagementSegment[] {
    const list = segments ?? [];
    if (list.length > 0 && !list[list.length - 1].endedAt) return list;
    return [...list, { startedAt: nowISO }];
}

/**
 * v6.4: close the open engagement segment (Stop / Complete / Skip). Stamps `endedAt = nowISO`
 * on the last segment if it's open; otherwise returns the list unchanged.
 */
function closeEngagementSegment(segments: EngagementSegment[] | undefined, nowISO: string): EngagementSegment[] | undefined {
    if (!segments || segments.length === 0) return segments;
    const last = segments[segments.length - 1];
    if (last.endedAt) return segments;
    return [...segments.slice(0, -1), { ...last, endedAt: nowISO }];
}

/**
 * v7.4 Phase 2: write-through archive. When an engagement segment closes, copy the now-finalized
 * segment into the durable `life.engagementHistory` (keyed by a durable source id so re-entry
 * latency spans days). `open` is the segment that was open *before* the close; pass `undefined` (or
 * the result is a no-op) when nothing was engaged. Returns `life` unchanged if there's nothing to
 * archive.
 */
function archiveClosedSegment(
    life: LifeContext,
    meta: { sourceKind: EngagementRecord['sourceKind']; sourceId: string; title: string },
    open: EngagementSegment | undefined,
    nowISO: string,
): LifeContext {
    if (!open) return life;
    const record = buildRecordFromClosedSegment({
        ...meta,
        segment: { startedAt: open.startedAt, endedAt: nowISO },
        history: life.engagementHistory,
    });
    if (!record) return life;
    return {
        ...life,
        engagementHistory: appendEngagementRecord(life.engagementHistory, record, {
            now: new Date(nowISO),
        }),
    };
}

/**
 * v7.4 Phase 2: append an `exit` re-entry breadcrumb to a task's context trail. Skips empty text and
 * de-dupes a no-op commit — when the Focus draft is seeded from the last exit note and left
 * unchanged, the latest exit note is returned as-is rather than duplicated.
 */
function appendExitNote(trail: ContextNote[] | undefined, text: string | undefined, at: string): ContextNote[] | undefined {
    const t = text?.trim();
    if (!t) return trail;
    const list = trail ?? [];
    const last = list[list.length - 1];
    if (last && last.kind === 'exit' && last.text === t) return list;
    return [...list, { at, text: t, kind: 'exit' }];
}

/**
 * v7.4 Phase 2: close a habit instance's open segment (Stop / Complete / Skip), archive it to the
 * durable engagement history (under the durable `habitId` + resolved kind), and apply the terminal
 * status transition. Shared by the three habit-close actions.
 */
function closeHabitInstance(
    state: State,
    instanceId: string,
    nowISO: string,
    apply: (i: TodaysHabitInstance) => TodaysHabitInstance,
): State {
    const target = state.plan.todaysHabits.find((i) => i.id === instanceId);
    if (!target) return state;
    const openSeg = openSegment(target.segments);
    const todaysHabits = state.plan.todaysHabits.map((i) =>
        i.id === instanceId
            ? apply({ ...i, segments: closeEngagementSegment(i.segments, nowISO) })
            : i,
    );
    const life = archiveClosedSegment(
        state.life,
        { sourceKind: habitKindOf(state.life, target), sourceId: target.habitId, title: target.titleSnapshot },
        openSeg,
        nowISO,
    );
    return { ...state, plan: { ...state.plan, todaysHabits }, life };
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
    | { type: 'UPSERT_TASK_ENTRY_NOTE'; todoistId: string; text: string; at: string }
    | { type: 'APPEND_TASK_CONTEXT_NOTE'; todoistId: string; text: string; at: string }
    | { type: 'DELETE_TASK_CONTEXT_NOTE'; todoistId: string; at: string; kind: 'entry' | 'exit' }
    | { type: 'QUICK_START'; intentionTitle: string; todoistIds: string[]; now: string }
    | { type: 'ASSIGN_TASK'; todoistId: string; sessionId: string }
    | { type: 'UNASSIGN_TASK'; todoistId: string; sessionId: string }
    | { type: 'TOGGLE_TASK_COMPLETE'; todoistId: string; titleSnapshot?: string; exitNote?: string }
    | { type: 'SYNC_TASK_SNAPSHOTS'; snapshots: Record<string, string> }
    | { type: 'REORDER_SESSION_TASKS'; sessionId: string; taskIds: string[] }
    | { type: 'REORDER_INTENTION_TASKS'; intentionId: string; todoistIds: string[] }
    // ---- v7.1: per-day sessions ----
    | { type: 'ADD_DAY_SESSION'; session: Omit<SessionSlot, 'id'> }
    | { type: 'UPDATE_DAY_SESSION'; session: SessionSlot }
    | { type: 'REMOVE_DAY_SESSION'; sessionId: string }
    | { type: 'APPLY_SESSION_TEMPLATE'; templateId: string }
    | { type: 'SET_WIZARD_STEP'; step: number }
    | { type: 'COMPLETE_SETUP' }
    | { type: 'ADD_CHECKIN'; checkIn: CheckIn }
    | { type: 'MARK_FOCUS_SEEDED'; focusId: string }
    | { type: 'RESET_DAY' }
    | { type: 'RESET_ALL' }
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
    | { type: 'PRUNE_TODAYS_HABITS' }
    | { type: 'PRUNE_STALE_HABIT_INSTANCES'; instanceIds: string[] }
    | { type: 'IMPORT_BACKUP'; settings?: AppSettings; life?: LifeContext; history?: SavedDayPlan[] }
    // ---- True Rest cue customization ----
    | { type: 'ADD_REST_CUE'; cue: Omit<RestCue, 'id'> }
    | { type: 'UPDATE_REST_CUE'; cue: RestCue }
    | { type: 'DELETE_REST_CUE'; cueId: string }
    | { type: 'REPLACE_REST_CUES'; cues: RestCue[] | undefined }
    // ---- v7.1: Session templates (Life) ----
    | { type: 'ADD_SESSION_TEMPLATE'; template: Omit<SessionTemplate, 'id' | 'createdAt'> }
    | { type: 'UPDATE_SESSION_TEMPLATE'; template: SessionTemplate }
    | { type: 'DELETE_SESSION_TEMPLATE'; templateId: string }
    // ---- v6.2: Intentions backlog ----
    | { type: 'MOVE_INTENTION_TO_BACKLOG'; intentionId: string; reason?: BacklogEntry['reason'] }
    | { type: 'RESTORE_FROM_BACKLOG'; backlogId: string; taskCache: Record<string, string>; now?: string }
    | { type: 'DELETE_BACKLOG_ENTRY'; backlogId: string }
    // ---- v6.3: TodaysHabitInstance lifecycle ----
    | { type: 'REFRESH_TODAYS_HABITS'; instances: TodaysHabitInstance[] }
    | { type: 'START_HABIT_INSTANCE'; instanceId: string; now: string }
    | { type: 'STOP_HABIT_INSTANCE'; instanceId: string; now: string }
    | { type: 'COMPLETE_HABIT_INSTANCE'; instanceId: string; now: string }
    | { type: 'SKIP_HABIT_INSTANCE'; instanceId: string; now: string }
    | { type: 'RESCHEDULE_HABIT_INSTANCE'; instanceId: string; newTargetTime?: string; now: string }
    // ---- v6.3: Task engagement ----
    | { type: 'START_TASK_ENGAGEMENT'; todoistId: string; now: string }
    | { type: 'STOP_TASK_ENGAGEMENT'; todoistId: string; now: string; exitNote?: string }
    // ---- v6.4: Engagement log deletion ----
    | { type: 'DELETE_HABIT_ENGAGEMENT_SEGMENT'; instanceId: string; segmentStartedAt: string }
    | { type: 'DELETE_TASK_ENGAGEMENT_SEGMENT'; todoistId: string; segmentStartedAt: string }
    | { type: 'DELETE_HABIT_RESCHEDULE_ENTRY'; instanceId: string; rescheduleAt: string };

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

        case 'UPSERT_TASK_ENTRY_NOTE': {
            // v7.4 Phase 2: the concrete entry point captured at refine time — a single, last-write-wins
            // `entry` note on the context trail. Empty → the entry note is removed (exit notes kept).
            const text = action.text.trim();
            const linkedTasks = plan.linkedTasks.map((lt) => {
                if (lt.todoistId !== action.todoistId) return lt;
                const others = (lt.contextTrail ?? []).filter((n) => n.kind !== 'entry');
                const trail = text
                    ? [{ at: action.at, text, kind: 'entry' as const }, ...others]
                    : others;
                return { ...lt, contextTrail: trail.length > 0 ? trail : undefined };
            });
            return { ...state, plan: { ...plan, linkedTasks } };
        }

        case 'APPEND_TASK_CONTEXT_NOTE': {
            // v7.4 Phase 2: append an `exit` breadcrumb mid-session ("Add to trail" in Focus), so a
            // multi-step session accumulates a visible trail without having to Stop. Dedups an
            // identical consecutive note; empty text is a no-op.
            const linkedTasks = plan.linkedTasks.map((lt) => {
                if (lt.todoistId !== action.todoistId) return lt;
                const contextTrail = appendExitNote(lt.contextTrail, action.text, action.at);
                return contextTrail ? { ...lt, contextTrail } : lt;
            });
            return { ...state, plan: { ...plan, linkedTasks } };
        }

        case 'DELETE_TASK_CONTEXT_NOTE': {
            // v7.6: remove a single breadcrumb from the trail (matched by timestamp + kind), driven by
            // the per-task focus timeline. The trail collapses to `undefined` when emptied.
            const linkedTasks = plan.linkedTasks.map((lt) => {
                if (lt.todoistId !== action.todoistId) return lt;
                const trail = (lt.contextTrail ?? []).filter((n) => !(n.at === action.at && n.kind === action.kind));
                return { ...lt, contextTrail: trail.length > 0 ? trail : undefined };
            });
            return { ...state, plan: { ...plan, linkedTasks } };
        }

        case 'QUICK_START': {
            // v7.4: low-friction entry — seed a minimal plan from a few tasks and mark setup complete.
            // Atomic: one catch-all intention + a main LinkedTask per id, all assigned to the session
            // covering `now`. The caller engages the first task + navigates to /focus separately.
            const ids = action.todoistIds.filter((id, i) => action.todoistIds.indexOf(id) === i);
            if (ids.length === 0) return state;

            const slots = plan.sessionSlots.length > 0
                ? plan.sessionSlots
                : state.settings.sessionSlots.length > 0
                    ? state.settings.sessionSlots
                    : defaultSessionSlots;
            const targetSessionId = pickSessionIdForTime(slots, minutesOfDay(new Date(action.now)));
            const selectedIds = new Set(ids);

            const intention: Intention = {
                id: crypto.randomUUID(),
                title: action.intentionTitle,
                linkedTaskIds: ids,
                completed: false,
                brokenDown: false,
            };

            const intentions = plan.intentions.map((existing) => (
                existing.linkedTaskIds.some((id) => selectedIds.has(id))
                    ? {
                        ...existing,
                        linkedTaskIds: existing.linkedTaskIds.filter((id) => !selectedIds.has(id)),
                    }
                    : existing
            ));

            // Re-home any pre-existing linked tasks to the Quick Start intention so task ownership
            // stays one-to-one. Normalize them to `main` and move them to the target session.
            const linkedTasks = plan.linkedTasks.map((lt) => (
                selectedIds.has(lt.todoistId)
                    ? {
                        ...setIntentionOwner(lt, intention.id),
                        type: 'main' as const,
                        assignedSessions: targetSessionId ? [targetSessionId] : [],
                    }
                    : lt
            ));

            // Append only ids not already present in the plan.
            const existingIds = new Set(plan.linkedTasks.map((lt) => lt.todoistId));
            const newTasks: LinkedTask[] = ids
                .filter((id) => !existingIds.has(id))
                .map((id) => ({
                    todoistId: id,
                    intentionId: intention.id,
                    type: 'main',
                    assignedSessions: targetSessionId ? [targetSessionId] : [],
                    completed: false,
                    estimatedMinutes: null,
                    status: 'pending',
                }));

            const taskSessions = removeTaskIdsFromSessions(plan.taskSessions, ids);
            if (targetSessionId) {
                const current = taskSessions[targetSessionId] ?? [];
                const merged = [...current];
                for (const id of ids) if (!merged.includes(id)) merged.push(id);
                taskSessions[targetSessionId] = merged;
            }

            return {
                ...state,
                plan: {
                    ...plan,
                    sessionSlots: slots,
                    intentions: [...intentions, intention],
                    linkedTasks: [...linkedTasks, ...newTasks],
                    taskSessions,
                    setupComplete: true,
                },
            };
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
            const target = plan.linkedTasks.find((lt) => lt.todoistId === action.todoistId);
            const completing = target ? !target.completed : false;
            // v7.4 Phase 2: completing closes any open segment — capture it to archive.
            const openSeg = completing ? openSegment(target?.segments) : undefined;
            const linkedTasks = plan.linkedTasks.map((lt) => {
                if (lt.todoistId !== action.todoistId) return lt;
                const completed = !lt.completed;
                const segments = completed ? closeEngagementSegment(lt.segments, nowISO) : lt.segments;
                const contextTrail = completed
                    ? appendExitNote(lt.contextTrail, action.exitNote, nowISO)
                    : lt.contextTrail;
                return {
                    ...lt,
                    completed,
                    status: completed ? ('completed' as const) : ('pending' as const),
                    ...(segments ? { segments } : {}),
                    ...(contextTrail ? { contextTrail } : {}),
                    ...(action.titleSnapshot ? { titleSnapshot: action.titleSnapshot } : {}),
                };
            });
            const life = archiveClosedSegment(
                state.life,
                {
                    sourceKind: 'task',
                    sourceId: action.todoistId,
                    title: target?.titleSnapshot ?? action.titleSnapshot ?? action.todoistId,
                },
                openSeg,
                nowISO,
            );
            return { ...state, plan: { ...plan, linkedTasks }, life };
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

        case 'REORDER_INTENTION_TASKS': {
            // Reorder a single intention's linkedTaskIds. Only ids already linked to this
            // intention are honoured (any stragglers are appended in their prior order),
            // so a stale drag payload can't drop or duplicate a task.
            const intentions = plan.intentions.map((i) => {
                if (i.id !== action.intentionId) return i;
                const current = new Set(i.linkedTaskIds);
                const reordered = action.todoistIds.filter((id) => current.has(id));
                const missing = i.linkedTaskIds.filter((id) => !reordered.includes(id));
                return { ...i, linkedTaskIds: [...reordered, ...missing] };
            });
            return { ...state, plan: { ...plan, intentions } };
        }

        // ---- v7.1: per-day sessions ----

        case 'ADD_DAY_SESSION': {
            const session: SessionSlot = { ...action.session, id: crypto.randomUUID() };
            return { ...state, plan: { ...plan, sessionSlots: [...plan.sessionSlots, session] } };
        }

        case 'UPDATE_DAY_SESSION': {
            // Id-stable rename/resize/move — assignments keyed by session id survive untouched.
            const sessionSlots = plan.sessionSlots.map((s) =>
                s.id === action.session.id ? action.session : s,
            );
            return { ...state, plan: { ...plan, sessionSlots } };
        }

        case 'REMOVE_DAY_SESSION': {
            const { sessionId } = action;
            const sessionSlots = plan.sessionSlots.filter((s) => s.id !== sessionId);
            const { [sessionId]: _dropped, ...taskSessions } = plan.taskSessions;
            void _dropped;
            const linkedTasks = plan.linkedTasks.map((lt) =>
                lt.assignedSessions.includes(sessionId)
                    ? { ...lt, assignedSessions: lt.assignedSessions.filter((s) => s !== sessionId) }
                    : lt,
            );
            return { ...state, plan: { ...plan, sessionSlots, taskSessions, linkedTasks } };
        }

        case 'APPLY_SESSION_TEMPLATE': {
            const tpl = state.life.sessionTemplates?.find((t) => t.id === action.templateId);
            if (!tpl) return state;
            // Fresh-id copies → every prior session id vanishes, so clear all assignments.
            const sessionSlots = cloneSessionSlots(tpl.slots);
            const linkedTasks = plan.linkedTasks.some((lt) => lt.assignedSessions.length)
                ? plan.linkedTasks.map((lt) =>
                    lt.assignedSessions.length ? { ...lt, assignedSessions: [] } : lt)
                : plan.linkedTasks;
            return { ...state, plan: { ...plan, sessionSlots, taskSessions: {}, linkedTasks } };
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

        case 'MARK_FOCUS_SEEDED': {
            // v6.7: record that a recurring focus was added as an intention today, so the banner
            // chip drops out and doesn't re-offer it on the same day.
            const seeded = plan.seededFocusIds ?? [];
            if (seeded.includes(action.focusId)) return state;
            return { ...state, plan: { ...plan, seededFocusIds: [...seeded, action.focusId] } };
        }

        case 'RESET_DAY':
            // Re-seed today's sessions from the legacy global slots / defaults (fresh ids).
            return { ...state, plan: freshPlan(seedSessionSlots(undefined, settings)), editingStep: null };

        case 'RESET_ALL':
            // Wipe all four persisted slices back to factory defaults. The four useEffects
            // below auto-persist the reset state to localStorage. Aux keys outside this
            // provider (Todoist cache, theme, music prefs) are handled by the caller. The
            // server-side integration tokens (Todoist/Google in KV) and the shared secret are
            // not touched here — disconnect those from Settings → Integrations.
            return {
                plan: freshPlan(cloneSessionSlots(defaultSessionSlots)),
                settings: defaultSettings(),
                editingStep: null,
                history: [],
                life: emptyLifeContext(),
            };

        case 'UPDATE_SETTINGS':
            return { ...state, settings: { ...settings, ...action.settings } };

        case 'SET_EDITING_STEP':
            return { ...state, editingStep: action.step };

        case 'SAVE_DAY': {
            const entry: SavedDayPlan = {
                plan: { ...structuredClone(plan), _schemaVersion: SCHEMA_VERSION } as DayPlan,
                savedAt: new Date().toISOString(),
                label: action.label,
            };
            const filtered = state.history.filter((h) => h.plan.date !== plan.date);
            return { ...state, history: [entry, ...filtered] };
        }

        case 'RESTORE_DAY': {
            const saved = state.history.find((h) => h.savedAt === action.savedAt);
            if (!saved) return state;
            // History is already schema-guarded on load/import, so the saved plan is current —
            // just strip its markers and re-date it to today (no migration).
            const restored = stripPlanMarkers(saved.plan as unknown as Record<string, unknown>);
            return { ...state, plan: { ...restored, date: todayISO() }, editingStep: null };
        }

        case 'DELETE_SAVED_DAY':
            return {
                ...state,
                history: state.history.filter((h) => h.savedAt !== action.savedAt),
            };

        case 'IMPORT_SESSIONS': {
            const existing = new Set(state.history.map((h) => h.savedAt));
            const newEntries = action.sessions
                .filter((s) => !existing.has(s.savedAt))
                .map(migrateSavedPlan);
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
            // `isAnchor` is a pure importance tag — it no longer blocks deletion. The UI shows
            // a confirm dialog for active anchors, but deletion is always permitted once confirmed.
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

        case 'PRUNE_TODAYS_HABITS': {
            // v6.7: drop any instance whose habit no longer exists (defensive — a deleted habit
            // should never linger in Today's Habits / the timeline / the Micro-gaps panel).
            const ids = new Set(state.life.habits.map((h) => h.id));
            const todaysHabits = plan.todaysHabits.filter((i) => ids.has(i.habitId));
            if (todaysHabits.length === plan.todaysHabits.length) return state;
            return { ...state, plan: { ...plan, todaysHabits } };
        }

        case 'PRUNE_STALE_HABIT_INSTANCES': {
            // Drop `planned` habit instances whose backing Todoist task was completed / moved off
            // today out-of-band (see `findStaleTodaysHabitInstances`). The caller passes the exact
            // instance ids to remove; value-stable so a no-op pass doesn't churn renders.
            if (action.instanceIds.length === 0) return state;
            const drop = new Set(action.instanceIds);
            const todaysHabits = plan.todaysHabits.filter((i) => !drop.has(i.id));
            if (todaysHabits.length === plan.todaysHabits.length) return state;
            return { ...state, plan: { ...plan, todaysHabits } };
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
            //
            // The merge is **value-stable**: a matched `planned` instance only allocates a new
            // object when a surfaced field actually changed. Combined with the bail-out below, a
            // re-fire with unchanged data is a true no-op — the compute helpers re-emit every
            // matching habit each tick (so form edits propagate), and the surfaces that depend on
            // `plan.todaysHabits` settle instead of looping.
            const incomingByHabitId = new Map(action.instances.map((i) => [i.habitId, i]));
            const seenHabitIds = new Set<string>();
            const merged = plan.todaysHabits.map((existing) => {
                const incoming = incomingByHabitId.get(existing.habitId);
                if (!incoming) return existing;
                seenHabitIds.add(existing.habitId);
                if (existing.status !== 'planned') return existing;
                // User-chosen time wins; otherwise the habit-form's latest time propagates.
                const nextTargetTime = existing.rescheduledAt ? existing.targetTime : incoming.targetTime;
                if (
                    existing.durationMinutes === incoming.durationMinutes
                    && existing.titleSnapshot === incoming.titleSnapshot
                    && existing.targetTime === nextTargetTime
                ) {
                    return existing;
                }
                return {
                    ...existing,
                    durationMinutes: incoming.durationMinutes,
                    titleSnapshot: incoming.titleSnapshot,
                    targetTime: nextTargetTime,
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
            // v6.4: Start opens a new engagement segment (counting from 0:00). A no-op if
            // one is already open. Each Start/Stop is an individual segment in the log.
            const todaysHabits = plan.todaysHabits.map((i) => {
                if (i.id !== action.instanceId) return i;
                return {
                    ...i,
                    status: 'engaged' as const,
                    segments: openEngagementSegment(i.segments, action.now),
                };
            });
            return { ...state, plan: { ...plan, todaysHabits } };
        }

        case 'STOP_HABIT_INSTANCE': {
            // v6.4: closes the open segment AND returns the instance to `planned` so the
            // toggle button flips back to ▶ Start. A subsequent Start opens a fresh segment.
            // v7.4 Phase 2: the closed segment is archived to life.engagementHistory.
            return closeHabitInstance(state, action.instanceId, action.now, (i) => ({
                ...i,
                status: 'planned' as const,
            }));
        }

        case 'COMPLETE_HABIT_INSTANCE': {
            return closeHabitInstance(state, action.instanceId, action.now, (i) => ({
                ...i,
                status: 'completed' as const,
                completedAt: action.now,
            }));
        }

        case 'SKIP_HABIT_INSTANCE': {
            // v6.4: close any open segment before the instance goes terminal, so an
            // in-flight engagement (Start then ✕ Skip without ■ Stop) is recorded.
            return closeHabitInstance(state, action.instanceId, action.now, (i) => ({
                ...i,
                status: 'skipped' as const,
            }));
        }

        case 'RESCHEDULE_HABIT_INSTANCE': {
            // v6.4 (revised): always in-place. The instance keeps its id, status, and
            // engagement record (if engaged, the timer keeps running at the new target
            // time). Only `targetTime` changes; `rescheduledAt` is stamped so REFRESH
            // preserves the user's chosen time. Every reschedule appends a
            // `RescheduleEventEntry` to `rescheduleHistory` — the durable in-day record
            // surfaced in the engagement log, whether or not the instance was engaged.
            //
            // This supersedes the v6.3 clone-on-engagement mechanic: there is no longer
            // an `'unfinished'` predecessor; the engagement stays on the moved instance
            // and the reschedule itself is logged as its own event. The recurring Todoist
            // task is untouched.
            const target = plan.todaysHabits.find((i) => i.id === action.instanceId);
            if (!target) return state;
            if (target.status !== 'planned' && target.status !== 'engaged') return state;

            const event: RescheduleEventEntry = {
                at: action.now,
                ...(target.targetTime ? { fromTime: target.targetTime } : {}),
                ...(action.newTargetTime ? { toTime: action.newTargetTime } : {}),
            };

            const todaysHabits = plan.todaysHabits.map((i) => {
                if (i.id !== action.instanceId) return i;
                return {
                    ...i,
                    ...(action.newTargetTime
                        ? { targetTime: action.newTargetTime }
                        : { targetTime: undefined }),
                    rescheduledAt: action.now,
                    rescheduleHistory: [...(i.rescheduleHistory ?? []), event],
                };
            });

            return { ...state, plan: { ...plan, todaysHabits } };
        }

        case 'START_TASK_ENGAGEMENT': {
            // v6.4: Start opens a new engagement segment (from 0:00); no-op if one is open.
            const linkedTasks = plan.linkedTasks.map((lt) => {
                if (lt.todoistId !== action.todoistId) return lt;
                return { ...lt, status: 'engaged' as const, segments: openEngagementSegment(lt.segments, action.now) };
            });
            return { ...state, plan: { ...plan, linkedTasks } };
        }

        case 'STOP_TASK_ENGAGEMENT': {
            // v6.4: closes the open segment AND returns status to `pending` so the toggle
            // button flips back to ▶ Start. A subsequent Start opens a fresh segment.
            // v7.4 Phase 2: archive the closed segment + append the Focus "next step" exit note.
            const target = plan.linkedTasks.find((lt) => lt.todoistId === action.todoistId);
            const openSeg = openSegment(target?.segments);
            const linkedTasks = plan.linkedTasks.map((lt) => {
                if (lt.todoistId !== action.todoistId) return lt;
                const contextTrail = appendExitNote(lt.contextTrail, action.exitNote, action.now);
                return {
                    ...lt,
                    status: 'pending' as const,
                    segments: closeEngagementSegment(lt.segments, action.now),
                    ...(contextTrail ? { contextTrail } : {}),
                };
            });
            const life = archiveClosedSegment(
                state.life,
                { sourceKind: 'task', sourceId: action.todoistId, title: target?.titleSnapshot ?? action.todoistId },
                openSeg,
                action.now,
            );
            return { ...state, plan: { ...plan, linkedTasks }, life };
        }

        case 'DELETE_HABIT_ENGAGEMENT_SEGMENT': {
            // Edits today's live record only. v7.4 Phase 2: the durable archive copy in
            // life.engagementHistory is intentionally NOT retroactively removed here.
            const todaysHabits = plan.todaysHabits.map((i) => {
                if (i.id !== action.instanceId) return i;
                const segments = (i.segments ?? []).filter(
                    (s) => s.startedAt !== action.segmentStartedAt,
                );
                const status = i.status === 'engaged' && segments.every((s) => s.endedAt)
                    ? 'planned' as const
                    : i.status;
                return { ...i, status, segments };
            });
            return { ...state, plan: { ...plan, todaysHabits } };
        }

        case 'DELETE_TASK_ENGAGEMENT_SEGMENT': {
            const linkedTasks = plan.linkedTasks.map((lt) => {
                if (lt.todoistId !== action.todoistId) return lt;
                const segments = (lt.segments ?? []).filter(
                    (s) => s.startedAt !== action.segmentStartedAt,
                );
                const status = lt.status === 'engaged' && segments.every((s) => s.endedAt)
                    ? 'pending' as const
                    : lt.status;
                return { ...lt, status, segments };
            });
            return { ...state, plan: { ...plan, linkedTasks } };
        }

        case 'DELETE_HABIT_RESCHEDULE_ENTRY': {
            const todaysHabits = plan.todaysHabits.map((i) => {
                if (i.id !== action.instanceId) return i;
                const rescheduleHistory = (i.rescheduleHistory ?? []).filter(
                    (e) => e.at !== action.rescheduleAt,
                );
                return { ...i, rescheduleHistory };
            });
            return { ...state, plan: { ...plan, todaysHabits } };
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

        case 'ADD_SESSION_TEMPLATE': {
            const template: SessionTemplate = {
                ...action.template,
                id: crypto.randomUUID(),
                createdAt: new Date().toISOString(),
            };
            const sessionTemplates = [...(state.life.sessionTemplates ?? []), template];
            return { ...state, life: { ...state.life, sessionTemplates } };
        }

        case 'UPDATE_SESSION_TEMPLATE': {
            const sessionTemplates = (state.life.sessionTemplates ?? []).map((t) =>
                t.id === action.template.id ? action.template : t,
            );
            return { ...state, life: { ...state.life, sessionTemplates } };
        }

        case 'DELETE_SESSION_TEMPLATE': {
            const sessionTemplates = (state.life.sessionTemplates ?? []).filter(
                (t) => t.id !== action.templateId,
            );
            return { ...state, life: { ...state.life, sessionTemplates } };
        }

        case 'IMPORT_BACKUP': {
            const next: State = { ...state };
            if (action.settings) {
                next.settings = withSettingsDefaults({ ...state.settings, ...action.settings });
            }
            if (action.life) {
                // Merge by id — never overwrite existing entries; append new ones. The import is
                // schema-guarded in DataManagement (floor → current); life's only 7.4 addition is
                // engagementHistory (defaulted below), and saved plans are migrated via migrateSavedPlan.
                const incomingSeasons = Array.isArray(action.life.seasons) ? action.life.seasons : [];
                const incomingHabits = Array.isArray(action.life.habits) ? action.life.habits : [];
                const incomingBacklog = Array.isArray(action.life.backlog) ? action.life.backlog : [];
                const incomingTemplates = Array.isArray(action.life.sessionTemplates)
                    ? action.life.sessionTemplates
                    : [];
                const incomingRestCues = Array.isArray(action.life.restCues)
                    ? action.life.restCues
                    : undefined;
                const incomingEngagement = Array.isArray(action.life.engagementHistory)
                    ? action.life.engagementHistory
                    : [];
                const existingSeasonIds = new Set(state.life.seasons.map((s) => s.id));
                const existingHabitIds = new Set(state.life.habits.map((h) => h.id));
                const existingBacklogIds = new Set((state.life.backlog ?? []).map((e) => e.id));
                const existingTemplateIds = new Set((state.life.sessionTemplates ?? []).map((t) => t.id));
                const existingEngagementIds = new Set((state.life.engagementHistory ?? []).map((r) => r.id));
                const mergedSeasons = [
                    ...state.life.seasons,
                    ...incomingSeasons.filter((s) => !existingSeasonIds.has(s.id)),
                ];
                const importedActiveSeasonId =
                    typeof action.life.activeSeasonId === 'string' ? action.life.activeSeasonId : null;
                next.life = {
                    seasons: mergedSeasons,
                    habits: [
                        ...state.life.habits,
                        ...incomingHabits.filter((h) => !existingHabitIds.has(h.id)),
                    ],
                    activeSeasonId: state.life.activeSeasonId
                        ?? (importedActiveSeasonId && mergedSeasons.some((s) => s.id === importedActiveSeasonId)
                            ? importedActiveSeasonId
                            : null),
                    restCues: state.life.restCues ?? incomingRestCues,
                    backlog: [
                        ...(state.life.backlog ?? []),
                        ...incomingBacklog.filter((e) => !existingBacklogIds.has(e.id)),
                    ],
                    sessionTemplates: [
                        ...(state.life.sessionTemplates ?? []),
                        ...incomingTemplates.filter((t) => !existingTemplateIds.has(t.id)),
                    ],
                    // v7.4 Phase 2: preserve the local archive; merge imported records by id, then prune.
                    engagementHistory: pruneEngagementHistory([
                        ...(state.life.engagementHistory ?? []),
                        ...incomingEngagement.filter((r) => !existingEngagementIds.has(r.id)),
                    ]),
                };
            }
            if (action.history) {
                const existing = new Set(state.history.map((h) => h.savedAt));
                const currentHistory = action.history.filter(isCurrentSavedPlan).map(migrateSavedPlan);
                next.history = [
                    ...state.history,
                    ...currentHistory.filter((h) => !existing.has(h.savedAt)),
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

    // Persist on every state change (stamp the schema version so loads can guard against old data)
    useEffect(() => {
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ ...state.plan, _schemaVersion: SCHEMA_VERSION }),
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

