import type { EngagementSegment } from '../types';

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

/** Format seconds as `M:SS` (or `H:MM:SS` past an hour). */
export function formatClock(totalSeconds: number): string {
    const s = Math.max(0, Math.floor(totalSeconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}
