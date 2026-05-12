> **What is this?** A mental-model + how-to guide for the entities Orchestrate uses to model your day: **Habits** (stabilizer / light-coherent), **Intentions**, **LinkedTasks** (main / background), **Light Pool**, **True Rest**, and **Capacity**. Use this as your quick reference. For the higher-level overview see [synthesis.md](./synthesis.md); for types and reducer actions see [data-model.md](./data-model.md).
>
> **Reflects:** v6.

# Orchestrate — User Guide

## 1. The big picture

Orchestrate models the day in **two persistence layers** and surfaces work through **three execution pathways** plus a non-task **recovery track**.

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

      Pathway A: Deep Track      → Main task in a session
      Pathway B: Stabilizer      → Auto-injected intention → background task in sessions
      Pathway C: Light Pool      → Logged-only HabitLogEntry, never enters task graph

      + Manual background        → Small today-only nudges inside an intention
      + True Rest                → Static recovery cues (no logging, no completion)
      + Capacity                 → Advisory arithmetic surrounding all of the above
```

---

## 2. Two persistence layers

| Layer | Where it lives | Lifetime |
|---|---|---|
| **LifeContext** | `orchestrate-life-context` | Durable. Survives daily resets. Holds Seasons + Habits + active-season pointer. |
| **DayPlan** | `orchestrate-day-plan` | Auto-resets when `date !== todayISO()`. Holds today's Intentions, LinkedTasks, session assignments, check-ins, and the v6 `habitLog`. |

User preferences (`AppSettings` — capacity defaults, session slots, encrypted Todoist token) live in their own durable key.

---

## 3. The Habit entity (v6)

A `Habit` is a durable recurring entity in `LifeContext`. It has two **orthogonal** classifications:

- **`kind: 'stabilizer' | 'light-coherent'`** — drives **behavior**.
- **`isAnchor: boolean`** — drives **protection**.

…plus the usual fields: `recurrence`, `minimumViable`, `triggerCue`, `completionRule`, `failureTolerance`, `seasonIds`, `active`, `autoLinkTodoistId?`, `maxBlockMinutes?`.

`kind` and `isAnchor` answer different questions; you can mix them freely (see §6).

---

## 4. The three execution pathways

Each pathway is a different route from intent to action. Pick by use case, not by reflex.

### 4.1 Pathway A — Deep Track (Main task)

```
You create an Intention manually
  → map a Todoist task to it in Step 1
  → categorize 'main' in Step 2 (no cap)
  → assign to ONE session in Step 3 (exclusive)
  → execute; completion writes back to Todoist
```

**For:** sustained, focused, today-specific work threads. The "primary intellectual pursuit" of the day.

**Examples:**
- *"Implement the v6 capacity arithmetic"* — coding intention, 2hr estimate.
- *"Finish chapter 3 of the textbook"* — study intention, 90 min estimate.
- *"Draft the project proposal"* — writing intention, 60 min estimate.
- *"Refactor authentication module"* — code intention, 3hr estimate (consider breaking down — wizard will nudge above 60 min).
- *"Read paper X end-to-end and write summary"* — research intention, 75 min estimate.

**Signature:** big enough to need a dedicated session block; specific to today.

### 4.2 Pathway B — Stabilizer ritual

```
Habit { kind: 'stabilizer', active, recurrence matches today }
  → INJECT_HABIT_INTENTIONS at Step 1 entry creates an Intention { sourceHabitId }
  → user maps a Todoist task (or autoLinkTodoistId pre-fills)
  → LINK_TASK forces LinkedTask.type = 'background' (locked, cannot change in Step 2)
  → assigned to one or many sessions in Step 3
  → Step 2 cap = habit.maxBlockMinutes ?? taskCapDefaults.stabilizer (30 min default)
```

**For:** anchor-style rituals that need to live in a slot and have protection. The "non-negotiables" and "important recurring practices."

**Examples (anchor stabilizers — the foundation):**
- *Morning meditation* — daily, 5–15 min, `autoLinkTodoistId` set to a recurring Todoist task.
- *Sleep wind-down* — daily, evening slot.
- *Gym workout* — Mon/Wed/Fri, 45 min `maxBlockMinutes`.
- *Evening shutdown ritual* — daily, 10 min.
- *Take medication* — daily, 5 min (binary completion).

**Examples (non-anchor stabilizers — recurring but not foundational):**
- *Daily standup attendance* — weekdays, 15 min.
- *Daily journal* — daily, 10 min.
- *Evening planning ritual* — daily, 15 min.
- *Weekly review* — weekly (Sunday), 30–45 min.

**Signature:** recurs on a schedule; you want to be reminded daily; deserves a slot in the day.

### 4.3 Pathway C — Light Pool (logged-only)

```
Habit { kind: 'light-coherent', active, recurrence matches today, season-scoped }
  → getLightPoolHabits filters today's pool
  → surfaces in LightPoolPanel (Dashboard) + LightPoolSection (/life)
  → also surfaced in CheckInModal when feeling/work-type indicates low resources
  → user clicks Start → LOG_HABIT_START writes a HabitLogEntry to plan.habitLog
  → user clicks Done → LOG_HABIT_COMPLETE fills completedAt + durationMinutes
  → NEVER becomes an Intention. NEVER becomes a LinkedTask. NEVER touches taskSessions.
```

**For:** the "Light Coherent Track" — small, resumable, coherent activities you pull from during micro-gaps. Replaces the impulse to open YouTube or Hacker News.

**Examples (season-scoped — tied to current focus):**
- *Anki / flashcard review* — during a learning season (e.g., "Spanish sprint", "Algorithms refresh").
- *Read one section of [current technical book]* — during a "Systems study" season.
- *Practice scales (10 min)* — during a music-learning season.
- *Sketch one figure* — during an "art practice" season.
- *Re-skim morning notes* — during a research-heavy season.

**Examples (season-agnostic — general novelty / curiosity):**
- *Idea capture / freewrite* — 5 min brain dump.
- *Read one essay from current queue* — general reading habit.
- *Duolingo session* — ambient language drill.
- *Walk + audio note* — thinking time.
- *Review a Pocket / Instapaper save* — light input.

**Signature:** small (≤ 20 min default), resumable, opportunistic. You pull when you have a gap, not on a schedule. Cadence is loose (`timesPerWeek` soft target).

### 4.4 Manual background tasks (the fourth pathway, lighter-weight)

```
You create an Intention manually
  → map a Todoist task in Step 1
  → categorize 'background' in Step 2 (cap = taskCapDefaults.manualBackground, default 30 min)
  → assign to one or many sessions in Step 3
```

Not from a Habit. Today-specific. Small. Tied to an intention.

**For:** small one-off nudges that should be visible in the day's plan but shouldn't crowd a session.

**Examples:**
- *"Reply to recruiter email"* — under a job-search intention.
- *"Push WIP commit before lunch"* — under a coding intention; small but you want it in a slot.
- *"Schedule dentist appointment"* — today's logistics, one-off.
- *"Send invoice for Q1 contract"* — under a freelance intention.
- *"Skim the arxiv paper Alice sent"* — under a research intention; not primary reading, but you want it visible.
- *"Print parking pass for tomorrow"* — admin one-off.
- *"Drink 2L water"* — multi-session nudge; assigned to 2–3 sessions.
- *"Stretch between sessions"* — multi-session nudge.
- *"Reply to PR review comments"* — under the same intention as the feature work.

**Decision rule vs. light-coherent:**
- If it **recurs** (matches a recurrence rule, you'd want it back next week) → make it a light-coherent Habit instead.
- If it's **just for today** and tied to an intention → manual background.

In practice, manual background is now a much smaller bucket than pre-v6: just "small chores attached to today's intentions."

---

## 5. True Rest (the fifth surface, not a pathway)

True Rest is **not** in any of the three pathways. It's a fourth layer: non-task, non-logged, non-tracked recovery cues.

- **Source:** static catalog in [src/data/restCues.ts](../src/data/restCues.ts) (~8 cues across `physical | breath | sensory`).
- **Three surfaces:**
  1. **Dashboard side rail** (`variant='card'`, rotates every 5 min) — always visible.
  2. **Check-in modal** (`variant='inline'`) — when `feeling ∈ {struggling, stuck}` or `workType ∈ {low-energy, restless}`.
  3. **Between-session banner** (`variant='banner'`) — gated by `useCurrentSession().nextSessionStartsWithin(60)`.
- **Catalog examples:** *Walk 5 minutes*, *Box-breath: in 4 / hold 4 / out 4 / hold 4*, *Eyes closed — no input, no agenda*, *Window-gaze*, *Long-exhale breathing*, *Drink a full glass of water*, *Stretch — neck, shoulders, hips*, *Sit in silence*.

**Why separate from light-coherent?** The point of True Rest is *no cognitive load*. No decision to log, no checkbox, no streak. If you wanted to log a walk, you'd model it as a light-coherent Habit. True Rest is the deliberately untracked corner.

---

## 6. Stabilizer vs Anchor — orthogonal classifications

They look overlapping. They aren't.

| Flag | Question it answers | What it controls |
|---|---|---|
| `kind: 'stabilizer'` (vs `'light-coherent'`) | **What behavior** does this habit have? | Auto-injects as intention; locks the linked task to `background` in Step 2. |
| `isAnchor: true` | **How protected** is it? | Cannot be deleted while active. `DELETE_HABIT` no-ops; the UI offers "deactivate first." Surfaced as the "anchor habits" set on `/life` and the Welcome Life card. |

All four combinations are meaningful:

| `kind` | `isAnchor` | Use case | Examples |
|---|---|---|---|
| `stabilizer` | `true` | The foundation. Non-negotiable; the day collapses without it. | Sleep wind-down, morning meditation, gym, evening shutdown, medication. |
| `stabilizer` | `false` | Recurring ritual that you want injected daily, but might retire without ceremony. | Daily standup attendance, daily journal, evening planning. |
| `light-coherent` | `true` | Unusual but valid — a micro-gap practice you want protection on. | Long-form weekly reading you don't want to delete on a whim. |
| `light-coherent` | `false` | The typical Light Pool fare. | Flashcards, idea capture, language drills, sketches. |

**Mental model:**

- **`isAnchor`** answers *"which habits, if dropped, would let the day collapse?"* — a strictly smaller subset than stabilizer.
- **`kind`** answers *"how does this habit surface — slotted-and-scheduled, or pulled-from-a-pool?"*

The pre-v6 word "anchor" was carrying double duty (foundational + auto-recurring). Now `kind: 'stabilizer'` carries the recurring semantics; `isAnchor` is purely "protected / foundational."

---

## 7. Anchors, Stabilizers, and Seasons — how they interact

`Habit.seasonIds: string[]` is the third axis. Three rules govern how it composes with the previous two:

1. **`seasonIds: []` means always-on.** The habit appears regardless of which season is active.
2. **`seasonIds: [X]` means season-scoped.** The habit only enters today's pool / auto-injection when season X is active.
3. **Season membership doesn't change `kind` or `isAnchor`.** Habits keep their classifications across seasons.

### 7.1 The "always-on anchor" principle

**Anchors should generally be season-agnostic (`seasonIds: []`).** Why? Because anchors are the foundation. If you lose your sleep anchor when switching from "Degree Push" to "Stabilization" season, that's a bug — the anchor *is* the foundation across all seasons. Sleep, meditation, gym, shutdown survive every season change.

Conversely, **season-scoped habits should generally not be anchors.** The season ending naturally retires them — protection is overkill and creates friction at season transitions.

### 7.2 The four useful combinations

| `kind` | `isAnchor` | `seasonIds` | What it represents |
|---|---|---|---|
| `stabilizer` | `true` | `[]` | **The foundation.** Sleep, meditation, gym, shutdown. Cross-season. Most users have 3–6 of these. |
| `stabilizer` | `false` | `[seasonId]` | **A season's ritual.** Daily research log during a "Research push" season; daily writing during a "Drafting" season. Auto-injects while the season is active; quietly retires when the season ends. |
| `light-coherent` | `false` | `[seasonId]` | **A season's micro-practice.** Spanish flashcards during a "Language sprint"; algorithms drills during an "Interview prep" season. Surfaces in the Light Pool only while that season is active. |
| `light-coherent` | `false` | `[]` | **Novelty / curiosity.** General reading, idea capture, ambient practices that aren't tied to any one season. Survives every season change. |

### 7.3 Season activation lifecycle

When you activate season Y:
- Habits with `seasonIds: [Y, …]` start appearing in Today's plan (stabilizers) or Light Pool (light-coherent).
- Habits with `seasonIds: [X]` (previous season) disappear from Today's view but are not deleted. They sit dormant in the habit library; reactivating season X brings them back.
- Habits with `seasonIds: []` (always-on) ride through unchanged.
- Anchors are protected from deletion regardless of season — even between seasons.

**Practical implication:** when designing a new season, you create three buckets of habits to attach to it:
1. The **stabilizer rituals** that define this season's daily structure (e.g., daily research log).
2. The **light-coherent micro-practices** that support it (e.g., flashcards for the relevant skill).
3. Leave existing **anchor stabilizers always-on** — don't reattach them to the season.

---

## 8. Session capacity (advisory)

Surrounds the three pathways. Pure utility, never gates.

- **Computation:** `totalMinutes = sessionLength − sessionBufferMinutes`. `assignedMinutes = Σ estimatedMinutes` for tasks in the session. Background tasks count **once per assignment** (a 20-min task in two sessions counts 20 against each).
- **Status thresholds:** `ok` < 100%, `tight` ≥ 100%, `over` > 150%.
- **Mid-session:** `totalMinutes` shrinks to remaining wall-clock; buffer shrinks proportionally. So the badge ticks down as the day moves.
- **Where it shows:**
  - Step 3 timeline: per-session badge (e.g., `47/120 min`); banner above the timeline if any session is `over`.
  - Dashboard `CurrentSession`: remaining-time pill and `over` banner (if applicable).
- **Never blocks.** Even at 200% the wizard advances. Visibility > prevention.
- **Light Pool entries are excluded.** They're outside the task graph entirely.

**How to read the badge:**
- *Grey* (`ok`) — you have headroom.
- *Amber* (`tight`) — you're at or over capacity but within the tolerance band. Likely fine if estimates are conservative.
- *Red* (`over`) — meaningfully overcommitted (>150%). Consider moving a task, breaking one down, or accepting that some won't land. The wizard won't stop you.

---

## 9. The check-in as decision point

The hourly check-in is where the system reads your state and offers the right pathway.

- `feeling: 'great'` + on track → no extra surfacing. Stay in Pathway A.
- `workType: 'low-energy' | 'restless'` OR `feeling: 'struggling' | 'stuck'` → modal surfaces **1–2 Light Pool rows (Pathway C) + a True Rest cue**. You pick: a smaller move or a real reset.
- `feeling: 'stuck'` → adds the **"What exactly are you avoiding?"** capture (persisted as `CheckIn.avoidanceNote`). The note feeds later pattern-spotting.

Capacity status feeds in passively — if the current session is `over`, the Dashboard banner is already visible above this same check-in, contextualizing why "struggling" might be more than psychological.

---

## 10. Decision tree — "I want to add X to my day"

```
Is X a non-task recovery move (walk, breath, gaze)?
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
          [] for general novelty / curiosity practices.
```

---

## 11. A typical day, in pathways

A concrete walk-through to anchor the model.

**Setup (LifeContext, durable):**
- Active season: *"Stabilization Q2"* — primary theme: sleep + planning consistency + degree groundwork.
- Anchor stabilizers (always-on, `seasonIds: []`): *Morning meditation*, *Gym (M/W/F)*, *Sleep wind-down*, *Evening shutdown*.
- Season stabilizer (`seasonIds: ['stabilization-q2']`): *Daily 15-min planning ritual*.
- Season light-coherent (`seasonIds: ['stabilization-q2']`): *Read one section of [current systems book]*, *Algorithms warm-up (one easy problem)*.
- Always-on light-coherent (`seasonIds: []`): *Idea capture freewrite*, *Duolingo session*.

**Step 1 — Intentions (Wizard):**
- Auto-injected (stabilizer pathway): *Morning meditation*, *Gym*, *Daily planning ritual*. Each carries 🔁 Habit badge + Skip for today option.
- User-added (deep track): *"Finish v6 capacity arithmetic"*, *"Read paper on session scheduling"*.
- (Light-coherent habits do NOT appear here.)

**Step 2 — Refine:**
- *Morning meditation* → background, locked, capped at 15 min (`habit.maxBlockMinutes`).
- *Gym* → background, locked, capped at 45 min.
- *Daily planning ritual* → background, locked, capped at 30 min (per-kind default).
- *Finish v6 capacity arithmetic* → main, 120 min.
- *Read paper on session scheduling* → main, 60 min.
- User adds a manual background under the v6 intention: *"Push WIP commit before lunch"*, 10 min.

**Step 3 — Schedule:**
- Early morning: *Morning meditation* + *Gym*.
- Morning: *Finish v6 capacity arithmetic* (main).
- Afternoon: *Read paper* (main) + *Daily planning ritual* + *Push WIP commit* (background).
- Night: *Evening shutdown* (auto-injected, separate flow if recurrence matches).

Capacity badge shows the morning session is `tight` at 110% — advisory, user proceeds.

**During the day:**
- Light Pool panel on the Dashboard lists *Read one section*, *Algorithms warm-up*, *Idea capture*, *Duolingo*. User pulls *Algorithms warm-up* between morning and afternoon sessions — Start logged, completed 12 min later. Writes to `plan.habitLog`. Does not touch task graph.
- Between-session True Rest banner: *"Walk 5 minutes — outside if possible."* No tracking.
- 14:00 check-in: `feeling: 'struggling'`, `workType: 'low-energy'`. Modal surfaces 1–2 Light Pool rows + a True Rest cue (*"Long-exhale breathing — 3 min"*). User picks the True Rest, then resumes Pathway A.
- 15:00 check-in: `feeling: 'stuck'`. Modal adds the avoidance prompt: *"What exactly are you avoiding?"* → user types *"The paper's math section — I don't have the prerequisites yet"*. Persisted on the check-in.

**End of day:**
- Stabilizer tasks: 3/3 completed (recorded as LinkedTask completions, syncs to Todoist).
- Main tasks: 1.5/2 completed.
- Light Pool log: 2 entries (algorithms warm-up done, Duolingo done; flashcards and reading skipped today).
- True Rest surfaced but not tracked.

---

## 12. Quick reference — what goes where

| You want to model… | Use… |
|---|---|
| A today-only big work thread | Main task (Pathway A) |
| A recurring ritual that needs a slot | Stabilizer Habit (Pathway B). Add `isAnchor: true` if foundational. |
| A small recurring practice you pull opportunistically | Light-coherent Habit (Pathway C) |
| A today-only small chore tied to an intention | Manual background task |
| A non-task recovery prompt | Don't model. True Rest covers it. |
| A practice tied to a specific focus period | Light-coherent Habit with `seasonIds: [seasonId]` |
| A foundational habit that survives season changes | Stabilizer Habit with `isAnchor: true`, `seasonIds: []` |

---

## See also

- [synthesis.md](./synthesis.md) — overview of Orchestrate's purpose and full feature inventory.
- [data-model.md](./data-model.md) — exact type signatures, reducer actions, migration chain.
- [architecture.md](./architecture.md) — provider tree, routing, components, persistence layout.
- [history/plan_v6.md](./history/plan_v6.md) — the implementation record for the v6 split that this guide describes.
