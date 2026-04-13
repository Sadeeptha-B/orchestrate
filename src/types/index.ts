export interface Intention {
    id: string;
    title: string;
    type: 'main' | 'background' | 'unclassified';
    assignedSessions: string[];
    completed: boolean;
    brokenDown: boolean;
    isHabit: boolean;
}

/** @deprecated Use Intention instead — kept as alias for migration */
export type Task = Intention;

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
    intentionSessions: Record<string, string[]>; // sessionId -> intentionId[]
    wizardStep: number; // 1–6
    setupComplete: boolean;
    checkIns: CheckIn[];
    syncChecklist: Record<string, boolean>;
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
