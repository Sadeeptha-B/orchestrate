import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { restCues as defaultRestCues } from '../../data/restCues';
import { useDayPlan } from '../../hooks/useDayPlan';

/** How long each panel is shown before auto-advancing (2 minutes). */
const CYCLE_MS = 2 * 60 * 1000;

/**
 * Consolidated side-rail card that alternates between the music Transition Tips
 * and a True Rest recovery cue. Auto-rotation flips mode every CYCLE_MS; the `›`
 * button advances cues when on True Rest, or jumps to True Rest when on Tips.
 * The mode-toggle link lets users flip modes without waiting for auto-rotation.
 */
export function InsightCard() {
    const { life } = useDayPlan();
    const navigate = useNavigate();
    const effectiveCues =
        life.restCues && life.restCues.length > 0 ? life.restCues : defaultRestCues;

    const [mode, setMode] = useState<'tips' | 'rest'>('tips');
    const [cueIndex, setCueIndex] = useState(() =>
        Math.floor(Math.random() * effectiveCues.length),
    );
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const resetInterval = useCallback(() => {
        if (intervalRef.current) clearInterval(intervalRef.current);
        intervalRef.current = setInterval(
            () => setMode((m) => (m === 'tips' ? 'rest' : 'tips')),
            CYCLE_MS,
        );
    }, []);

    useEffect(() => {
        resetInterval();
        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [resetInterval]);

    const isRest = mode === 'rest';
    const total = effectiveCues.length;
    const cue = effectiveCues[((cueIndex % total) + total) % total];

    const handleTogglePanel = () => {
        setMode((m) => (m === 'tips' ? 'rest' : 'tips'));
        resetInterval();
    };

    const handlePrevCue = () => {
        setCueIndex((i) => (i - 1 + total) % total);
        resetInterval();
    };
    const handleNextCue = () => {
        setCueIndex((i) => (i + 1) % total);
        resetInterval();
    };

    return (
        <div className="bg-surface-dark rounded-lg p-4 text-xs text-text-light">
            <div className="flex items-center justify-between mb-2">
                <p className="font-medium text-text text-[11px] uppercase tracking-wider">
                    {isRest ? 'True Rest' : 'Transition Tips'}
                </p>
                <button
                    type="button"
                    onClick={handleTogglePanel}
                    title={isRest ? 'Show transition tips' : 'Show True Rest'}
                    className="text-text-light hover:text-accent transition-colors cursor-pointer leading-none p-0.5 -mr-0.5"
                >
                    ›
                </button>
            </div>

            <div className="flex flex-col min-h-[9rem]">
                {isRest ? (
                    <>
                        <p className="text-sm text-text line-clamp-2 min-h-[2.5rem]">{cue.label}</p>
                        <p className="text-text-light mt-1.5">{cue.durationHint} · {cue.category}</p>
                        <p className="text-[10px] pt-2 italic text-text-light">
                            Recovery, not productivity. No completion required.
                        </p>
                        <div className="flex items-center justify-between mt-auto pt-2">
                            <CueCarousel
                                index={((cueIndex % total) + total) % total}
                                total={total}
                                onPrev={handlePrevCue}
                                onNext={handleNextCue}
                            />
                            <button
                                type="button"
                                onClick={() => navigate('/rest-cues')}
                                className="text-xs text-text-light hover:text-accent transition-colors cursor-pointer"
                            >
                                Manage →
                            </button>
                        </div>
                    </>
                ) : (
                    <>
                        <p>• Start Work → 5-10 min, then switch to task-specific</p>
                        <p className="mt-1.5">• Coding → Deep Focus &nbsp;|&nbsp; Lectures → Lo-Fi</p>
                        <p className="mt-1.5">• Restless → Brain Food &nbsp;|&nbsp; Low energy → Piano</p>
                        <p className="mt-1.5">• Turn off for deep reading or when fully locked in</p>
                        <p className="mt-1.5">• Volume: barely noticeable but present</p>
                    </>
                )}
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
