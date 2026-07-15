/**
 * ASCII buddy (v1) — pure frame data, no React. Each activity is a handful of kaomoji frames at a
 * deliberately slow fps (the charm lives at 1–4 fps, not smoothness). Frames are authored as line
 * arrays and normalized onto one global grid — bottom-anchored, right-padded — so the widget keeps
 * a constant footprint and the buddy's feet stay planted across every activity switch.
 */

export type BuddyActivity = 'idle' | 'dance' | 'code' | 'water' | 'workout' | 'swim' | 'plan' | 'sleep';
export type BuddyAnimationName = BuddyActivity | 'pet' | 'celebrate';

export interface BuddyAnimation {
    fps: number;
    /** Normalized frames: identical width and height across ALL animations. */
    frames: string[];
}

const RAW: Record<BuddyAnimationName, { fps: number; frames: string[][] }> = {
    // Sitting contentedly; blinks on the last frame of the cycle.
    idle: {
        fps: 1.5,
        frames: [
            ['(•ᴗ•)', '⊂(_)⊃', ' ∪ ∪'],
            ['(•ᴗ•)', '⊂(_)⊃', ' ∪ ∪'],
            ['(•ᴗ•)', '⊂(_)⊃', ' ∪ ∪'],
            ['(-ᴗ-)', '⊂(_)⊃', ' ∪ ∪'],
        ],
    },
    // Classic kaomoji dance — arms swap sides, the note follows.
    dance: {
        fps: 3,
        frames: [
            ['  ♪', '┏(•ᴗ•)┛', '   / \\'],
            ['      ♪', '┗(•ᴗ•)┓', '   / \\'],
            ['  ♪', '┏(•ᴗ•)┓', '   / \\'],
            ['      ♪', '┗(•ᴗ•)┛', '   / \\'],
        ],
    },
    // Heads-down at the laptop; the screen fills as they type.
    code: {
        fps: 2,
        frames: [
            ['(⌐■_■)', '⊂[▓░░]', ' ·'],
            ['(⌐■_■)', '⊂[▓▓░]', ' ··'],
            ['(⌐■_■)', '⊂[▓▓▓]', ' ···'],
        ],
    },
    // Watering a little plant — it blooms as the engagement runs.
    water: {
        fps: 1.5,
        frames: [
            ['(•ᴗ•)⌐ ˚', '⊂(_)   ✿', ' ∪ ∪  ▔▔'],
            ['(•ᴗ•)⌐', '⊂(_)  ˚✿', ' ∪ ∪  ▔▔'],
            ['(•ᴗ•)⌐ ✧', '⊂(_)   ❀', ' ∪ ∪  ▔▔'],
        ],
    },
    // Jumping jacks.
    workout: {
        fps: 2,
        frames: [
            ['\\(•ᴗ•)/', '  |_|', '  / \\'],
            [' (•ᴗ•)', ' /|_|\\', '  | |'],
        ],
    },
    // Bobbing along the waves — True Rest between sessions.
    swim: {
        fps: 2,
        frames: [
            ['(•ᴗ•)~', '≈~≈~≈~≈'],
            [' (•ᴗ•)~', '~≈~≈~≈~'],
        ],
    },
    // Clipboard in hand, sketching the day (the wizard).
    plan: {
        fps: 1.5,
        frames: [
            ['  ✎', '(•ᴗ•)', '⊂[≡≡]', ' ∪ ∪'],
            ['', '(•ᴗ•)', '⊂[≡_]', ' ∪ ∪'],
            ['  ✎', '(•ᴗ<)', '⊂[≡≡]', ' ∪ ∪'],
        ],
    },
    // Dozing after hours.
    sleep: {
        fps: 1,
        frames: [
            ['   z', '(-ᴗ-)', '⊂(_)⊃', ' ∪ ∪'],
            ['  z Z', '(-ᴗ-)', '⊂(_)⊃', ' ∪ ∪'],
        ],
    },
    // One-shot when a task or habit gets completed — sparkles and a little jump.
    celebrate: {
        fps: 4,
        frames: [
            ['˚ ✦ ˚ ✧', '\\(≧ᴗ≦)/', '  / \\'],
            ['✧ ˚ ✦ ˚', '─(≧ᴗ≦)─', '  / \\'],
            ['✦ ✧ ✦ ✧', '\\(≧ᴗ≦)/', '  / \\'],
        ],
    },
    // One-shot on click — hearts bloom, then back to whatever they were doing.
    pet: {
        fps: 4,
        frames: [
            ['(≧ᴗ≦)', '⊂(_)⊃', ' ∪ ∪'],
            ['  ♡', '(≧ᴗ≦)', '⊂(_)⊃', ' ∪ ∪'],
            [' ♡ ♡', '(≧ᴗ≦)', '⊂(_)⊃', ' ∪ ∪'],
            ['♡ ♡ ♡', '(≧ᴗ≦)', '⊂(_)⊃', ' ∪ ∪'],
        ],
    },
};

// ── Ambient backdrops ─────────────────────────────────────────────────────────
// Static ASCII scenes rendered faintly behind the buddy when the widget is expanded — a little
// diorama per activity. Kept to a handful of shared scenes so the set stays maintainable.

const SCENES = {
    meadow: [
        '    ☼          ~⌒~ ',
        ' ~⌒⌒~              ',
        '          ⌒~⌒      ',
        '                   ',
        ' ✿   ˚        ✿  ˚ ',
        '▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁',
    ],
    garden: [
        '   ☼            ˚  ',
        '        ~⌒~        ',
        '                   ',
        '                   ',
        ' ✿   ❀    ✿   ❀  ✿ ',
        '▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁',
    ],
    sea: [
        '    ☼         ✧    ',
        '         ~⌒~       ',
        '                   ',
        '  ~      ~      ~  ',
        '≈~≈~≈~≈~≈~≈~≈~≈~≈~≈',
        '~≈~≈~≈~≈~≈~≈~≈~≈~≈~',
    ],
    night: [
        '  ☾      ✦      ˚  ',
        '     ˚        ✧    ',
        ' ✧        ✦        ',
        '                   ',
        '      ˚        ✧   ',
        '▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁',
    ],
    study: [
        ' ┌────┐    ┌────┐  ',
        ' │ ≡≡ │    │ ▓░ │  ',
        ' └────┘    └────┘  ',
        '                   ',
        '                   ',
        '▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁',
    ],
} as const;

const SCENE_FOR: Record<BuddyAnimationName, keyof typeof SCENES> = {
    idle: 'meadow',
    dance: 'meadow',
    workout: 'meadow',
    celebrate: 'meadow',
    pet: 'meadow',
    water: 'garden',
    swim: 'sea',
    sleep: 'night',
    code: 'study',
    plan: 'study',
};

export const BACKDROPS = Object.fromEntries(
    (Object.keys(SCENE_FOR) as BuddyAnimationName[]).map((name) => [name, SCENES[SCENE_FOR[name]].join('\n')]),
) as Record<BuddyAnimationName, string>;

const ALL_FRAMES = Object.values(RAW).flatMap((a) => a.frames);
const HEIGHT = Math.max(...ALL_FRAMES.map((f) => f.length));
const WIDTH = Math.max(...ALL_FRAMES.flatMap((f) => f.map((l) => l.length)));

export const ANIMATIONS = Object.fromEntries(
    Object.entries(RAW).map(([name, { fps, frames }]) => [
        name,
        {
            fps,
            frames: frames.map((f) =>
                [...(Array(HEIGHT - f.length).fill('') as string[]), ...f]
                    .map((l) => l.padEnd(WIDTH, ' '))
                    .join('\n'),
            ),
        },
    ]),
) as Record<BuddyAnimationName, BuddyAnimation>;
