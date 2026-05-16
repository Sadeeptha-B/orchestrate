import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Logo } from '../ui/Logo';
import { ThemeToggle } from '../ui/ThemeToggle';

/**
 * v6.1 User Guide — mental model and how-to for the three execution pathways
 * (Deep Track / Stabilizer / Light Pool) plus manual background, True Rest,
 * and capacity arithmetic. **Mirrors docs/user-guide.md** — keep these in sync.
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

                    <Section id="big-picture" title="1. How Orchestrate sees your day">
                        <p>
                            At its core, Orchestrate divides your world into two layers:
                        </p>
                        <ul className="list-disc pl-5 space-y-1">
                            <li><strong>The stuff that persists across days</strong> — your seasons, your habits, your routines. These survive when the day resets.</li>
                            <li><strong>Today's plan</strong> — your intentions, the tasks you've linked to them, which session each task lives in, and how you're feeling throughout the day. This resets every morning.</li>
                        </ul>
                        <p>
                            On top of that, there are <strong>three ways work can flow</strong> through your day, plus a recovery layer that deliberately stays off the grid:
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

      Deep Track       → Your main work: big tasks in dedicated session blocks
      Stabilizer       → Your recurring rituals: synced to Todoist, session-slotted
      Light Pool       → Your micro-gap fillers: logged when you pull them, never scheduled

      + Manual background  → Small today-only nudges inside an intention
      + True Rest          → Recovery cues with zero tracking overhead
      + Capacity           → Advisory math that tells you if you're overloaded`}</Flow>
                    </Section>

                    <Section id="layers" title="2. Where your data lives">
                        <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
                            <thead className="bg-surface-dark text-left">
                                <tr>
                                    <th className="px-3 py-2 font-medium">Layer</th>
                                    <th className="px-3 py-2 font-medium">What it holds</th>
                                    <th className="px-3 py-2 font-medium">How long it lasts</th>
                                </tr>
                            </thead>
                            <tbody>
                                <Tr>
                                    <Td><strong>LifeContext</strong></Td>
                                    <Td>Seasons, Habits, which season is active</Td>
                                    <Td>Durable — survives daily resets.</Td>
                                </Tr>
                                <Tr>
                                    <Td><strong>DayPlan</strong></Td>
                                    <Td>Today's Intentions, linked tasks, session assignments, check-ins, Light Pool log</Td>
                                    <Td>Resets every morning automatically.</Td>
                                </Tr>
                                <Tr>
                                    <Td><strong>Settings</strong></Td>
                                    <Td>Capacity defaults, session time slots, encrypted Todoist token, calendar config</Td>
                                    <Td>Durable — independent of the day.</Td>
                                </Tr>
                            </tbody>
                        </table>
                        <p className="text-text-light">
                            You don't need to think about this much. The important takeaway: your habits and seasons
                            are safe across day boundaries. Today's task plan is ephemeral by design.
                        </p>
                    </Section>

                    <Section id="habit-entity" title="3. Habits: the recurring backbone">
                        <p>
                            A <strong>Habit</strong> is anything you want to do regularly — from morning meditation to
                            flashcard reviews. Every habit has two independent settings that determine how it behaves:
                        </p>

                        <SubHeading>What kind of habit is it?</SubHeading>
                        <ul className="list-disc pl-5 space-y-1.5">
                            <li><strong>Stabilizer</strong> — a habit that needs a dedicated slot in your day. Think rituals: meditation, gym, shutdown routine. Orchestrate syncs these to Todoist as recurring tasks (in a project you pick) and surfaces them directly as session-assigned tasks each day they're due.</li>
                            <li><strong>Light-coherent</strong> — a small, resumable activity you do when you have a gap. Think flashcards, short reading, idea capture. These show up in the Light Pool on your dashboard — you pull from them when you're ready, and they're logged but never scheduled.</li>
                        </ul>

                        <SubHeading>How protected is it?</SubHeading>
                        <ul className="list-disc pl-5 space-y-1.5">
                            <li><strong>Anchor</strong> — a habit so foundational that you don't want to accidentally delete it. Sleep, meditation, gym — the stuff your day collapses without. Anchor habits can't be deleted while active; you'd have to deactivate them first.</li>
                            <li><strong>Non-anchor</strong> — a regular habit you can remove freely.</li>
                        </ul>

                        <Callout tone="info">
                            These two settings are independent. You can have any combination — see{' '}
                            <Link to="#stabilizer-vs-anchor" className="text-accent hover:underline">§6</Link>{' '}
                            for all four.
                        </Callout>
                    </Section>

                    <Section id="pathways" title="4. The three ways work flows through your day">
                        <SubHeading id="pathway-a">4.1 Deep Track — your main work</SubHeading>
                        <p>
                            This is the big stuff. You create an intention ("Finish chapter 3"), link a Todoist task to
                            it, mark it as <strong>main</strong>, give it a time estimate, and assign it to a specific
                            session. Main tasks get a dedicated block — they're exclusive to one session.
                        </p>
                        <Flow>{`Create an Intention
  → link a Todoist task in Step 1
  → categorize as 'main' in Step 2
  → assign to one session in Step 3
  → work on it; completion syncs back to Todoist`}</Flow>
                        <p><strong>Good for:</strong> sustained, focused work that's specific to today.</p>
                        <ExampleList heading="Examples">
                            <li><em>"Implement the capacity arithmetic"</em> — coding, 2hr estimate.</li>
                            <li><em>"Finish chapter 3 of the textbook"</em> — study, 90 min.</li>
                            <li><em>"Draft the project proposal"</em> — writing, 60 min.</li>
                            <li><em>"Refactor the auth module"</em> — code, 3hr (the wizard will nudge you to break this down).</li>
                            <li><em>"Read paper X and write summary"</em> — research, 75 min.</li>
                        </ExampleList>
                        <p className="text-text-light"><strong>When to use it:</strong> the task is big enough to need a dedicated session block, and it's specific to today.</p>

                        <SubHeading id="pathway-b">4.2 Stabilizer — your daily rituals</SubHeading>
                        <p>
                            These are habits that automatically show up as tasks every day their recurrence rule matches.
                            You don't have to remember to add "morning meditation" — Orchestrate creates a recurring
                            Todoist task once, and from then on it surfaces in your plan whenever it's due.
                        </p>
                        <Flow>{`You set up a stabilizer Habit once (e.g., "Morning meditation", daily, 07:00, 10 min)
  → Orchestrate creates a recurring Todoist task in the Habits project
     (with due_string like "every day at 7:00" and duration 10 min)
  → each matching day, if the task is due and unchecked, it appears in your plan
     as a session-assigned task — auto-placed in the session containing 07:00
  → if it can't resolve a session, it lands in the "Unassigned habits" tray on Step 3
  → completing it on the Dashboard syncs back to Todoist; tomorrow's recurrence
     is auto-created by Todoist`}</Flow>
                        <p>A few knobs in the form:</p>
                        <ul className="list-disc pl-5 space-y-1.5">
                            <li><strong>Target time</strong> (optional but recommended) — drives session auto-assignment.</li>
                            <li><strong>Duration</strong> — pushed to Todoist as the task duration and used as the in-plan estimate.</li>
                            <li><strong>Todoist project</strong> — pick which project this habit's recurring task lives in. Leave on "Use default" to use the workspace default in <strong>Settings → Integrations → Default Habits Project</strong> (which itself defaults to a lazily-created project named "Habits"). Changing the project on an already-synced habit moves the recurring task.</li>
                            <li><strong>Window behavior</strong>:
                                <ul className="list-disc pl-5 space-y-1 mt-1">
                                    <li><em>Surface anyway</em> (lenient, default) — show it whenever the Todoist task is due + unchecked, even if you're planning late.</li>
                                    <li><em>Hide for today</em> (strict) — if your planning time is already past <Code>targetTime + duration</Code>, drop it from today's plan. Streaks are preserved.</li>
                                </ul>
                            </li>
                        </ul>
                        <p><strong>Good for:</strong> anchor-style rituals that need to live in a time slot.</p>
                        <ExampleList heading="Anchor stabilizers — the non-negotiables">
                            <li><em>Morning meditation</em> — daily, 5–15 min.</li>
                            <li><em>Sleep wind-down</em> — daily, evening.</li>
                            <li><em>Gym workout</em> — Mon/Wed/Fri, 45 min.</li>
                            <li><em>Evening shutdown ritual</em> — daily, 10 min.</li>
                            <li><em>Take medication</em> — daily, 5 min.</li>
                        </ExampleList>
                        <ExampleList heading="Non-anchor stabilizers — recurring but flexible">
                            <li><em>Daily standup attendance</em> — weekdays, 15 min.</li>
                            <li><em>Daily journal</em> — daily, 10 min.</li>
                            <li><em>Evening planning ritual</em> — daily, 15 min.</li>
                            <li><em>Weekly review</em> — weekly (Sunday), 30–45 min.</li>
                        </ExampleList>
                        <p className="text-text-light"><strong>When to use it:</strong> the activity recurs on a schedule, you want to be reminded about it, and it deserves a slot in the day.</p>

                        <SubHeading id="pathway-c">4.3 Light Pool — your micro-gap fillers</SubHeading>
                        <p>
                            These are small, resumable activities that you pull from when you have a window — between
                            sessions, when your attention drifts, or when you're waiting for something. They never become
                            intentions or scheduled tasks. You just hit <strong>Start</strong> when you begin,{' '}
                            <strong>Done</strong> when you finish, and it gets logged.
                        </p>
                        <Flow>{`You set up a light-coherent Habit (e.g., "Anki flashcards", daily)
  → it shows up in the Light Pool panel on the Dashboard
  → you click Start when you have a gap → a log entry is created
  → you click Done when you finish → duration is recorded
  → it never enters your task plan. Never gets assigned to a session.`}</Flow>
                        <p><strong>Good for:</strong> the "Light Coherent Track" — small coherent activities that replace the impulse to open YouTube or scroll Hacker News.</p>
                        <ExampleList heading="Tied to your current season">
                            <li><em>Anki / flashcard review</em> — during a "Spanish sprint" season.</li>
                            <li><em>Read one section of [current book]</em> — during a "Systems study" season.</li>
                            <li><em>Practice scales (10 min)</em> — during a music-learning season.</li>
                            <li><em>Sketch one figure</em> — during an "art practice" season.</li>
                        </ExampleList>
                        <ExampleList heading="Not tied to any season">
                            <li><em>Idea capture / freewrite</em> — 5 min brain dump.</li>
                            <li><em>Read one essay from current queue</em> — general reading.</li>
                            <li><em>Duolingo session</em> — ambient language drill.</li>
                            <li><em>Walk + audio note</em> — thinking time.</li>
                        </ExampleList>
                        <p className="text-text-light"><strong>When to use it:</strong> the activity is small (≤ 20 min), resumable, and opportunistic. You pull when you have a gap, not on a schedule.</p>

                        <SubHeading id="manual-background">4.4 Manual background — today-only small tasks</SubHeading>
                        <p>
                            Not every small task needs to be a Habit. If you have a quick one-off chore that's tied to
                            one of today's intentions, categorize it as <strong>background</strong> in Step 2.
                            Background tasks can be assigned to multiple sessions and have a 30-min cap by default.
                        </p>
                        <ExampleList heading="Examples">
                            <li><em>"Reply to recruiter email"</em> — under a job-search intention.</li>
                            <li><em>"Push WIP commit before lunch"</em> — under a coding intention.</li>
                            <li><em>"Schedule dentist appointment"</em> — today's logistics.</li>
                            <li><em>"Drink 2L water"</em> — multi-session nudge, assigned to 2–3 sessions.</li>
                        </ExampleList>
                        <Callout tone="info">
                            <strong>Rule of thumb:</strong>{' '}
                            If it recurs and you'd want it back next week, make it a light-coherent Habit. If
                            it's just for today, manual background.
                        </Callout>
                    </Section>

                    <Section id="true-rest" title="5. True Rest — deliberately untracked recovery">
                        <p>
                            True Rest is the one layer that has <strong>no tracking at all</strong>. No logging,
                            no completion checkbox, no streak. Just gentle prompts to reset.
                        </p>
                        <p>It shows up in three places:</p>
                        <ol className="list-decimal pl-5 space-y-1">
                            <li><strong>Dashboard side rail</strong> — a rotating cue, always visible.</li>
                            <li><strong>Check-in modal</strong> — when you report feeling struggling, stuck, or low-energy.</li>
                            <li><strong>Between sessions</strong> — a banner when the next session is within 60 minutes.</li>
                        </ol>
                        <p className="text-text-light">
                            <strong>Catalog examples:</strong> <em>Walk 5 minutes</em>, <em>Box-breathe for 90 seconds</em>,{' '}
                            <em>Close your eyes for 2 minutes</em>, <em>Look out a window</em>,{' '}
                            <em>Long-exhale breathing</em>, <em>Drink a full glass of water</em>,{' '}
                            <em>Stretch</em>, <em>Sit in silence</em>.
                        </p>
                        <Callout tone="info">
                            <strong>Why not just make it a light-coherent habit?</strong> Because the whole point is
                            zero cognitive overhead. No "should I log this?" decision. If you find yourself wanting
                            to track walks, make that a light-coherent habit. True Rest is the deliberately untracked corner.
                        </Callout>
                    </Section>

                    <Section id="stabilizer-vs-anchor" title="6. Stabilizer vs Anchor — they're not the same thing">
                        <p>This is worth spelling out because the two labels look similar but answer different questions:</p>
                        <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
                            <thead className="bg-surface-dark text-left">
                                <tr>
                                    <th className="px-3 py-2 font-medium">Setting</th>
                                    <th className="px-3 py-2 font-medium">What it controls</th>
                                    <th className="px-3 py-2 font-medium">Question it answers</th>
                                </tr>
                            </thead>
                            <tbody>
                                <Tr>
                                    <Td><Code>kind: 'stabilizer'</Code></Td>
                                    <Td><strong>Behavior</strong> — synced to Todoist as a recurring task and surfaced as a session-assigned task each day it's due</Td>
                                    <Td><em>"How does this habit show up each day?"</em></Td>
                                </Tr>
                                <Tr>
                                    <Td><Code>isAnchor: true</Code></Td>
                                    <Td><strong>Protection</strong> — can't be deleted while active</Td>
                                    <Td><em>"Would my day collapse without this?"</em></Td>
                                </Tr>
                            </tbody>
                        </table>

                        <p className="mt-4">All four combinations make sense:</p>
                        <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
                            <thead className="bg-surface-dark text-left">
                                <tr>
                                    <th className="px-3 py-2 font-medium">Kind</th>
                                    <th className="px-3 py-2 font-medium">Anchor?</th>
                                    <th className="px-3 py-2 font-medium">What it means</th>
                                    <th className="px-3 py-2 font-medium">Examples</th>
                                </tr>
                            </thead>
                            <tbody>
                                <Tr>
                                    <Td>Stabilizer</Td>
                                    <Td>Yes</Td>
                                    <Td>The foundation — non-negotiable, the day collapses without it.</Td>
                                    <Td>Sleep, meditation, gym, shutdown, medication.</Td>
                                </Tr>
                                <Tr>
                                    <Td>Stabilizer</Td>
                                    <Td>No</Td>
                                    <Td>Recurring ritual that lands in a session daily, but might retire quietly.</Td>
                                    <Td>Daily standup, journal, evening planning.</Td>
                                </Tr>
                                <Tr>
                                    <Td>Light-coherent</Td>
                                    <Td>Yes</Td>
                                    <Td>Unusual but valid — a micro-gap practice you want to protect.</Td>
                                    <Td>Long-form weekly reading you don't want to delete on a whim.</Td>
                                </Tr>
                                <Tr>
                                    <Td>Light-coherent</Td>
                                    <Td>No</Td>
                                    <Td>The typical Light Pool activity.</Td>
                                    <Td>Flashcards, idea capture, language drills.</Td>
                                </Tr>
                            </tbody>
                        </table>

                        <Callout tone="success">
                            <strong>The mental shortcut.</strong>{' '}
                            <Code>isAnchor</Code> answers <em>"which habits, if I dropped them, would let the day fall apart?"</em>{' '}
                            <Code>kind</Code> answers <em>"does this need a slot in the day, or do I pull from a pool?"</em>
                        </Callout>
                    </Section>

                    <Section id="anchor-stabilizer-seasons" title="7. How Habits, Seasons, and Anchors work together">
                        <p>
                            Every habit has a <Code>seasonIds</Code> list — which seasons it belongs to. This is the third axis:
                        </p>
                        <ol className="list-decimal pl-5 space-y-1">
                            <li><strong>Empty list</strong> means <strong>always-on</strong>. The habit shows up regardless of which season is active. Use this for foundational stuff.</li>
                            <li><strong>Specific season(s)</strong> means <strong>season-scoped</strong>. The habit only shows up when that season is active. Use this for practices tied to a specific focus period.</li>
                            <li><strong>Season membership doesn't change anything else.</strong> A stabilizer stays a stabilizer, an anchor stays an anchor, regardless of season.</li>
                        </ol>

                        <SubHeading id="always-on-anchor">The "always-on anchor" principle</SubHeading>
                        <p>
                            <strong>Anchors should almost always be season-agnostic</strong> (empty <Code>seasonIds</Code>).
                            Your sleep routine shouldn't disappear when you switch from "Degree Push" to "Stabilization"
                            season — it's the foundation <em>across</em> seasons.
                        </p>
                        <p>
                            Conversely, <strong>season-scoped habits usually shouldn't be anchors.</strong>{' '}
                            The season ending naturally retires them. Protection would just create friction at transitions.
                        </p>

                        <SubHeading id="four-combinations">The four common patterns</SubHeading>
                        <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
                            <thead className="bg-surface-dark text-left">
                                <tr>
                                    <th className="px-3 py-2 font-medium">Kind</th>
                                    <th className="px-3 py-2 font-medium">Anchor?</th>
                                    <th className="px-3 py-2 font-medium">Season-scoped?</th>
                                    <th className="px-3 py-2 font-medium">What it is</th>
                                </tr>
                            </thead>
                            <tbody>
                                <Tr>
                                    <Td>Stabilizer</Td>
                                    <Td>Yes</Td>
                                    <Td>No (always-on)</Td>
                                    <Td><strong>Your foundation.</strong> 3–6 of these, cross-season. Sleep, meditation, gym, shutdown.</Td>
                                </Tr>
                                <Tr>
                                    <Td>Stabilizer</Td>
                                    <Td>No</Td>
                                    <Td>Yes</Td>
                                    <Td><strong>A season's ritual.</strong> Lands in a session daily while the season is active. E.g., daily research log during a "Research push" season.</Td>
                                </Tr>
                                <Tr>
                                    <Td>Light-coherent</Td>
                                    <Td>No</Td>
                                    <Td>Yes</Td>
                                    <Td><strong>A season's micro-practice.</strong> In the Light Pool only while that season is active. E.g., flashcards during an "Interview prep" season.</Td>
                                </Tr>
                                <Tr>
                                    <Td>Light-coherent</Td>
                                    <Td>No</Td>
                                    <Td>No (always-on)</Td>
                                    <Td><strong>General curiosity.</strong> Survives every season change. Idea capture, general reading, Duolingo.</Td>
                                </Tr>
                            </tbody>
                        </table>

                        <SubHeading id="season-lifecycle">What happens when you switch seasons</SubHeading>
                        <ul className="list-disc pl-5 space-y-1">
                            <li>Habits scoped to the new season start appearing (in the plan or Light Pool).</li>
                            <li>Habits scoped to the old season quietly disappear from today's view — but they're not deleted. Reactivating that season brings them back.</li>
                            <li>Always-on habits ride through unchanged.</li>
                            <li>Anchors stay protected regardless — even between seasons.</li>
                        </ul>
                        <Callout tone="success">
                            <strong>When setting up a new season,</strong> think in three buckets:
                            (1) <strong>stabilizer rituals</strong> for this season's daily structure;
                            (2) <strong>light-coherent micro-practices</strong> that support it;
                            (3) <strong>leave your anchors alone</strong> — they're already always-on.
                        </Callout>
                    </Section>

                    <Section id="capacity" title="8. Session capacity — your advisory dashboard">
                        <p>Capacity math runs across all your session assignments. It's advisory — it tells you how loaded each session is, but it never blocks you from proceeding.</p>
                        <ul className="list-disc pl-5 space-y-1.5">
                            <li><strong>How it works:</strong> each session's available time = session length minus a buffer. Assigned minutes = sum of all task estimates in that session. Background tasks count once per assignment.</li>
                            <li><strong>Mid-session:</strong> the available time shrinks to whatever's left on the clock.</li>
                            <li><strong>Where it shows up:</strong> Step 3 timeline (per-session badge + over-capacity banner) and Dashboard current session (remaining-time indicator + banner if over).</li>
                            <li><strong>It never blocks the wizard.</strong> Even at 200% you can proceed. The goal is visibility, not prevention.</li>
                            <li><strong>Light Pool entries are excluded</strong> — they're outside the task graph entirely.</li>
                        </ul>
                        <p className="mt-3"><strong>What the status badges mean:</strong></p>
                        <ul className="list-none pl-1 space-y-1">
                            <li><span className="inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded-full border whitespace-nowrap bg-surface-dark text-text-light border-border">47/120 min</span> <span className="text-text-light">— <strong>Grey</strong> (under 100%): you have headroom.</span></li>
                            <li><span className="inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded-full border whitespace-nowrap bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700">130/120 min</span> <span className="text-text-light">— <strong>Amber</strong> (100–150%): at or just over capacity. Probably fine if estimates are conservative.</span></li>
                            <li><span className="inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded-full border whitespace-nowrap bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-red-300 dark:border-red-700">200/120 min</span> <span className="text-text-light">— <strong>Red</strong> (above 150%): meaningfully overcommitted. Consider moving or breaking down a task.</span></li>
                        </ul>
                    </Section>

                    <Section id="check-in" title="9. The hourly check-in">
                        <p>Every hour during an active session, Orchestrate asks how you're doing. This is where the system reads your state and routes you to the right response:</p>
                        <ul className="list-disc pl-5 space-y-1.5">
                            <li><strong>Feeling great, on track?</strong> No extra surfacing. Keep going.</li>
                            <li><strong>Struggling, low-energy, or restless?</strong> The modal surfaces 1–2 <strong>Light Pool</strong> activities and a <strong>True Rest</strong> cue. You pick: a smaller productive move, or a genuine reset.</li>
                            <li><strong>Feeling stuck?</strong> An extra prompt appears: <em>"What exactly are you avoiding?"</em> Your answer is saved — it feeds pattern-spotting over time.</li>
                        </ul>
                        <p>
                            Every check-in also asks what kind of work you're doing and suggests a matching playlist
                            (coding → Deep Focus, lectures → Lo-Fi Beats, etc.).
                        </p>
                        <p className="text-text-light">
                            If the current session is over-capacity, the Dashboard banner is already visible alongside
                            the check-in — contextualizing why "struggling" might be more than psychological.
                        </p>
                    </Section>

                    <Section id="decision-tree" title='10. Decision tree — "I want to add X to my day"'>
                        <Flow>{`Is X a non-task recovery move (walk, breathe, gaze)?
├─ YES → Don't model it. True Rest will surface organically.
│        If you find yourself wanting to log it, that's the signal
│        it should be a light-coherent habit instead.
└─ NO ↓

Is X today-only?
├─ YES ↓
│   Is X your primary work thread for the day?
│   ├─ YES → Deep Track: create an Intention, map a task, categorize 'main'.
│   └─ NO  → manual background: attach it as a 'background' task
│            under an existing or new intention.
│
└─ NO  (X is recurring) ↓
    Does X need a slot in the day to anchor your structure?
    ├─ YES → create a stabilizer Habit.
    │        Set targetTime + duration so Orchestrate can drop it in the right session.
    │        Mark as anchor ONLY if dropping it would let the day collapse.
    │        Set seasonIds = [] for always-on, [seasonId] for season-scoped.
    │        (Saving will create a recurring Todoist task in the chosen project.)
    └─ NO  (X is opportunistic, pulled when you have a gap)
        → create a light-coherent Habit.
          Set seasonIds = [seasonId] if tied to current focus,
          [] for general curiosity practices.`}</Flow>
                    </Section>

                    <Section id="typical-day" title="11. A typical day, start to finish">
                        <p>A concrete walk-through showing all the pieces in action.</p>

                        <SubHeading>Your setup (durable, lives across days)</SubHeading>
                        <ul className="list-disc pl-5 space-y-1">
                            <li>Active season: <em>"Stabilization Q2"</em> — sleep + planning consistency + degree groundwork.</li>
                            <li>Anchor stabilizers (always-on): <em>Morning meditation</em>, <em>Gym (M/W/F)</em>, <em>Sleep wind-down</em>, <em>Evening shutdown</em>.</li>
                            <li>Season stabilizer: <em>Daily 15-min planning ritual</em>.</li>
                            <li>Season light-coherent: <em>Read one section of [current systems book]</em>, <em>Algorithms warm-up (one easy problem)</em>.</li>
                            <li>Always-on light-coherent: <em>Idea capture freewrite</em>, <em>Duolingo session</em>.</li>
                        </ul>

                        <SubHeading>Step 1 — Intentions</SubHeading>
                        <ul className="list-disc pl-5 space-y-1">
                            <li>Stabilizer habit-tasks are <em>not</em> in the intention list. Instead, an inline chip says: <em>"4 habit tasks scheduled for today — see Step 3."</em></li>
                            <li>You add manually: <em>"Finish v6 capacity arithmetic"</em>, <em>"Read paper on session scheduling"</em>.</li>
                            <li>Light-coherent habits don't appear here either — they live in the Light Pool.</li>
                        </ul>

                        <SubHeading>Step 2 — Refine</SubHeading>
                        <ul className="list-disc pl-5 space-y-1">
                            <li><em>Finish v6 capacity arithmetic</em> → main, 120 min.</li>
                            <li><em>Read paper on session scheduling</em> → main, 60 min.</li>
                            <li>You add a manual background: <em>"Push WIP commit before lunch"</em>, 10 min.</li>
                            <li>Stabilizer habit-tasks bypass this step entirely — they already arrived as background tasks with their <Code>targetDurationMinutes</Code> estimate from injection.</li>
                        </ul>

                        <SubHeading>Step 3 — Schedule</SubHeading>
                        <ul className="list-disc pl-5 space-y-1">
                            <li>Early morning: 🔁 <em>Morning meditation</em> + 🔁 <em>Gym</em> (auto-assigned via Todoist due time).</li>
                            <li>Morning: <em>Finish v6 capacity arithmetic</em> (main).</li>
                            <li>Afternoon: <em>Read paper</em> (main) + 🔁 <em>Daily planning ritual</em> + <em>Push WIP commit</em> (background).</li>
                            <li>Night: 🔁 <em>Evening shutdown</em>.</li>
                            <li>Habit-tasks render under a "🔁 Habits" group inside each session card; if any habit-task lacks a Todoist time, it would sit in the "Unassigned habits" tray above the timeline for you to drop into a session.</li>
                        </ul>
                        <p className="text-text-light text-sm">
                            Capacity badge shows the morning session is <em>tight</em> at 110%. You proceed — it's advisory.
                        </p>

                        <SubHeading>During the day</SubHeading>
                        <ul className="list-disc pl-5 space-y-1">
                            <li>The Light Pool panel lists <em>Read one section</em>, <em>Algorithms warm-up</em>, <em>Idea capture</em>, <em>Duolingo</em>. Between morning and afternoon sessions, you pull <em>Algorithms warm-up</em> — Start, work for 12 minutes, Done. Logged, doesn't touch the task graph.</li>
                            <li>Between-session True Rest banner: <em>"Walk 5 minutes — outside if possible."</em> No tracking.</li>
                            <li>2:00 PM check-in: feeling <em>struggling</em>, work type <em>low-energy</em>. The modal shows a True Rest cue (<em>"Long-exhale breathing — 3 min"</em>) and a couple Light Pool rows. You try the breathing, then resume your main work.</li>
                            <li>3:00 PM check-in: feeling <em>stuck</em>. The avoidance prompt appears. You write: <em>"The paper's math section — I don't have the prerequisites yet."</em> Saved for later reflection.</li>
                        </ul>

                        <SubHeading>End of day</SubHeading>
                        <ul className="list-disc pl-5 space-y-1">
                            <li>Stabilizer habit-tasks: 4/4 completed (synced to Todoist; tomorrow's recurrences auto-created by Todoist).</li>
                            <li>Main tasks: 1.5/2 completed.</li>
                            <li>Light Pool log: 2 entries (algorithms warm-up and Duolingo; flashcards and reading skipped today).</li>
                            <li>True Rest: surfaced but untracked, as intended.</li>
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
                                <Tr><Td>A today-only big work thread</Td><Td>Main task (Deep Track)</Td></Tr>
                                <Tr><Td>A recurring ritual that needs a slot</Td><Td>Stabilizer Habit (set <Code>targetTime</Code> + duration so it auto-lands in the right session). Add <Code>isAnchor</Code> if foundational.</Td></Tr>
                                <Tr><Td>A small recurring practice you pull opportunistically</Td><Td>Light-coherent Habit (Light Pool)</Td></Tr>
                                <Tr><Td>A today-only small chore tied to an intention</Td><Td>Manual background task</Td></Tr>
                                <Tr><Td>A non-task recovery prompt</Td><Td>Don't model. True Rest handles it.</Td></Tr>
                                <Tr><Td>A practice tied to a specific focus period</Td><Td>Light-coherent Habit with <Code>seasonIds</Code> set</Td></Tr>
                                <Tr><Td>A foundational habit that survives season changes</Td><Td>Stabilizer Habit with <Code>isAnchor</Code>, always-on</Td></Tr>
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
                            Reflects v6.1. See <Link to="/life" className="text-accent hover:underline">/life</Link> to manage your seasons and habits.
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
                A guide to how Orchestrate thinks about your day — and how you can use that to
                get more done with less friction. Covers <strong>Habits</strong>,{' '}
                <strong>Intentions</strong>, <strong>Tasks</strong>, the <strong>Light Pool</strong>,{' '}
                <strong>True Rest</strong>, and <strong>Capacity</strong>.
            </p>
        </div>
    );
}

const TOC_ENTRIES: { id: string; label: string }[] = [
    { id: 'big-picture', label: '1. How Orchestrate sees your day' },
    { id: 'layers', label: '2. Where your data lives' },
    { id: 'habit-entity', label: '3. Habits: the recurring backbone' },
    { id: 'pathways', label: '4. The three work pathways' },
    { id: 'true-rest', label: '5. True Rest' },
    { id: 'stabilizer-vs-anchor', label: '6. Stabilizer vs Anchor' },
    { id: 'anchor-stabilizer-seasons', label: '7. Habits, Seasons, Anchors' },
    { id: 'capacity', label: '8. Session capacity' },
    { id: 'check-in', label: '9. The hourly check-in' },
    { id: 'decision-tree', label: '10. Decision tree' },
    { id: 'typical-day', label: '11. A typical day' },
    { id: 'quick-reference', label: '12. Quick reference' },
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
        <pre className="bg-surface-dark border border-border rounded-lg p-4 text-[12px] leading-snug overflow-x-auto scrollbar-subtle whitespace-pre font-mono text-text">
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
