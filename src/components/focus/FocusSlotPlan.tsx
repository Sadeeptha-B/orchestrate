import type { FocusPlan } from '../../lib/focus';

interface FocusSlotPlanProps {
    plan: FocusPlan;
    /** index of the block currently running (Pomodoro engine), or -1/undefined when idle/off. */
    activeIndex?: number;
    /** true once the Pomodoro schedule has completed. */
    done?: boolean;
}

/**
 * v7: vertical slot timeline for Focus Mode. Renders the work/break blocks of a `FocusPlan` stacked
 * top-to-bottom with heights proportional to their minutes — encouragement to work in slots (e.g.
 * 20 / 5 break / 20). When the Pomodoro engine is running, `activeIndex` highlights the live block.
 */
export function FocusSlotPlan({ plan, activeIndex = -1, done = false }: FocusSlotPlanProps) {
    if (plan.singleSession) {
        return (
            <div className="text-xs text-text-light leading-relaxed">
                Single session — short enough to do in one stretch.
            </div>
        );
    }

    const workCount = plan.blocks.filter((b) => b.kind === 'work').length;

    return (
        <div>
            <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-medium text-text-light uppercase tracking-wider">
                    Suggested slots
                </span>
                <span className="text-[10px] text-text-light tabular-nums">
                    {workCount}× work
                </span>
            </div>
            <ol className="space-y-1">
                {plan.blocks.map((block, i) => {
                    const isWork = block.kind === 'work';
                    const isActive = i === activeIndex && !done;
                    const isPast = activeIndex >= 0 && (done || i < activeIndex);
                    return (
                        <li
                            key={i}
                            // height scales with duration so a 20-min block reads as longer than a 5-min break
                            style={{ minHeight: `${Math.max(20, block.minutes * 1.6)}px` }}
                            className={`flex items-center justify-between rounded-md px-3 py-1.5 text-xs border transition-colors ${
                                isActive
                                    ? isWork
                                        ? 'bg-accent text-white border-accent'
                                        : 'bg-amber-400 text-amber-950 border-amber-400'
                                    : isWork
                                        ? 'bg-accent/10 text-accent border-accent/20'
                                        : 'bg-surface-dark text-text-light border-border'
                            } ${isPast ? 'opacity-40' : ''}`}
                        >
                            <span className="font-medium">
                                {isWork ? 'Work' : 'Break'}
                            </span>
                            <span className="tabular-nums">{block.minutes}m</span>
                        </li>
                    );
                })}
            </ol>
        </div>
    );
}
