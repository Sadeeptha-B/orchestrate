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
 * v7.4 Phase 2: one re-entry breadcrumb on a `LinkedTask.contextTrail`. The trail is cumulative:
 * an `entry` note is the concrete entry point written at refine time (one, last-write-wins); an
 * `exit` note is "where I left off", appended on each Stop/Complete. The latest note is the task's
 * current "start here". Replaces the v7.4-Phase-1 `firstAction`/`reentryNote` scalars.
 */
export interface ContextNote {
    at: string;                   // ISO — when the note was written
    text: string;
    kind: 'entry' | 'exit';
}

/**
 * v7.4 Phase 2: a finalized (closed) engagement segment, archived durably to
 * `LifeContext.engagementHistory` so the day's behavioral record survives rollover. Write-through:
 * today's live segments still live on the plan; each segment is copied here when it closes. Keyed by
 * a **durable** source id (task `todoistId` / habit `Habit.id`) so re-entry latency and streaks span
 * days. Pruned to a rolling window (see `lib/engagementHistory.ts`).
 */
export interface EngagementRecord {
    id: string;                            // uuid for this record
    sourceKind: 'task' | 'habit' | 'micro-gap';
    sourceId: string;                      // durable id: LinkedTask.todoistId, or Habit.id (NOT the per-day instance id)
    title: string;                         // titleSnapshot at archive time
    date: string;                          // YYYY-MM-DD (local) of startedAt — prune + rollup key
    startedAt: string;                     // ISO
    endedAt: string;                       // ISO — only closed segments are archived
    gapBeforeMinutes?: number;             // minutes since the prior record of same sourceId ended = re-entry latency
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
    contextTrail?: ContextNote[];                         // v7.4 Phase 2: cumulative re-entry breadcrumbs (replaces firstAction/reentryNote). Latest note = current "start here"
}

export interface SessionSlot {
    id: string;
    name: string;
    startTime: string; // "HH:mm"
    endTime: string;   // "HH:mm"
    // v7.7 Phase 3: No Distraction blocklist suffix appended to this session's calendar event name
    // (e.g. "-ND"). Undefined / "" = no blocklist. The actual blocklists are managed by the extension.
    blocklist?: string;
}

/**
 * v7.1: a named, reusable set of session slots. Defined in the Life section and applied
 * during the wizard's Sessions step as a quick preset. Replaces the old single global
 * `AppSettings.sessionSlots` editor concept (sessions are now per-day on `DayPlan`).
 */
export interface SessionTemplate {
    id: string;
    name: string;
    slots: SessionSlot[];
    createdAt: string; // ISO
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
 * v6.3: today's manifestation of a habit. Lives on `DayPlan.todaysHabits`, independent of
 * session assignment. v6.7: carries both kinds — resolve via the parent habit's `kind`
 * (`habitKindOf`). 'habit' instances are Todoist-backed + terminal; 'micro-gap' instances have
 * no `todoistTaskId`, are always untimed, and cycle planned↔engaged repeatably (never terminal).
 */
export interface TodaysHabitInstance {
    id: string;                            // uuid (primary key)
    habitId: string;                       // → life.habits[i].id
    todoistTaskId?: string;                // recurring Todoist task id. v6.7: absent for micro-gaps.
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
    sessionSlots: SessionSlot[];                          // v7.1: authoritative per-day sessions (seeded from last-used day)
    taskSessions: Record<string, string[]>;               // sessionId -> todoistId[]
    wizardStep: number; // 1–5
    setupComplete: boolean;
    checkIns: CheckIn[];
    seededFocusIds?: string[];                            // v6.7: recurring-focus ids already added as intentions today (chip dedup)
    // v7.7 Phase 3: sessionId -> Google event id on the Orchestrate calendar (for Sync reconcile).
    sessionCalendarEventIds?: Record<string, string>;
    // v7.7 Phase 3: per-session blocklist confirmation. Presence = confirmed; locked until the
    // session's end time. `blocklist` is the suffix locked in at confirmation (null = none).
    sessionStarts?: Record<string, { blocklist: string | null; confirmedAt: string }>;
}

export type NotificationPreference = 'in-app' | 'browser' | 'both';

export type CalendarViewMode = 'day' | 'threeDay' | 'week';

export interface SavedDayPlan {
    plan: DayPlan;
    savedAt: string; // ISO timestamp
    label: string;   // e.g. "Thursday, Apr 10"
}

export interface GoogleCalendarEntry {
    id: string;
    name?: string;    // user-friendly label, e.g. "Work", "Todoist"
    color?: string;   // hex color for the embed, e.g. "#009688"
    primary?: boolean; // v7.2: the user's primary calendar (from the Calendar API list)
    // v7.7: per-surface visibility. A calendar can be shown on the SessionTimelineBar (day context),
    // in the rendered calendar view, or both — independently. `undefined` means visible (so entries
    // saved before v7.7 keep showing on both surfaces without a migration).
    showOnTimeline?: boolean;
    showInCalendar?: boolean;
}

/** v6: per-kind defaults for habit-instance duration. Habits override via Habit.targetDurationMinutes (v6.1). */
export interface TaskCapDefaults {
    habit: number;            // v6.7: default duration for 'habit'-kind instances (was `stabilizer`)
    microGap: number;         // v6.7: default duration for 'micro-gap' instances (was `lightCoherent`)
    manualBackground: number; // applied to manually-categorized 'background' tasks
}

export interface AppSettings {
    userName?: string;
    notificationPreference: NotificationPreference;
    sessionSlots: SessionSlot[];
    // v7.2: the Todoist token lives server-side (Cloudflare Worker + KV) — never in the browser, never
    // in a backup. The app authenticates to the Worker proxy with the shared secret (`orchestrate-cf-secret`).
    googleCalendarIds?: GoogleCalendarEntry[]; // v7.2: the *selected* calendars to overlay (sourced from the Calendar API list)
    googleCalendarConnected?: boolean;         // v7.2: user has authorized Google Calendar via the server-mediated OAuth flow (Cloudflare Worker holds the refresh token); drives the connection re-check on load. Access tokens are minted server-side on demand and held only in memory.
    calendarViewMode?: CalendarViewMode;
    // v7.7 Phase 3: the dedicated app-managed calendar sessions are written to.
    orchestrateCalendarName?: string;   // display name (default "Orchestrate")
    orchestrateCalendarId?: string;     // Google calendar id once created (per connected account)
    blocklists?: string[];              // No Distraction suffix strings the user can assign to sessions (e.g. "-ND")
    taskCapDefaults?: TaskCapDefaults;  // v6: defaults are injected by loadSettings when absent
    sessionBufferMinutes?: number;      // v6: subtracted from session length when computing capacity (default 60)
    habitsTodoistProjectId?: string;    // v6.1: Todoist project all habit-tasks live under; lazily created on first habit save
    timelineStartMinutes?: number;      // minutes since midnight; default 270 (4:30 am)
    timelineEndMinutes?: number;        // minutes since midnight; default 1440 (midnight)
    // v7.5: Focus Mode strictness. When true (default), the first-concrete-action note (on start) and
    // the next-step note (on Stop / on leaving Focus) are *required*; when false they're optional.
    focusStrict?: boolean;
    // v7.8: cadence (minutes) of the hourly recontextualization check-in. Default 60; 0 disables it.
    recontextualizationCadenceMinutes?: number;
    // v7.8: idle minutes before the engagement nudge fires (notif + persistent dashboard banner).
    // Default 10; 0 disables it.
    engagementNudgeMinutes?: number;
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
    recurringFocuses?: RecurringFocus[]; // v6.7: cadenced work-threads that seed intentions; undefined = []
}

/**
 * v6.7: a season-scoped recurring work-thread (e.g. "Learn redis") — recurring *work* that
 * decomposes into tasks, not an atomic habit. On matching days it surfaces in the Step 1 season
 * banner as a clickable "+ Add" chip that seeds an Intention into the plan (manual, not auto).
 */
export interface RecurringFocus {
    id: string;
    title: string;
    recurrence: HabitRecurrence;
    active: boolean;
}

export type HabitRecurrenceKind = 'daily' | 'weekdays' | 'weekly' | 'custom';

export interface HabitRecurrence {
    kind: HabitRecurrenceKind;
    daysOfWeek?: number[];               // 0=Sun..6=Sat, used for 'weekly' and 'custom'
    timesPerWeek?: number;               // soft target for 'weekly' when daysOfWeek is not set
}

export type HabitCompletionRule = 'binary' | 'count' | 'duration';

/**
 * Discriminator splitting durable recurring entities by *lifecycle* (v6.7):
 *  - 'habit'      → the normal recurring thing. Todoist-backed, **terminal once per day**
 *                   (Complete advances the recurrence). `targetTime` is OPTIONAL: timed → timeline
 *                   lane; untimed → "anytime today". Reschedulable.
 *  - 'micro-gap'  → light, **repeatable** filler (flashcards, a quick drill). NOT synced to Todoist,
 *                   never terminal — Start/Stop logs a rep and it stays available all day. Lives on its
 *                   own dashboard surface; still feeds the Engagement Log via segments. Always untimed.
 */
export type HabitKind = 'habit' | 'micro-gap';

/** v6.1: how to handle timed habits whose target time-of-day window has already passed at planning time. */
export type HabitWindowBehavior = 'strict' | 'lenient';

export interface Habit {
    id: string;
    name: string;                        // e.g. "Morning meditation"
    kind: HabitKind;                     // v6.7: 'habit' (Todoist-backed, terminal) | 'micro-gap' (no Todoist, repeatable)
    recurrence: HabitRecurrence;
    minimumViable: string;               // e.g. "5 min sit, no app required"
    triggerCue: string;                  // e.g. "After waking, before phone"
    completionRule: HabitCompletionRule;
    failureTolerance: number;            // # of misses per week before nudge
    isAnchor: boolean;                   // sleep, meditation, gym, shutdown, review
    seasonIds: string[];                 // which seasons this habit belongs to ([] = always-on)
    active: boolean;                     // user-toggle to pause without deleting
    todoistTaskId?: string;              // v6.1: persistent recurring Todoist task ID. v6.7: 'habit' kind only — micro-gaps never sync.
    todoistProjectId?: string;           // v6.1: explicit Todoist project for this habit's task; falls back to AppSettings.habitsTodoistProjectId
    targetTime?: string;                 // "HH:mm" target time-of-day. v6.7: optional for 'habit' (timed → timeline; absent → anytime); always absent for 'micro-gap'.
    targetDurationMinutes?: number;      // v6.1: minutes; pushed to Todoist `duration` and used as the LinkedTask estimate
    windowBehavior?: HabitWindowBehavior;// v6.1/v6.8: timed-habit window policy. 'strict' = still surfaced + completable past targetTime+duration but presented as "missed" (greyed); 'lenient' = stays an active to-do. v6.8: no longer hides the row. Default 'lenient'.
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
    sessionTemplates?: SessionTemplate[]; // v7.1: reusable session presets; undefined = treated as []
    engagementHistory?: EngagementRecord[]; // v7.4 Phase 2: durable, pruned archive of closed engagement segments; undefined = treated as []
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
    contextTrails?: Record<string, ContextNote[]>;  // v7.4 Phase 2: todoistId → re-entry breadcrumbs at archive time, restored on bring-to-today
}
