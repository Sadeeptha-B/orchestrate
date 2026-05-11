import type { RestCue } from '../types';

/**
 * v6 True Rest catalog — non-stimulating reset cues surfaced during low-energy / struggling
 * check-ins, on the Dashboard side rail, and between sessions. Not Habits: no completion
 * semantics, no streak, no logging. Just gentle prompts.
 */
export const restCues: RestCue[] = [
    { id: 'walk-5',         label: 'Walk 5 minutes — outside if possible',  durationHint: '5 min',  category: 'physical' },
    { id: 'stretch',        label: 'Stand up and stretch — neck, shoulders, hips', durationHint: '2 min',  category: 'physical' },
    { id: 'water',          label: 'Drink a full glass of water',           durationHint: '1 min',  category: 'physical' },
    { id: 'breathe-90s',    label: 'Box-breath: in 4, hold 4, out 4, hold 4', durationHint: '90 sec', category: 'breath' },
    { id: 'breathe-long',   label: 'Long exhale breathing — exhale twice as long as inhale', durationHint: '3 min', category: 'breath' },
    { id: 'eyes-closed',    label: 'Close your eyes — no input, no agenda', durationHint: '2 min',  category: 'sensory' },
    { id: 'window-gaze',    label: 'Look out a window, focus on something far away', durationHint: '2 min',  category: 'sensory' },
    { id: 'silence',        label: 'Sit in silence — no phone, no music',   durationHint: '3 min',  category: 'sensory' },
];

/**
 * Pick a cue deterministically (when `seed` is provided) or randomly (otherwise).
 * Deterministic mode is useful for surfaces that should not jitter on re-render.
 */
export function pickRestCue(seed?: number): RestCue {
    if (seed === undefined) return restCues[Math.floor(Math.random() * restCues.length)];
    return restCues[((seed % restCues.length) + restCues.length) % restCues.length];
}
