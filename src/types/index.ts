export interface Intention {
    id: string;
    title: string;
    linkedTaskIds: string[];   // ordered Todoist task IDs linked to this intention
    completed: boolean;
    brokenDown: boolean;
}

/** v6.3: lifecycle status for a LinkedTask. Treat absent (legacy rows) as 'pending'. */
export type LinkedTaskStatus = 'pending' | 'engaged' | 'completed';

/**
 * v6.4: one engagement segment — a single Start→Stop period of working on a habit instance
 * or task. Named `EngagementSegment` (not "session") to avoid confusion with the first-class
 * work-`Session`/`SessionSlot`. The segment list is the durable per-instance record: each
 * Start pushes a new open segment; Stop/Complete/Skip closes the open one. Duration is
 * derived (`endedAt − startedAt`, or `now − startedAt` while open) — no stored accumulator.
 */
export interface EngagementSegment {
    startedAt: string;            // ISO — when this segment started
    endedAt?: string;             // ISO — when it closed (absent = open / live)
}

/**
 * v6.4: one entry in a habit instance's reschedule history. Surfaced in the dashboard
 * engagement log as a "Rescheduled … → HH:mm" row. Captured on every reschedule,
 * whether or not the instance was engaged.
 */
export interface RescheduleEventEntry {
    at: string;                   // ISO — when the reschedule happened (clock time)
    fromTime?: string;            // "HH:mm" prior targetTime (absent = was "anytime")
    toTime?: string;              // "HH:mm" new targetTime (absent = moved to "anytime")
}

/** A Todoist task linked to an intention. v6.3: stabilizers no longer live here (see TodaysHabitInstance). */
export interface LinkedTask {
    todoistId: string;                                    // Todoist task ID (primary key)
    intentionId?: string;                                 // parent intention (always set in v6.3)
    type: 'main' | 'background' | 'unclassified';        // categorization
    assignedSessions: string[];                           // session slot IDs
    completed: boolean;                                   // kept; mirrors status === 'completed'
    estimatedMinutes: number | null;                      // null = not yet estimated
    titleSnapshot?: string;                               // cached title for completed tasks no longer in Todoist
    status?: LinkedTaskStatus;                            // v6.3: absent = 'pending'
    segments?: EngagementSegment[];                       // v6.4: explicit Start/Stop engagement segments
    rescheduledFromTodoistId?: string;                    // v6.3: predecessor LinkedTask's todoistId when restored from a backlog entry with engagement
    rescheduledAt?: string;                               // v6.3: ISO timestamp of the restore
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

/**
 * v6.3: lifecycle status of a TodaysHabitInstance.
 *  - planned    : surfaced for today, not yet acted on
 *  - engaged    : user pressed Start
 *  - completed  : done (Todoist recurring task occurrence completed)
 *  - skipped    : user explicitly skipped today (terminal)
 *
 * v6.4: the old `'unfinished'` value (v6.3 clone-on-reschedule predecessor) is gone —
 * reschedules are in-place and engagement segments survive them, so no clone is produced.
 */
export type HabitInstanceStatus =
    | 'planned'
    | 'engaged'
    | 'completed'
    | 'skipped';

/**
 * v6.3: today's manifestation of a stabilizer habit. Lives on `DayPlan.todaysHabits`,
 * independent of session assignment. Positioned on the timeline via `targetTime`. The
 * `id` is distinct from `todoistTaskId` so reschedule successors can coexist in the same day.
 */
export interface TodaysHabitInstance {
    id: string;                            // uuid (primary key)
    habitId: string;                       // → life.habits[i].id
    todoistTaskId: string;                 // recurring Todoist task id
    titleSnapshot: string;
    durationMinutes: number;
    targetTime?: string;                   // "HH:mm" — drives timeline position; absent = "anytime today"
    status: HabitInstanceStatus;
    completedAt?: string;                  // ISO
    segments?: EngagementSegment[];        // v6.4: Start/Stop engagement segments (individual)
    rescheduledAt?: string;                // v6.3: ISO timestamp of the last user reschedule.
                                           //       When set, `REFRESH_TODAYS_HABITS` preserves
                                           //       the user-chosen `targetTime` instead of
                                           //       re-deriving it from the habit definition.
    rescheduleHistory?: RescheduleEventEntry[]; // v6.4: every reschedule, surfaced in the engagement log.
}

export interface DayPlan {
    date: string; // ISO date string (YYYY-MM-DD)
    intentions: Intention[];
    linkedTasks: LinkedTask[];                             // all tasks across all intentions
    todaysHabits: TodaysHabitInstance[];                  // v6.3: stabilizer instances for today
    taskSessions: Record<string, string[]>;               // sessionId -> todoistId[]
    wizardStep: number; // 1–4
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

/** v6: per-kind defaults for habit-instance duration. Habits override via Habit.targetDurationMinutes (v6.1). */
export interface TaskCapDefaults {
    stabilizer: number;       // default duration for scheduled (stabilizer) habit instances
    lightCoherent: number;    // v6.6: default duration for anytime (light-coherent) habit instances
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
 * Discriminator splitting durable recurring entities by *scheduling* only. As of v6.6 both
 * kinds sync to Todoist as recurring tasks, produce `TodaysHabitInstance`s, and share the
 * full Start/Stop/Complete/Skip engagement lifecycle. The single difference:
 *  - 'stabilizer'      → scheduled ritual; requires a `targetTime`; placed on the timeline at that time.
 *  - 'light-coherent'  → "anytime" habit; never has a `targetTime`; pulled opportunistically. No reschedule.
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
    todoistProjectId?: string;           // v6.1: explicit Todoist project for this habit's task; falls back to AppSettings.habitsTodoistProjectId
    targetTime?: string;                 // "HH:mm" target time-of-day. v6.6: required for stabilizers (enforced in the form), always absent for light-coherent. Optional on the type for legacy data.
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
    backlog?: BacklogEntry[];            // v6.2: parked intentions awaiting reuse; undefined = treated as []
}

/**
 * v6.2: a parked intention. Created when the user moves an intention to the backlog
 * (manual discard during planning) or when an unfinished intention auto-rolls over
 * at date-change. Brought back into today's plan via `RESTORE_FROM_BACKLOG`.
 *
 * `intention.linkedTaskIds` is pending-only: tasks already completed at archive time
 * are stripped from the id list and their titles are stashed in `completedTaskTitles`
 * for context display in the Backlog tab. On restore we only rebuild LinkedTasks for
 * the pending ids; completed work is preserved as read-only annotation.
 */
export interface BacklogEntry {
    id: string;                              // uuid for the entry itself (distinct from intention.id)
    intention: Intention;                    // preserved — but linkedTaskIds is pending-only (no completed)
    archivedAt: string;                      // ISO timestamp
    archivedFromDate: string;                // YYYY-MM-DD — plan.date the intention came from
    reason: 'manual' | 'rollover';
    taskSnapshots?: Record<string, string>;  // todoistId → titleSnapshot for pending tasks
    completedTaskTitles?: string[];          // titles of tasks already completed at archive time (context-only)
    unfinishedTaskRecords?: Record<string, EngagementSegment[]>;  // v6.3/v6.4: todoistId → engagement segments at archive time
}
