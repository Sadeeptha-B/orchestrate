import { format } from 'date-fns';
import type { EngagementRecord, EngagementSegment } from '../types';

/**
 * v7.4 Phase 2: pure helpers for the durable engagement archive (`LifeContext.engagementHistory`).
 *
 * Write-through model: today's live segments stay on the plan; each *closed* segment is copied into
 * a finalized `EngagementRecord` here when it closes. The archive is bounded by a rolling
 * `RETENTION_DAYS` prune (applied on load + on every append) so the localStorage footprint stays
 * flat. This is a transitional measure until a real backend (see
 * docs/roadmap/persistence_and_backend_migration.md); the move-to-DB trigger is when retention
 * needs exceed the localStorage budget or multi-device sync is wanted.
 */

/** Rolling retention window for archived engagement records. */
export const RETENTION_DAYS = 90;

/** Local "YYYY-MM-DD" of an ISO timestamp. */
function localDate(iso: string): string {
    return format(new Date(iso), 'yyyy-MM-dd');
}

/** The cutoff "YYYY-MM-DD": records dated before this are pruned. */
function cutoffDate(now: Date, retentionDays: number): string {
    const d = new Date(now);
    d.setDate(d.getDate() - retentionDays);
    return format(d, 'yyyy-MM-dd');
}

/** Most-recent `endedAt` among archived records for a source, or undefined if none. */
export function lastEndedFor(
    history: EngagementRecord[] | undefined,
    sourceId: string,
): string | undefined {
    let latest: string | undefined;
    for (const r of history ?? []) {
        if (r.sourceId !== sourceId) continue;
        if (!latest || r.endedAt > latest) latest = r.endedAt;
    }
    return latest;
}

/**
 * Build a finalized record from a just-closed segment. `gapBeforeMinutes` (re-entry latency) is the
 * minutes since the same source's prior record ended — undefined when this is the first engagement
 * of that source in the archive (no resume to measure).
 */
export function buildRecordFromClosedSegment(args: {
    sourceKind: EngagementRecord['sourceKind'];
    sourceId: string;
    title: string;
    segment: EngagementSegment;
    history: EngagementRecord[] | undefined;
}): EngagementRecord | null {
    const { sourceKind, sourceId, title, segment, history } = args;
    if (!segment.endedAt) return null; // only closed segments are archived
    const priorEnd = lastEndedFor(history, sourceId);
    let gapBeforeMinutes: number | undefined;
    if (priorEnd) {
        const gapMs = Date.parse(segment.startedAt) - Date.parse(priorEnd);
        if (gapMs >= 0) gapBeforeMinutes = Math.round(gapMs / 60000);
    }
    return {
        id: crypto.randomUUID(),
        sourceKind,
        sourceId,
        title,
        date: localDate(segment.startedAt),
        startedAt: segment.startedAt,
        endedAt: segment.endedAt,
        ...(gapBeforeMinutes !== undefined ? { gapBeforeMinutes } : {}),
    };
}

/** Drop records dated older than the retention window. */
export function pruneEngagementHistory(
    history: EngagementRecord[] | undefined,
    opts: { retentionDays?: number; now?: Date } = {},
): EngagementRecord[] {
    if (!history || history.length === 0) return history ?? [];
    const cutoff = cutoffDate(opts.now ?? new Date(), opts.retentionDays ?? RETENTION_DAYS);
    return history.filter((r) => r.date >= cutoff);
}

/** Append a record and prune in one pass. */
export function appendEngagementRecord(
    history: EngagementRecord[] | undefined,
    record: EngagementRecord,
    opts: { retentionDays?: number; now?: Date } = {},
): EngagementRecord[] {
    return pruneEngagementHistory([...(history ?? []), record], opts);
}

export interface ReentryStats {
    resumeCount: number;       // archived engagements that were a resume (gapBeforeMinutes set) in the window
    medianGapMinutes: number;  // median re-entry latency across those resumes (0 when none)
}

/**
 * Re-entry metric over a recent window: how many times work was resumed after a gap, and the median
 * time-to-resume. A "resume" is any record carrying `gapBeforeMinutes`. This is the v7.4 success
 * metric (problem-statement §15 Principle 5) made measurable.
 */
export function computeReentryStats(
    history: EngagementRecord[] | undefined,
    opts: { now?: Date; windowDays?: number } = {},
): ReentryStats {
    const cutoff = cutoffDate(opts.now ?? new Date(), opts.windowDays ?? 7);
    const gaps = (history ?? [])
        .filter((r) => r.date >= cutoff && r.gapBeforeMinutes !== undefined)
        .map((r) => r.gapBeforeMinutes as number)
        .sort((a, b) => a - b);
    if (gaps.length === 0) return { resumeCount: 0, medianGapMinutes: 0 };
    const mid = Math.floor(gaps.length / 2);
    const median = gaps.length % 2 === 0 ? Math.round((gaps[mid - 1] + gaps[mid]) / 2) : gaps[mid];
    return { resumeCount: gaps.length, medianGapMinutes: median };
}
