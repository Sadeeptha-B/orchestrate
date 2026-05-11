import type { AppSettings, LinkedTask, SessionSlot } from '../types';
import { timeToMinutes } from './time';

/** Default session buffer (subtracted from a session's wall-clock length) when AppSettings doesn't set one. */
export const DEFAULT_SESSION_BUFFER_MINUTES = 60;

export type CapacityStatus = 'ok' | 'tight' | 'over';

export interface SessionCapacity {
    /** Effective minutes available (post-buffer, or remaining minutes when mid-session). */
    totalMinutes: number;
    /** Buffer subtracted from the session length. */
    bufferMinutes: number;
    /** Sum of `estimatedMinutes` for tasks assigned to this session (counted once per assignment). */
    assignedMinutes: number;
    /** `totalMinutes − assignedMinutes`, clamped to 0 minimum for display. */
    remainingMinutes: number;
    /** `assignedMinutes / totalMinutes`. Infinity when totalMinutes is 0. */
    percentUsed: number;
    /** `over` only when load > 150% — banner-worthy. `tight` when ≥ 100%. */
    status: CapacityStatus;
    /** True when `now` falls inside the session's wall-clock window. */
    isCurrent: boolean;
}

function minutesIntoDay(now: Date): number {
    return now.getHours() * 60 + now.getMinutes();
}

/**
 * Compute capacity for a single session.
 *
 * - `totalMinutes` is the session's wall-clock length minus the buffer, OR — when `now` is
 *   inside the session window — the minutes remaining until the session's end, with the buffer
 *   proportionally shrunk so a half-elapsed session still shows roughly half its buffer.
 * - Background tasks count once per assignment: a 20-min background task assigned to two
 *   sessions counts 20 min against each.
 * - `over` only when `percentUsed > 1.5` (matches v6's "looser, advisory-only" decision).
 */
export function computeSessionCapacity(
    session: SessionSlot,
    taskSessions: Record<string, string[]>,
    linkedTasks: LinkedTask[],
    settings: AppSettings,
    now: Date = new Date(),
): SessionCapacity {
    const startMin = timeToMinutes(session.startTime);
    const endMin = timeToMinutes(session.endTime);
    const sessionLengthMinutes = Math.max(0, endMin - startMin);
    const baseBuffer = Math.min(
        settings.sessionBufferMinutes ?? DEFAULT_SESSION_BUFFER_MINUTES,
        sessionLengthMinutes,
    );

    const nowMin = minutesIntoDay(now);
    const isCurrent = nowMin >= startMin && nowMin < endMin;

    let totalMinutes: number;
    let bufferMinutes: number;
    if (isCurrent && sessionLengthMinutes > 0) {
        const remainingWall = endMin - nowMin;
        const fractionLeft = remainingWall / sessionLengthMinutes;
        bufferMinutes = Math.round(baseBuffer * fractionLeft);
        totalMinutes = Math.max(0, remainingWall - bufferMinutes);
    } else {
        bufferMinutes = baseBuffer;
        totalMinutes = Math.max(0, sessionLengthMinutes - bufferMinutes);
    }

    const assignedIds = taskSessions[session.id] ?? [];
    const byId = new Map(linkedTasks.map((t) => [t.todoistId, t]));
    const assignedMinutes = assignedIds.reduce((sum, id) => {
        const task = byId.get(id);
        if (!task || task.completed) return sum;
        return sum + (task.estimatedMinutes ?? 0);
    }, 0);

    const percentUsed = totalMinutes > 0 ? assignedMinutes / totalMinutes : (assignedMinutes > 0 ? Infinity : 0);
    let status: CapacityStatus = 'ok';
    if (percentUsed > 1.5) status = 'over';
    else if (percentUsed >= 1.0) status = 'tight';

    return {
        totalMinutes,
        bufferMinutes,
        assignedMinutes,
        remainingMinutes: Math.max(0, totalMinutes - assignedMinutes),
        percentUsed,
        status,
        isCurrent,
    };
}

/** Compute capacity for every session in a list. Returns a map keyed by session id. */
export function computeAllSessionCapacities(
    sessions: SessionSlot[],
    taskSessions: Record<string, string[]>,
    linkedTasks: LinkedTask[],
    settings: AppSettings,
    now: Date = new Date(),
): Record<string, SessionCapacity> {
    const out: Record<string, SessionCapacity> = {};
    for (const s of sessions) {
        out[s.id] = computeSessionCapacity(s, taskSessions, linkedTasks, settings, now);
    }
    return out;
}
