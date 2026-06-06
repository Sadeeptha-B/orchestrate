import { useEffect, useRef, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { restCues as defaultRestCues } from '../../data/restCues';
import { useDayPlan } from '../../hooks/useDayPlan';
import { CueCarousel } from './InsightCard';
import { Card } from '../ui/Card';
import type { RestCue } from '../../types';

type Variant = 'card' | 'inline' | 'banner';

/** Default rotation interval (5 minutes) for the True Rest cue on rotating surfaces. */
const DEFAULT_ROTATE_MS = 5 * 60 * 1000;

interface TrueRestCardProps {
    variant?: Variant;
    /** Optional pre-picked cue (used by callers that want a stable cue for the render). */
    cue?: RestCue;
    /** Rotate to a new random cue every N ms. Ignored when `cue` is provided. banner/inline only. */
    rotateMs?: number;
    /** Optional eyebrow heading override (default depends on variant). */
    heading?: string;
    /** `card` variant: start collapsed (default: expanded). */
    defaultCollapsed?: boolean;
}

/**
 * v6 True Rest surface — three forms:
 *
 * - `card`   — Dashboard side rail. Shows a full list of all rest cues with a collapsible section
 *              header. Replaces the old single-rotating-cue carousel approach (v6.9).
 * - `inline` — embedded inside the check-in modal alongside the playlist suggestion.
 * - `banner` — between-session prompt (rendered when no session is active but one is upcoming).
 */
export function TrueRestCard({
    variant = 'card',
    cue: cueProp,
    rotateMs = DEFAULT_ROTATE_MS,
    heading,
    defaultCollapsed = false,
}: TrueRestCardProps) {
    const { life } = useDayPlan();
    const navigate = useNavigate();
    const effectiveCues = (life.restCues && life.restCues.length > 0) ? life.restCues : defaultRestCues;

    const total = effectiveCues.length;
    const [index, setIndex] = useState(() => Math.floor(Math.random() * total));
    const [open, setOpen] = useState(!defaultCollapsed);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const startInterval = useCallback(() => {
        if (intervalRef.current) clearInterval(intervalRef.current);
        if (cueProp || rotateMs <= 0) return;
        intervalRef.current = setInterval(() => setIndex((i) => (i + 1) % total), rotateMs);
    }, [cueProp, rotateMs, total]);

    useEffect(() => {
        if (variant === 'card') return;
        startInterval();
        return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
    }, [startInterval, variant]);

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
    const showCarousel = !cueProp;

    if (variant === 'card') {
        const eyebrow = heading ?? 'True Rest';
        return (
            <section className="space-y-2">
                <button
                    type="button"
                    onClick={() => setOpen((o) => !o)}
                    className="flex items-center gap-2 text-sm font-semibold text-text-light uppercase tracking-wider hover:text-accent transition-colors cursor-pointer"
                    aria-expanded={open}
                >
                    <svg
                        className={`w-3 h-3 transition-transform ${open ? 'rotate-90' : ''}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                    >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                    {eyebrow}
                </button>
                {open && (
                    <Card className="py-2 px-2">
                        <div className="max-h-[24rem] overflow-y-auto scrollbar-subtle -mr-1 pr-1">
                            <ul className="space-y-0.5">
                                {effectiveCues.map((c) => (
                                    <li key={c.id} className="px-1.5 py-1.5 rounded hover:bg-surface-dark/50 transition-colors">
                                        <div className="flex items-start gap-1.5">
                                            <span className="text-xs flex-shrink-0 mt-px" aria-hidden>🌿</span>
                                            <span className="flex-1 min-w-0 text-xs">{c.label}</span>
                                            <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                                                <span className="text-[10px] px-1 py-px rounded-full bg-surface-dark text-text-light tabular-nums">
                                                    {c.durationHint}
                                                </span>
                                                <span className="text-[10px] px-1 py-px rounded-full bg-surface-dark text-text-light capitalize">
                                                    {c.category}
                                                </span>
                                            </div>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                            <div className="pt-2 px-1.5">
                                <button
                                    type="button"
                                    onClick={() => navigate('/life')}
                                    className="text-xs text-text-light hover:text-accent transition-colors cursor-pointer"
                                >
                                    Manage →
                                </button>
                            </div>
                        </div>
                    </Card>
                )}
            </section>
        );
    }

    if (variant === 'banner') {
        const eyebrow = heading ?? 'Between sessions';
        return (
            <div className="rounded-xl border border-border p-5 flex items-start gap-3">
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

    // inline
    const eyebrow = heading ?? 'True Rest';
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
