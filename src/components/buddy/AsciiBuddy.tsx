import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { ANIMATIONS, BACKDROPS, type BuddyActivity, type BuddyAnimationName } from './animations';
import { useBuddyActivity } from '../../hooks/useBuddyActivity';
import { useDayPlan } from '../../hooks/useDayPlan';

// Device-local cosmetic preferences — deliberately NOT in the synced schema (cf. POMODORO_KEY).
const MIN_KEY = 'orchestrate-buddy-min';
const POS_KEY = 'orchestrate-buddy-pos';
const MODE_KEY = 'orchestrate-buddy-mode';
const PET_MS = 2400;
const CELEBRATE_MS = 3600;
const DANCE_MS = 5000;
const DANCE_GAP_MIN_MS = 25_000;
const DANCE_GAP_JITTER_MS = 20_000;
const EDGE_PAD = 8;
const DRAG_THRESHOLD_PX = 5;

/**
 * Decoration glyphs (notes, hearts, sparkles, plants, waves, screen pixels…) render in the accent
 * green; the buddy itself stays neutral, so the colour reads as garnish rather than a green blob.
 */
const DECOR_CHARS = new Set('♪♡✧✦˚✿❀✎·zZ▓░≈~≡');

function DecoratedFrame({ frame, className }: { frame: string; className: string }) {
    const nodes: ReactNode[] = [];
    let buf = '';
    let accent: boolean = false;
    const flush = () => {
        if (!buf) return;
        nodes.push(accent ? <span key={nodes.length} className="text-accent">{buf}</span> : buf);
        buf = '';
    };
    for (const ch of frame) {
        // Whitespace extends the current run; any other glyph may flip the colour.
        const target: boolean = ch === ' ' || ch === '\n' ? accent : DECOR_CHARS.has(ch);
        if (target !== accent) { flush(); accent = target; }
        buf += ch;
    }
    flush();
    return <span aria-hidden className={`block whitespace-pre text-left font-mono ${className}`}>{nodes}</span>;
}

/** Ambient-view caption per animation — one soft line under the diorama. */
const CAPTIONS: Record<BuddyAnimationName, string> = {
    idle: 'taking it easy',
    dance: 'having a little boogie',
    code: 'pairing with you',
    water: 'tending the garden',
    workout: 'getting the reps in',
    swim: 'true rest — floating a while',
    plan: 'sketching the day with you',
    sleep: 'recharging for tomorrow',
    pet: '♡',
    celebrate: 'nice one!',
};

/** The mode picker: auto (follow the day) plus every activity the user can pin. */
const MODES: { value: BuddyActivity | null; label: string }[] = [
    { value: null, label: 'auto' },
    { value: 'idle', label: 'idle' },
    { value: 'dance', label: 'dance' },
    { value: 'code', label: 'code' },
    { value: 'water', label: 'water' },
    { value: 'workout', label: 'gym' },
    { value: 'swim', label: 'swim' },
    { value: 'plan', label: 'plan' },
    { value: 'sleep', label: 'zzz' },
];
const ACTIVITY_VALUES = new Set(MODES.map((m) => m.value).filter((v): v is BuddyActivity => v != null));

function usePrefersReducedMotion(): boolean {
    const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    useEffect(() => {
        const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
        const onChange = () => setReduced(mq.matches);
        mq.addEventListener('change', onChange);
        return () => mq.removeEventListener('change', onChange);
    }, []);
    return reduced;
}

/** Current frame of the named animation; paused (reduced motion / minimized) holds frame 0. */
function useBuddyFrame(name: BuddyAnimationName, paused: boolean): string {
    const anim = ANIMATIONS[name];
    const stateKey = `${name}:${paused ? 'paused' : 'active'}`;
    const [state, setState] = useState({ key: stateKey, idx: 0 });
    useEffect(() => {
        if (paused) return;
        const id = setInterval(() => {
            setState((prev) => prev.key === stateKey ? { key: stateKey, idx: prev.idx + 1 } : { key: stateKey, idx: 1 });
        }, Math.round(1000 / anim.fps));
        return () => clearInterval(id);
    }, [anim.fps, paused, stateKey]);
    const idx = paused || state.key !== stateKey ? 0 : state.idx % anim.frames.length;
    return anim.frames[idx];
}

type Pos = { left: number; top: number };

/** Keep the widget fully on-screen. */
const clampPos = (left: number, top: number, w: number, h: number): Pos => ({
    left: Math.min(Math.max(left, EDGE_PAD), Math.max(EDGE_PAD, window.innerWidth - w - EDGE_PAD)),
    top: Math.min(Math.max(top, EDGE_PAD), Math.max(EDGE_PAD, window.innerHeight - h - EDGE_PAD)),
});

/**
 * The slice-of-life ASCII companion. Mounted once in App.tsx as a fixed overlay (default
 * bottom-left — toasts own the bottom-right) so it survives route changes without its animation
 * resetting. Activity comes from `useBuddyActivity`, unless the user pins a mode from the widget
 * (persisted device-locally); three one-shots layer on top: a pet burst (click the buddy in the
 * ambient view), a celebration burst when a task or habit completes, and an occasional
 * spontaneous dance while idle.
 *
 * Interactions: drag to move anywhere (position persists), click to expand in place into the
 * **ambient view** — a small diorama with a faint ASCII backdrop behind the buddy, a caption, and
 * the mode picker (click the card background or Esc to shrink back). Hover shows the minimize
 * control. On /focus — the distraction-free surface — it defaults to a minimized chip, expandable
 * per visit without touching the everywhere-else preference.
 */
export function AsciiBuddy() {
    const autoActivity = useBuddyActivity();
    const { plan } = useDayPlan();
    const { pathname } = useLocation();
    const reducedMotion = usePrefersReducedMotion();

    // ── Pinned mode (null = auto) ─────────────────────────────────────────────
    const [override, setOverride] = useState<BuddyActivity | null>(() => {
        try {
            const raw = localStorage.getItem(MODE_KEY) as BuddyActivity | null;
            return raw != null && ACTIVITY_VALUES.has(raw) ? raw : null;
        } catch { return null; }
    });
    const pickMode = (mode: BuddyActivity | null) => {
        setOverride(mode);
        try {
            if (mode == null) localStorage.removeItem(MODE_KEY);
            else localStorage.setItem(MODE_KEY, mode);
        } catch { /* ignore */ }
    };
    const activity = override ?? autoActivity;

    const [persistedMin, setPersistedMin] = useState(() => {
        try { return localStorage.getItem(MIN_KEY) === '1'; } catch { return false; }
    });
    const [focusExpanded, setFocusExpanded] = useState(false);
    const [ambient, setAmbient] = useState(false);
    const onFocusRoute = pathname === '/focus';
    const minimized = onFocusRoute ? !focusExpanded : persistedMin;

    const setMinimized = (min: boolean) => {
        if (onFocusRoute) {
            setFocusExpanded(!min);
        } else {
            setPersistedMin(min);
            try { localStorage.setItem(MIN_KEY, min ? '1' : '0'); } catch { /* ignore */ }
        }
    };

    // ── Position (drag to move; persisted) ───────────────────────────────────
    const [pos, setPos] = useState<Pos | null>(() => {
        try {
            const raw = localStorage.getItem(POS_KEY);
            if (!raw) return null;
            const p = JSON.parse(raw) as Partial<Pos>;
            if (typeof p.left !== 'number' || typeof p.top !== 'number') return null;
            return clampPos(p.left, p.top, 120, 90);
        } catch { return null; }
    });
    const posStyle: CSSProperties = pos ? { left: pos.left, top: pos.top } : { left: 16, bottom: 16 };
    const cardRef = useRef<HTMLDivElement | null>(null);
    const chipRef = useRef<HTMLButtonElement | null>(null);

    const persistPos = (next: Pos) => {
        setPos(next);
        try { localStorage.setItem(POS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    };

    const dragRef = useRef<{
        startX: number; startY: number; baseLeft: number; baseTop: number;
        w: number; h: number; moved: boolean;
    } | null>(null);

    useLayoutEffect(() => {
        if (!pos) return;
        const rect = (minimized ? chipRef.current : cardRef.current)?.getBoundingClientRect();
        if (!rect) return;
        const next = clampPos(pos.left, pos.top, rect.width, rect.height);
        if (next.left !== pos.left || next.top !== pos.top) {
            persistPos(next);
        }
    }, [minimized, ambient, pos]);

    useEffect(() => {
        if (!pos) return;
        const onResize = () => {
            const rect = (minimized ? chipRef.current : cardRef.current)?.getBoundingClientRect();
            if (!rect) return;
            const next = clampPos(pos.left, pos.top, rect.width, rect.height);
            if (next.left !== pos.left || next.top !== pos.top) {
                persistPos(next);
            }
        };
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, [minimized, ambient, pos]);

    /** Shared drag behaviour for the card and the chip; a non-drag release runs `onTap`. */
    const dragHandlers = (onTap: () => void) => ({
        onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
            if (e.button !== 0) return;
            const rect = e.currentTarget.getBoundingClientRect();
            dragRef.current = {
                startX: e.clientX, startY: e.clientY,
                baseLeft: rect.left, baseTop: rect.top,
                w: rect.width, h: rect.height, moved: false,
            };
            e.currentTarget.setPointerCapture(e.pointerId);
        },
        onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
            const d = dragRef.current;
            if (!d) return;
            const dx = e.clientX - d.startX;
            const dy = e.clientY - d.startY;
            if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
            d.moved = true;
            setPos(clampPos(d.baseLeft + dx, d.baseTop + dy, d.w, d.h));
        },
        onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
            const d = dragRef.current;
            dragRef.current = null;
            if (!d) return;
            if (d.moved) {
                const next = clampPos(d.baseLeft + (e.clientX - d.startX), d.baseTop + (e.clientY - d.startY), d.w, d.h);
                persistPos(next);
            } else {
                onTap();
            }
        },
        onPointerCancel: () => {
            dragRef.current = null;
        },
    });

    useEffect(() => {
        if (!ambient) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setAmbient(false); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [ambient]);

    // ── One-shot overlays: pet > celebrate > dance ───────────────────────────
    const [burst, setBurst] = useState<'pet' | 'celebrate' | 'dance' | null>(null);
    const petTimer = useRef<number | undefined>(undefined);
    const celebrateTimer = useRef<number | undefined>(undefined);
    useEffect(() => () => {
        window.clearTimeout(petTimer.current);
        window.clearTimeout(celebrateTimer.current);
    }, []);

    // Celebration: fires when the day's completed count (tasks + habits) goes up. The hide timer
    // lives in a ref so a later effect cleanup can't strand the buddy mid-celebration.
    const completedCount =
        plan.linkedTasks.filter((lt) => lt.completed).length +
        plan.todaysHabits.filter((h) => h.status === 'completed').length;
    const prevCompletedRef = useRef<number | null>(null);
    useEffect(() => {
        const prev = prevCompletedRef.current;
        prevCompletedRef.current = completedCount;
        if (prev == null || completedCount <= prev) return;
        setBurst((b) => (b === 'pet' ? b : 'celebrate'));
        window.clearTimeout(celebrateTimer.current);
        celebrateTimer.current = window.setTimeout(() => setBurst((b) => (b === 'celebrate' ? null : b)), CELEBRATE_MS);
    }, [completedCount]);

    useEffect(() => {
        if (activity !== 'idle' || reducedMotion || minimized) return;
        // Sweep a dance left over from a previous idle spell, then run the spontaneous-dance loop.
        setBurst((b) => (b === 'dance' ? null : b));
        let show: number | undefined;
        let hide: number | undefined;
        const schedule = () => {
            show = window.setTimeout(() => {
                setBurst((b) => b ?? 'dance');
                hide = window.setTimeout(() => {
                    setBurst((b) => (b === 'dance' ? null : b));
                    schedule();
                }, DANCE_MS);
            }, DANCE_GAP_MIN_MS + Math.random() * DANCE_GAP_JITTER_MS);
        };
        schedule();
        return () => { window.clearTimeout(show); window.clearTimeout(hide); };
    }, [activity, reducedMotion, minimized]);

    const pet = () => {
        setBurst('pet');
        window.clearTimeout(petTimer.current);
        petTimer.current = window.setTimeout(() => setBurst((b) => (b === 'pet' ? null : b)), PET_MS);
    };

    // Pet wins (user touch), then celebration, then a dance burst — which only applies while still
    // idling; if an engagement started mid-dance we fall through to the real activity immediately.
    const animName: BuddyAnimationName =
        burst === 'pet' ? 'pet'
            : burst === 'celebrate' ? 'celebrate'
                : burst === 'dance' && activity === 'idle' ? 'dance'
                    : activity;
    const frame = useBuddyFrame(animName, reducedMotion || minimized);

    if (minimized) {
        return (
            <button
                ref={chipRef}
                {...dragHandlers(() => setMinimized(false))}
                style={posStyle}
                className="fixed z-40 w-9 h-9 flex items-center justify-center rounded-full border border-accent/40 bg-card/90 backdrop-blur-sm shadow-sm text-[10px] text-accent hover:border-accent transition-colors cursor-pointer select-none touch-none"
                title="Your buddy is tucked away — click to bring them back"
                aria-label="Expand buddy widget"
            >
                ◕‿◕
            </button>
        );
    }

    const stopPointer = (e: React.PointerEvent) => e.stopPropagation();

    return (
        <div
            ref={cardRef}
            {...dragHandlers(() => setAmbient(!ambient))}
            style={posStyle}
            className="fixed z-40 select-none group touch-none"
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setAmbient(!ambient); }}
            aria-label={ambient ? 'Shrink buddy widget (drag to move)' : 'Expand buddy into ambient view (drag to move)'}
        >
            <div
                className={`relative rounded-xl border bg-card/90 backdrop-blur-sm transition-colors cursor-grab active:cursor-grabbing ${ambient
                    ? 'border-accent/40 shadow-md px-3 pt-3 pb-2.5'
                    : 'border-accent/30 shadow-sm hover:border-accent/60 px-3 py-2'}`}
                title={ambient ? 'Click to shrink · drag to move' : 'Click to expand · drag to move'}
            >
                <button
                    onClick={() => setMinimized(true)}
                    onPointerDown={stopPointer}
                    className="absolute -top-2 -right-2 w-5 h-5 flex items-center justify-center rounded-full border border-border bg-card text-text-light hover:text-accent hover:border-accent opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer text-xs leading-none z-10"
                    title="Tuck the buddy away"
                    aria-label="Minimize buddy widget"
                >
                    −
                </button>

                {ambient ? (
                    <div className="space-y-2">
                        {/* Diorama — faint accent backdrop, buddy front and centre on the ground line */}
                        <div className="relative">
                            <span aria-hidden className="block whitespace-pre text-left font-mono text-[10px] leading-[1.35] text-accent opacity-40">
                                {BACKDROPS[animName]}
                            </span>
                            <button
                                onClick={pet}
                                onPointerDown={stopPointer}
                                className="absolute bottom-0.5 left-1/2 -translate-x-1/2 cursor-pointer"
                                title="Pet"
                                aria-label="Pet your buddy"
                            >
                                <DecoratedFrame frame={frame} className="text-[13px] leading-[1.2] text-text" />
                            </button>
                        </div>
                        <p className="text-[9px] uppercase tracking-[0.18em] text-text-light text-center">
                            {CAPTIONS[animName]}{override != null && ' · pinned'}
                        </p>
                        {/* Mode picker — pin an activity, or auto to follow the day */}
                        <div className="flex flex-wrap justify-center gap-1" onPointerDown={stopPointer}>
                            {MODES.map((m) => {
                                const active = override === m.value;
                                return (
                                    <button
                                        key={m.label}
                                        onClick={() => pickMode(m.value)}
                                        className={`px-1.5 py-0.5 rounded-full border text-[9px] leading-none transition-colors cursor-pointer ${active
                                            ? 'border-accent bg-accent/10 text-accent'
                                            : 'border-border text-text-light hover:text-accent hover:border-accent'}`}
                                        title={m.value == null ? 'Follow the day automatically' : `Pin ${m.label}`}
                                    >
                                        {m.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                ) : (
                    <DecoratedFrame frame={frame} className="text-[11px] leading-[1.2] text-text-light" />
                )}
            </div>
        </div>
    );
}
