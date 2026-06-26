import type { DayPlan, EngagementSegment, SessionSlot } from '../types';
import { timeToMinutes } from './time';

/** Seconds elapsed in a single segment — `endedAt − startedAt`, or `now − startedAt` while open. */
export function segmentSeconds(segment: EngagementSegment, nowMs: number): number {
    const end = segment.endedAt ? Date.parse(segment.endedAt) : nowMs;
    return Math.max(0, (end - Date.parse(segment.startedAt)) / 1000);
}

/** Total engaged seconds across all segments at a given instant (open segments measured to `now`). */
export function totalEngagedSeconds(segments: EngagementSegment[] | undefined, nowMs: number): number {
    if (!segments) return 0;
    return segments.reduce((sum, s) => sum + segmentSeconds(s, nowMs), 0);
}

/** The open (live) segment of a list, if any — the last segment with no `endedAt`. */
export function openSegment(segments: EngagementSegment[] | undefined): EngagementSegment | undefined {
    if (!segments) return undefined;
    const last = segments[segments.length - 1];
    return last && !last.endedAt ? last : undefined;
}

/**
 * v7.8: the most recent engagement boundary today, as epoch-ms — the latest `endedAt` across every
 * closed segment on today's habit instances and linked tasks. Returns null when nothing has been
 * engaged yet today. (Open/live segments are intentionally ignored: while something is engaged
 * there's nothing to nudge about.) Used to anchor the engagement nudge to "time since you last did
 * something" rather than "time since the session started".
 */
export function lastEngagementBoundary(plan: DayPlan): number | null {
    let latest: number | null = null;
    const consider = (segments: EngagementSegment[] | undefined) => {
        for (const s of segments ?? []) {
            if (!s.endedAt) continue;
            const t = Date.parse(s.endedAt);
            if (latest === null || t > latest) latest = t;
        }
    };
    for (const h of plan.todaysHabits) consider(h.segments);
    for (const lt of plan.linkedTasks) consider(lt.segments);
    return latest;
}

/** True when any task or habit instance currently has an open engagement segment (user is engaged). */
export function isAnythingEngaged(plan: DayPlan): boolean {
    const taskEngaged = plan.linkedTasks.some((lt) => lt.status === 'engaged' && openSegment(lt.segments));
    const habitEngaged = plan.todaysHabits.some((h) => h.status === 'engaged' && openSegment(h.segments));
    return taskEngaged || habitEngaged;
}

/** Epoch-ms of a session's start time, anchored to today. */
export function sessionStartMs(startTime: string): number {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime() + timeToMinutes(startTime) * 60_000;
}

export interface EngagementIdle {
    sessionName: string;
    /** Epoch-ms the elapsed clock is anchored to (last engagement boundary, or session start). */
    anchorMs: number;
    /** Minutes since `anchorMs`. */
    elapsedMin: number;
}

/**
 * v7.8: shared pure basis for the engagement nudge + dashboard banner. Returns the current idle
 * state when the user is inside `currentSession`, has nothing engaged, and the session still has
 * incomplete assigned work — else null (nothing to nudge about). The elapsed clock is anchored to
 * the last engagement boundary within this session, falling back to the session start when nothing
 * has been engaged here yet, so it reads "time since you last did something".
 */
export function engagementIdleState(
    plan: DayPlan,
    currentSession: SessionSlot | null,
    nowMs: number,
): EngagementIdle | null {
    if (!currentSession) return null;
    if (isAnythingEngaged(plan)) return null;

    const ids = plan.taskSessions[currentSession.id] ?? [];
    const hasIncompleteWork = ids.some((id) => {
        const lt = plan.linkedTasks.find((t) => t.todoistId === id);
        return lt && !lt.completed;
    });
    if (!hasIncompleteWork) return null;

    const start = sessionStartMs(currentSession.startTime);
    const boundary = lastEngagementBoundary(plan);
    const anchorMs = boundary !== null && boundary > start ? boundary : start;
    return { sessionName: currentSession.name, anchorMs, elapsedMin: (nowMs - anchorMs) / 60_000 };
}

/** Format seconds as `M:SS` (or `H:MM:SS` past an hour). */
export function formatClock(totalSeconds: number): string {
    const s = Math.max(0, Math.floor(totalSeconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}
