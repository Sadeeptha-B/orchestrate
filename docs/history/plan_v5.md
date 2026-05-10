# Plan v5 — Life Scaffolding Primitives

> Frozen post-implementation plan. The living docs ([synthesis.md](../synthesis.md), [data-model.md](../data-model.md), [architecture.md](../architecture.md)) reflect the result. This document preserves the *narrative* of how v5 was designed and what tradeoffs were made.

## Context

The user authored [orchestrate_life_migration_spec.md](../orchestrate_life_migration_spec.md), which expands Orchestrate's mission from "day-execution and contextualization engine" to "executive-function and life-scaffolding companion." The spec spans four phases (life primitives, capacity intelligence, modes/rituals/recovery, reviews/drift). v5 implements **Phase 1 only**, intentionally.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Backend? | **No backend.** Add JSON Full Backup export/import. | Vision constraint; personal tool; data volume small. |
| First iteration size | **Phase 1 only.** v6+ deferred. | Each iteration must be shippable. |
| Navigation | **New routes** `/life`, `/season`, `/season/:id`, `/habits`. | Composable with React Router. Dashboard stays the day hub. |
| Mode control (deferred to v7) | Manual + signal-driven suggestions. | Preserves user agency. |

## Architectural shape

A **third persistent state slice** `life: LifeContext` was added alongside `plan` and `settings`, owned by the same `DayPlanProvider`. This avoids a new context provider while letting the reducer enforce cross-slice invariants like "activating a habit injects an intention into today's plan."

```
DayPlanContext state:
  plan      — DayPlan          (per-day, auto-resets)
  settings  — AppSettings      (persistent, user prefs)
  life      — LifeContext      ← NEW (persistent, multi-day entities)
  editingStep
  history
```

`life` persists to a new localStorage key `orchestrate-life-context` carrying `_schemaVersion: 5`.

## Schema versioning

Pre-v5 the `_wizardSteps` marker was de facto schema versioning. v5 introduces an explicit, additive `_schemaVersion: number` field stamped on plan, settings, life, and saved sessions on every persist. Old plans without the marker still load via the existing v1→v4.1 chain unchanged.

## Backfill

Legacy `Intention.isHabit === true` entries (in current plan and history) are scanned **once** at startup and surfaced as inactive `Habit` candidates so the user can promote them in the Habits Library. Idempotent — guarded by `LifeContext.backfilledFromIsHabit`.

## Data-model summary

New types in [src/types/index.ts](../../src/types/index.ts):
- `Season` (with `SeasonCapacity` budget)
- `Habit` (with `HabitRecurrence` and `HabitCompletionRule`)
- `LifeContext` (the slice itself)

Modified type:
- `Intention` gained `sourceHabitId?` and `skippedForToday?`. Its `isHabit` flag is **deprecated** (kept for backwards-compat for one iteration; UI no longer surfaces it). `LinkedTask.isHabit` is also deprecated.

## Reducer additions

10 new actions in `DayPlanContext`:
- Seasons: `ADD_SEASON`, `UPDATE_SEASON`, `DELETE_SEASON`, `ACTIVATE_SEASON`
- Habits: `ADD_HABIT`, `UPDATE_HABIT`, `DELETE_HABIT`, `TOGGLE_HABIT_ACTIVE`
- Cross-slice: `INJECT_HABIT_INTENTIONS` (idempotent — filters by existing `sourceHabitId`), `SKIP_HABIT_INTENTION`
- Backup: `IMPORT_BACKUP` (merge-by-id semantics)

Cross-slice invariants enforced in the reducer:
- Activating a season auto-deactivates the previously active one and updates `activeSeasonId`.
- Deleting a season clears the season-id from any habit's `seasonIds`.
- An anchor habit cannot be deleted while active (caller surfaces a "deactivate first" modal).
- Deleting a habit clears `sourceHabitId` from any intentions still referencing it.

## Habit recurrence

`habitMatchesDate(habit, dateISO)` lives in [src/lib/habits.ts](../../src/lib/habits.ts). Supports `daily`, `weekdays`, `weekly`, `custom` kinds. Parses dates as local (not UTC) to avoid TZ off-by-one.

## Habit auto-promotion in Step 1

On Step 1 mount, `INJECT_HABIT_INTENTIONS` is dispatched. The reducer:
1. Filters active habits to those whose recurrence matches today.
2. Excludes habits that already have an intention with matching `sourceHabitId` (idempotent).
3. Prepends fresh intentions with `sourceHabitId` set, `brokenDown: false`.

Habit-derived intentions render with a 🔁 Habit badge and a "Skip for today" affordance. Skipping marks the intention `completed + skippedForToday + brokenDown` so it doesn't block progression and is honest in any future streak data.

If a habit has `autoLinkTodoistId` set and the corresponding Todoist task is in the current cache, Step 1 auto-links it the first time the habit's intention becomes the current mapping target. This is gated by a render-scoped `Set` so it doesn't loop.

## Habit-task background lock (Step 2)

In Step 2, an effect identifies all linked tasks under habit-derived intentions and auto-categorizes them as `background` if not already. The TaskCard accepts a `lockedToBackground` prop and renders a fixed "Background" pill with a "🔁 Habit task — category locked" hint instead of the toggle.

## New routes

| Route | Component | Purpose |
|---|---|---|
| `/life` | `LifeView` | Hub: active season, anchor habits, all active habits |
| `/season` | `SeasonsManager` | List + create + activate seasons |
| `/season/:id` | `SeasonDetail` | Single-season editor, member-habit list |
| `/habits` | `HabitsLibrary` | List + CRUD habits with anchor protection |

All four are guarded by `setupComplete` (redirect to `/` otherwise) — same pattern used for `/setup`. They share the `LifeShell` layout (header with crumbs, "Back to Dashboard," theme toggle).

## New / modified files

**Added** (under `src/components/life/`):
- `LifeView.tsx`, `LifeShell.tsx`, `SeasonsManager.tsx`, `SeasonDetail.tsx`, `SeasonForm.tsx`, `HabitsLibrary.tsx`, `HabitForm.tsx`, `ActiveSeasonBadge.tsx`

**Added** under `src/lib/`:
- `habits.ts` (`habitMatchesDate`)

**Modified:**
- `src/types/index.ts` — new types, deprecated flags
- `src/context/DayPlanContext.tsx` — `life` slice, schema markers, new actions, backfill, `IMPORT_BACKUP`, `LifeContext` persistence
- `src/App.tsx` — 4 new routes
- `src/components/wizard/WizardLayout.tsx` — `ActiveSeasonBadge` in header
- `src/components/wizard/Step1Intentions.tsx` — auto-inject hook, habit badge, skip affordance, autoLink prefill
- `src/components/wizard/Step2Refine.tsx` — `lockedToBackground` flow, auto-categorize habit tasks
- `src/components/dashboard/Dashboard.tsx` — `ActiveSeasonBadge`, "Life" header button
- `src/components/dashboard/SavedSessions.tsx` — Full Backup export, Restore Backup import

## Backup story (no-backend safety net)

`SavedSessions` gains two non-compact buttons:
- **Full Backup** — bundles `{ settings, life, history, _backupVersion: 1 }` to `orchestrate-backup-YYYY-MM-DD.json`.
- **Restore Backup** — imports such a file via `IMPORT_BACKUP`, which **merges by id** (existing entries are never overwritten; new entries are appended). Surfaces a success summary listing what was imported.

This is the user's safety net in lieu of cross-device sync.

## Verification performed

- `npm run build` — passes; 424 kB bundle (gzip 122 kB).
- `npm run lint` — 5 pre-existing errors, 0 new errors introduced. (`sw.js` parse, two `TodoistPanel` conditional-hooks, one `Step2Refine` set-state-in-effect, one `DayPlanContext` mixed-export warning for `useDayPlan` hook.)
- TypeScript strict mode — clean.

End-to-end manual checks (see [the original plan](../../C:/Users/SadeepthaBandara/.claude/plans/hello-have-a-look-lovely-sundae.md) section "Verification" for the full list) — execute these on first browser session post-deploy.

## Deferred to later iterations

- **v6 — Capacity Intelligence:** tunable session buffer, overload warnings during Step 3, remaining-time awareness when mid-session, recommendations to split/move/defer.
- **v7 — Modes, Rituals, Recovery:** `DayPlan.mode` field, mode switcher, RitualPlayer with templates, Minimum Viable Day. v7 also fully removes the deprecated `isHabit` flag.
- **v8 — Reviews, Drift Detection, Hierarchical Views:** `/review` route with weekly + seasonal flows, `useDriftSignals` hook, `/week` cadence view, expanded `/life`.

## Open interpretations from the backlog

These were taken as positions during v5 implementation:

1. *"as long as it is in the active stay"* → "active state."
2. Habit-derived task category → **always background**, locked.
3. First day a habit is active → user maps manually unless `autoLinkTodoistId` is set on the habit (which can be filled in by the user after the first manual link).
4. `isHabit` flag → deprecated in v5, removed in v7. v5 leaves the flag readable to keep saved-session migration intact.
