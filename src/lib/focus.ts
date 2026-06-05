import type { DayPlan, LinkedTask } from '../types';
import { openSegment } from './engagement';

/**
 * v7: Focus Mode logic. A "focus plan" turns a task's estimate into a pomodoro-style schedule of
 * alternating work/break blocks, surfaced as a vertical slot timeline and (when Pomodoro mode is on)
 * driven live by `resolveBlockAt`. Pure module — no React, no DOM.
 */

export interface FocusBlock {
    kind: 'work' | 'break';
    minutes: number;
}

export interface FocusPlan {
    blocks: FocusBlock[];
    /** true when the estimate is too small (or absent) to split — one open-ended work session. */
    singleSession: boolean;
}

/**
 * Build the pomodoro schedule for a task estimate:
 *  - ≥ 45 min → 20-min work blocks separated by 5-min breaks
 *  - 30–44 min → 10-min work blocks separated by 5-min breaks
 *  - < 30 min or unestimated → a single session, no breaks
 *
 * Work-block count is `max(2, round(estimate / workLen))` for the split tiers, so 45→20/5/20,
 * 30→10/5/10/5/10, 60→20/5/20/5/20. Breaks interleave between work blocks (n work → n−1 breaks).
 */
export function computeFocusPlan(estimateMinutes: number | null): FocusPlan {
    if (estimateMinutes == null || estimateMinutes < 30) {
        return {
            blocks: [{ kind: 'work', minutes: estimateMinutes ?? 0 }],
            singleSession: true,
        };
    }

    const workLen = estimateMinutes >= 45 ? 20 : 10;
    const breakLen = 5;
    const workCount = Math.max(2, Math.round(estimateMinutes / workLen));

    const blocks: FocusBlock[] = [];
    for (let i = 0; i < workCount; i++) {
        blocks.push({ kind: 'work', minutes: workLen });
        if (i < workCount - 1) blocks.push({ kind: 'break', minutes: breakLen });
    }
    return { blocks, singleSession: false };
}

export interface BlockPosition {
    /** index into `blocks`, or -1 when `done`. */
    index: number;
    kind: 'work' | 'break';
    /** seconds left in the current block. */
    blockRemainingSeconds: number;
    /** true once elapsed has run past the last block. */
    done: boolean;
}

/**
 * Walk a block schedule to find which block `elapsedSeconds` lands in, and how many seconds remain in
 * it. Drives the live Pomodoro engine (current phase + countdown). Returns `done` once the schedule is
 * exhausted. A single-session (open-ended) plan never completes — callers should branch on that before
 * calling this.
 */
export function resolveBlockAt(blocks: FocusBlock[], elapsedSeconds: number): BlockPosition {
    let acc = 0;
    for (let i = 0; i < blocks.length; i++) {
        const blockSeconds = blocks[i].minutes * 60;
        if (elapsedSeconds < acc + blockSeconds) {
            return {
                index: i,
                kind: blocks[i].kind,
                blockRemainingSeconds: Math.max(0, acc + blockSeconds - elapsedSeconds),
                done: false,
            };
        }
        acc += blockSeconds;
    }
    return { index: -1, kind: 'work', blockRemainingSeconds: 0, done: true };
}

/**
 * The task the user is currently focused on: the engaged `LinkedTask` with an open engagement segment.
 * If several are open (shouldn't normally happen), the most-recently-started one wins. Returns
 * undefined when nothing is engaged — Focus Mode then shows its empty state.
 */
export function findActiveFocusTask(plan: DayPlan): LinkedTask | undefined {
    const engaged = plan.linkedTasks.filter(
        (lt) => lt.status === 'engaged' && openSegment(lt.segments) !== undefined,
    );
    if (engaged.length === 0) return undefined;
    return engaged.reduce((latest, lt) => {
        const a = openSegment(lt.segments)!.startedAt;
        const b = openSegment(latest.segments)!.startedAt;
        return a > b ? lt : latest;
    });
}
