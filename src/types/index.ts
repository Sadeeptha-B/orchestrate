export interface Intention {
    id: string;
    title: string;
    linkedTaskIds: string[];   // ordered Todoist task IDs linked to this intention
    completed: boolean;
    brokenDown: boolean;
}

/** A Todoist task either linked to an intention or surfaced directly from a stabilizer Habit (v6.1). */
export interface LinkedTask {
    todoistId: string;                                    // Todoist task ID (primary key)
    intentionId?: string;                                 // v6.1: parent intention; absent = habit-derived orphan task
    sourceHabitId?: string;                               // v6.1: set when this LinkedTask came from a stabilizer Habit
    type: 'main' | 'background' | 'unclassified';        // categorization
    assignedSessions: string[];                           // session slot IDs
    completed: boolean;
    estimatedMinutes: number | null;                      // null = not yet estimated
    titleSnapshot?: string;                               // cached title for completed tasks no longer in Todoist
    skippedForToday?: boolean;                            // v6.1: set when user skips a habit-task without completing it
}

export interface SessionSlot {
    id: string;
    name: string;
    startTime: string; // "HH:mm"
    endTime: string;   // "HH:mm"
}

export interface CheckIn {
    id: string;
    timestamp: string; // ISO string
    feeling: 'great' | 'okay' | 'struggling' | 'stuck';
    currentWorkType: WorkType;
    playlistSuggested: string; // playlist id
    notes: string;
    avoidanceNote?: string;    // v6: captured when feeling === 'stuck'
}

export type WorkType =
    | 'coding'
    | 'lecture'
    | 'reading'
    | 'restless'
    | 'low-energy';

export interface Playlist {
    id: string;
    name: string;
    workLabel: string;
    description: string;
    emoji: string;
    spotifyUrl: string;
    workTypes: WorkType[];
}

/** v6.1: pre-computed habit-task to be appended via `INJECT_HABIT_TASKS`. */
export interface HabitTaskInjection {
    habitId: string;
    todoistId: string;
    name: string;                 // titleSnapshot — protects display if Todoist task is later deleted
    estimatedMinutes: number;
    sessionId?: string;           // pre-assigned via Todoist due.datetime → SessionSlot mapping
}

/** v6: a logged "pull" from the Light Pool. Never becomes an intention or LinkedTask. */
export interface HabitLogEntry {
    id: string;
    habitId: string;
    startedAt: string;            // ISO
    completedAt?: string;         // ISO; absent while in-progress
    durationMinutes?: number;     // derived or user-entered on complete
    sessionId?: string;           // active session when started, if any
}

export interface DayPlan {
    date: string; // ISO date string (YYYY-MM-DD)
    intentions: Intention[];
    linkedTasks: LinkedTask[];                             // all tasks across all intentions
    taskSessions: Record<string, string[]>;               // sessionId -> todoistId[]
    wizardStep: number; // 1–5
    setupComplete: boolean;
    checkIns: CheckIn[];
    habitLog: HabitLogEntry[];                            // v6: Light Pool log entries for today
}

export type NotificationPreference = 'in-app' | 'browser' | 'both';

export type CalendarViewMode = 'week' | 'month' | 'agenda';

export interface SavedDayPlan {
    plan: DayPlan;
    savedAt: string; // ISO timestamp
    label: string;   // e.g. "Thursday, Apr 10"
}

export interface GoogleCalendarEntry {
    id: string;
    name?: string;  // user-friendly label, e.g. "Work", "Todoist"
    color?: string; // hex color for the embed, e.g. "#009688"
}

/** v6: per-kind defaults for the per-task duration cap. Stabilizer habit-tasks override via Habit.targetDurationMinutes (v6.1). */
export interface TaskCapDefaults {
    stabilizer: number;       // applied to stabilizer-habit-derived tasks
    lightCoherent: number;    // applied to light-coherent-habit-derived tasks
    manualBackground: number; // applied to manually-categorized 'background' tasks
}

export interface AppSettings {
    notificationPreference: NotificationPreference;
    sessionSlots: SessionSlot[];
    todoistToken?: string;
    todoistTokenIV?: string;
    todoistTokenKey?: string;
    googleCalendarIds?: GoogleCalendarEntry[];
    calendarViewMode?: CalendarViewMode;
    taskCapDefaults?: TaskCapDefaults;  // v6: defaults are injected by loadSettings when absent
    sessionBufferMinutes?: number;      // v6: subtracted from session length when computing capacity (default 60)
    habitsTodoistProjectId?: string;    // v6.1: Todoist project all stabilizer habit-tasks live under; lazily created on first habit save
}

// ─── v5: Life scaffolding primitives ──────────────────────────────────────────

export interface SeasonCapacity {
    weeklyGrowthHours: number | null;    // soft cap on non-anchor growth blocks per week
    maxConcurrentHabits: number | null;  // soft cap on simultaneously-active habits
    notes: string;
}

export interface Season {
    id: string;
    name: string;                        // e.g. "Stabilization", "Degree Push 2026"
    startDate: string;                   // YYYY-MM-DD
    endDate: string | null;              // null = open-ended
    primaryTheme: string;                // one-line "what this season is about"
    supportingGoals: string[];
    nonGoals: string[];                  // explicit "not this season"
    successCriteria: string;
    capacityBudget: SeasonCapacity | null;
    active: boolean;                     // exactly one season can be active at a time
    archivedAt?: string;                 // ISO timestamp once retired
}

export type HabitRecurrenceKind = 'daily' | 'weekdays' | 'weekly' | 'custom';

export interface HabitRecurrence {
    kind: HabitRecurrenceKind;
    daysOfWeek?: number[];               // 0=Sun..6=Sat, used for 'weekly' and 'custom'
    timesPerWeek?: number;               // soft target for 'weekly' when daysOfWeek is not set
}

export type HabitCompletionRule = 'binary' | 'count' | 'duration';

/**
 * Discriminator splitting durable recurring entities into:
 *  - 'stabilizer'      → anchor-style rituals (sleep, meditation, gym).
 *                        v6.1: synced as a recurring Todoist task; surfaces directly as a session-assigned background LinkedTask (no intention).
 *  - 'light-coherent'  → small resumable micro-gap fillers; never become tasks; surfaced via the Light Pool and logged-only.
 */
export type HabitKind = 'stabilizer' | 'light-coherent';

/** v6.1: how to handle stabilizer habits whose target time-of-day window has already passed at planning time. */
export type HabitWindowBehavior = 'strict' | 'lenient';

export interface Habit {
    id: string;
    name: string;                        // e.g. "Morning meditation"
    kind: HabitKind;                     // v6: 'stabilizer' for anchor-style rituals, 'light-coherent' for micro-gap fillers
    recurrence: HabitRecurrence;
    minimumViable: string;               // e.g. "5 min sit, no app required"
    triggerCue: string;                  // e.g. "After waking, before phone"
    completionRule: HabitCompletionRule;
    failureTolerance: number;            // # of misses per week before nudge
    isAnchor: boolean;                   // sleep, meditation, gym, shutdown, review
    seasonIds: string[];                 // which seasons this habit belongs to ([] = always-on)
    active: boolean;                     // user-toggle to pause without deleting
    todoistTaskId?: string;              // v6.1: persistent recurring Todoist task ID synced from this habit (stabilizer only)
    targetTime?: string;                 // v6.1: "HH:mm" target time-of-day; drives session auto-assignment + window-behavior gate
    targetDurationMinutes?: number;      // v6.1: minutes; pushed to Todoist `duration` and used as the LinkedTask estimate
    windowBehavior?: HabitWindowBehavior;// v6.1: 'strict' hides the habit-task if past targetTime + duration; 'lenient' surfaces while still due in Todoist (default 'lenient')
    /** @deprecated v6.1: replaced by `todoistTaskId`. Retained for migration only. */
    autoLinkTodoistId?: string;
    /** @deprecated v6.1: replaced by `targetDurationMinutes`. Retained for migration only. */
    maxBlockMinutes?: number;
    createdAt: string;                   // ISO timestamp
}

/**
 * v6: True Rest cues — non-task recovery prompts surfaced contextually
 * (Dashboard side rail, check-in modal for low-energy states, between-session banner).
 * Static catalog only — no completion semantics, never a Habit.
 */
export interface RestCue {
    id: string;
    label: string;
    durationHint: string;                                  // e.g. "5 min", "90 sec"
    category: 'physical' | 'breath' | 'sensory';
}

export interface LifeContext {
    seasons: Season[];
    habits: Habit[];
    activeSeasonId: string | null;       // denormalized for fast lookup; mirrors seasons[].active
    restCues?: RestCue[];                // user-customized list; undefined = use built-in defaults
}
