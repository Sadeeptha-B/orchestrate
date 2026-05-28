# Plan v6.4 — Stabilizer Recurrence Reconcile

> Frozen post-implementation plan. The living docs ([synthesis.md](../synthesis.md), [data-model.md](../data-model.md)) reflect the result. This document preserves the *narrative* of how v6.4 was designed and which tradeoffs landed where.

## Context

v6.3 made Todoist the recurrence engine for stabilizer habits: a habit's recurring Todoist task drives whether it surfaces as a `TodaysHabitInstance` on the timeline, and `computeTodaysHabitInstances` filters to "due today + unchecked". This works for the happy path — user completes the habit, Todoist advances the rule, tomorrow's task is due tomorrow.

But Todoist's recurrence engine only advances on **completion**. If the user misses a stabilizer:
- The Todoist task stays at yesterday's date, unchecked, marked overdue.
- Tomorrow, `computeTodaysHabitInstances` filters it out (it's not "due today").
- The habit silently disappears from today's plan despite being a daily ritual.
- The day after, still overdue from two days ago — same problem.

A stabilizer is by definition a daily (or weekly-cadence) ritual; "I missed yesterday" should not erase the habit from today's plan. The recurrence engine needs help bridging the gap.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Recurrence engine ownership | **Keep Todoist as the rule-of-record** | Stabilizers exist in Todoist as recurring tasks for the user's mobile/cross-device visibility. Taking that away would be a much larger rewrite (full Orchestrate-side recurrence) and lose the Todoist mobile UX. The v6.4 fix is additive, not a rewrite. |
| Missed-day handling | **Reconcile on Step 1 mount: bump Todoist's due date forward** | Three options considered: (A) read-side filter expansion ("due ≤ today") — leaves Todoist visibly out-of-date for the user; (B) bump Todoist forward — single write per missed day per habit, keeps both sides consistent; (D) take recurrence entirely Orchestrate-side — too big for this iteration. (B) chosen. (A) was tempting but the Orchestrate↔Todoist drift it creates is the kind of paper-cut that compounds. |
| Bump payload | **`due_datetime` when the task has a time, `due_date` when it doesn't. `due_string` left untouched.** | `due_string` encodes the rule (`"every day at 7:00"`). Sending it on a bump risks re-interpretation (if 7am has passed, Todoist could roll to tomorrow). Sending just `due_datetime`/`due_date` shifts the current occurrence without disturbing the rule. Todoist re-applies `due_string` on the next user-driven completion to advance to the following occurrence. |
| Recompute timing | **Optimistic patch map returned from `reconcileOverdueStabilizers`, merged into `taskMap` for an immediate `computeTodaysHabitInstances` call** | Naive flow (bump → wait for React re-render → recompute) doesn't work: the existing Step 1 effect depends on `taskMap.size`, which doesn't change when tasks are *updated* in place. The reconciler returns the patched tasks itself so the caller can merge them into a fresh map and dispatch `REFRESH_TODAYS_HABITS` in the same tick. |
| Skip-as-completion | **`SKIP_HABIT_INSTANCE` in the UI posts a Todoist comment, then fires `completeTask`** | When the user explicitly skips, we know the recurrence should advance. Letting Todoist's engine do that immediately (vs. waiting for the next-day reconcile to bump) means one fewer wasted write and a Todoist view that matches the user's intent. Todoist doesn't have a native "skip" semantic, so completion is the closest fit — but a bare completion is indistinguishable from a normal done. A preceding `"Skipped via Orchestrate on <date>"` comment preserves the distinction in Todoist's own task history; the Orchestrate-side `'skipped'` status is the in-app surface. |
| Where to fire reconcile | **Step 1 mount only, with a once-per-mount ref guard** | The wizard is on the daily-rollover path (stale plan → fresh plan with `setupComplete: false` → Welcome → Step 1). Direct-to-Dashboard entry only happens after Step 1 has already run, by which point any overdue tasks were already bumped that morning. No need for a second reconcile point. |
| Carry-forward indicator | **None for this iteration** | A `carriedFromDate` field on `TodaysHabitInstance` was considered. Skipped — the user said they want the habit to surface as if it were today's; visible "missed yesterday" tagging is a future UX enhancement, not core to the fix. |
| Schema bump | **None** | No persisted shape changes. Schema stays at `6.3`. |
| Scope phasing | **Single PR, two cohesive moves (B + C)** | The reconcile and skip-completion are two halves of the same conceptual shift ("keep Todoist's recurrence engine in sync with Orchestrate's intent"). Shipping them separately would leave the skip case dropping into the reconcile path unnecessarily. |

## Architectural shape

No new contexts, no new reducer actions, no new state. The fix lives entirely in two helper functions and two small wiring changes.

- **New helpers** (`src/lib/habitsTodoistSync.ts`):
  - `OverdueStabilizerInfo { habit, task }`
  - `findOverdueStabilizers({ life, taskMap, dateISO })` — mirrors the filter chain in `computeTodaysHabitInstances` except the date gate is "due < today" instead of "due === today". Honors recurrence-matches-today (a Monday-only habit on Saturday stays overdue, no bump) and active-season scope.
  - `reconcileOverdueStabilizers({ overdue, actions, dateISO })` — issues one `updateTask` per overdue habit and returns a `Map<todoistTaskId, TodoistTask>` of optimistically-patched tasks. Per-task failures logged and skipped (non-blocking — next mount retries).

- **Step 1 wiring** (`src/components/wizard/Step1Intentions.tsx`):
  - Adds `useTodoistActions` consumer alongside the existing `useTodoistData`.
  - Adds a second `useEffect` with a `reconciledRef` guard (once per mount, after `taskMap.size > 0`). Detects overdue, fires async reconciler, then merges the patch map into a fresh `taskMap`, recomputes instances, and dispatches `REFRESH_TODAYS_HABITS`. Idempotent: the merge dispatcher and the existing "due today" effect coexist cleanly because `REFRESH_TODAYS_HABITS` dedupes by `habitId`.

- **Skip wiring** (`src/components/dashboard/HabitInstanceCard.tsx` + `src/context/TodoistContext.tsx`):
  - New `createTaskComment(taskId, content)` action on `TodoistActionsValue`, hitting `POST /comments` with `{ task_id, content }`. Errors handled through the existing `handleApiError` funnel.
  - `handleSkip` now fires (in parallel) `createTaskComment(...)` with `"Skipped via Orchestrate on <plan.date>"` and `completeTask(...)`. Both fire-and-forget; failures fall into the next mount's reconcile path. Mirrors the existing pattern in `handleComplete`.

## Post-ship hardening (v6.4 follow-up)

Field testing surfaced cases where overdue habits — particularly multi-day overdue — still failed to appear after reconcile. A targeted audit found four interlocking bugs in the sync surface. All four were fixed in the same revision.

| Bug | Symptom | Fix |
|---|---|---|
| **C1 — `updateTask` swallowed API errors** | `reconcileOverdueStabilizers`'s try/catch was dead code because `updateTask` caught errors internally and never re-threw. The optimistic patch landed unconditionally, masking failed Todoist writes. | `updateTask` now returns `TodoistTask \| null`. The reconciler treats `null` as failure, logs it, and skips the patch. Authoritative server responses replace the prior optimistic-patch construction. |
| **C2 — bare `due_datetime`/`due_date` on recurring tasks** | Sending a date field without `due_string`/`due_lang` left the Todoist v1 API's behavior on multi-day-overdue recurring tasks underspecified (likely root cause of the observed failures). The existing `syncHabitToTodoist` always paired the date with the rule for this reason. | `reconcileOverdueStabilizers` now re-passes `due_string` + `due_lang` from the existing task on every bump. Semantics become unambiguous: "rule unchanged, next occurrence is this date." |
| **D1 — `completeTask` removed recurring tasks from cache** | Pre-existing bug exacerbated by v6.4 skip-as-completion. After completing/skipping a habit, the recurring Todoist task was filtered out of local cache. Until the next 5-min staleness window, `computeTodaysHabitInstances` and `findOverdueStabilizers` were blind to it — habits could silently vanish from the dashboard. | `completeTask` now branches on `task.due?.is_recurring`. For recurring tasks: leaves the cache entry in place and force-refreshes (so the new server-advanced due date lands ASAP). For non-recurring: existing filter behavior. A `tasksRef` avoids dragging `tasks` into the callback's deps. |
| **B1 — date comparison ignored timezone semantics** | `task.due.date.slice(0, 10)` was correct for Orchestrate-synced floating tasks but wrong for tasks the user edited externally with explicit timezone — a UTC-stored time near the day boundary could be misclassified. | New `dueDateLocal(due)` helper handles all three formats (date-only / floating / fixed). Used by both `computeTodaysHabitInstances` and `findOverdueStabilizers`. |

**Error logging discipline.** Per project rule on Todoist/habit integration paths, every API failure now `console.error`s in addition to surfacing in the UI:
- `handleApiError` in `TodoistContext` always logs (was UI-state-only).
- `reconcileOverdueStabilizers` logs explicitly when `updateTask` returns null, and warns when Todoist's response disagrees with the requested date (post-hoc debugging signal).
- `HabitInstanceCard.handleComplete` / `handleSkip` upgraded from `console.warn` to `console.error` with a `[habits]` prefix.
- `intentionUnschedule` upgraded the same way.

The C1 fix is structural: any future call site that wants to know whether a Todoist update actually landed can now check the return value. The previous "fire and forget" pattern still works (callers can ignore the return), but it's no longer the only option.

## What's deliberately not in scope

- **Cross-day engagement / streak ledger.** Plan v6.3 already flags this. With the v6.4 reconcile, every eligible day now produces exactly one `TodaysHabitInstance` with a terminal status — the harvest source for a future `life.habitOutcomes` ledger is now gap-free. The ledger itself is still future work (likely v8 with `/review`).
- **Carry-forward indicator.** Could be added later as a `TodaysHabitInstance.carriedFromDate?: string` field surfaced in `HabitInstanceCard` (e.g. "missed yesterday — bumped to today"). Out of scope here; the silent surfacing matches the user's stated intent ("habit reappears next day irrespective of completion status").
- **Reconcile on Dashboard mount.** Not needed today because the daily-rollover path forces Step 1 before Dashboard. Would become necessary only if `setupComplete` were ever skippable or if rollover stopped resetting the plan — neither is on the roadmap.
- **Taking recurrence off Todoist entirely.** Option D from the design alternatives. Right end-state if streaking/analytics become first-class, but a much larger rewrite. Defer until the engagement ledger demands it.
- **Skip-as-completion for tasks (not just habits).** LinkedTask skip doesn't exist as a concept — tasks only have pending/completed/engaged. No analogous case.
