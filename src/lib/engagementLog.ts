import type { DayPlan, EngagementSegment } from '../types';
import type { TodoistTask } from '../hooks/useTodoist';
import { formatTimeOfDay } from './time';

/**
 * v6.4: flattened rows for the dashboard engagement log — a time-ordered record of
 * "what actually happened today". Two row kinds:
 *  - **engagement** — one per Start→Stop segment on a habit instance or task (individual,
 *    not cumulative: a Start/Stop/Start sequence produces two rows).
 *  - **reschedule** — a habit instance was moved to a different target time.
 *
 * Both are sorted together by `sortAt` (the segment's `startedAt` or the reschedule's `at`).
 */

interface EngagementLogRowBase {
    key: string;
    kind: 'habit' | 'task';
    title: string;
    sortAt: string;          // ISO — primary timestamp for ordering
    sourceId: string;
}

export interface EngagementSegmentRow extends EngagementLogRowBase {
    entryType: 'engagement';
    segment: EngagementSegment;
}

export interface RescheduleRow extends EngagementLogRowBase {
    entryType: 'reschedule';
    at: string;              // ISO — when the reschedule happened
    fromTime?: string;       // "HH:mm" prior target
    toTime?: string;         // "HH:mm" new target
}

export type EngagementLogRow = EngagementSegmentRow | RescheduleRow;

/**
 * Build the engagement log for today. Includes:
 *  - one engagement row per `EngagementSegment` on every habit instance / task, and
 *  - one reschedule row per `rescheduleHistory` entry on every habit instance.
 */
export function buildEngagementLog(
    plan: DayPlan,
    taskMap: Map<string, TodoistTask> | Map<string, { id: string; content: string }>,
): EngagementLogRow[] {
    const rows: EngagementLogRow[] = [];

    for (const instance of plan.todaysHabits) {
        for (const [idx, seg] of (instance.segments ?? []).entries()) {
            rows.push({
                entryType: 'engagement',
                key: `habit-seg-${instance.id}-${idx}`,
                kind: 'habit',
                title: instance.titleSnapshot,
                sortAt: seg.startedAt,
                sourceId: instance.id,
                segment: seg,
            });
        }
        for (const [idx, ev] of (instance.rescheduleHistory ?? []).entries()) {
            rows.push({
                entryType: 'reschedule',
                key: `habit-resched-${instance.id}-${idx}`,
                kind: 'habit',
                title: instance.titleSnapshot,
                sortAt: ev.at,
                sourceId: instance.id,
                at: ev.at,
                fromTime: ev.fromTime,
                toTime: ev.toTime,
            });
        }
    }

    for (const lt of plan.linkedTasks) {
        if (!lt.segments) continue;
        const title = taskMap.get(lt.todoistId)?.content
            ?? lt.titleSnapshot
            ?? lt.todoistId;
        for (const [idx, seg] of lt.segments.entries()) {
            rows.push({
                entryType: 'engagement',
                key: `task-seg-${lt.todoistId}-${idx}`,
                kind: 'task',
                title,
                sortAt: seg.startedAt,
                sourceId: lt.todoistId,
                segment: seg,
            });
        }
    }

    rows.sort((a, b) => a.sortAt.localeCompare(b.sortAt));
    return rows;
}

/** Format an ISO timestamp's local time-of-day as "HH:mm". */
export function formatLocalTimeOfDay(iso: string): string {
    return formatTimeOfDay(new Date(iso));
}
