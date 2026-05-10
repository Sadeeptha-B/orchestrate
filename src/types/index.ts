export interface Intention {
    id: string;
    title: string;
    linkedTaskIds: string[];   // ordered Todoist task IDs linked to this intention
    completed: boolean;
    brokenDown: boolean;
    /** @deprecated v5: superseded by sourceHabitId. Retained for one iteration for backwards-compat. */
    isHabit: boolean;
    sourceHabitId?: string;    // set when intention was auto-injected from a Habit
    skippedForToday?: boolean; // set when user skips a habit-derived intention without completing
}

/** A Todoist task linked to an intention within Orchestrate's data model. */
export interface LinkedTask {
    todoistId: string;                                    // Todoist task ID (primary key)
    intentionId: string;                                  // parent intention
    type: 'main' | 'background' | 'unclassified';        // categorization
    assignedSessions: string[];                           // session slot IDs
    completed: boolean;
    /** @deprecated v5: superseded by Habit entity in LifeContext. Retained for one iteration. */
    isHabit: boolean;
    estimatedMinutes: number | null;                      // null = not yet estimated
    titleSnapshot?: string;                               // cached title for completed tasks no longer in Todoist
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

export interface DayPlan {
    date: string; // ISO date string (YYYY-MM-DD)
    intentions: Intention[];
    linkedTasks: LinkedTask[];                             // all tasks across all intentions
    taskSessions: Record<string, string[]>;               // sessionId -> todoistId[]
    wizardStep: number; // 1–5
    setupComplete: boolean;
    checkIns: CheckIn[];
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

export interface AppSettings {
    notificationPreference: NotificationPreference;
    sessionSlots: SessionSlot[];
    todoistToken?: string;
    todoistTokenIV?: string;
    todoistTokenKey?: string;
    googleCalendarIds?: GoogleCalendarEntry[];
    calendarViewMode?: CalendarViewMode;
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

export interface Habit {
    id: string;
    name: string;                        // e.g. "Morning meditation"
    recurrence: HabitRecurrence;
    minimumViable: string;               // e.g. "5 min sit, no app required"
    triggerCue: string;                  // e.g. "After waking, before phone"
    completionRule: HabitCompletionRule;
    failureTolerance: number;            // # of misses per week before nudge
    isAnchor: boolean;                   // sleep, meditation, gym, shutdown, review
    seasonIds: string[];                 // which seasons this habit belongs to ([] = always-on)
    active: boolean;                     // user-toggle to pause without deleting
    autoLinkTodoistId?: string;          // persistent Todoist task to auto-link in Step 1
    createdAt: string;                   // ISO timestamp
}

export interface LifeContext {
    seasons: Season[];
    habits: Habit[];
    activeSeasonId: string | null;       // denormalized for fast lookup; mirrors seasons[].active
    backfilledFromIsHabit?: boolean;     // one-time migration flag
}
