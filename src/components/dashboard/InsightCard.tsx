import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { restCues as defaultRestCues } from '../../data/restCues';
import { useDayPlan } from '../../hooks/useDayPlan';

/** How long each panel is shown before auto-advancing (2 minutes). */
const CYCLE_MS = 2 * 60 * 1000;

/**
 * Consolidated side-rail card that alternates between the music Transition Tips
 * and a True Rest recovery cue.
 *
 * Even steps → Transition Tips (static).
 * Odd steps  → True Rest (cycles through the user's rest-cue catalog).
 */
export function InsightCard() {
    const { life } = useDayPlan();
    const navigate = useNavigate();
    const effectiveCues =
        life.restCues && life.restCues.length > 0 ? life.restCues : defaultRestCues;

    const [step, setStep] = useState(0);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const resetInterval = useCallback(() => {
        if (intervalRef.current) clearInterval(intervalRef.current);
        intervalRef.current = setInterval(() => setStep((s) => s + 1), CYCLE_MS);
    }, []);

    useEffect(() => {
        resetInterval();
        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [resetInterval]);

    const handleNext = () => {
        setStep((s) => s + 1);
        resetInterval();
    };

    const isRest = step % 2 === 1;
    const cue = effectiveCues[Math.floor(step / 2) % effectiveCues.length];

    return (
        <div className="bg-surface-dark rounded-lg p-4 text-xs text-text-light">
            <div className="flex items-center justify-between mb-2">
                <p className="font-medium text-text text-[11px] uppercase tracking-wider">
                    {isRest ? 'True Rest' : 'Transition Tips'}
                </p>
                <button
                    type="button"
                    onClick={handleNext}
                    title="Next"
                    className="text-text-light hover:text-accent transition-colors cursor-pointer leading-none p-0.5 -mr-0.5"
                >
                    ›
                </button>
            </div>

            <div className="flex flex-col min-h-[6rem]">
                {isRest ? (
                    <>
                        <p className="text-sm text-text">{cue.label}</p>
                        <p className="text-text-light mt-1.5">{cue.durationHint} · {cue.category}</p>
                        <p className="text-[10px] pt-2 italic text-text-light">
                            Recovery, not productivity. No completion required.
                        </p>
                        <div className="flex justify-end mt-auto pt-2">
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
