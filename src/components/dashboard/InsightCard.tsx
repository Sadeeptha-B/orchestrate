/**
 * Side-rail card with music Transition Tips. (True Rest now lives as its own collapsible
 * card in the Dashboard habits rail — see {@link TrueRestCard} — rather than auto-cycling here.)
 */
export function InsightCard() {
    return (
        <div className="bg-surface-dark rounded-lg p-4 text-xs text-text-light">
            <p className="font-medium text-text text-[11px] uppercase tracking-wider mb-2">
                Transition Tips
            </p>
            <div className="flex flex-col">
                <p>• Start Work → 5-10 min, then switch to task-specific</p>
                <p className="mt-1.5">• Coding → Deep Focus &nbsp;|&nbsp; Lectures → Lo-Fi</p>
                <p className="mt-1.5">• Restless → Brain Food &nbsp;|&nbsp; Low energy → Piano</p>
                <p className="mt-1.5">• Turn off for deep reading or when fully locked in</p>
                <p className="mt-1.5">• Volume: barely noticeable but present</p>
            </div>
        </div>
    );
}

interface CueCarouselProps {
    index: number;
    total: number;
    onPrev: () => void;
    onNext: () => void;
    compact?: boolean;
}

export function CueCarousel({ index, total, onPrev, onNext, compact = false }: CueCarouselProps) {
    if (total <= 1) return null;
    return (
        <div className={`inline-flex items-center ${compact ? 'gap-0.5' : 'gap-1'} text-text-light`}>
            <button
                type="button"
                onClick={onPrev}
                aria-label="Previous cue"
                className="w-5 h-5 flex items-center justify-center rounded hover:text-accent hover:bg-surface-dark/60 transition-colors cursor-pointer leading-none text-base"
            >
                ‹
            </button>
            <span className="text-[10px] tabular-nums min-w-[2.25rem] text-center">
                {index + 1} / {total}
            </span>
            <button
                type="button"
                onClick={onNext}
                aria-label="Next cue"
                className="w-5 h-5 flex items-center justify-center rounded hover:text-accent hover:bg-surface-dark/60 transition-colors cursor-pointer leading-none text-base"
            >
                ›
            </button>
        </div>
    );
}
