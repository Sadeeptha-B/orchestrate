/**
 * v7: a tiny WebAudio chime for Pomodoro block boundaries. No audio asset — synthesises a short
 * two-tone beep on demand. Plays regardless of notification preference (audio is in-app feedback).
 * Best-effort: silently no-ops if WebAudio is unavailable or blocked before a user gesture.
 */

type AudioCtor = typeof AudioContext;

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    const Ctor: AudioCtor | undefined =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
    if (!Ctor) return null;
    if (!ctx) ctx = new Ctor();
    return ctx;
}

/** Play a short rising two-tone chime. `kind` shifts the pitch so work↔break boundaries sound distinct. */
export function playChime(kind: 'work' | 'break' = 'work'): void {
    try {
        const audio = getContext();
        if (!audio) return;
        if (audio.state === 'suspended') void audio.resume();

        const now = audio.currentTime;
        const freqs = kind === 'break' ? [660, 880] : [880, 1175];

        freqs.forEach((freq, i) => {
            const osc = audio.createOscillator();
            const gain = audio.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;

            const start = now + i * 0.16;
            const end = start + 0.18;
            gain.gain.setValueAtTime(0.0001, start);
            gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, end);

            osc.connect(gain).connect(audio.destination);
            osc.start(start);
            osc.stop(end + 0.02);
        });
    } catch {
        // best-effort; ignore audio failures
    }
}
