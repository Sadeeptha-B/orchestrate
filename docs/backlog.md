> **What is this?** Forward-looking feature proposals that are **not yet implemented**. Each item below is a candidate direction, not a committed plan.
>
> When an item ships: write the implementation plan into [history/](./history/) (e.g. `plan_v7.md`), append a narrative entry to [history/iterations.md](./history/iterations.md), update [synthesis.md](./synthesis.md) to reflect the new current state, and remove the item from this file.
>
> See [vision.md](./vision.md) for the durable "why", [synthesis.md](./synthesis.md) for the current state, and the most recent shipped plan: [history/plan_v6.x.md](./history/plan_v6.x.md).

# Orchestrate — Backlog

## Modes, rituals, recovery (sketched in plan_v5)

Targeted for **v7** — the next iteration after v6.2's intentions backlog. See [history/plan_v5.md](./history/plan_v5.md) "v7 — Modes, Rituals, Recovery" for the sketch:
- `DayPlan.mode: 'focus' | 'maintenance' | 'recovery' | 'shutdown' | 'review'`.
- Mode switcher card on Dashboard (manual; signal-driven suggestions in v8).
- `RitualPlayer` for state transitions, with seed templates (morning launch, shutdown, recovery reset, weekly review prep).
- "Apply Minimum Viable Day" one-click reduced template.

## Reviews, drift detection, hierarchical views (sketched in plan_v5)

Targeted for **v8**. See [history/plan_v5.md](./history/plan_v5.md) "v8 — Reviews, Drift Detection, Hierarchical Views":
- `useDriftSignals()` hook aggregating missed check-ins, repeated reschedules, low completion, sleep deficit.
- `/review` route with weekly + seasonal flows; persists to `LifeContext.reviews`.
- `/week` cadence view drawing from `history`.
- Expanded `/life` with current-week anchor cadence rollup and the Light Pool weekly cadence already shipped in v6.
