> **What is this?** A guide to how Orchestrate thinks about your day — and how you can use that to get more done with less friction. Covers **Habits**, **Intentions**, **Tasks**, the **Light Pool**, **True Rest**, and **Capacity**. For the technical overview see [synthesis.md](./synthesis.md); for exact types and actions see [data-model.md](./data-model.md).
>
> **Reflects:** v6.2 — Intentions Backlog. Discarded intentions can be parked in `life.backlog` rather than deleted; day rollover harvests unfinished intentions automatically. Completed tasks are preserved as read-only context on backlog entries (`completedTaskTitles`) rather than rebuilt as fresh work on restore. EoD auto-save was removed in this iteration — `SavedDayPlan` history is now manual-save-only. The v6.1 habit-as-task decoupling (stabilizers as recurring Todoist tasks surfaced directly as session-assigned tasks) remains the baseline.

# Orchestrate — User Guide

## 1. How Orchestrate sees your day

At its core, Orchestrate divides your world into two layers:

- **The stuff that persists across days** — your seasons, your habits, your routines. These survive when the day resets.
- **Today's plan** — your intentions, the tasks you've linked to them, which session each task lives in, and how you're feeling throughout the day. This resets every morning.

On top of that, there are **three ways work can flow** through your day, plus a recovery layer that deliberately stays off the grid:

```
                    LifeContext (durable, multi-day)
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
      + Capacity           → Advisory math that tells you if you're overloaded
```

---

## 2. Where your data lives

| Layer | What it holds | How long it lasts |
|---|---|---|
| **LifeContext** | Seasons, Habits, which season is active | Durable — survives daily resets. |
| **DayPlan** | Today's Intentions, linked tasks, session assignments, check-ins, Light Pool log | Resets every morning automatically. |
| **Settings** | Capacity defaults, session time slots, encrypted Todoist token, calendar config | Durable — independent of the day. |

You don't need to think about this much. The important takeaway: your habits and seasons are safe across day boundaries. Today's task plan is ephemeral by design.

---

## 3. Habits: the recurring backbone

A **Habit** is anything you want to do regularly — from morning meditation to flashcard reviews. Every habit has two independent settings that determine how it behaves:

### What kind of habit is it?

- **Stabilizer** (`kind: 'stabilizer'`) — a habit that needs a dedicated slot in your day. Think rituals: meditation, gym, shutdown routine. Orchestrate syncs these to Todoist as recurring tasks (in a dedicated Habits project) and surfaces them directly as session-assigned tasks each day they're due.
- **Light-coherent** (`kind: 'light-coherent'`) — a small, resumable activity you do when you have a gap. Think flashcards, short reading, idea capture. These show up in the **Light Pool** on your dashboard — you pull from them when you're ready, and they're logged but never scheduled.

### How protected is it?

- **Anchor** (`isAnchor: true`) — a habit so foundational that you don't want to accidentally delete it. Sleep, meditation, gym — the stuff your day collapses without. Anchor habits can't be deleted while active; you'd have to deactivate them first.
- **Non-anchor** (`isAnchor: false`) — a regular habit you can remove freely.

These two settings are independent. You can have any combination (see [§6](#stabilizer-vs-anchor) for all four).

---

## 4. The three ways work flows through your day

### 4.1 Deep Track — your main work

This is the big stuff. You create an intention ("Finish chapter 3"), link a Todoist task to it, mark it as **main**, give it a time estimate, and assign it to a specific session. Main tasks get a dedicated block — they're exclusive to one session.

**The flow:**
```
Create an Intention
  → link a Todoist task in Step 1
  → categorize as 'main' in Step 2
  → assign to one session in Step 3
  → work on it; completion syncs back to Todoist
```

**Good for:** sustained, focused work that's specific to today.

**Examples:**
- *"Implement the capacity arithmetic"* — coding, 2hr estimate
- *"Finish chapter 3 of the textbook"* — study, 90 min
- *"Draft the project proposal"* — writing, 60 min
- *"Refactor the auth module"* — code, 3hr (the wizard will nudge you to break this down)
- *"Read paper X and write summary"* — research, 75 min

**When to use it:** the task is big enough to need a dedicated session block, and it's specific to today.

### 4.2 Stabilizer — your daily rituals

These are habits that automatically show up as tasks every day their recurrence rule matches. You don't have to remember to add "morning meditation" — Orchestrate creates a recurring Todoist task once, and from then on it surfaces in your plan whenever it's due.

**The flow:**
```
You set up a stabilizer Habit once (e.g., "Morning meditation", daily, 07:00, 10 min)
  → Orchestrate creates a recurring Todoist task in the Habits project
     (with due_string like "every day at 7:00" and duration 10 min)
  → each matching day, if the task is due and unchecked, it appears in your plan
     as a session-assigned task — auto-placed in the session containing 07:00
  → if it can't resolve a session, it lands in the "Unassigned habits" tray on Step 3
  → completing it on the Dashboard syncs back to Todoist; tomorrow's recurrence
     is auto-created by Todoist
```

A few knobs in the form:
- **Target time** (optional but recommended) — drives session auto-assignment.
- **Duration** — pushed to Todoist as the task duration and used as the in-plan estimate.
- **Todoist project** — pick which project this habit's recurring task lives in. Leave on "Use default" to use the workspace default you set in **Settings → Integrations → Default Habits Project** (which itself defaults to a lazily-created project named "Habits"). Changing the project on an already-synced habit *moves* the recurring task to the new project.
- **Window behavior**:
  - *Surface anyway* (lenient, default) — show it whenever the Todoist task is due + unchecked, even if you're planning late.
  - *Hide for today* (strict) — if your planning time is already past `targetTime + duration`, drop it from today's plan. Streaks are preserved.

**Good for:** anchor-style rituals that need to live in a time slot.

**Examples of anchor stabilizers (the non-negotiables):**
- *Morning meditation* — daily, 5–15 min
- *Sleep wind-down* — daily, evening
- *Gym workout* — Mon/Wed/Fri, 45 min
- *Evening shutdown ritual* — daily, 10 min
- *Take medication* — daily, 5 min

**Examples of non-anchor stabilizers (recurring but flexible):**
- *Daily standup attendance* — weekdays, 15 min
- *Daily journal* — daily, 10 min
- *Weekly review* — weekly (Sunday), 30–45 min

**When to use it:** the activity recurs on a schedule, you want to be reminded about it, and it deserves a slot in the day.

### 4.3 Light Pool — your micro-gap fillers

These are small, resumable activities that you pull from when you have a window — between sessions, when your attention drifts, or when you're waiting for something. They never become intentions or scheduled tasks. You just hit **Start** when you begin, **Done** when you finish, and it gets logged.

**The flow:**
```
You set up a light-coherent Habit (e.g., "Anki flashcards", daily)
  → it shows up in the Light Pool panel on the Dashboard
  → you click Start when you have a gap → a log entry is created
  → you click Done when you finish → duration is recorded
  → it never enters your task plan. Never gets assigned to a session.
```

**Good for:** the "Light Coherent Track" — small coherent activities that replace the impulse to open YouTube or scroll Hacker News.

**Examples tied to your current season:**
- *Anki / flashcard review* — during a "Spanish sprint" season
- *Read one section of [current book]* — during a "Systems study" season
- *Practice scales (10 min)* — during a music-learning season
- *Sketch one figure* — during an "art practice" season

**Examples that aren't tied to any season:**
- *Idea capture / freewrite* — 5 min brain dump
- *Read one essay from current queue*
- *Duolingo session*
- *Walk + audio note* — thinking time

**When to use it:** the activity is small (≤ 20 min), resumable, and opportunistic. You pull when you have a gap, not on a schedule.

### 4.4 Manual background — today-only small tasks

Not every small task needs to be a Habit. If you have a quick one-off chore that's tied to one of today's intentions, you can categorize it as **background** in Step 2. Background tasks can be assigned to multiple sessions (they'll show up as nudges) and have a 30-min cap by default.

**Examples:**
- *"Reply to recruiter email"* — under a job-search intention
- *"Push WIP commit before lunch"* — under a coding intention
- *"Schedule dentist appointment"* — today's logistics
- *"Drink 2L water"* — multi-session nudge, assigned to 2–3 sessions

**Rule of thumb:** if it recurs and you'd want it back next week, make it a light-coherent Habit. If it's just for today, manual background.

---

## 5. True Rest — deliberately untracked recovery

True Rest is the one layer that has **no tracking at all**. No logging, no completion checkbox, no streak. Just gentle prompts to reset: *walk 5 minutes*, *box-breathe for 90 seconds*, *close your eyes for 2 minutes*, *look out a window*.

It shows up in three places:
1. **Dashboard side rail** — a rotating cue, always visible.
2. **Check-in modal** — when you report feeling struggling, stuck, or low-energy.
3. **Between sessions** — a banner when the next session is within 60 minutes.

**Why not just make it a light-coherent habit?** Because the whole point is zero cognitive overhead. No "should I log this?" decision. If you find yourself wanting to track walks, make that a light-coherent habit. True Rest is the deliberately untracked corner.

---

## 6. Stabilizer vs Anchor — they're not the same thing {#stabilizer-vs-anchor}

This is worth spelling out because the two labels look similar but answer different questions:

| Setting | What it controls | Question it answers |
|---|---|---|
| `kind: 'stabilizer'` | **Behavior** — syncs to Todoist as a recurring task and surfaces directly as a session-assigned task each day it's due | *"How does this habit show up each day?"* |
| `isAnchor: true` | **Protection** — can't be deleted while active | *"Would my day collapse without this?"* |

All four combinations make sense:

| Kind | Anchor? | What it means | Examples |
|---|---|---|---|
| Stabilizer | Yes | The foundation — non-negotiable, the day collapses without it | Sleep, meditation, gym, shutdown, medication |
| Stabilizer | No | Recurring ritual that lands in a session daily, but might retire quietly | Daily standup, journal, evening planning |
| Light-coherent | Yes | Unusual but valid — a micro-gap practice you want to protect | Long-form weekly reading you don't want to delete on a whim |
| Light-coherent | No | The typical Light Pool activity | Flashcards, idea capture, language drills |

**The mental shortcut:**
- `isAnchor` answers *"which habits, if I dropped them, would let the day fall apart?"*
- `kind` answers *"does this need a slot in the day, or do I pull from a pool?"*

---

## 7. How Habits, Seasons, and Anchors work together

Every habit has a `seasonIds` list — which seasons it belongs to. This is the third axis:

1. **`seasonIds: []`** (empty) means **always-on**. The habit shows up regardless of which season is active. Use this for foundational stuff.
2. **`seasonIds: ['some-season']`** means **season-scoped**. The habit only shows up when that season is active. Use this for practices tied to a specific focus period.
3. **Season membership doesn't change anything else.** A stabilizer stays a stabilizer, an anchor stays an anchor, regardless of season.

### The "always-on anchor" principle

**Anchors should almost always be season-agnostic** (empty `seasonIds`). Your sleep routine shouldn't disappear when you switch from "Degree Push" to "Stabilization" season — it's the foundation *across* seasons.

Conversely, **season-scoped habits usually shouldn't be anchors.** The season ending naturally retires them. Protection would just create friction at transitions.

### The four common patterns

| Kind | Anchor? | Season-scoped? | What it is | Example |
|---|---|---|---|---|
| Stabilizer | Yes | No (always-on) | **Your foundation.** 3–6 of these, cross-season. | Sleep, meditation, gym, shutdown |
| Stabilizer | No | Yes | **A season's ritual.** Lands in a session daily while the season is active. | Daily research log during a "Research push" season |
| Light-coherent | No | Yes | **A season's micro-practice.** In the Light Pool only while that season is active. | Spanish flashcards during a "Language sprint" season |
| Light-coherent | No | No (always-on) | **General curiosity.** Survives every season change. | Idea capture, general reading, Duolingo |

### What happens when you switch seasons

When you activate a new season:
- Habits scoped to the new season start appearing (in the plan or Light Pool).
- Habits scoped to the old season quietly disappear from today's view — but they're not deleted. Reactivating that season brings them back.
- Always-on habits ride through unchanged.
- Anchors stay protected regardless — even between seasons.

**When setting up a new season**, think in three buckets:
1. **Stabilizer rituals** for this season's daily structure (e.g., daily research log).
2. **Light-coherent micro-practices** that support it (e.g., domain flashcards).
3. **Leave your anchors alone** — they're already always-on.

---

## 8. Session capacity — your advisory dashboard

Capacity math runs across all your session assignments. It's advisory — it tells you how loaded each session is, but it never blocks you from proceeding.

**How it works:**
- Each session's available time = session length minus a buffer (configurable, default 60 min).
- Assigned minutes = sum of all task estimates in that session. Background tasks count once per assignment.
- Mid-session, the available time shrinks to whatever's left on the clock.

**What the status badges mean:**
- **Grey** (`ok`, under 100%) — you have headroom.
- **Amber** (`tight`, 100–150%) — you're at or just over capacity. Probably fine if your estimates are conservative.
- **Red** (`over`, above 150%) — meaningfully overcommitted. Consider moving or breaking down a task.

**Where it shows up:**
- Step 3 timeline — per-session badge, plus a banner if any session is `over`.
- Dashboard current session — remaining-time indicator, plus a banner if you're `over`.

**It never blocks the wizard.** Even at 200% you can proceed. The goal is visibility, not prevention.

Light Pool entries are excluded from capacity — they're outside the task graph entirely.

---

## 9. The hourly check-in

Every hour during an active session, Orchestrate asks how you're doing. This is where the system reads your state and routes you to the right response:

- **Feeling great, on track?** No extra surfacing. Keep going.
- **Struggling, low-energy, or restless?** The modal surfaces 1–2 Light Pool activities and a True Rest cue. You pick: a smaller productive move, or a genuine reset.
- **Feeling stuck?** An extra prompt appears: *"What exactly are you avoiding?"* Your answer is saved on the check-in — it feeds pattern-spotting over time.

Every check-in also asks what kind of work you're doing and suggests a matching playlist (coding → Deep Focus, lectures → Lo-Fi Beats, etc.).

If the current session is over-capacity, the Dashboard banner is already visible alongside the check-in — contextualizing why "struggling" might be more than psychological.

---

## 9a. Intentions Backlog — parking work for later (v6.2)

Not every intention you write down on Monday belongs on Monday. You overcommit, plans shift, energy fades. The **Backlog** is a persistent pool of parked intentions you can pull back into a future day, surfaced in the second tab of the left-side sidebar (the same panel that holds your Saved Sessions). The `Work Items` button in the header on every screen — Wizard, Dashboard — opens the sidebar; switch between Saved Sessions and Backlog with the tab toggle at the top of the panel. The header button shows a count suffix (e.g. `Work Items (3)`) when there's anything in the backlog.

**Two ways an intention lands in the backlog:**

1. **You park it manually.** Every intention row in Step 1 and the "Today's intentions" panel at the top of Step 3 has two small icon buttons: `📥` (Move to backlog — no confirm, non-destructive) and `🗑` (Delete — confirm modal). The 📥 path is the default, low-cost gesture. Use it when you realize at Step 3 that the day is over-stuffed, or mid-day when priorities shift.
2. **Day rollover harvests it.** When a new day starts, any intention from yesterday that still has uncompleted linked tasks is automatically moved into the backlog (with `reason: 'rollover'`). The plan resets fresh; the unfinished thought is preserved. Intentions where every linked task was completed are not harvested — there's nothing to bring back.

**What gets carried:** the intention title, plus the ids of its *pending* (not-yet-completed) linked tasks. Tasks you'd already checked off at archive time are stripped from the carried-forward list — their titles are kept as a small `✓ Done: …` annotation under the entry so you can see what you accomplished before parking, but they're never reconstructed as work to be re-done.

**What Todoist sees:** manually moving an intention to the backlog (or deleting it) also clears the `due_*` fields on its linked Todoist tasks — they revert to "no date" so they don't sit forever on yesterday's schedule. Rollover-harvested intentions deliberately leave Todoist alone, so yesterday's overdue tasks remain visible there for you to deal with on your terms. Habit-task recurrences (`sourceHabitId` set) are never touched by either path — they belong to Todoist's recurrence engine, not the intention flow.

**Bringing one back:** open the sidebar's Backlog tab and click "Bring to today" on any entry. The intention reappears in today's `plan.intentions` and its pending tasks come back as fresh `unclassified` rows — you re-flow them through Step 2 (categorize + estimate) and Step 3 (schedule). Nothing carries the previous estimate or session assignment forward, by design: today's plan isn't yesterday's plan.

**Discarding:** "Discard" on a backlog entry asks once for confirmation, then unschedules its linked Todoist tasks and drops the entry. This is the final delete — there's no second-level recycle bin.

**Note on Saved Sessions vs Backlog:** since v6.2, *Saved Sessions are manual-only*. The end-of-day auto-save was removed because the backlog already preserves the part of yesterday that matters (unfinished intentions). Use `Save Day` from the Dashboard header when you want a deliberate snapshot of a full day's plan (e.g. before a major reset, or to export); rely on the backlog for everyday spillover.

---

## 10. Decision tree — "I want to add X to my day"

```
Is X a non-task recovery move (walk, breathe, gaze)?
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
    │        (Saving will create a recurring Todoist task in the Habits project.)
    └─ NO  (X is opportunistic, pulled when you have a gap)
        → create a light-coherent Habit.
          Set seasonIds = [seasonId] if tied to current focus,
          [] for general curiosity practices.
```

---

## 11. A typical day, start to finish

Here's a concrete walk-through showing all the pieces in action.

**Your setup (durable, lives across days):**
- Active season: *"Stabilization Q2"* — sleep + planning consistency + degree groundwork.
- Anchor stabilizers (always-on): *Morning meditation*, *Gym (M/W/F)*, *Sleep wind-down*, *Evening shutdown*.
- Season stabilizer: *Daily 15-min planning ritual*.
- Season light-coherent: *Read one section of [current systems book]*, *Algorithms warm-up (one easy problem)*.
- Always-on light-coherent: *Idea capture freewrite*, *Duolingo session*.

**Step 1 — Intentions:**
- Stabilizer habit-tasks are *not* in the intention list. Instead, an inline chip says: *"4 habit tasks scheduled for today — see Step 3."*
- You add manually: *"Finish v6 capacity arithmetic"*, *"Read paper on session scheduling"*.
- Light-coherent habits don't appear here either — they live in the Light Pool.

**Step 2 — Refine:**
- *Finish v6 capacity arithmetic* → main, 120 min.
- *Read paper on session scheduling* → main, 60 min.
- You add a manual background: *"Push WIP commit before lunch"*, 10 min.
- Stabilizer habit-tasks bypass this step entirely — they already arrived as background tasks with their `targetDurationMinutes` estimate from injection.

**Step 3 — Schedule:**
- Early morning: 🔁 *Morning meditation* + 🔁 *Gym* (auto-assigned via Todoist due time).
- Morning: *Finish v6 capacity arithmetic* (main).
- Afternoon: *Read paper* (main) + 🔁 *Daily planning ritual* + *Push WIP commit* (background).
- Night: 🔁 *Evening shutdown*.
- Habit-tasks render under a "🔁 Habits" group inside each session card; if any habit-task lacks a Todoist time, it would sit in the "Unassigned habits" tray above the timeline for you to drop into a session.
- Capacity badge shows the morning session is `tight` at 110%. You proceed — it's advisory.

**During the day:**
- The Light Pool panel lists *Read one section*, *Algorithms warm-up*, *Idea capture*, *Duolingo*. Between morning and afternoon sessions, you pull *Algorithms warm-up* — Start, work for 12 minutes, Done. Logged to `habitLog`, doesn't touch the task graph.
- Between-session True Rest banner: *"Walk 5 minutes — outside if possible."* No tracking.
- 2:00 PM check-in: feeling *struggling*, work type *low-energy*. The modal shows a True Rest cue (*"Long-exhale breathing — 3 min"*) and a couple Light Pool rows. You try the breathing, then resume your main work.
- 3:00 PM check-in: feeling *stuck*. The avoidance prompt appears. You write: *"The paper's math section — I don't have the prerequisites yet."* Saved for later reflection.

**End of day:**
- Stabilizer habit-tasks: 4/4 completed (synced to Todoist; tomorrow's recurrences auto-created by Todoist).
- Main tasks: 1.5/2 completed.
- Light Pool log: 2 entries (algorithms warm-up and Duolingo; flashcards and reading skipped today).
- True Rest: surfaced but untracked, as intended.
- Tomorrow morning: the half-finished main task's parent intention is auto-harvested into the Backlog with `reason: 'rollover'`. Its already-done sibling task shows up under `✓ Done:` in the backlog row for context. You decide whether to bring it back into the new day's plan.

---

## 12. Quick reference — what goes where

| You want to model… | Use… |
|---|---|
| A today-only big work thread | Main task (Deep Track) |
| A recurring ritual that needs a slot | Stabilizer Habit (set `targetTime` + duration so it auto-lands in the right session). Add `isAnchor` if foundational. |
| A small recurring practice you pull opportunistically | Light-coherent Habit (Light Pool) |
| A today-only small chore tied to an intention | Manual background task |
| A non-task recovery prompt | Don't model. True Rest handles it. |
| A practice tied to a specific focus period | Light-coherent Habit with `seasonIds` set |
| A foundational habit that survives season changes | Stabilizer Habit with `isAnchor`, always-on (`seasonIds: []`) |
| An intention you want to defer (today is too full, or plans shifted) | Click `📥` on the intention row. Bring it back from the Backlog sidebar tab on a future day. |

---

## See also

- [synthesis.md](./synthesis.md) — overview of Orchestrate's purpose and full feature inventory.
- [data-model.md](./data-model.md) — exact type signatures, reducer actions, migration chain.
- [architecture.md](./architecture.md) — provider tree, routing, components, persistence layout.
- [history/plan_v6.md](./history/plan_v6.md) — the implementation record for the v6 changes this guide describes.
