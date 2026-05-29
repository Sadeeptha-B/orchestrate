import type { DayPlan, LinkedTask, TodaysHabitInstance } from '../types';
import type { TodoistTask } from '../hooks/useTodoist';

/**
 * v6.4: a flattened row for the engagement log view on the dashboard.
 * Combines per-instance engagement records from `todaysHabits` and per-task records from
 * `linkedTasks` into a single sortable list. The user-facing "what actually happened
 * today" view, ordered by `startedAt`.
 *
 * Each engagement record on `LinkedTask` / `TodaysHabitInstance` represents the most
 * recent segment's `startedAt` + accumulated `totalMinutes` (segments are not retained
 * individually today — see the durable-record roadmap for the cross-day store).
 */
export interface EngagementLogRow {
    key: string;                                   // stable react key
    kind: 'habit' | 'task';
    title: string;
    startedAt: string;                             // ISO — current/last segment start
    endedAt?: string;                              // ISO when paused/closed; absent = ongoing
    totalMinutes: number;                          // accumulated across cycles
    /**
     * Lifecycle status of the underlying entity (mirrors the source's `status`).
     * For habits this is `HabitInstanceStatus`; for tasks it is `LinkedTaskStatus`.
     */
    status: TodaysHabitInstance['status'] | NonNullable<LinkedTask['status']>;
    /** Optional reference to the source (for click-through or detail panels). */
    sourceId: string;
}

/**
 * Build the engagement log for today. Includes every instance/task that has an engagement
 * record — regardless of current status. The status field lets the UI render the row's
 * outcome (engaged / completed / unfinished / skipped / paused-when-planned-or-pending).
 */
export function buildEngagementLog(
    plan: DayPlan,
    taskMap: Map<string, TodoistTask> | Map<string, { id: string; content: string }>,
): EngagementLogRow[] {
    const rows: EngagementLogRow[] = [];

    for (const instance of plan.todaysHabits) {
        const eng = instance.engagement;
        if (!eng) continue;
        rows.push({
            key: `habit-${instance.id}`,
            kind: 'habit',
            title: instance.titleSnapshot,
            startedAt: eng.startedAt,
            endedAt: eng.endedAt,
            totalMinutes: eng.totalMinutes ?? 0,
            status: instance.status,
            sourceId: instance.id,
        });
    }

    for (const lt of plan.linkedTasks) {
        const eng = lt.engagement;
        if (!eng) continue;
        const title = taskMap.get(lt.todoistId)?.content
            ?? lt.titleSnapshot
            ?? lt.todoistId;
        rows.push({
            key: `task-${lt.todoistId}`,
            kind: 'task',
            title,
            startedAt: eng.startedAt,
            endedAt: eng.endedAt,
            totalMinutes: eng.totalMinutes ?? 0,
            status: lt.status ?? 'pending',
            sourceId: lt.todoistId,
        });
    }

    rows.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    return rows;
}

/** Format an ISO timestamp's local time-of-day as "HH:mm". */
export function formatLocalTimeOfDay(iso: string): string {
    const d = new Date(iso);
    const h = d.getHours();
    const m = d.getMinutes();
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Map a log row's status to a user-facing label for the engagement log. Distinct from
 * the status enum because for tasks/habits with engagement, "planned"/"pending" actually
 * means "paused" in this context (the engagement was opened, then stopped, but the
 * underlying entity isn't terminal).
 */
export function engagementStatusLabel(row: EngagementLogRow): string {
    switch (row.status) {
        case 'engaged':       return 'Engaged';
        case 'completed':     return 'Completed';
        case 'unfinished':    return 'Rescheduled';
        case 'skipped':       return 'Skipped';
        case 'planned':
        case 'pending':       return 'Paused';
        default:              return row.status;
    }
}
