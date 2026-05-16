import { useEffect, useRef, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { restCues as defaultRestCues } from '../../data/restCues';
import { useDayPlan } from '../../hooks/useDayPlan';
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

    const [index, setIndex] = useState(() => Math.floor(Math.random() * effectiveCues.length));
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const startInterval = useCallback(() => {
        if (intervalRef.current) clearInterval(intervalRef.current);
        if (cueProp || rotateMs <= 0) return;
        intervalRef.current = setInterval(() => setIndex((i) => i + 1), rotateMs);
    }, [cueProp, rotateMs]);

    useEffect(() => {
        startInterval();
        return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
    }, [startInterval]);

    const handleNext = () => {
        setIndex((i) => i + 1);
        startInterval();
    };

    const rotatingCue = effectiveCues[index % effectiveCues.length];
    const cue = cueProp ?? rotatingCue;
    const eyebrow = heading ?? (variant === 'banner' ? 'Between sessions' : 'True Rest');

    if (variant === 'banner') {
        return (
            <div className="rounded-lg border border-border bg-subtle/60 px-4 py-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                    <div className="text-[10px] uppercase tracking-wider text-text-light">
                        {eyebrow}
                    </div>
                    <div className="text-sm">{cue.label}</div>
                </div>
                <div className="text-xs text-text-light whitespace-nowrap">
                    {cue.durationHint}
                </div>
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
        <div className="bg-surface-dark rounded-lg p-4 text-xs text-text-light space-y-1.5">
            <div className="flex items-center justify-between mb-2">
                <p className="font-medium text-text text-[11px] uppercase tracking-wider">
                    {eyebrow}
                </p>
                <button
                    type="button"
                    onClick={handleNext}
                    title="Next cue"
                    className="text-text-light hover:text-accent transition-colors cursor-pointer leading-none p-0.5 -mr-0.5"
                >
                    ›
                </button>
            </div>
            <p className="text-sm text-text">{cue.label}</p>
            <p className="text-text-light">{cue.durationHint} · {cue.category}</p>
            <p className="text-[10px] pt-2 italic text-text-light">
                Recovery, not productivity. No completion required.
            </p>
            <div className="flex justify-end pt-1">
                <button
                    type="button"
                    onClick={() => navigate('/rest-cues')}
                    className="text-xs text-text-light hover:text-accent transition-colors cursor-pointer"
                >
                    Manage →
                </button>
            </div>
        </div>
    );
}
