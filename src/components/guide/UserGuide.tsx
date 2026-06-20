import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Logo } from '../ui/Logo';
import { HeaderControls } from '../ui/HeaderControls';

/**
 * User Guide — mental model and how-to for the three execution pathways
 * (Deep Track / Habit / Micro-gap) plus manual background, recurring focus, True Rest,
 * and capacity arithmetic. This component is the single source for user-facing
 * guide content.
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
                        <HeaderControls />
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
                   │  taskSessions  ·  todaysHabits │
                   │  checkIns                      │
                   └────────────────────────────────┘

      Deep Track       → Your main work: big tasks in dedicated session blocks
      Habit            → Recurring things, done once a day: synced to Todoist. Timed → on the timeline; untimed → "anytime"
      Micro-gap        → Light, repeatable fillers: NO Todoist, pulled whenever; logged each rep, never "done for the day"

      + Manual background  → Small today-only nudges inside an intention
      + True Rest          → Recovery cues with zero tracking overhead
      + Capacity           → Advisory math that tells you if you're overloaded`}</Flow>
                        <Callout tone="info">
                            Low on activation and the full plan feels like too much? Use{' '}
                            <strong>⚡ Quick start</strong> on the home screen: pick or type one or two things and drop
                            straight into Focus, skipping the wizard. It seeds a minimal "Today" plan behind you — you can
                            flesh it out later with Edit Plan.
                        </Callout>
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
                                    <Td>Seasons, Habits, which season is active, session templates</Td>
                                    <Td>Durable — survives daily resets.</Td>
                                </Tr>
                                <Tr>
                                    <Td><strong>DayPlan</strong></Td>
                                    <Td>Today's Intentions, linked tasks, the day's work sessions, session assignments, today's habit instances, check-ins</Td>
                                    <Td>Resets every morning automatically — sessions seed from the prior day.</Td>
                                </Tr>
                                <Tr>
                                    <Td><strong>Settings</strong></Td>
                                    <Td>Capacity defaults, encrypted Todoist token, calendar config</Td>
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
                            <li><strong>Habit</strong> — the normal recurring thing you do once a day. Synced to Todoist as a recurring task; Complete checks it off and advances the recurrence. Give it a <strong>target time</strong> to place it on the dashboard timeline, or leave it untimed and it surfaces as an "Anytime today" row. Start / Stop / Complete / Skip / Reschedule.</li>
                            <li><strong>Micro-gap</strong> — a light, <strong>repeatable</strong> filler you dip into when you have a window (flashcards, a quick drill, a few pages). <strong>Not</strong> synced to Todoist and never "done for the day": Start / Stop logs a rep and it stays available. Lives in its own <strong>Micro-gaps</strong> panel, separate from the obligations list, so it never feels like a chore.</li>
                        </ul>
                        <p className="text-text-light">
                            Both kinds feed the <strong>Engagement Log</strong> and never burn session capacity, but
                            they differ in lifecycle: a <strong>habit</strong> syncs to Todoist and is done once a day;
                            a <strong>micro-gap</strong> has no Todoist task and repeats freely. Habits show in the
                            <strong> Today's Habits</strong> card; micro-gaps in their own <strong>Micro-gaps</strong> panel.
                        </p>

                        <SubHeading>How protected is it?</SubHeading>
                        <ul className="list-disc pl-5 space-y-1.5">
                            <li><strong>Anchor</strong> — a habit so foundational that you don't want to accidentally delete it. Sleep, meditation, gym — the stuff your day collapses without. Anchors sort to the front of your habit list, and deleting an active one asks you to confirm first.</li>
                            <li><strong>Non-anchor</strong> — a regular habit you can remove freely, no confirm.</li>
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
  → assign to one session in Step 4
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

                        <SubHeading id="pathway-b">4.2 Habit — your recurring rituals</SubHeading>
                        <p>
                            These show up automatically every day their recurrence rule matches. You don't have to
                            remember to add "morning meditation" — Orchestrate creates a recurring Todoist task once,
                            and from then on it surfaces in your plan whenever it's due. Done once a day.
                        </p>
                        <Flow>{`You set up a Habit once (e.g., "Morning meditation", daily, 07:00, 10 min)
  → Orchestrate creates a recurring Todoist task in the Habits project
     (with due_string like "every day at 7:00" and duration 10 min)
  → each matching day, if the task is due and unchecked, it appears as a
     TodaysHabitInstance on your dashboard:
       • on the timeline's habit lane at 07:00 (its target time)
       • plus a row in the HabitInstanceCard with Start / Stop / Complete /
         Skip / Reschedule controls
  → press ▶ when you begin → status flips to "engaged" and a live timer runs from 0:00
  → press ■ to pause → that Start→Stop becomes one entry in the engagement log;
     press ▶ again for a fresh segment (another log entry)
  → press ✓ when done → instance flips to "completed" and the recurring Todoist
     task's current occurrence is checked off (tomorrow's auto-created by Todoist)
  → missed it? hit ⤴ Reschedule to pick a later time today — the instance just moves
     to the new time (engagement and timer intact); the move is recorded in the
     engagement log. The recurring Todoist task is untouched, so your recurrence stays clean.`}</Flow>
                        <p>A few knobs in the form:</p>
                        <ul className="list-disc pl-5 space-y-1.5">
                            <li><strong>Target time</strong> (optional) — set it to place the instance on the timeline; leave it blank for an "anytime" habit that clusters under "Anytime today".</li>
                            <li><strong>Duration</strong> — pushed to Todoist as the task duration and used as the displayed estimate / lane width.</li>
                            <li><strong>Todoist project</strong> — pick which project this habit's recurring task lives in. Leave on "Use default" to use the workspace default in <strong>Settings → Integrations → Default Habits Project</strong> (which itself defaults to a lazily-created project named "Habits"). Changing the project on an already-synced habit moves the recurring task.</li>
                            <li><strong>Window behavior</strong>:
                                <ul className="list-disc pl-5 space-y-1 mt-1">
                                    <li><em>Keep as to-do</em> (lenient, default) — stays an active to-do all day whenever the Todoist task is due + unchecked, even if you're planning late. You can reschedule it to a later time today.</li>
                                    <li><em>Mark as missed</em> (strict) — once you're past <Code>targetTime + duration</Code> it's no longer prompted as a live to-do: the row greys out and is tagged <em>"missed"</em>. It still appears on the timeline and in the habits card as a record, and stays completable (handy if you did it before planning) — rescheduling it to a later time clears the "missed" tag.</li>
                                </ul>
                            </li>
                        </ul>
                        <p><strong>Good for:</strong> recurring rituals — timed (meditation 7am) or anytime-but-once (vitamins, an evening shutdown, an anime episode).</p>
                        <ExampleList heading="Anchor habits — the non-negotiables">
                            <li><em>Morning meditation</em> — daily, 5–15 min.</li>
                            <li><em>Sleep wind-down</em> — daily, evening.</li>
                            <li><em>Gym workout</em> — Mon/Wed/Fri, 45 min.</li>
                            <li><em>Evening shutdown ritual</em> — daily, 10 min.</li>
                            <li><em>Take medication</em> — daily, 5 min.</li>
                        </ExampleList>
                        <ExampleList heading="Non-anchor habits — recurring but flexible">
                            <li><em>Daily standup attendance</em> — weekdays, 15 min.</li>
                            <li><em>Daily journal</em> — daily, 10 min.</li>
                            <li><em>Evening planning ritual</em> — daily, 15 min.</li>
                            <li><em>Weekly review</em> — weekly (Sunday), 30–45 min.</li>
                        </ExampleList>
                        <p className="text-text-light"><strong>When to use it:</strong> the activity recurs on a schedule, you want to be reminded about it, and it deserves a slot in the day.</p>

                        <SubHeading id="pathway-c">4.3 Micro-gap — your repeatable fillers</SubHeading>
                        <p>
                            Small, resumable activities you pull from when you have a window — between sessions, when
                            your attention drifts, or while you're waiting. Unlike habits they are <strong>not</strong>{' '}
                            synced to Todoist and are <strong>repeatable</strong>: you can do one several times a day,
                            and they never go "done for the day". They live in their own <strong>Micro-gaps</strong>{' '}
                            panel — deliberately separate from the obligations list so dipping in never feels like a chore.
                            Each rep is still tracked in the Engagement Log.
                        </p>
                        <Flow>{`You set up a Micro-gap Habit (e.g., "Anki flashcards", daily) — no Todoist task is created
  → each matching day it appears as a row in the Micro-gaps panel
  → press ▶ when you have a gap → a live timer runs; ■ logs the rep (an Engagement Log entry)
  → the row stays available — press ▶ again later for another rep
  → a "N× · Mm" badge shows today's reps + total time. It never enters your task plan
     or burns session capacity, and there's no Todoist completion.`}</Flow>
                        <p><strong>Good for:</strong> the "Light Coherent Track" — small coherent activities that replace the impulse to open YouTube or scroll Hacker News, that you want to track but not turn into a daily obligation.</p>
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
                            If it recurs and you'd want it back next week, make it a Habit (or a Micro-gap if it's
                            a light, repeatable filler). If it's just for today, manual background.
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
                            <strong>Why not just make it a micro-gap?</strong> Because the whole point is
                            zero cognitive overhead. No "should I log this?" decision. If you find yourself wanting
                            to track walks, make that a micro-gap. True Rest is the deliberately untracked corner.
                        </Callout>
                    </Section>

                    <Section id="stabilizer-vs-anchor" title="6. Kind vs Anchor — they're not the same thing">
                        <p>This is worth spelling out because the two settings look similar but answer different questions:</p>
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
                                    <Td><Code>kind</Code></Td>
                                    <Td><strong>Lifecycle</strong> — <Code>habit</Code> syncs to Todoist and is done once a day (timed or anytime); <Code>micro-gap</Code> has no Todoist task and repeats freely</Td>
                                    <Td><em>"Is this a once-a-day recurring thing, or a repeatable filler?"</em></Td>
                                </Tr>
                                <Tr>
                                    <Td><Code>isAnchor: true</Code></Td>
                                    <Td><strong>Importance</strong> — sorts first; confirm before deleting</Td>
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
                                    <Td>Habit</Td>
                                    <Td>Yes</Td>
                                    <Td>The foundation — non-negotiable, the day collapses without it.</Td>
                                    <Td>Sleep, meditation, gym, shutdown, medication.</Td>
                                </Tr>
                                <Tr>
                                    <Td>Habit</Td>
                                    <Td>No</Td>
                                    <Td>Recurring ritual done once a day, but might retire quietly.</Td>
                                    <Td>Daily standup, journal, evening planning, an anime episode.</Td>
                                </Tr>
                                <Tr>
                                    <Td>Micro-gap</Td>
                                    <Td>Yes</Td>
                                    <Td>Unusual but valid — a repeatable filler you want to protect.</Td>
                                    <Td>Long-form weekly reading you don't want to delete on a whim.</Td>
                                </Tr>
                                <Tr>
                                    <Td>Micro-gap</Td>
                                    <Td>No</Td>
                                    <Td>The typical repeatable filler.</Td>
                                    <Td>Flashcards, idea capture, language drills.</Td>
                                </Tr>
                            </tbody>
                        </table>

                        <Callout tone="success">
                            <strong>The mental shortcut.</strong>{' '}
                            <Code>isAnchor</Code> answers <em>"which habits, if I dropped them, would let the day fall apart?"</em>{' '}
                            <Code>kind</Code> answers <em>"is this a once-a-day recurring thing (habit), or a repeatable filler (micro-gap)?"</em>
                        </Callout>
                    </Section>

                    <Section id="anchor-stabilizer-seasons" title="7. How Habits, Seasons, and Anchors work together">
                        <p>
                            Every habit has a <Code>seasonIds</Code> list — which seasons it belongs to. This is the third axis:
                        </p>
                        <ol className="list-decimal pl-5 space-y-1">
                            <li><strong>Empty list</strong> means <strong>always-on</strong>. The habit shows up regardless of which season is active. Use this for foundational stuff.</li>
                            <li><strong>Specific season(s)</strong> means <strong>season-scoped</strong>. The habit only shows up when that season is active. Use this for practices tied to a specific focus period.</li>
                            <li><strong>Season membership doesn't change anything else.</strong> A habit stays a habit, a micro-gap stays a micro-gap, an anchor stays an anchor, regardless of season.</li>
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
                                    <Td>Habit</Td>
                                    <Td>Yes</Td>
                                    <Td>No (always-on)</Td>
                                    <Td><strong>Your foundation.</strong> 3–6 of these, cross-season. Sleep, meditation, gym, shutdown.</Td>
                                </Tr>
                                <Tr>
                                    <Td>Habit</Td>
                                    <Td>No</Td>
                                    <Td>Yes</Td>
                                    <Td><strong>A season's ritual.</strong> Done daily while the season is active. E.g., daily research log during a "Research push" season.</Td>
                                </Tr>
                                <Tr>
                                    <Td>Micro-gap</Td>
                                    <Td>No</Td>
                                    <Td>Yes</Td>
                                    <Td><strong>A season's micro-practice.</strong> A repeatable filler only while that season is active. E.g., flashcards during an "Interview prep" season.</Td>
                                </Tr>
                                <Tr>
                                    <Td>Micro-gap</Td>
                                    <Td>No</Td>
                                    <Td>No (always-on)</Td>
                                    <Td><strong>General curiosity.</strong> Survives every season change. Idea capture, general reading, Duolingo.</Td>
                                </Tr>
                            </tbody>
                        </table>

                        <SubHeading id="season-lifecycle">What happens when you switch seasons</SubHeading>
                        <ul className="list-disc pl-5 space-y-1">
                            <li>Habits scoped to the new season start appearing in Today's Habits (timed or anytime).</li>
                            <li>Habits scoped to the old season quietly disappear from today's view — but they're not deleted. Reactivating that season brings them back.</li>
                            <li>Always-on habits ride through unchanged.</li>
                            <li>Anchors stay protected regardless — even between seasons.</li>
                        </ul>
                        <Callout tone="success">
                            <strong>When setting up a new season,</strong> think in buckets:
                            (1) <strong>habit rituals</strong> for this season's daily structure;
                            (2) <strong>micro-gap fillers</strong> that support it;
                            (3) <strong>recurring focuses</strong> for bigger work-threads that decompose into tasks;
                            (4) <strong>leave your anchors alone</strong> — they're already always-on.
                        </Callout>
                    </Section>

                    <Section id="capacity" title="8. Session capacity — your advisory dashboard">
                        <p>Capacity math runs across all your session assignments. It's advisory — it tells you how loaded each session is, but it never blocks you from proceeding.</p>
                        <ul className="list-disc pl-5 space-y-1.5">
                            <li><strong>How it works:</strong> each session's available time = session length minus a buffer. Assigned minutes = sum of all task estimates in that session. Background tasks count once per assignment.</li>
                            <li><strong>Mid-session:</strong> the available time shrinks to whatever's left on the clock.</li>
                            <li><strong>Where it shows up:</strong> Step 4 (Schedule) timeline (per-session badge + over-capacity banner) and Dashboard current session (remaining-time indicator + banner if over).</li>
                            <li><strong>It never blocks the wizard.</strong> Even at 200% you can proceed. The goal is visibility, not prevention.</li>
                            <li><strong>Habits are excluded</strong> (both kinds) — they're outside the task graph entirely.</li>
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
                            <li><strong>Struggling, low-energy, or restless?</strong> The modal surfaces 1–2 <strong>anytime habits</strong> (with Start/Complete) and a <strong>True Rest</strong> cue. You pick: a smaller productive move, or a genuine reset.</li>
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

                    <Section id="focus-mode" title="9b. Focus Mode — one task, one timer">
                        <p>
                            When you press <strong>▶ Start</strong> on a task in the Current Session, Orchestrate drops
                            into <strong>Focus Mode</strong> — a stripped-down page with just the day timeline, the one
                            task you're working on, and a large timer counting your time on it. It's the antidote to the
                            busy dashboard: one thing, in front of you, with the clock running. <strong>Stop</strong>{' '}
                            pauses; <strong>Complete</strong> ticks the task off and returns you home. <strong>Exit</strong>{' '}
                            leaves the timer running and goes back to the dashboard.
                        </p>
                        <SubHeading>Pomodoro pacing</SubHeading>
                        <p>
                            Toggle <strong>Pomodoro mode</strong> to work in slots instead of one long stretch. Orchestrate
                            sizes the slots from the task's estimate: <strong>45 min or more</strong> → 20-minute work
                            blocks with 5-minute breaks; <strong>around 30 min</strong> → 10-minute blocks; anything
                            shorter is a single session. The slots show as a vertical plan on the right; while the engine
                            runs it highlights the current block, counts it down, and chimes (plus a notification) each
                            time you switch between work and break.
                        </p>
                        <Callout tone="info">
                            If you're in an active session for 10 minutes without starting a focus block, Orchestrate
                            nudges you (banner + notification) and keeps reminding you every 30 minutes until you begin —
                            but only while the session still has unfinished work.
                        </Callout>
                        <SubHeading>Re-entry breadcrumb</SubHeading>
                        <p>
                            The hardest part of deep work is usually <em>getting back in</em>. Every task carries a{' '}
                            <strong>context trail</strong> — a running list of breadcrumbs you can see in Focus Mode under{' '}
                            <strong>Re-entry context</strong> (with a <strong>last worked Xm ago</strong> line). Use the{' '}
                            <strong>"Next step — where you're leaving off"</strong> line to jot one sentence; it's committed
                            each time you <strong>Stop</strong> or <strong>Complete</strong>, and you can hit{' '}
                            <strong>+ Add</strong> to drop an extra breadcrumb mid-session. The trail builds across work
                            sessions so you skip rebuilding the whole mental model, and the latest note shows as a small{' '}
                            <strong>↩</strong> preview on dashboard task rows.
                        </p>
                        <p>
                            Two deliberate guardrails make this stick: you can't <strong>Start</strong> a fresh task without
                            naming a <strong>first concrete action</strong> (the specific first move, not the whole task), and
                            you can't <strong>Stop</strong> without leaving a next step. A little friction at the edges buys
                            you a much cheaper return later.
                        </p>
                        <SubHeading>Activation ramp</SubHeading>
                        <p>
                            Low on activation? Tap <strong>Ramp in</strong> (5 or 10 min) for a deliberate, <em>bounded</em>{' '}
                            warm-up — one video, tea, a quick skim — that <em>closes</em> with a chime and a "begin work"
                            nudge. The point is to make stimulation intentional instead of ambient. Your time-on-task timer
                            keeps running through the ramp.
                        </p>
                    </Section>

                    <Section id="backlog" title="9a. Intentions Backlog — parking work for later">
                        <p>
                            Not every intention you write down on Monday belongs on Monday. You overcommit, plans shift,
                            energy fades. The <strong>Backlog</strong> is a persistent pool of parked intentions you can
                            pull back into a future day, surfaced in the second tab of the left-side sidebar (same panel
                            as Saved Sessions). The <code>Work Items</code> header button on every screen opens the
                            sidebar; switch between <em>Saved Sessions</em> and <em>Backlog</em> using the tab toggle
                            at the top of the panel. The header button shows a count suffix
                            (e.g. <code>Work Items (3)</code>) when there's anything in the backlog.
                        </p>

                        <SubHeading>Two ways an intention lands in the backlog</SubHeading>
                        <ol className="list-decimal pl-5 space-y-1.5">
                            <li>
                                <strong>You park it manually.</strong> Every intention row in Step 1 and the
                                "Today's intentions" panel at the top of Step 4 (Schedule) shows two icon buttons:{' '}
                                <code>📥</code> (Move to backlog — no confirm, non-destructive) and <code>🗑</code>{' '}
                                (Delete — confirm modal). <code>📥</code> is the low-cost default; use it when Step 4
                                reveals an over-stuffed day, or mid-day when priorities shift.
                            </li>
                            <li>
                                <strong>Day rollover harvests it.</strong> When a new day starts, any intention from
                                yesterday with uncompleted linked tasks moves into the backlog automatically
                                (<code>reason: 'rollover'</code>). Intentions whose linked tasks were all completed are
                                not harvested — nothing to bring back.
                            </li>
                        </ol>

                        <SubHeading>What gets carried forward</SubHeading>
                        <p>
                            The intention title plus the ids of its <em>pending</em> (not-yet-completed) linked tasks.
                            Tasks you'd already checked off at archive time are stripped from the carried-forward list;
                            their titles appear as a small <em>✓ Done: …</em> annotation under the entry so you can see
                            what was accomplished before parking, but they're never reconstructed as work to redo.
                        </p>

                        <SubHeading>What Todoist sees</SubHeading>
                        <p>
                            Manually moving an intention to the backlog (or deleting it) clears the <code>due_*</code>{' '}
                            fields on its linked Todoist tasks — they revert to "no date" so they don't sit forever on
                            yesterday's schedule. Rollover-harvested intentions deliberately leave Todoist alone, so
                            yesterday's overdue tasks remain visible there for you to deal with on your terms. Habit-task
                            recurrences are never touched by either path — they belong to Todoist's recurrence engine,
                            not the intention flow.
                        </p>

                        <SubHeading>Bringing one back</SubHeading>
                        <p>
                            Open the sidebar's Backlog tab and click "Bring to today" on any entry. The intention
                            reappears in today's plan and its pending tasks come back as fresh <em>unclassified</em>{' '}
                            rows — you re-flow them through Step 2 (categorize + estimate) and Step 4 (schedule). Nothing
                            carries the previous estimate or session assignment forward, by design: today's plan isn't
                            yesterday's plan.
                        </p>

                        <SubHeading>Discarding</SubHeading>
                        <p>
                            "Discard" on a backlog entry asks once for confirmation, then unschedules its linked
                            Todoist tasks and drops the entry. This is the final delete — no second-level recycle bin.
                        </p>

                        <p className="text-text-light">
                            <strong>Note on Saved Sessions vs Backlog:</strong> Saved Sessions are manual-only. The
                            end-of-day auto-save was removed in v6.2 because the backlog already preserves the part of
                            yesterday that matters (unfinished intentions). Use <em>Save Day</em> from the Dashboard
                            header for deliberate snapshots; rely on the backlog for everyday spillover.
                        </p>
                    </Section>

                    <Section id="decision-tree" title='10. Decision tree — "I want to add X to my day"'>
                        <Flow>{`Is X a non-task recovery move (walk, breathe, gaze)?
├─ YES → Don't model it. True Rest will surface organically.
│        If you find yourself wanting to log it, that's the signal
│        it should be a Micro-gap instead.
└─ NO ↓

Is X today-only?
├─ YES ↓
│   Is X your primary work thread for the day?
│   ├─ YES → Deep Track: create an Intention, map a task, categorize 'main'.
│   └─ NO  → manual background: attach it as a 'background' task
│            under an existing or new intention.
│
└─ NO  (X is recurring) ↓
    Is X a once-a-day recurring thing you want to track in Todoist?
    ├─ YES → create a Habit.
    │        Add a target time to place it on the timeline, or leave it "anytime".
    │        Mark as anchor ONLY if dropping it would let the day collapse.
    │        Set seasonIds = [] for always-on, [seasonId] for season-scoped.
    │        (Saving creates a recurring Todoist task in the chosen project.)
    ├─ NO, it's a light repeatable filler (pulled when you have a gap)
    │   → create a Micro-gap. No Todoist; do it as many times as you like.
    └─ NO, it's a bigger work-thread that breaks into tasks (e.g. "learn redis")
        → add it as a Recurring focus on the active season.
          On matching days it offers a "+ Add" chip in Step 1 that seeds an intention.`}</Flow>
                    </Section>

                    <Section id="typical-day" title="11. A typical day, start to finish">
                        <p>A concrete walk-through showing all the pieces in action.</p>

                        <SubHeading>Your setup (durable, lives across days)</SubHeading>
                        <ul className="list-disc pl-5 space-y-1">
                            <li>Active season: <em>"Stabilization Q2"</em> — sleep + planning consistency + degree groundwork.</li>
                            <li>Anchor habits (always-on): <em>Morning meditation</em>, <em>Gym (M/W/F)</em>, <em>Sleep wind-down</em>, <em>Evening shutdown</em>.</li>
                            <li>Season habit: <em>Daily 15-min planning ritual</em>.</li>
                            <li>Season micro-gaps: <em>Read one section of [current systems book]</em>, <em>Algorithms warm-up (one easy problem)</em>.</li>
                            <li>Always-on micro-gaps: <em>Idea capture freewrite</em>, <em>Duolingo session</em>.</li>
                            <li>Recurring focus: <em>Learn redis</em> (Mon/Wed/Fri) — seeds an intention you break into tasks.</li>
                        </ul>

                        <SubHeading>Step 1 — Intentions</SubHeading>
                        <ul className="list-disc pl-5 space-y-1">
                            <li>Habits are <em>not</em> in the intention list. Instead, an inline chip says: <em>"6 habits will fire today — already in Today's Habits."</em></li>
                            <li>You add manually: <em>"Finish v6 capacity arithmetic"</em>, <em>"Read paper on session scheduling"</em>.</li>
                            <li>Micro-gaps don't appear here either — they surface in their own Micro-gaps panel on the dashboard. A "+ Add: Learn redis" focus chip is offered (it's M/W/F) — you click it to seed an intention.</li>
                        </ul>

                        <SubHeading>Step 2 — Refine</SubHeading>
                        <ul className="list-disc pl-5 space-y-1">
                            <li><em>Finish v6 capacity arithmetic</em> → main, 120 min.</li>
                            <li><em>Read paper on session scheduling</em> → main, 60 min.</li>
                            <li>You add a manual background: <em>"Push WIP commit before lunch"</em>, 10 min.</li>
                            <li>Habits aren't here — they live separately on the timeline / in Today's Habits.</li>
                        </ul>

                        <SubHeading>Step 3 — Sessions</SubHeading>
                        <ul className="list-disc pl-5 space-y-1">
                            <li>You lay out today's work sessions on a drag-calendar: drag an empty area to add a block, drag a block to move it, drag its edges to resize, click to rename or delete. Today started seeded from yesterday's sessions, so you only tweak what's different.</li>
                            <li>You shift the afternoon block earlier and add a short evening block. One click on the <em>"Deep Work Day"</em> template chip would have replaced the whole layout instead. <em>"Save as template"</em> stores your current layout for reuse.</li>
                            <li>These sessions are what every later surface uses — the next step's assignment, the dashboard timeline, check-ins, and capacity all follow them.</li>
                        </ul>

                        <SubHeading>Step 4 — Schedule</SubHeading>
                        <ul className="list-disc pl-5 space-y-1">
                            <li>Phase 1 (Assign): you assign manual tasks to sessions. Habits already render in the dedicated habit lane above the session blocks, positioned at their target time. They are <em>not</em> assignable to sessions.</li>
                            <li>Phase 2 (Time): side-by-side Todoist + Calendar plus a <em>"Today's habits"</em> panel listing each instance. Any habit past its target window gets a ⤴ Reschedule affordance with a time-picker; strict ones are tagged <em>"missed"</em> but still listed and reschedulable.</li>
                        </ul>
                        <p className="text-text-light text-sm">
                            Capacity badge shows the morning session is <em>tight</em> at 110%. You proceed — it's advisory. Habits do not count toward session capacity.
                        </p>

                        <SubHeading>During the day</SubHeading>
                        <ul className="list-disc pl-5 space-y-1">
                            <li>The dashboard habit lane shows 🔁 <em>Morning meditation</em> (07:00), 🔁 <em>Gym</em>, 🔁 <em>Daily planning ritual</em> (14:00), 🔁 <em>Evening shutdown</em> (22:00). The HabitInstanceCard lists them with Start/Stop/Complete/Skip/Reschedule controls.</li>
                            <li>7:02 AM — you press ▶ on Morning meditation, sit 12 minutes, press ✓. The pill turns 🎉, the recurring Todoist task is checked off.</li>
                            <li>For a main task you've started but need to pause, hit ■ on its TaskRow. Each Start→Stop is logged as its own entry in the <em>Engagement Log</em> card; pressing ▶ again starts a fresh segment. If you defer the intention to the backlog, those segments ride along as a memo.</li>
                            <li>The Micro-gaps panel lists <em>Read one section</em>, <em>Algorithms warm-up</em>, <em>Idea capture</em>, <em>Duolingo</em>. Between morning and afternoon sessions you pull <em>Algorithms warm-up</em> — ▶ Start, 12 minutes, ■ Stop (one rep, logged). Later you pull it again — it never greyed out. No Todoist, doesn't touch the task graph.</li>
                            <li>Between-session True Rest banner: <em>"Walk 5 minutes — outside if possible."</em> No tracking.</li>
                            <li>2:00 PM check-in: feeling <em>struggling</em>, work type <em>low-energy</em>. The modal shows a True Rest cue (<em>"Long-exhale breathing — 3 min"</em>) and a couple micro-gap rows. You try the breathing, then resume your main work.</li>
                            <li>3:00 PM check-in: feeling <em>stuck</em>. The avoidance prompt appears. You write: <em>"The paper's math section — I don't have the prerequisites yet."</em> Saved for later reflection.</li>
                            <li>6:30 PM — you realize you haven't done Gym yet. You press ⤴ Reschedule on the Gym row, pick 19:30. The instance just moves to 19:30 (keeping any engagement it had); the move shows up as a "⤴ Gym · 08:00 → 19:30 · Rescheduled" entry in the Engagement Log. The recurring Todoist task is untouched.</li>
                        </ul>

                        <SubHeading>End of day</SubHeading>
                        <ul className="list-disc pl-5 space-y-1">
                            <li>Habit instances: 4/4 completed (their recurring Todoist tasks were checked off as you completed each).</li>
                            <li>Main tasks: 1.5/2 completed.</li>
                            <li>Micro-gaps: 3 reps logged across the day (algorithms warm-up ×2, Duolingo ×1) — no completion, just reps in the Engagement Log.</li>
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
                                <Tr><Td>A recurring ritual done once a day</Td><Td>Habit (add <Code>targetTime</Code> to place it on the timeline, or leave it anytime). Add <Code>isAnchor</Code> if foundational.</Td></Tr>
                                <Tr><Td>A small repeatable filler you pull opportunistically</Td><Td>Micro-gap (no Todoist, repeatable, its own panel)</Td></Tr>
                                <Tr><Td>A recurring work-thread that breaks into tasks (e.g. "learn redis")</Td><Td>Recurring focus on the active season (offers a "+ Add" chip in Step 1)</Td></Tr>
                                <Tr><Td>A today-only small chore tied to an intention</Td><Td>Manual background task</Td></Tr>
                                <Tr><Td>A non-task recovery prompt</Td><Td>Don't model. True Rest handles it.</Td></Tr>
                                <Tr><Td>A filler tied to a specific focus period</Td><Td>Micro-gap with <Code>seasonIds</Code> set</Td></Tr>
                                <Tr><Td>A foundational habit that survives season changes</Td><Td>Habit with <Code>isAnchor</Code>, always-on</Td></Tr>
                                <Tr><Td>An intention you want to defer (today's too full, or plans shifted)</Td><Td>Click <Code>📥</Code> on the intention row. Bring it back from the Backlog sidebar tab on a future day.</Td></Tr>
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
                            See <Link to="/life" className="text-accent hover:underline">/life</Link> to manage your seasons and habits.
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
                <strong>Intentions</strong>, <strong>Tasks</strong>, <strong>anytime habits</strong>,{' '}
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
    { id: 'stabilizer-vs-anchor', label: '6. Kind vs Anchor' },
    { id: 'anchor-stabilizer-seasons', label: '7. Habits, Seasons, Anchors' },
    { id: 'capacity', label: '8. Session capacity' },
    { id: 'check-in', label: '9. The hourly check-in' },
    { id: 'focus-mode', label: '9b. Focus Mode' },
    { id: 'backlog', label: '9a. Intentions Backlog' },
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
