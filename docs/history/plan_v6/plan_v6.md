# Plan v6 — Micro-gap Refinement + Capacity Intelligence

> Frozen post-implementation plan. The living docs ([synthesis.md](../synthesis.md), [data-model.md](../data-model.md), [architecture.md](../architecture.md)) reflect the result. This document preserves the *narrative* of how v6 was designed and what tradeoffs were made.

## Context

Pre-v6 the `LinkedTask.type: 'background'` bucket conflated two distinct uses: anchor-style stabilizer rituals (meditation, gym, shutdown) and small resumable micro-gap fillers (flashcards, short reading). Both were subject to the same hard 30-min cap and the same auto-injection pipeline. Separately, the previously-planned v6 (session capacity arithmetic) was still in the backlog, and the deprecated `isHabit` flags from v5 were waiting for a v7 removal.

v6 collapses all of this into a single coherent iteration: split the habit semantics, add the missing layers (Light Pool, True Rest), ship advisory capacity arithmetic, and complete the v5 deprecation. The framing was informed by a three-layer activity model — Deep Track (sustained main work), Light Coherent Track (micro-gap fillers), True Rest (non-stimulating reset).

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Split habit semantics | New `Habit.kind: 'stabilizer' | 'light-coherent'` discriminator. | Matches the three-layer model; stabilizers keep current behavior, light-coherent gets a new logged-only pathway. |
| Light Pool semantics | **Logs only** (`plan.habitLog`). Light-coherent habits never become intentions. | Cheapest to build; keeps the day's task graph clean; matches the "opportunistic micro-gap" framing. |
| Duration caps | **Per-habit `maxBlockMinutes` + per-kind defaults in `AppSettings`**. | Per-kind for sensible defaults; per-habit for the one-off "this one needs 45 min" case. |
| True Rest | Static catalog (`src/data/restCues.ts`), 3 surfaces (Dashboard side rail, low-energy check-in, between-session banner). | Mirrors the playlist catalog pattern; surfaces it contextually without making it another habit-shaped chore. |
| Capacity arithmetic variant | **Looser**: banner only at > 150% load; never blocks the wizard. | Matches plan_v5's advisory framing; pure-utility surfacing keeps user agency. |
| v6 scope | Merge micro-gap + capacity arithmetic. | Both touch the day-level execution layer; shipping together produces a coherent "day intelligence" iteration. |
| Legacy `isHabit` purge | **Pulled forward from v7**. Drop fields, action, and backfill function entirely. | Removes the semantic ambiguity now that `sourceHabitId` is the canonical "habit-derived" check. |

## Architectural shape

No new contexts. All additions land on the existing `DayPlanProvider`:

- `plan.habitLog: HabitLogEntry[]` is a new slice of `DayPlan`. Wiped daily with the rest of the plan.
- Three new actions: `LOG_HABIT_START`, `LOG_HABIT_COMPLETE`, `DELETE_HABIT_LOG_ENTRY`.
- `AppSettings` gains `taskCapDefaults: TaskCapDefaults` and `sessionBufferMinutes: number`. Both injected by `loadSettings` when absent.
- `Habit` gains required `kind: HabitKind` (`'stabilizer'` default at migration time) and optional `maxBlockMinutes`.
- `CheckIn` gains optional `avoidanceNote?: string` (only set when `feeling === 'stuck'`).
- `LifeContext.backfilledFromIsHabit` removed alongside the `backfillHabitsFromLegacy` function and `TOGGLE_TASK_HABIT` action.

## Schema versioning

Schema bumped to `_schemaVersion: 6`. The migration step (`migratePlan` v5→v6):

- Strips deprecated `isHabit` off intentions and linked tasks.
- Initializes `plan.habitLog: []` if missing.
- `loadLifeContext` defaults `Habit.kind = 'stabilizer'` for any habit that lacks one.
- `loadSettings` injects `taskCapDefaults` and `sessionBufferMinutes` defaults.

Old saved sessions remain loadable through the unchanged v1→v5 chain; on first read they pass through the new step and get stamped with `_schemaVersion: 6` on persist.

## Cross-slice invariants enforced

Carried forward from v5:
- Activating a season auto-deactivates the previously active one.
- Deleting a season clears its id from any habit's `seasonIds`.
- Deleting a habit clears `sourceHabitId` from any intentions referencing it.
- Anchor habits cannot be deleted while active.

New in v6:
- `INJECT_HABIT_INTENTIONS` filters to `kind === 'stabilizer'`. Light-coherent habits never become intentions.
- Light-coherent habits surface only via the Light Pool; the path from Habit to LinkedTask only exists for stabilizers.

## Light Pool

- `getLightPoolHabits(life, dateISO)` in `src/lib/habits.ts` is the canonical filter: `{ active, kind === 'light-coherent', habitMatchesDate(today), seasonIds.length === 0 || seasonIds.includes(activeSeasonId) }`.
- `LightPoolPanel` lives on the Dashboard between Current Session and Task Manager. Per-row Start / Done / Delete dispatch the three new log actions.
- `LightPoolSection` lives on `/life` and computes weekly cadence per light habit from `plan.habitLog` + the last 7 days of `history[].plan.habitLog`. Soft target is `recurrence.timesPerWeek` when set.
- The check-in modal surfaces 1–2 pool rows when `feeling ∈ {struggling, stuck}` or `workType ∈ {low-energy, restless}`.

## True Rest

- `src/data/restCues.ts` seeds ~8 cues across `physical | breath | sensory`.
- `TrueRestCard` has three variants: `card` (Dashboard side rail, rotates every 5 min), `inline` (check-in modal), `banner` (between-session prompt).
- The between-session banner is gated by `useCurrentSession().nextSessionStartsWithin(60)` — a new helper added to that hook.

## Capacity arithmetic

- `src/lib/capacity.ts` exports `computeSessionCapacity(session, taskSessions, linkedTasks, settings, now?)` and a `computeAllSessionCapacities` helper.
- Status thresholds: `ok` at < 100%, `tight` at ≥ 100%, `over` at > 150%.
- Mid-session (`now` inside the session window): `totalMinutes` shrinks to remaining wall-clock time; buffer shrinks proportionally.
- Background tasks count once per assignment.
- Surfaces: per-session `SessionCapacityBadge` on the Step 3 interactive `SessionTimelineBar` and on the Dashboard `CurrentSession`. `SessionCapacityBanner` above the Step 3 timeline when any session is `over`, and inside the Dashboard `CurrentSession` block when the active session is `over`. Never blocks `canAdvance`.

## Duration cap refactor

- `BACKGROUND_MAX_MINUTES = 30` constant was deleted from Step2Refine.
- Step2Refine resolves a per-task cap: habit-derived → `habit.maxBlockMinutes ?? settings.taskCapDefaults[habit.kind === 'stabilizer' ? 'stabilizer' : 'lightCoherent']`; manual background → `settings.taskCapDefaults.manualBackground`.
- `HabitForm` gained a kind toggle (Stabilizer / Light-coherent) and an optional `Max block (minutes)` input.
- `SettingsModal` gained a "Capacity" section (`CapacitySettings.tsx`) editing the per-kind defaults and `sessionBufferMinutes`.

## Legacy `isHabit` purge

- Removed `Intention.isHabit`, `LinkedTask.isHabit`, `LifeContext.backfilledFromIsHabit` from types.
- Removed `TOGGLE_TASK_HABIT` action and case.
- Removed `backfillHabitsFromLegacy` function and the call in the provider initializer.
- All UI sites that read `lt.isHabit` for the 🔁 emoji were rewritten to check `intention.sourceHabitId`. `SessionTimelineBar` gained an optional `habitDerivedIntentionIds: Set<string>` prop; `SessionTimeline.tsx`'s `TaskRow` gained an `isHabitDerived: boolean` prop.

Ripgrep across `src/` shows zero remaining usages of `isHabit`, `TOGGLE_TASK_HABIT`, `backfilledFromIsHabit`, or `backfillHabitsFromLegacy` outside of explanatory comments referencing the removal.

## New / modified files

**Added:**
- `src/lib/capacity.ts` — `computeSessionCapacity`, `computeAllSessionCapacities`.
- `src/data/restCues.ts` — static catalog + `pickRestCue`.
- `src/components/dashboard/LightPoolPanel.tsx`
- `src/components/dashboard/TrueRestCard.tsx`
- `src/components/dashboard/SessionCapacityBadge.tsx`
- `src/components/dashboard/SessionCapacityBanner.tsx`
- `src/components/life/LightPoolSection.tsx`
- `src/components/settings/CapacitySettings.tsx`

**Modified:**
- `src/types/index.ts` — new types, removed deprecated fields.
- `src/context/DayPlanContext.tsx` — schema bump, new actions, settings defaults, kind backfill, legacy purge.
- `src/lib/habits.ts` — added `getLightPoolHabits`.
- `src/hooks/useCurrentSession.ts` — exposes `nextSession` and `nextSessionStartsWithin`.
- `src/components/wizard/Step2Refine.tsx` — per-task cap resolution, removed habit toggle button, dropped `onToggleHabit` from `TaskCard`.
- `src/components/wizard/Step3Schedule.tsx` — capacity badges/banner on timeline, replaced `lt.isHabit` with intention-derived check.
- `src/components/checkin/CheckInModal.tsx` — avoidance note, low-state Light Pool + True Rest panels.
- `src/components/dashboard/Dashboard.tsx` — mounts `LightPoolPanel` and `TrueRestCard`; adds between-session rest banner.
- `src/components/dashboard/SessionTimeline.tsx` — remaining-time capacity badge + over-capacity banner on Current Session; rewrote `TaskRow` to take `isHabitDerived`.
- `src/components/ui/SessionTimelineBar.tsx` — optional `capacities` and `habitDerivedIntentionIds` props.
- `src/components/life/HabitForm.tsx` — `kind` toggle and `maxBlockMinutes` input.
- `src/components/life/LifeView.tsx` — hosts `LightPoolSection`.
- `src/components/settings/SettingsModal.tsx` — adds Capacity section.

## Verification performed

- `npm run build` — passes; bundle 452 kB (gzip 128 kB).
- `npm run lint` — clean.
- `npx tsc --noEmit` — clean.
- Ripgrep sweep for `isHabit`, `TOGGLE_TASK_HABIT`, `backfilledFromIsHabit`, `backfillHabitsFromLegacy` — zero hits outside explanatory comments.

End-to-end manual checks (recommended on first browser session post-deploy):
- Stabilizer regression — existing habits still auto-inject in Step 1 and lock to background in Step 2.
- Light-coherent — create one assigned to the active season → appears in `LightPoolPanel` and `LightPoolSection`; does NOT auto-inject; Start writes a `HabitLogEntry`; Done fills `completedAt` and `durationMinutes`.
- Cap refactor — stabilizer habit with `maxBlockMinutes = 45` allows 45-min estimate; same habit with no override clamps to 30; manual background clamps to `taskCapDefaults.manualBackground`.
- Check-in — `feeling=stuck` reveals avoidance input; `workType=low-energy` reveals 1–2 Light Pool rows + a True Rest cue.
- Capacity (Step 3) — overload a session beyond 150% → per-session badge turns red, banner names the session, `Next` still enabled.
- Capacity (mid-session) — within active session window with overload, `CurrentSession` shows the remaining-time pill and an over-capacity banner.
- True Rest between sessions — no active session, next within 60 min → side-rail card surfaces a contextual nudge.

## Deferred to later iterations

- **v7 — Modes, Rituals, Recovery:** `DayPlan.mode` field, mode switcher, RitualPlayer with templates, Minimum Viable Day. (Pulled forward by one slot: was v7 in plan_v5's deferred list; remains v7 here.)
- **v8 — Reviews, Drift Detection, Hierarchical Views:** `/review` route, `useDriftSignals` hook, `/week` cadence view, expanded `/life`.
