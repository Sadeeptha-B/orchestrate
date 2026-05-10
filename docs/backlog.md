> **What is this?** Forward-looking feature proposals that are **not yet implemented**. Each item below is a candidate direction, not a committed plan.
>
> When an item ships: write the implementation plan into [history/](./history/) (e.g. `plan_v5.md`), append a narrative entry to [history/iterations.md](./history/iterations.md), update [synthesis.md](./synthesis.md) to reflect the new current state, and remove the item from this file.
>
> See [vision.md](./vision.md) for the durable "why" and [synthesis.md](./synthesis.md) for the current state.

# Orchestrate — Backlog

## Session capacity arithmetic

**Summary.** When the user assigns tasks to a session, sum their estimates and compare against the session's available time (minus a tunable buffer for inefficiencies). Warn when assignments exceed capacity. When the user is currently within a session, compute against *remaining* time, not total.

**Original text** (Iteration 5, `requirement.md` pre-refactor, preserved verbatim):

> The next feature improvement I want is some further sophistication in the estimation and scheduling.
>
> After estimating tasks in step 2, the user is to schedule them into sessions in step3, first at a high level and then into specific slots. So, as the user schedules items into a session, we should compute how much time that is in aggregate and compare that against the total time in the session - 1h (As buffer time for inefficiencies, make the buffer time tunable).
>
> If the time is too much, the user is invited to go back to the previous step and break a task down into two or to move an item to a different session. If the user is currently within a session, the time computation must be intelligent to compute within the remaining time in the session instead of the total time.

**Open questions** (not in the original — flagged for resolution before implementation):

- Default buffer is "1h". Where is the tunable stored — `AppSettings` (per-user persistent) or per-day on the plan?
- Background tasks have estimates capped at 30 min and can be assigned to multiple sessions. Do they count once-per-session against capacity, or are they excluded from capacity arithmetic since they're nudges?
- Is the over-capacity signal blocking (cannot advance) or advisory (warning banner, can proceed)? The Iteration 5 phrasing — *"the user is invited to go back"* — reads advisory.

**Provisional positions** (from [history/plan_v5.md](./history/plan_v5.md), to be confirmed when v6 is planned):
- Buffer in `AppSettings` (persistent default).
- Background tasks count once-per-session.
- Advisory only — never blocks the wizard.
- Reuse `Season.capacityBudget.weeklyGrowthHours` (introduced in v5) as the soft weekly aggregator alongside per-session arithmetic.

## Modes, rituals, recovery (sketched in plan_v5)

Targeted for v7. See [history/plan_v5.md](./history/plan_v5.md) "v7 — Modes, Rituals, Recovery" for the sketch:
- `DayPlan.mode: 'focus' | 'maintenance' | 'recovery' | 'shutdown' | 'review'`.
- Mode switcher card on Dashboard (manual; signal-driven suggestions in v8).
- `RitualPlayer` for state transitions, with seed templates (morning launch, shutdown, recovery reset, weekly review prep).
- "Apply Minimum Viable Day" one-click reduced template.
- v7 also fully removes the deprecated `Intention.isHabit` and `LinkedTask.isHabit` flags.

## Reviews, drift detection, hierarchical views (sketched in plan_v5)

Targeted for v8. See [history/plan_v5.md](./history/plan_v5.md) "v8 — Reviews, Drift Detection, Hierarchical Views":
- `useDriftSignals()` hook aggregating missed check-ins, repeated reschedules, low completion, sleep deficit.
- `/review` route with weekly + seasonal flows; persists to `LifeContext.reviews`.
- `/week` cadence view drawing from `history`.
- Expanded `/life` with current-week anchor cadence rollup.
