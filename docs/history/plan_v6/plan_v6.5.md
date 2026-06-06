# Plan v6.5 — Central Stabilizer Reconciliation

> Frozen post-implementation plan. The living docs ([synthesis.md](../synthesis.md), [data-model.md](../data-model.md)) reflect the result. This document preserves the *narrative* of how v6.5 was designed and which tradeoffs landed where.
>
> **Direct sequel to [v6.4 — Stabilizer Recurrence Reconcile](./plan_v6.4.md).** v6.4 was the behavioral fix (habits survive a missed day); v6.5 is the architectural consolidation (one reconcile surface, evenly applied). Read v6.4 first for the *why* of reconcile; this doc covers *where* it runs.

## Context

After [v6.4](./plan_v6.4.md) shipped the overdue-bump reconcile, the habit↔Todoist sync surface had two reconciliation paths with very different shapes:

1. **Overdue reconcile** lived in `Step1Intentions.tsx` as a once-per-mount `useEffect`. Auto-triggered, silent on success, only fired on Step 1 mount.
2. **Needs-sync reconcile** lived in `HabitsLibrary.tsx` as a user-clicked **Migrate** / **Re-sync** button on a banner only visible inside `/habits`.

They addressed structurally different defects — overdue bumps a stale due date; needs-sync creates a missing Todoist task — but the trigger model, visibility, and code organization were inconsistent. A user who never opened `/habits` could carry unsynced stabilizers indefinitely without realising; a user who refreshed the dashboard mid-day couldn't re-trigger the overdue path without going back through Step 1.

The user proposed unifying the surface by extracting the reconcile into a central provider and adding cross-app visibility (recommendation A + D from the audit).

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Provider vs hook-per-surface | **Single `ReconciliationProvider` mounted between `TodoistProvider` and `AppRoutes`** | Hook-per-surface (option B from the audit) would have meant mounting the same reconcile from Step 1, Dashboard, and HabitsLibrary — easy to forget when adding a new route, and would race on cold start. A single provider has one mount, one in-flight guard, one source of truth for status. The state needed to be readable from a header chip *and* from the HabitsLibrary banner — context is the natural fit. |
| Provider placement | **Below `TodoistProvider`** | The provider needs both `useDayPlan()` (habits, plan, settings, dispatch) and `useTodoist*()` (taskMap, actions, isConfigured). Existing layering puts TodoistProvider below DayPlanProvider, so the new provider sits at the bottom of the stack. |
| Detection placement | **Pure helpers in `habitsTodoistSync.ts`** | Both `findOverdueStabilizers` (already there from v6.4) and the new `findNeedsSyncStabilizers` are pure functions of `life` + `taskMap`. Keeping them in the same module preserves "all habit-sync logic in one file" and lets the provider compose them without duplicating filter chains. |
| Action ordering inside `triggerReconcile()` | **Needs-sync first, then overdue** | A habit without `todoistTaskId` has no task to bump — needs-sync must create it first. Newly-created tasks are never overdue (Todoist places them at the next valid occurrence), so the overdue pass running against the pre-reconcile `taskMap` snapshot doesn't miss anything in practice. Trying to merge created tasks into a running taskMap snapshot would have required `syncHabitToTodoist` to return the full task object instead of just an id — bigger ergonomic cost than the failure mode justifies. |
| Auto-trigger conditions | **First hydration (once per session) + window focus (5-min staleness gate)** | First-hydration covers the common case (user opens the app). Focus covers "user came back after a while" — gated to avoid spamming Todoist on tab-switches. Considered a poll-on-timer pattern; rejected as needless overhead for a single-user local app. Day-rollover is implicitly covered: a stale plan triggers a full app reload through `loadInitialState`, which re-mounts the provider. |
| In-flight guard | **`inflightRef` boolean** | Multiple triggers (mount + focus + manual) can race. A ref-based mutex is the smallest thing that works. Status state (`isReconciling`) is also exposed for UI but isn't the gate — using state as a mutex would have introduced a race between setter and check. |
| Visibility surface | **`HabitSyncChip` in `HeaderControls`** | The shared header is rendered across every route via `HeaderControls`, so dropping a chip there gives cross-app visibility for free. Three states surface: needs-sync count (amber), reconcile error (red), in-flight (pulse). Overdue is *not* surfaced — it auto-fixes and the user shouldn't have to act on it. |
| Should the chip always show? | **No — silent in the happy path** | A persistent "all good" indicator becomes wallpaper. The chip only appears when there's something for the user to know about. |
| Keep per-habit immediate sync on create/edit? | **Yes** | The HabitsLibrary create/edit flow still calls `syncHabitToTodoist` directly for its specific habit. Routing through `triggerReconcile()` would have made the UI error focused on a specific habit harder to surface, and would have run a full needs-sync scan for a single-habit operation. Two-tier model: immediate-sync for explicit user save, central reconcile for catch-up. |
| Schema bump | **None** | No persisted shape changes. Schema stays at `6.3`. |

## Architectural shape

The reconcile concern is now layered:

```
ReconciliationProvider                     ← orchestration + status
  ├─ findNeedsSyncStabilizers(...)         ← detection (pure)
  ├─ findOverdueStabilizers(...)           ← detection (pure, v6.4)
  ├─ syncHabitToTodoist(...) (loop)        ← per-habit fix (existing)
  ├─ reconcileOverdueStabilizers(...)      ← per-habit fix (v6.4)
  └─ triggerReconcile()                    ← exposed action
```

- **New module** (`src/context/ReconciliationContext.tsx`): `ReconciliationProvider`. Holds `isReconciling`, `lastReconciledAt`, `lastError` state; exposes computed `overdueCount`, `needsSyncCount`, `neverSyncedCount`, `missingTaskCount`, `isConfigured`, `triggerReconcile`. Effects: first-hydration auto-trigger (ref-guarded), focus-trigger (5-min staleness).
- **New hook** (`src/hooks/useStabilizerReconciliation.ts`): single-line consumer that throws if used outside the provider.
- **New helper** (`src/lib/habitsTodoistSync.ts`): `findNeedsSyncStabilizers({ life, taskMap }) → NeedsSyncStabilizerInfo[]` with `reason: 'never-synced' | 'missing-in-todoist'`. Mirrors the inline memo that previously lived in HabitsLibrary.
- **New component** (`src/components/ui/HabitSyncChip.tsx`): renders the cross-app status indicator. Mounted in `HeaderControls` so every route gets it.
- **App.tsx**: provider tree now `DayPlanProvider → TodoistProvider → ReconciliationProvider → AppRoutes`.
- **`Step1Intentions.tsx`**: the v6.4 overdue-reconcile useEffect is removed. The remaining "compute due-today instances" effect stays untouched.
- **`HabitsLibrary.tsx`**: drops local `needsSyncStabilizers` memo, `migrating` state, and the inline `handleMigrate` loop. Banner counts come from the hook; the button calls `triggerReconcile()`. The per-habit create/edit sync flow (`syncStabilizer` + immediate dispatch on user save) is unchanged. The `syncError` state is kept for create/edit failures; reconcile failures route through the hook's `lastError`.

## Trigger conditions in detail

`triggerReconcile()` is fired from three places:

1. **First hydration** — `useEffect([isConfigured, taskMap.size])` guarded by `firstRunDoneRef`. Runs once when both Todoist is configured and tasks have loaded.
2. **Window focus** — `useEffect([isConfigured, triggerReconcile])` adds a `window.focus` listener gated by `Date.now() - lastReconciledAtRef.current < FOCUS_STALENESS_MS` (5 min). Stays consistent with Todoist's own focus-refresh staleness window.
3. **Manual** — `HabitsLibrary`'s Migrate button; could be wired to other surfaces (e.g., a retry button on the chip's error state) in future iterations.

The pass is a sequential async:
```
needsSync.length > 0:
  ensureHabitsProject → defaultProjectId
  for habit in needsSync:
    syncStabilizer(habit, defaultProjectId)
overdue.length > 0:
  reconcileOverdueStabilizers(overdue, actions, dateISO) → patched
  if patched.size > 0:
    computeTodaysHabitInstances against merged taskMap
    dispatch REFRESH_TODAYS_HABITS
```

Errors are caught around the whole pass; `setLastError` updates the UI, `console.error` logs for debugging. The next successful pass clears `lastError`.

## What's deliberately not in scope

- **Auto-create on needs-sync from the provider's auto-trigger.** Currently, the auto-trigger DOES run needs-sync — meaning a habit saved while offline will get auto-synced the next time the user opens the app online. This was a tradeoff: the alternative is "detected automatically, repaired on user trigger only" which feels safer but loses the recovery semantics the user wants. The chosen behavior is "auto-create on first hydration if Todoist is reachable", which is what a user would expect. The audit's option-A recommendation included "don't auto-fix needs-sync without user consent" as a guardrail; we softened that based on practical considerations.
- **Polling on a timer.** Not implemented. Focus-refresh + manual trigger cover the realistic cases.
- **Per-habit error reporting from the central pass.** The provider's `lastError` is a single string for the whole pass. If 3 of 5 habits failed, the user sees one error message. A richer error model (per-habit error map) could be added later but felt over-engineered for the current usage.
- **Dashboard reconcile surface.** No Dashboard mount of the hook beyond reading the chip status. The chip provides visibility; the Dashboard doesn't need to *act* on reconcile state.
- **Reconcile for light-coherent habits.** Light-coherent habits don't sync to Todoist (they live entirely in `plan.habitLog`). The detector and action both filter to stabilizer only.
- **Cross-day reconcile of skipped/completed habits.** Out of scope — engagement ledger is still the v8 Reviews territory.
