import { useEffect, useRef, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { restCues as defaultRestCues } from '../../data/restCues';
import { useDayPlan } from '../../hooks/useDayPlan';
import { CueCarousel } from './InsightCard';
import type { RestCue } from '../../types';

type Variant = 'card' | 'inline' | 'banner';

/** Default rotation interval (5 minutes) for the True Rest cue on the Dashboard side rail. */
const DEFAULT_ROTATE_MS = 5 * 60 * 1000;

interface TrueRestCardProps {
    variant?: Variant;
    /** Optional pre-picked cue (used by callers that want a stable cue for the render). */
    cue?: RestCue;
    /** Rotate to a new random cue every N ms. Ignored when `cue` is provided. */
    rotateMs?: number;
    /** Optional eyebrow heading override (default depends on variant). */
    heading?: string;
}

/**
 * v6 True Rest surface — renders a single rotating recovery cue in one of three forms:
 *
 * - `card`   — Dashboard side rail (always visible).
 * - `inline` — embedded inside the check-in modal alongside the playlist suggestion.
 * - `banner` — between-session prompt (rendered when no session is active but one is upcoming).
 */
export function TrueRestCard({
    variant = 'card',
    cue: cueProp,
    rotateMs = DEFAULT_ROTATE_MS,
    heading,
}: TrueRestCardProps) {
    const { life } = useDayPlan();
    const navigate = useNavigate();
    const effectiveCues = (life.restCues && life.restCues.length > 0) ? life.restCues : defaultRestCues;

    const total = effectiveCues.length;
    const [index, setIndex] = useState(() => Math.floor(Math.random() * total));
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const startInterval = useCallback(() => {
        if (intervalRef.current) clearInterval(intervalRef.current);
        if (cueProp || rotateMs <= 0) return;
        intervalRef.current = setInterval(() => setIndex((i) => (i + 1) % total), rotateMs);
    }, [cueProp, rotateMs, total]);

    useEffect(() => {
        startInterval();
        return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
    }, [startInterval]);

    const handlePrev = () => {
        setIndex((i) => (i - 1 + total) % total);
        startInterval();
    };
    const handleNext = () => {
        setIndex((i) => (i + 1) % total);
        startInterval();
    };

    const wrappedIndex = ((index % total) + total) % total;
    const rotatingCue = effectiveCues[wrappedIndex];
    const cue = cueProp ?? rotatingCue;
    const eyebrow = heading ?? (variant === 'banner' ? 'Between sessions' : 'True Rest');
    const showCarousel = !cueProp;

    if (variant === 'banner') {
        return (
            <div className="rounded-lg border border-border bg-subtle/60 px-4 py-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                    <div className="text-[10px] uppercase tracking-wider text-text-light">
                        {eyebrow}
                    </div>
                    <div className="text-sm line-clamp-2 min-h-[2.5rem]">{cue.label}</div>
                </div>
                <div className="text-xs text-text-light whitespace-nowrap self-center">
                    {cue.durationHint}
                </div>
                {showCarousel && (
                    <div className="self-center">
                        <CueCarousel
                            index={wrappedIndex}
                            total={total}
                            onPrev={handlePrev}
                            onNext={handleNext}
                            compact
                        />
                    </div>
                )}
            </div>
        );
    }

    if (variant === 'inline') {
        return (
            <div className="rounded-lg bg-subtle/50 px-3 py-2 text-sm">
                <span className="text-[10px] uppercase tracking-wider text-text-light mr-2">
                    {eyebrow}
                </span>
                <span>{cue.label}</span>
                <span className="ml-2 text-xs text-text-light">· {cue.durationHint}</span>
            </div>
        );
    }

    return (
        <div className="bg-surface-dark rounded-lg p-4 text-xs text-text-light flex flex-col min-h-[11rem]">
            <p className="font-medium text-text text-[11px] uppercase tracking-wider mb-2">
                {eyebrow}
            </p>
            <p className="text-sm text-text line-clamp-2 min-h-[2.5rem]">{cue.label}</p>
            <div className="mt-auto pt-2 space-y-1.5">
                <p className="text-text-light">{cue.durationHint} · {cue.category}</p>
                <p className="text-[10px] italic text-text-light">
                    Recovery, not productivity. No completion required.
                </p>
                <div className="flex items-center justify-between pt-1">
                    {showCarousel ? (
                        <CueCarousel
                            index={wrappedIndex}
                            total={total}
                            onPrev={handlePrev}
                            onNext={handleNext}
                        />
                    ) : <span />}
                    <button
                        type="button"
                        onClick={() => navigate('/rest-cues')}
                        className="text-xs text-text-light hover:text-accent transition-colors cursor-pointer"
                    >
                        Manage →
                    </button>
                </div>
            </div>
        </div>
    );
}
