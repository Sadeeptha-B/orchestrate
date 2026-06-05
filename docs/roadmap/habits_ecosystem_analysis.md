> **What is this?** A roadmap-stage analysis of Orchestrate's habits ecosystem (habits, micro-gaps, True Rest, recurring focuses) and its Todoist integration — current behaviour, divergence scenarios, gaps — paired with a **feature-level** account of the proposed improvements: what each one *enables*, how it would be *used*, and where it sits in the overall Orchestrate feature context.
>
> This is forward-looking framing, not committed work. It complements [orchestrate_life_migration_spec.md](./orchestrate_life_migration_spec.md) (the "life OS" target), [engagement_record_strategy.md](./engagement_record_strategy.md) (the durable-record direction), and [backlog.md](../backlog.md) (the v7/v8 sketches). For current state always defer to [synthesis.md](../synthesis.md) and the code.

# Habits Ecosystem — Analysis & Feature Roadmap

---

# Part 1 — Analysis of the current ecosystem

## 1.1 The ecosystem map

Five distinct entities make up the habits ecosystem, and they are deliberately **not** unified — each has its own lifecycle, storage, and Todoist relationship:

| Entity | Storage | Todoist-backed? | Terminal/day? | Timed? | Durable record? |
|---|---|---|---|---|---|
| **Habit** (`kind:'habit'`) | `life.habits[]` → `plan.todaysHabits[]` | ✅ recurring task | ✅ (Complete advances recurrence) | optional | ❌ (resets daily) |
| **Micro-gap** (`kind:'micro-gap'`) | `life.habits[]` → `plan.todaysHabits[]` | ❌ | ❌ repeatable | never | ❌ (resets daily) |
| **Recurring focus** | `season.recurringFocuses[]` | ❌ (seeds an *intention*) | n/a | no | ❌ |
| **True Rest cue** | `life.restCues[]` | ❌ | n/a (no completion) | no | ❌ (by design) |
| **Anchor flag** | `Habit.isAnchor` | n/a | n/a | n/a | n/a |

The core architectural decision — habits live on `DayPlan.todaysHabits`, entirely separate from intentions / linkedTasks / taskSessions, and never enter session capacity — is clean and correct. The `kind` discriminator splitting by *lifecycle* (terminal-once-a-day vs. repeatable filler) rather than by category is the right abstraction.

Two compute paths are the heart of the day-of machinery:
- `computeTodaysHabitInstances` (`src/lib/habitsTodoistSync.ts`) — Todoist-gated (`'habit'` kind).
- `computeTodaysMicroGapInstances` (`src/lib/habits.ts`) — pure, no Todoist (`'micro-gap'` kind).

Both feed `REFRESH_TODAYS_HABITS` (value-stable merge, idempotent) via `useTodaysHabitsSync`.

## 1.2 Current behaviour, surface by surface

**Habit lifecycle (the well-built part).** The v6.8 "always surface, derive missed" model is genuinely good. A due-today habit is *never* hidden: strict-past-window renders greyed via `isHabitInstanceMissed` (purely derived from `now`, no persisted state, flips live as the clock crosses its window end), and the lenient "rescue" path (`isLenientPastWindow`) handles the Todoist-rolled-to-tomorrow edge case. The read path and the prune path share that one predicate so the row can't flicker.

**Reconciliation.** `ReconciliationProvider` centralizes overdue-bump + needs-sync into one provider, firing on first hydration + window focus (5-min gated). The overdue bump re-passes the existing `due_string` to give Todoist's recurrence engine unambiguous semantics. Date comparison goes through `dueDateLocal` to handle floating vs fixed-TZ.

**Skip-as-completion.** `SKIP_HABIT_INSTANCE` posts a `"Skipped via Orchestrate"` comment then `completeTask`s to advance the recurrence — a workaround for Todoist having no native skip. The Orchestrate-side `'skipped'` status preserves the user distinction.

**Micro-gaps.** Repeatable Start/Stop, rep-count + total-time badge, off-timeline, fed into the Engagement Log. Correctly excluded from sync / reconcile / capacity.

## 1.3 Todoist integration: action / scenario divergence matrix

What Orchestrate shows vs. what Todoist shows, per action — the most actionable gaps live here:

| Action | Orchestrate state | Todoist state | Divergence / risk |
|---|---|---|---|
| Complete habit in Orchestrate | `completed`, segment closed | Recurrence advances | ✅ aligned |
| Skip habit in Orchestrate | `skipped` (distinct) | Comment posted + task completed → recurrence advances | ✅ traceable; Todoist can't tell skip from done except via comment |
| Complete habit **in Todoist app** | `planned` row pruned next sync (`findStaleTodaysHabitInstances`) | advanced | ✅ — but only if instance is still `planned`; an already-*engaged* instance is preserved and won't reflect the external completion |
| **Reschedule** habit in Orchestrate | `targetTime` moves, history stamped | **No write** — `due_string` unchanged | ⚠️ Todoist (and Todoist→GCal) still show the original time. Reschedule is Orchestrate-cosmetic only and is lost at day rollover |
| Habit Start/Stop (engagement) | segments logged, live timer | No write | ⚠️ Time tracking is local-only and **not durable** (resets daily) |
| **Pause** habit (`TOGGLE_HABIT_ACTIVE`) | hidden from all surfaces | **Recurring task left intact** — keeps generating | ⚠️ Paused habit still clutters Todoist as a daily-recurring task; reconcile would treat it as overdue if it weren't filtered out by active-state |
| Missed yesterday (no action) | vanishes at rollover; no record | task sits overdue → reconcile bumps to today next session | ⚠️ **No record that it was missed** — backlog harvest covers intentions only, not habits |
| Edit habit→micro-gap | drops `todoistTaskId` | task deleted (best-effort) | ✅ aligned; orphan possible on failure (logged, non-blocking) |
| Delete habit | row pruned | task deleted (best-effort) | ✅ aligned |
| Micro-gap reps all day | rep count + segments | n/a | ⚠️ **All micro-gap history dies at day rollover** — no durable record, no streak |

**Theme:** only Complete/Skip write to Todoist. Reschedule, engagement, and pause do not — and *nothing* habit-related survives day rollover except via Todoist's own recurrence advance. The day-plan is the only home for engagement / reschedule / rep data, and it resets.

## 1.4 Configured-but-dead fields

Fields the `HabitForm` collects and persists but nothing consumes:

- **`completionRule`** (`binary`/`count`/`duration`) — stored, but no execution path branches on it. Every habit is effectively binary.
- **`failureTolerance`** ("# of misses per week before nudge") — stored, but no nudge exists and no weekly miss tracking drives it.
- **`recurrence.timesPerWeek`** — defined on the type, but the form never sets it and `recurrenceMatchesDate` returns `false` for `'weekly'` without explicit `daysOfWeek`. **"Gym 3–4×/week" cannot be expressed** as a flexible target — you must pin specific weekdays. Directly conflicts with a stated fixed life-block in the migration spec.
- **`Season.capacityBudget.maxConcurrentHabits`** — displayed in `SeasonDetail` but never enforced; no overload warning when too many habits are active.
- **`minimumViable`** — shown as text, purely informational. The obvious hook for a Minimum Viable Day / recovery mode that doesn't exist yet.
- **`triggerCue`** — shown only in the library list, not surfaced at execution time when it would actually cue behaviour.

The data model ran ahead of the behaviour: the schema anticipated features that were never wired up.

## 1.5 The biggest structural gap: no durable engagement history

Everything habit-related lives on `plan.todaysHabits`, which `freshPlan()` wipes daily. `SavedDayPlan` history only writes on manual `SAVE_DAY`. So there are no streaks, no weekly cadence, no miss tracking (so `failureTolerance` can never function), no trends, no "were anchors protected this season?". `engagement_record_strategy.md` already names the fix (`life.engagementHistory`). This is the keystone: most of the migration spec's Phase-2/3 ambitions (drift detection, review loops, cadence) are blocked on a durable per-day habit record existing.

## 1.6 The through-line

The habit *lifecycle engine* (compute → reconcile → missed/rescue → skip-as-complete) is mature and carefully built. The gaps cluster in two places:
1. **Todoist write coverage is partial** — reschedule / engagement / pause don't propagate, so Orchestrate and Todoist diverge under exactly the actions a real user takes mid-day.
2. **Nothing is durable below the day** — which both leaves several form fields as dead config and blocks the entire spec Phase-2/3 vision (cadence, streaks, review, drift, recovery).

---

# Part 2 — The improvements at a feature level

This part reframes the gaps above as *features*: what each one enables, how the user would actually use it, and where it fits in Orchestrate's overall feature context (the daily wizard → dashboard execution loop sitting under a seasons-and-habits life layer).

The improvements fall into three tiers of effort. Within each, the framing is **enables → usage scenario → feature context**.

## 2.1 Low-hanging fruit — closing the "lies and leaks"

These are small fixes that make existing surfaces honest. Their shared theme: today the app *implies* capabilities it doesn't have, and *leaks* state into Todoist. Fixing them raises trust in the companion without new conceptual weight.

### Flexible weekly cadence ("N times per week")
- **Enables:** expressing a goal as a *frequency* ("gym 3–4× this week") instead of fixed weekdays. Wires up the already-typed `recurrence.timesPerWeek`.
- **Usage scenario:** The user adds "Gym" as a habit with "3× per week, any day." On Monday it surfaces as an available anchor; once completed three times across the week, it stops nagging. No more pretending Tuesday/Thursday/Saturday are the only valid gym days.
- **Feature context:** This is the single concrete life-block the migration spec names that the current model *cannot represent*. It bridges the Day layer (today's instance) and the Week layer (cadence) the spec asks for — a small step that makes the weekly horizon real for the first time.

### Pause that doesn't leak into Todoist
- **Enables:** pausing a habit without leaving an orphaned recurring task generating clutter (and false overdue noise) in Todoist.
- **Usage scenario:** The user pauses "Reading" for a heavy degree week. Today, the Todoist task keeps firing daily and piling up overdue. After the fix, pause offers to suspend the Todoist task too, and resuming restores it.
- **Feature context:** Reinforces the principle that Orchestrate and Todoist stay coherent. Pausing is reversible by design; the Todoist side should mirror that reversibility.

### Trigger cue at execution time
- **Enables:** the `triggerCue` ("After waking, before phone") actually doing its job — cueing behaviour where the user acts, on the dashboard instance card, not buried in the library.
- **Usage scenario:** When "Morning meditation" surfaces on the dashboard, the user sees "After waking, before phone" right on the row, reinforcing the intended trigger chain.
- **Feature context:** Habits are about *automaticity*; the cue is the behavioural lever. Surfacing it at execution time is the difference between a cue being documentation vs. a prompt.

### Reschedule honesty (local-only label, or optional Todoist write)
- **Enables:** the user knowing whether moving a habit's time actually moved it in Todoist/Calendar, or just locally.
- **Usage scenario:** The user drags meditation from 7:00 to 8:00. Either the change writes through to Todoist (so the GCal mirror updates) or the UI clearly tags it "local only for today." No silent divergence.
- **Feature context:** Reschedule is core to the "recontextualize mid-day" loop. It must not quietly lie about where the change landed.

### Capacity / concurrent-habit guardrail
- **Enables:** `maxConcurrentHabits` finally meaning something — a soft banner when a season has more active habits than its budget.
- **Usage scenario:** During a Stabilization season budgeted for 4 habits, the user adds a 6th. A non-blocking banner notes they're over the season's habit budget and suggests pausing one.
- **Feature context:** Directly serves the spec's "make capacity visible / warn early / reduce decision load" principles, applied at the *life* layer rather than the per-session layer where capacity arithmetic already exists.

### Retire or back the dead fields
- **Enables:** trust. `completionRule` and `failureTolerance` currently present choices that do nothing.
- **Usage scenario (interim):** until count/duration completion and miss-nudges exist, these fields are hidden so the form only offers what the app honours.
- **Feature context:** An opinionated companion shouldn't ship configuration theatre. Either implement or hide.

## 2.2 Medium — the durable record and what it unlocks

This tier is anchored on one keystone feature; the rest are surfaces built on top of it.

### `life.engagementHistory` — the durable per-day record (keystone)
- **Enables:** a compact, persistent rollup appended at day rollover — per habit: completed / skipped / missed; per micro-gap: rep count. The first time anything habit-related survives past midnight.
- **Usage scenario:** Quietly invisible on its own — but it's the substrate every feature below reads from.
- **Feature context:** Today Orchestrate is a *day-execution engine* with amnesia between days. This is the seam where it starts becoming a *life system*. Five separate spec items (streaks, weekly cadence, miss-tracking, review, drift) collapse onto this one foundation. It is the highest-leverage single move in the entire ecosystem.

### Native streaks & weekly cadence rollup
- **Enables:** "🔥 12-day meditation streak," "Gym 2/3 this week" — momentum and cadence visible on `/life` and the instance card.
- **Usage scenario:** The user opens `/life` and sees which anchors are holding and which are slipping this week, at a glance, before planning the day.
- **Feature context:** Turns habits from per-day to-dos into *tracked commitments*. Streaks are the motivational layer; weekly cadence is the bridge to the Week horizon the spec wants. This is also what finally makes `failureTolerance` functional (a miss-count to compare against).

### Habit miss capture at rollover
- **Enables:** missed habits being *recorded* instead of silently evaporating — mirroring how unfinished intentions already harvest to the backlog.
- **Usage scenario:** The user skips meditation three days running; the record knows, so streaks break correctly and (later) drift detection has signal.
- **Feature context:** Parity with the intentions backlog. Right now habits are second-class at rollover; this closes that asymmetry.

### Micro-gap rep persistence
- **Enables:** micro-gaps getting streaks and totals too ("480 flashcards this season"), not just same-day rep counts.
- **Usage scenario:** The user sees that their flashcard micro-gap has accumulated real volume over weeks, validating the "fill the gaps" behaviour.
- **Feature context:** Micro-gaps were introduced as the low-friction filler; persistence is what makes the small moves *add up* visibly, which is the entire psychological point of the pattern.

## 2.3 Extensive — the executive-function companion layer

These are the migration spec's "life OS" features. They depend on the durable record (2.2) and represent the largest conceptual additions.

### Minimum Viable Day / Recovery mode
- **Enables:** a one-tap reduced day that assembles anchor habits + their `minimumViable` strings into a stripped-down plan ("5-min sit, gym = walk, sleep on time").
- **Usage scenario:** On a low-energy or overloaded day, the user switches to Recovery mode. Side projects vanish, only anchors remain, each shown at its minimum-viable bar. The day stays *continuous* instead of collapsing into disengagement.
- **Feature context:** This is where `minimumViable` and `isAnchor` finally earn their place in the schema. It operationalizes the spec's central principle — "support recovery, not just execution" — and is the headline of the backlog's v7.

### Drift / overload detection
- **Enables:** the app noticing trouble before the user does — repeated misses, low completion, frequent reschedules, too many active habits — via `useDriftSignals` over the engagement record.
- **Usage scenario:** After a week of slipping anchors and reshuffled plans, the dashboard gently suggests switching to Recovery mode and narrowing the plan to essentials.
- **Feature context:** Moves Orchestrate from *reactive* (hourly check-ins ask how you feel) to *proactive* (it tells you when the frame is collapsing). The spec frames this as the leap from a good planner to an executive-function companion.

### Weekly & seasonal review
- **Enables:** structured reflection that reports anchor protection and cadence per season ("Did the season's purpose happen? Were the anchors protected?").
- **Usage scenario:** Sunday review shows the week's habit cadence, what slipped, what to repeat or cut — feeding the next week's plan instead of relying on memory.
- **Feature context:** Closes the loop the spec describes (saved history → review loops). Review is the layer that makes seasons *self-correcting* rather than set-and-forget.

### Recurring-focus follow-through tracking
- **Enables:** knowing whether a season's recurring focuses ("Learn Redis") actually got worked, not just whether they were seeded.
- **Usage scenario:** A season's review shows each recurring focus with the days it was actually engaged, so the user can tell maintenance from neglect.
- **Feature context:** Recurring focuses are today fire-and-forget (manual seed, dedup via `seededFocusIds`, no outcome record). Tracking follow-through makes the Season layer accountable for its work-threads, completing the Life-direction → Season → Day chain the spec lays out.

## 2.4 Sequencing and the single highest-leverage move

The recommended order respects the dependency structure:

1. **Low-hanging fruit (2.1)** — independent, ship anytime; immediate trust + the gym-cadence unblock.
2. **`life.engagementHistory` (2.2 keystone)** — the prerequisite gate.
3. **Streaks / cadence / miss-capture / micro-gap persistence (rest of 2.2)** — built directly on the record.
4. **Recovery mode, drift detection, review, focus tracking (2.3)** — the companion layer, each reading the record.

If only one thing gets built: **`life.engagementHistory`**. It is the foundation under streaks, weekly cadence, miss-tracking, review loops, and drift detection — five spec items on one base. The flexible-weekly-cadence fix is the best *standalone* quick win, because it unblocks a concrete, stated life block (gym) that the current model literally cannot represent.
