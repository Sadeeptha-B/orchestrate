export interface Task {
    id: string;
    title: string;
    type: 'main' | 'background' | 'unclassified';
    assignedSession?: string;
    completed: boolean;
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
    tasks: Task[];
    taskSessions: Record<string, string[]>; // sessionId -> taskId[]
    wizardStep: number; // 1–6
    setupComplete: boolean;
    checkIns: CheckIn[];
    syncChecklist: Record<string, boolean>;
}

export type NotificationPreference = 'in-app' | 'browser' | 'both';

export interface SavedDayPlan {
    plan: DayPlan;
    savedAt: string; // ISO timestamp
    label: string;   // e.g. "Thursday, Apr 10"
}

export interface AppSettings {
    notificationPreference: NotificationPreference;
    sessionSlots: SessionSlot[];
}
