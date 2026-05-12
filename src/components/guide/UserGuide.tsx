import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Logo } from '../ui/Logo';
import { ThemeToggle } from '../ui/ThemeToggle';

/**
 * v6 User Guide — mental model and how-to for the three execution pathways
 * (Deep Track / Stabilizer / Light Pool) plus manual background, True Rest,
 * and capacity arithmetic. Mirrors docs/user-guide.md.
 */
export function UserGuide() {
    const navigate = useNavigate();
    return (
        <div className="min-h-screen flex flex-col">
            <header className="px-6 py-4 border-b border-border">
                <div className="max-w-5xl mx-auto flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Link
                            to="/"
                            className="text-xl font-semibold text-accent flex items-center gap-2"
                        >
                            <Logo />
                            Orchestrate
                        </Link>
                        <span className="text-text-light text-sm">/</span>
                        <span className="text-sm text-text-light">User Guide</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => navigate('/')}
                            className="text-sm text-text-light hover:text-accent cursor-pointer"
                        >
                            Back to Dashboard
                        </button>
                        <ThemeToggle />
                    </div>
                </div>
            </header>

            <main className="flex-1 px-6 py-8">
                <div className="max-w-4xl mx-auto">
                    <Intro />
                    <TableOfContents />

                    <Section id="big-picture" title="1. The big picture">
                        <p>
                            Orchestrate models the day in <strong>two persistence layers</strong> and surfaces work
                            through <strong>three execution pathways</strong> plus a non-task recovery track.
                        </p>
                        <Flow>{`                    LifeContext (durable, multi-day)
                   ┌────────────────────────────────┐
                   │  Seasons  ·  Habits (kind: …)  │
                   └─────────────┬──────────────────┘
                                 │   habit-derived
                                 ▼
                    DayPlan (today only, auto-resets)
                   ┌────────────────────────────────┐
                   │  Intentions  ·  LinkedTasks    │
                   │  taskSessions  ·  habitLog     │
                   │  checkIns                      │
                   └────────────────────────────────┘

      Pathway A: Deep Track      → Main task in a session
      Pathway B: Stabilizer      → Auto-injected intention → background task in sessions
      Pathway C: Light Pool      → Logged-only HabitLogEntry, never enters task graph

      + Manual background        → Small today-only nudges inside an intention
      + True Rest                → Static recovery cues (no logging, no completion)
      + Capacity                 → Advisory arithmetic surrounding all of the above`}</Flow>
                    </Section>

                    <Section id="layers" title="2. Two persistence layers">
                        <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
                            <thead className="bg-surface-dark text-left">
                                <tr>
                                    <th className="px-3 py-2 font-medium">Layer</th>
                                    <th className="px-3 py-2 font-medium">localStorage key</th>
                                    <th className="px-3 py-2 font-medium">Lifetime</th>
                                </tr>
                            </thead>
                            <tbody>
                                <Tr>
                                    <Td><strong>LifeContext</strong></Td>
                                    <Td><Code>orchestrate-life-context</Code></Td>
                                    <Td>Durable. Survives daily resets. Holds Seasons + Habits + active-season pointer.</Td>
                                </Tr>
                                <Tr>
                                    <Td><strong>DayPlan</strong></Td>
                                    <Td><Code>orchestrate-day-plan</Code></Td>
                                    <Td>Auto-resets when the date changes. Holds today's Intentions, LinkedTasks, session assignments, check-ins, and the v6 <Code>habitLog</Code>.</Td>
                                </Tr>
                            </tbody>
                        </table>
                        <p className="text-text-light">
                            User preferences (capacity defaults, session slots, encrypted Todoist token) live in their
                            own durable <Code>orchestrate-settings</Code> key.
                        </p>
                    </Section>

                    <Section id="habit-entity" title="3. The Habit entity">
                        <p>
                            A <strong>Habit</strong> is a durable recurring entity in <Code>LifeContext</Code>. It
                            has two <em>orthogonal</em> classifications:
                        </p>
                        <ul className="list-disc pl-5 space-y-1">
                            <li><Code>kind: 'stabilizer' | 'light-coherent'</Code> — drives <strong>behavior</strong>.</li>
                            <li><Code>isAnchor: boolean</Code> — drives <strong>protection</strong>.</li>
                        </ul>
                        <p>
                            …plus the usual fields: <Code>recurrence</Code>, <Code>minimumViable</Code>,{' '}
                            <Code>triggerCue</Code>, <Code>completionRule</Code>, <Code>failureTolerance</Code>,{' '}
                            <Code>seasonIds</Code>, <Code>active</Code>, <Code>autoLinkTodoistId?</Code>,{' '}
                            <Code>maxBlockMinutes?</Code>.
                        </p>
                        <Callout tone="info">
                            <Code>kind</Code> and <Code>isAnchor</Code> answer different questions; you can mix
                            them freely. See <Link to="#stabilizer-vs-anchor" className="text-accent hover:underline">§6</Link>.
                        </Callout>
                    </Section>

                    <Section id="pathways" title="4. The three execution pathways">
                        <p>
                            Each pathway is a different route from intent to action. Pick by use case, not by reflex.
                        </p>

                        <SubHeading id="pathway-a">4.1 Pathway A — Deep Track (Main task)</SubHeading>
                        <Flow>{`You create an Intention manually
  → map a Todoist task to it in Step 1
  → categorize 'main' in Step 2 (no cap)
  → assign to ONE session in Step 3 (exclusive)
  → execute; completion writes back to Todoist`}</Flow>
                        <p><strong>For:</strong> sustained, focused, today-specific work threads. The "primary intellectual pursuit" of the day.</p>
                        <ExampleList heading="Examples">
                            <li><em>"Implement the v6 capacity arithmetic"</em> — coding intention, 2hr estimate.</li>
                            <li><em>"Finish chapter 3 of the textbook"</em> — study intention, 90 min estimate.</li>
                            <li><em>"Draft the project proposal"</em> — writing intention, 60 min estimate.</li>
                            <li><em>"Refactor authentication module"</em> — code intention, 3hr estimate (consider breaking down — wizard will nudge above 60 min).</li>
                            <li><em>"Read paper X end-to-end and write summary"</em> — research intention, 75 min estimate.</li>
                        </ExampleList>
                        <p className="text-text-light"><strong>Signature:</strong> big enough to need a dedicated session block; specific to today.</p>

                        <SubHeading id="pathway-b">4.2 Pathway B — Stabilizer ritual</SubHeading>
                        <Flow>{`Habit { kind: 'stabilizer', active, recurrence matches today }
  → INJECT_HABIT_INTENTIONS at Step 1 entry creates an Intention { sourceHabitId }
  → user maps a Todoist task (or autoLinkTodoistId pre-fills)
  → LINK_TASK forces LinkedTask.type = 'background' (locked, cannot change in Step 2)
  → assigned to one or many sessions in Step 3
  → Step 2 cap = habit.maxBlockMinutes ?? taskCapDefaults.stabilizer (30 min default)`}</Flow>
                        <p><strong>For:</strong> anchor-style rituals that need to live in a slot and have protection. The "non-negotiables" and "important recurring practices."</p>
                        <ExampleList heading="Anchor stabilizers — the foundation">
                            <li><em>Morning meditation</em> — daily, 5–15 min, <Code>autoLinkTodoistId</Code> set to a recurring Todoist task.</li>
                            <li><em>Sleep wind-down</em> — daily, evening slot.</li>
                            <li><em>Gym workout</em> — Mon/Wed/Fri, 45 min <Code>maxBlockMinutes</Code>.</li>
                            <li><em>Evening shutdown ritual</em> — daily, 10 min.</li>
                            <li><em>Take medication</em> — daily, 5 min (binary completion).</li>
                        </ExampleList>
                        <ExampleList heading="Non-anchor stabilizers — recurring but not foundational">
                            <li><em>Daily standup attendance</em> — weekdays, 15 min.</li>
                            <li><em>Daily journal</em> — daily, 10 min.</li>
                            <li><em>Evening planning ritual</em> — daily, 15 min.</li>
                            <li><em>Weekly review</em> — weekly (Sunday), 30–45 min.</li>
                        </ExampleList>
                        <p className="text-text-light"><strong>Signature:</strong> recurs on a schedule; you want to be reminded daily; deserves a slot in the day.</p>

                        <SubHeading id="pathway-c">4.3 Pathway C — Light Pool (logged-only)</SubHeading>
                        <Flow>{`Habit { kind: 'light-coherent', active, recurrence matches today, season-scoped }
  → getLightPoolHabits filters today's pool
  → surfaces in LightPoolPanel (Dashboard) + LightPoolSection (/life)
  → also surfaced in CheckInModal when feeling/work-type indicates low resources
  → user clicks Start → LOG_HABIT_START writes a HabitLogEntry to plan.habitLog
  → user clicks Done → LOG_HABIT_COMPLETE fills completedAt + durationMinutes
  → NEVER becomes an Intention. NEVER becomes a LinkedTask. NEVER touches taskSessions.`}</Flow>
                        <p><strong>For:</strong> the "Light Coherent Track" — small, resumable, coherent activities you pull from during micro-gaps. Replaces the impulse to open YouTube or Hacker News.</p>
                        <ExampleList heading="Season-scoped — tied to current focus">
                            <li><em>Anki / flashcard review</em> — during a learning season (e.g., "Spanish sprint", "Algorithms refresh").</li>
                            <li><em>Read one section of [current technical book]</em> — during a "Systems study" season.</li>
                            <li><em>Practice scales (10 min)</em> — during a music-learning season.</li>
                            <li><em>Sketch one figure</em> — during an "art practice" season.</li>
                            <li><em>Re-skim morning notes</em> — during a research-heavy season.</li>
                        </ExampleList>
                        <ExampleList heading="Season-agnostic — general novelty / curiosity">
                            <li><em>Idea capture / freewrite</em> — 5 min brain dump.</li>
                            <li><em>Read one essay from current queue</em> — general reading habit.</li>
                            <li><em>Duolingo session</em> — ambient language drill.</li>
                            <li><em>Walk + audio note</em> — thinking time.</li>
                            <li><em>Review a Pocket / Instapaper save</em> — light input.</li>
                        </ExampleList>
                        <p className="text-text-light"><strong>Signature:</strong> small (≤ 20 min default), resumable, opportunistic. You pull when you have a gap, not on a schedule. Cadence is loose (<Code>timesPerWeek</Code> soft target).</p>

                        <SubHeading id="manual-background">4.4 Manual background tasks (the fourth pathway, lighter-weight)</SubHeading>
                        <Flow>{`You create an Intention manually
  → map a Todoist task in Step 1
  → categorize 'background' in Step 2 (cap = taskCapDefaults.manualBackground, default 30 min)
  → assign to one or many sessions in Step 3`}</Flow>
                        <p>Not from a Habit. Today-specific. Small. Tied to an intention.</p>
                        <p><strong>For:</strong> small one-off nudges that should be visible in the day's plan but shouldn't crowd a session.</p>
                        <ExampleList heading="Examples">
                            <li><em>"Reply to recruiter email"</em> — under a job-search intention.</li>
                            <li><em>"Push WIP commit before lunch"</em> — under a coding intention; small but you want it in a slot.</li>
                            <li><em>"Schedule dentist appointment"</em> — today's logistics, one-off.</li>
                            <li><em>"Send invoice for Q1 contract"</em> — under a freelance intention.</li>
                            <li><em>"Skim the arxiv paper Alice sent"</em> — under a research intention; not primary reading, but you want it visible.</li>
                            <li><em>"Print parking pass for tomorrow"</em> — admin one-off.</li>
                            <li><em>"Drink 2L water"</em> — multi-session nudge; assigned to 2–3 sessions.</li>
                            <li><em>"Stretch between sessions"</em> — multi-session nudge.</li>
                            <li><em>"Reply to PR review comments"</em> — under the same intention as the feature work.</li>
                        </ExampleList>
                        <Callout tone="info">
                            <strong>Decision rule vs. light-coherent:</strong>{' '}
                            If it <em>recurs</em> (you'd want it back next week) → make it a light-coherent Habit. If
                            it's <em>just for today</em> and tied to an intention → manual background.
                        </Callout>
                    </Section>

                    <Section id="true-rest" title="5. True Rest (the fifth surface, not a pathway)">
                        <p>
                            True Rest is <strong>not</strong> in any of the three pathways. It's a fourth layer:
                            non-task, non-logged, non-tracked recovery cues.
                        </p>
                        <ul className="list-disc pl-5 space-y-1.5">
                            <li><strong>Source:</strong> static catalog (~8 cues across <em>physical / breath / sensory</em>).</li>
                            <li>
                                <strong>Three surfaces:</strong>
                                <ol className="list-decimal pl-5 mt-1 space-y-0.5">
                                    <li><strong>Dashboard side rail</strong> (<Code>variant=&apos;card&apos;</Code>, rotates every 5 min) — always visible.</li>
                                    <li><strong>Check-in modal</strong> (<Code>variant=&apos;inline&apos;</Code>) — when feeling is struggling/stuck or workType is low-energy/restless.</li>
                                    <li><strong>Between-session banner</strong> (<Code>variant=&apos;banner&apos;</Code>) — when the next session starts within 60 min.</li>
                                </ol>
                            </li>
                            <li><strong>Catalog examples:</strong> <em>Walk 5 minutes</em>, <em>Box-breath</em>, <em>Eyes closed — no input</em>, <em>Window-gaze</em>, <em>Long-exhale breathing</em>, <em>Drink a full glass of water</em>, <em>Stretch</em>, <em>Sit in silence</em>.</li>
                        </ul>
                        <Callout tone="info">
                            <strong>Why separate from light-coherent?</strong> The point of True Rest is{' '}
                            <em>no cognitive load</em>. No decision to log, no checkbox, no streak. If you wanted to
                            log a walk, you'd model it as a light-coherent Habit. True Rest is the deliberately
                            untracked corner.
                        </Callout>
                    </Section>

                    <Section id="stabilizer-vs-anchor" title="6. Stabilizer vs Anchor — orthogonal classifications">
                        <p>They look overlapping. They aren't.</p>
                        <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
                            <thead className="bg-surface-dark text-left">
                                <tr>
                                    <th className="px-3 py-2 font-medium">Flag</th>
                                    <th className="px-3 py-2 font-medium">Question it answers</th>
                                    <th className="px-3 py-2 font-medium">What it controls</th>
                                </tr>
                            </thead>
                            <tbody>
                                <Tr>
                                    <Td><Code>kind: 'stabilizer'</Code></Td>
                                    <Td><strong>What behavior</strong> does this habit have?</Td>
                                    <Td>Auto-injects as intention; locks the linked task to <Code>background</Code> in Step 2.</Td>
                                </Tr>
                                <Tr>
                                    <Td><Code>isAnchor: true</Code></Td>
                                    <Td><strong>How protected</strong> is it?</Td>
                                    <Td>Cannot be deleted while active. <Code>DELETE_HABIT</Code> no-ops; UI offers "deactivate first." Surfaced as the "anchor habits" set on <Code>/life</Code> and the Welcome Life card.</Td>
                                </Tr>
                            </tbody>
                        </table>

                        <p className="mt-4">All four combinations are meaningful:</p>
                        <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
                            <thead className="bg-surface-dark text-left">
                                <tr>
                                    <th className="px-3 py-2 font-medium"><Code>kind</Code></th>
                                    <th className="px-3 py-2 font-medium"><Code>isAnchor</Code></th>
                                    <th className="px-3 py-2 font-medium">Use case</th>
                                    <th className="px-3 py-2 font-medium">Examples</th>
                                </tr>
                            </thead>
                            <tbody>
                                <Tr>
                                    <Td><Code>stabilizer</Code></Td>
                                    <Td><Code>true</Code></Td>
                                    <Td>The foundation. Non-negotiable; the day collapses without it.</Td>
                                    <Td>Sleep wind-down, morning meditation, gym, evening shutdown, medication.</Td>
                                </Tr>
                                <Tr>
                                    <Td><Code>stabilizer</Code></Td>
                                    <Td><Code>false</Code></Td>
                                    <Td>Recurring ritual that you want injected daily, but might retire without ceremony.</Td>
                                    <Td>Daily standup attendance, daily journal, evening planning.</Td>
                                </Tr>
                                <Tr>
                                    <Td><Code>light-coherent</Code></Td>
                                    <Td><Code>true</Code></Td>
                                    <Td>Unusual but valid — a micro-gap practice you want protection on.</Td>
                                    <Td>Long-form weekly reading you don't want to delete on a whim.</Td>
                                </Tr>
                                <Tr>
                                    <Td><Code>light-coherent</Code></Td>
                                    <Td><Code>false</Code></Td>
                                    <Td>The typical Light Pool fare.</Td>
                                    <Td>Flashcards, idea capture, language drills, sketches.</Td>
                                </Tr>
                            </tbody>
                        </table>

                        <Callout tone="success">
                            <strong>Mental model.</strong>{' '}
                            <Code>isAnchor</Code> answers <em>"which habits, if dropped, would let the day collapse?"</em> —
                            a strictly smaller subset than stabilizer.{' '}
                            <Code>kind</Code> answers <em>"how does this habit surface — slotted-and-scheduled, or
                            pulled-from-a-pool?"</em>
                        </Callout>
                    </Section>

                    <Section id="anchor-stabilizer-seasons" title="7. Anchors, Stabilizers, and Seasons — how they interact">
                        <p>
                            <Code>Habit.seasonIds: string[]</Code> is the third axis. Three rules govern how it
                            composes with the previous two:
                        </p>
                        <ol className="list-decimal pl-5 space-y-1">
                            <li><Code>seasonIds: []</Code> means <strong>always-on</strong>. The habit appears regardless of which season is active.</li>
                            <li><Code>seasonIds: [X]</Code> means <strong>season-scoped</strong>. The habit only enters today's pool / auto-injection when season X is active.</li>
                            <li><strong>Season membership doesn't change <Code>kind</Code> or <Code>isAnchor</Code>.</strong> Habits keep their classifications across seasons.</li>
                        </ol>

                        <SubHeading id="always-on-anchor">7.1 The "always-on anchor" principle</SubHeading>
                        <p>
                            <strong>Anchors should generally be season-agnostic</strong>{' '}
                            (<Code>seasonIds: []</Code>). Why? Because anchors are the foundation. If you lose your
                            sleep anchor when switching from "Degree Push" to "Stabilization" season, that's a bug —
                            the anchor <em>is</em> the foundation across all seasons. Sleep, meditation, gym,
                            shutdown survive every season change.
                        </p>
                        <p>
                            Conversely, <strong>season-scoped habits should generally not be anchors.</strong>{' '}
                            The season ending naturally retires them — protection is overkill and creates friction
                            at season transitions.
                        </p>

                        <SubHeading id="four-combinations">7.2 The four useful combinations</SubHeading>
                        <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
                            <thead className="bg-surface-dark text-left">
                                <tr>
                                    <th className="px-3 py-2 font-medium"><Code>kind</Code></th>
                                    <th className="px-3 py-2 font-medium"><Code>isAnchor</Code></th>
                                    <th className="px-3 py-2 font-medium"><Code>seasonIds</Code></th>
                                    <th className="px-3 py-2 font-medium">What it represents</th>
                                </tr>
                            </thead>
                            <tbody>
                                <Tr>
                                    <Td><Code>stabilizer</Code></Td>
                                    <Td><Code>true</Code></Td>
                                    <Td><Code>[]</Code></Td>
                                    <Td><strong>The foundation.</strong> Sleep, meditation, gym, shutdown. Cross-season. Most users have 3–6 of these.</Td>
                                </Tr>
                                <Tr>
                                    <Td><Code>stabilizer</Code></Td>
                                    <Td><Code>false</Code></Td>
                                    <Td><Code>[seasonId]</Code></Td>
                                    <Td><strong>A season's ritual.</strong> Daily research log during a "Research push" season; daily writing during a "Drafting" season. Auto-injects while the season is active; quietly retires when the season ends.</Td>
                                </Tr>
                                <Tr>
                                    <Td><Code>light-coherent</Code></Td>
                                    <Td><Code>false</Code></Td>
                                    <Td><Code>[seasonId]</Code></Td>
                                    <Td><strong>A season's micro-practice.</strong> Spanish flashcards during a "Language sprint"; algorithms drills during an "Interview prep" season. Surfaces in the Light Pool only while that season is active.</Td>
                                </Tr>
                                <Tr>
                                    <Td><Code>light-coherent</Code></Td>
                                    <Td><Code>false</Code></Td>
                                    <Td><Code>[]</Code></Td>
                                    <Td><strong>Novelty / curiosity.</strong> General reading, idea capture, ambient practices that aren't tied to any one season. Survives every season change.</Td>
                                </Tr>
                            </tbody>
                        </table>

                        <SubHeading id="season-lifecycle">7.3 Season activation lifecycle</SubHeading>
                        <p>When you activate season Y:</p>
                        <ul className="list-disc pl-5 space-y-1">
                            <li>Habits with <Code>seasonIds: [Y, …]</Code> start appearing in Today's plan (stabilizers) or Light Pool (light-coherent).</li>
                            <li>Habits with <Code>seasonIds: [X]</Code> (previous season) disappear from Today's view but are not deleted. They sit dormant in the habit library; reactivating season X brings them back.</li>
                            <li>Habits with <Code>seasonIds: []</Code> (always-on) ride through unchanged.</li>
                            <li>Anchors are protected from deletion regardless of season — even between seasons.</li>
                        </ul>
                        <Callout tone="success">
                            <strong>Practical implication.</strong> When designing a new season, you create three buckets:
                            (1) the <strong>stabilizer rituals</strong> that define its daily structure;
                            (2) the <strong>light-coherent micro-practices</strong> that support it;
                            (3) leave existing <strong>anchor stabilizers always-on</strong> — don't reattach them to the season.
                        </Callout>
                    </Section>

                    <Section id="capacity" title="8. Session capacity (advisory)">
                        <p>Surrounds the three pathways. Pure utility, never gates.</p>
                        <ul className="list-disc pl-5 space-y-1.5">
                            <li><strong>Computation:</strong> <Code>totalMinutes = sessionLength − sessionBufferMinutes</Code>. <Code>assignedMinutes = Σ estimatedMinutes</Code> for tasks in the session. Background tasks count <em>once per assignment</em>.</li>
                            <li><strong>Status thresholds:</strong> <Code>ok</Code> &lt; 100%, <Code>tight</Code> ≥ 100%, <Code>over</Code> &gt; 150%.</li>
                            <li><strong>Mid-session:</strong> <Code>totalMinutes</Code> shrinks to remaining wall-clock; buffer shrinks proportionally. The badge ticks down as the day moves.</li>
                            <li><strong>Where it shows:</strong> Step 3 timeline (per-session badge + over-capacity banner) and Dashboard <strong>Current Session</strong> (remaining-time pill + banner if over).</li>
                            <li><strong>Never blocks.</strong> Even at 200% the wizard advances. Visibility &gt; prevention.</li>
                            <li><strong>Light Pool entries are excluded</strong> from the arithmetic — they're outside the task graph.</li>
                        </ul>
                        <p className="mt-3"><strong>How to read the badge:</strong></p>
                        <ul className="list-none pl-1 space-y-1">
                            <li><span className="inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded-full border whitespace-nowrap bg-surface-dark text-text-light border-border">47/120 min</span> <span className="text-text-light">— <Code>ok</Code>: you have headroom.</span></li>
                            <li><span className="inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded-full border whitespace-nowrap bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700">130/120 min</span> <span className="text-text-light">— <Code>tight</Code>: at or just over capacity. Likely fine if estimates are conservative.</span></li>
                            <li><span className="inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded-full border whitespace-nowrap bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-red-300 dark:border-red-700">200/120 min</span> <span className="text-text-light">— <Code>over</Code>: meaningfully overcommitted. Consider moving a task, breaking one down, or accepting some won't land.</span></li>
                        </ul>
                    </Section>

                    <Section id="check-in" title="9. The check-in as decision point">
                        <p>The hourly check-in is where the system reads your state and offers the right pathway.</p>
                        <ul className="list-disc pl-5 space-y-1.5">
                            <li><Code>feeling: 'great'</Code> + on track → no extra surfacing. Stay in Pathway A.</li>
                            <li><Code>workType: 'low-energy' | 'restless'</Code> OR <Code>feeling: 'struggling' | 'stuck'</Code> → modal surfaces <strong>1–2 Light Pool rows</strong> (Pathway C) + a <strong>True Rest cue</strong>. You pick: a smaller move or a real reset.</li>
                            <li><Code>feeling: 'stuck'</Code> → adds the <strong>"What exactly are you avoiding?"</strong> capture (persisted as <Code>CheckIn.avoidanceNote</Code>). Feeds later pattern-spotting.</li>
                        </ul>
                        <p>
                            Capacity status feeds in passively — if the current session is <Code>over</Code>, the
                            Dashboard banner is already visible above this same check-in, contextualizing why
                            "struggling" might be more than psychological.
                        </p>
                    </Section>

                    <Section id="decision-tree" title='10. Decision tree — "I want to add X to my day"'>
                        <Flow>{`Is X a non-task recovery move (walk, breath, gaze)?
├─ YES → Don't model it. True Rest will surface organically.
│        If you find yourself wanting to log it, that's the signal
│        it should be a light-coherent habit instead.
└─ NO ↓

Is X today-only?
├─ YES ↓
│   Is X your primary work thread for the day?
│   ├─ YES → Pathway A: create an Intention, map task, categorize 'main'.
│   └─ NO  → Pathway A or D: create the Intention if it's new,
│            or add this as a 'background' LinkedTask under an existing intention.
│
└─ NO  (X is recurring) ↓
    Does X need a slot in the day to anchor your structure?
    ├─ YES → Pathway B: create a Habit { kind: 'stabilizer' }.
    │        Set isAnchor = true ONLY if dropping it would let the day collapse.
    │        Set seasonIds = [] for always-on, [seasonId] for season-scoped.
    └─ NO  (X is opportunistic, pulled when you have a gap)
        → Pathway C: create a Habit { kind: 'light-coherent' }.
          Set seasonIds = [seasonId] if X is tied to current focus,
          [] for general novelty / curiosity practices.`}</Flow>
                    </Section>

                    <Section id="typical-day" title="11. A typical day, in pathways">
                        <p>A concrete walk-through to anchor the model.</p>

                        <SubHeading>Setup (LifeContext, durable)</SubHeading>
                        <ul className="list-disc pl-5 space-y-1">
                            <li>Active season: <em>"Stabilization Q2"</em> — primary theme: sleep + planning consistency + degree groundwork.</li>
                            <li>Anchor stabilizers (always-on, <Code>seasonIds: []</Code>): <em>Morning meditation</em>, <em>Gym (M/W/F)</em>, <em>Sleep wind-down</em>, <em>Evening shutdown</em>.</li>
                            <li>Season stabilizer (<Code>seasonIds: ['stabilization-q2']</Code>): <em>Daily 15-min planning ritual</em>.</li>
                            <li>Season light-coherent (<Code>seasonIds: ['stabilization-q2']</Code>): <em>Read one section of [current systems book]</em>, <em>Algorithms warm-up (one easy problem)</em>.</li>
                            <li>Always-on light-coherent (<Code>seasonIds: []</Code>): <em>Idea capture freewrite</em>, <em>Duolingo session</em>.</li>
                        </ul>

                        <SubHeading>Step 1 — Intentions (Wizard)</SubHeading>
                        <ul className="list-disc pl-5 space-y-1">
                            <li>Auto-injected (stabilizer pathway): <em>Morning meditation</em>, <em>Gym</em>, <em>Daily planning ritual</em>. Each carries the 🔁 Habit badge + "Skip for today" option.</li>
                            <li>User-added (deep track): <em>"Finish v6 capacity arithmetic"</em>, <em>"Read paper on session scheduling"</em>.</li>
                            <li>Light-coherent habits do <strong>not</strong> appear here.</li>
                        </ul>

                        <SubHeading>Step 2 — Refine</SubHeading>
                        <ul className="list-disc pl-5 space-y-1">
                            <li><em>Morning meditation</em> → background, locked, capped at 15 min (<Code>habit.maxBlockMinutes</Code>).</li>
                            <li><em>Gym</em> → background, locked, capped at 45 min.</li>
                            <li><em>Daily planning ritual</em> → background, locked, capped at 30 min (per-kind default).</li>
                            <li><em>Finish v6 capacity arithmetic</em> → main, 120 min.</li>
                            <li><em>Read paper on session scheduling</em> → main, 60 min.</li>
                            <li>User adds a manual background under the v6 intention: <em>"Push WIP commit before lunch"</em>, 10 min.</li>
                        </ul>

                        <SubHeading>Step 3 — Schedule</SubHeading>
                        <ul className="list-disc pl-5 space-y-1">
                            <li>Early morning: <em>Morning meditation</em> + <em>Gym</em>.</li>
                            <li>Morning: <em>Finish v6 capacity arithmetic</em> (main).</li>
                            <li>Afternoon: <em>Read paper</em> (main) + <em>Daily planning ritual</em> + <em>Push WIP commit</em> (background).</li>
                            <li>Night: <em>Evening shutdown</em>.</li>
                        </ul>
                        <p className="text-text-light text-sm">
                            Capacity badge shows the morning session is <Code>tight</Code> at 110% — advisory, user proceeds.
                        </p>

                        <SubHeading>During the day</SubHeading>
                        <ul className="list-disc pl-5 space-y-1">
                            <li>Light Pool panel lists <em>Read one section</em>, <em>Algorithms warm-up</em>, <em>Idea capture</em>, <em>Duolingo</em>. User pulls <em>Algorithms warm-up</em> between sessions — Start logged, completed 12 min later. Writes to <Code>plan.habitLog</Code>. Does not touch task graph.</li>
                            <li>Between-session True Rest banner: <em>"Walk 5 minutes — outside if possible."</em> No tracking.</li>
                            <li>14:00 check-in: <Code>feeling: 'struggling'</Code>, <Code>workType: 'low-energy'</Code>. Modal surfaces 1–2 Light Pool rows + a True Rest cue (<em>"Long-exhale breathing — 3 min"</em>). User picks the True Rest, then resumes Pathway A.</li>
                            <li>15:00 check-in: <Code>feeling: 'stuck'</Code>. Avoidance prompt: <em>"What exactly are you avoiding?"</em> → user types <em>"The paper's math section — I don't have the prerequisites yet"</em>. Persisted on the check-in.</li>
                        </ul>

                        <SubHeading>End of day</SubHeading>
                        <ul className="list-disc pl-5 space-y-1">
                            <li>Stabilizer tasks: 3/3 completed (recorded as LinkedTask completions, syncs to Todoist).</li>
                            <li>Main tasks: 1.5/2 completed.</li>
                            <li>Light Pool log: 2 entries (algorithms warm-up done, Duolingo done; flashcards and reading skipped today).</li>
                            <li>True Rest surfaced but not tracked.</li>
                        </ul>
                    </Section>

                    <Section id="quick-reference" title="12. Quick reference — what goes where">
                        <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
                            <thead className="bg-surface-dark text-left">
                                <tr>
                                    <th className="px-3 py-2 font-medium">You want to model…</th>
                                    <th className="px-3 py-2 font-medium">Use…</th>
                                </tr>
                            </thead>
                            <tbody>
                                <Tr><Td>A today-only big work thread</Td><Td>Main task (Pathway A)</Td></Tr>
                                <Tr><Td>A recurring ritual that needs a slot</Td><Td>Stabilizer Habit (Pathway B). Add <Code>isAnchor: true</Code> if foundational.</Td></Tr>
                                <Tr><Td>A small recurring practice you pull opportunistically</Td><Td>Light-coherent Habit (Pathway C)</Td></Tr>
                                <Tr><Td>A today-only small chore tied to an intention</Td><Td>Manual background task</Td></Tr>
                                <Tr><Td>A non-task recovery prompt</Td><Td>Don't model. True Rest covers it.</Td></Tr>
                                <Tr><Td>A practice tied to a specific focus period</Td><Td>Light-coherent Habit with <Code>seasonIds: [seasonId]</Code></Td></Tr>
                                <Tr><Td>A foundational habit that survives season changes</Td><Td>Stabilizer Habit with <Code>isAnchor: true</Code>, <Code>seasonIds: []</Code></Td></Tr>
                            </tbody>
                        </table>
                    </Section>

                    <div className="mt-12 pt-6 border-t border-border flex items-center justify-between text-sm">
                        <button
                            onClick={() => navigate('/')}
                            className="text-accent hover:underline cursor-pointer"
                        >
                            ← Back to Dashboard
                        </button>
                        <span className="text-text-light">
                            Reflects v6. See <Link to="/life" className="text-accent hover:underline">/life</Link> to manage your seasons and habits.
                        </span>
                    </div>
                </div>
            </main>
        </div>
    );
}

// ─── Inline helpers ───────────────────────────────────────────────────────────

function Intro() {
    return (
        <div className="rounded-lg bg-accent-subtle border-l-4 border-accent p-4 mb-6">
            <p className="text-sm text-text leading-relaxed">
                A mental-model + how-to guide for the entities Orchestrate uses to model your day:{' '}
                <strong>Habits</strong> (stabilizer / light-coherent), <strong>Intentions</strong>,{' '}
                <strong>LinkedTasks</strong> (main / background), the <strong>Light Pool</strong>,{' '}
                <strong>True Rest</strong>, and <strong>Capacity</strong>. Use this as your quick reference.
            </p>
        </div>
    );
}

const TOC_ENTRIES: { id: string; label: string }[] = [
    { id: 'big-picture',             label: '1. The big picture' },
    { id: 'layers',                  label: '2. Two persistence layers' },
    { id: 'habit-entity',            label: '3. The Habit entity' },
    { id: 'pathways',                label: '4. The three execution pathways' },
    { id: 'true-rest',               label: '5. True Rest' },
    { id: 'stabilizer-vs-anchor',    label: '6. Stabilizer vs Anchor' },
    { id: 'anchor-stabilizer-seasons', label: '7. Anchors, Stabilizers, Seasons' },
    { id: 'capacity',                label: '8. Session capacity' },
    { id: 'check-in',                label: '9. The check-in as decision point' },
    { id: 'decision-tree',           label: '10. Decision tree' },
    { id: 'typical-day',             label: '11. A typical day' },
    { id: 'quick-reference',         label: '12. Quick reference' },
];

function TableOfContents() {
    return (
        <nav className="rounded-lg border border-border bg-card p-4 mb-8">
            <p className="text-[11px] uppercase tracking-wider text-text-light mb-2">Contents</p>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-y-1 gap-x-4 text-sm">
                {TOC_ENTRIES.map((e) => (
                    <li key={e.id}>
                        <a href={`#${e.id}`} className="text-accent hover:underline">
                            {e.label}
                        </a>
                    </li>
                ))}
            </ul>
        </nav>
    );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
    return (
        <section id={id} className="mb-10 space-y-3 scroll-mt-20">
            <h2 className="text-2xl font-semibold border-b border-border pb-1.5">{title}</h2>
            <div className="space-y-3 text-sm leading-relaxed">{children}</div>
        </section>
    );
}

function SubHeading({ id, children }: { id?: string; children: ReactNode }) {
    return (
        <h3 id={id} className="text-base font-semibold mt-5 mb-1 scroll-mt-20">
            {children}
        </h3>
    );
}

function Flow({ children }: { children: string }) {
    return (
        <pre className="bg-surface-dark border border-border rounded-lg p-4 text-[12px] leading-snug overflow-x-auto whitespace-pre font-mono text-text">
            {children}
        </pre>
    );
}

function Code({ children }: { children: ReactNode }) {
    return (
        <code className="px-1.5 py-0.5 rounded bg-surface-dark text-[12px] font-mono text-text border border-border/60">
            {children}
        </code>
    );
}

function Tr({ children }: { children: ReactNode }) {
    return <tr className="border-t border-border align-top">{children}</tr>;
}

function Td({ children }: { children: ReactNode }) {
    return <td className="px-3 py-2 text-sm">{children}</td>;
}

function ExampleList({ heading, children }: { heading: string; children: ReactNode }) {
    return (
        <div className="rounded-lg border border-border bg-subtle/40 p-3">
            <p className="text-[11px] uppercase tracking-wider text-text-light mb-1.5">{heading}</p>
            <ul className="list-disc pl-5 space-y-1">{children}</ul>
        </div>
    );
}

function Callout({ tone, children }: { tone: 'info' | 'success' | 'warning'; children: ReactNode }) {
    const cls =
        tone === 'success'
            ? 'border-l-4 border-accent bg-accent-subtle'
            : tone === 'warning'
                ? 'border-l-4 border-amber-400 bg-amber-50 dark:bg-amber-900/20'
                : 'border-l-4 border-border bg-subtle/50';
    return <div className={`${cls} rounded-md p-3 text-sm`}>{children}</div>;
}
