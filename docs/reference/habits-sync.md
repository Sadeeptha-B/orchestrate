# Habit ⇄ Todoist sync — module reference

> The code/module-level walkthrough of how habits stay in sync with Todoist. For entity semantics, reducer actions, and instance lifecycle, see [data-model.md](../data-model.md) (Habit, TodaysHabitInstance). For account-provenance gating and durable markers, see [reference/backup_and_restore.md](./backup_and_restore.md). For where this sits in the app, see [synthesis.md §9](../synthesis.md).

**Core file:** `src/lib/habitsTodoistSync.ts`. Only **'habit'-kind** entries sync — **micro-gaps never touch Todoist**, and `syncHabitToTodoist` / `findNeedsSyncHabits` / `findOverdueHabits` all early-skip them.

---

## 1. Sync layer (on habit save)

On a 'habit'-kind save: `buildDueString(habit)` → `ensureHabitsProject(...)` → `resolveHabitProjectId(...)` → `syncHabitToTodoist(...)`. This creates/updates/moves the recurring Todoist task (timed → "every day at HH:mm", untimed → "every day"), self-heals stale project references, and recreates deleted tasks. Sync failures are non-blocking.

Task resolution follows a durable-marker ladder — **id → uuid token → marker + name → create** — so a link-less habit adopts an existing unclaimed task instead of duplicating. Every created task carries the `orchestrate-habit` label (class marker) and an `[orchestrate:habit:<uuid>]` description token (instance marker). Writes are gated by the account fingerprint (`fingerprintVerdict`); see [backup_and_restore.md](./backup_and_restore.md) §2.

## 2. Delete propagation

Handled in `useHabitMutations` (not the reducer — shared by `HabitsLibrary` + `LifeView`):

- Deleting a habit also removes its backing recurring Todoist task (`todoistActions.deleteTask`).
- Editing a habit's kind from `habit` → `micro-gap` deletes the now-orphaned task (`HabitForm` drops `todoistTaskId` for non-habit kinds).
- Both are best-effort / non-blocking — a failure leaves a logged orphan task, never blocking the local change.
- Pausing a habit (`TOGGLE_HABIT_ACTIVE`) deliberately leaves the Todoist task intact, since deactivation is reversible.

## 3. Day-of layer

`useTodaysHabitsSync` (mounted by Step 1 + the dashboard) feeds two compute paths into `REFRESH_TODAYS_HABITS`:

- `computeTodaysHabitInstances(...)` — 'habit' kind, Todoist-gated.
- `computeTodaysMicroGapInstances(...)` — 'micro-gap' kind, no Todoist.

Both honor season scope; timed habits get a `targetTime` (which drives timeline positioning only — no session auto-assignment).

A **due-today habit is always surfaced regardless of `windowBehavior`**: `strict` no longer hides a past-window row — it stays a `planned`, actionable instance that *presents* as "missed" (greyed) via the derived `isHabitInstanceMissed(...)` helper, so the day's record is kept and a habit done before planning is still completable. A timed **lenient** ("surface anyway") habit whose time has passed but whose recurring task Todoist rolled forward to tomorrow is *rescued* — it still surfaces today unless already completed/skipped.

Because `REFRESH_TODAYS_HABITS` only appends/refreshes (never removes), the hook also runs `findStaleTodaysHabitInstances(...)` → `PRUNE_STALE_HABIT_INSTANCES` (gated on `tasksHydrated`) to drop `planned` instances whose Todoist task was completed / moved off today out-of-band. It shares the `isLenientPastWindow` predicate with the compute path so a rescued row isn't pruned right back out.

## 4. Central reconciliation

Both the overdue bump and the needs-sync repair are driven from a single `ReconciliationProvider` mounted between `TodoistProvider` and `AppRoutes` (**'habit' kind only** — micro-gaps never sync). Detection uses `findOverdueHabits(...)` and `findNeedsSyncHabits(...)`; `triggerReconcile()` runs needs-sync first (creating/recreating Todoist tasks for entries without a live link) then the overdue bump. The provider auto-fires on first hydration (Todoist configured + `tasksHydrated`, so a legitimately empty task list still triggers needs-sync) and on window focus (gated by 5-min staleness). `useHabitReconciliation()` exposes status + a manual trigger.

Automatic reconcile passes are **adopt-only** for previously-linked habits whose task has vanished — re-creation requires an explicit action on the Habits page (see §7).

Surfaces:
- **Step 1** no longer fires reconcile directly — the provider handles it.
- **HabitsLibrary** "Migrate / Re-sync" delegates to `triggerReconcile()`.
- **`HabitSyncChip`** (in the shared `HeaderControls`) surfaces needs-sync count, error state, and in-flight pulse app-wide; click navigates to `/habits`.

## 5. Overdue bump

Todoist's recurrence engine only advances on completion, so a habit missed yesterday sits at yesterday's due date and never surfaces. `reconcileOverdueHabits(...)` bumps each overdue habit's Todoist task via `updateTask({ due_string, due_lang, due_datetime | due_date })` — re-passing the existing recurrence rule so Todoist reads it as "rule unchanged, next occurrence is this date" — and returns a patch map from Todoist's authoritative responses so `computeTodaysHabitInstances` can run against the bumped state without waiting for a re-render. Date comparisons go through `dueDateLocal(...)`, which handles Todoist's floating vs fixed-timezone semantics so late-evening habits in non-UTC zones aren't misclassified.

## 6. Skip and reschedule

- **Skip-as-completion.** `SKIP_HABIT_INSTANCE` posts a `"Skipped via Orchestrate on <date>"` comment on the Todoist task (Todoist has no native skip semantic, so this keeps the skip traceable), then fires `completeTask` so the recurrence engine advances cleanly. The Orchestrate-side `'skipped'` status preserves the user-facing distinction.
- **Reschedule** ('habit'-kind only — micro-gaps are untimed and not reschedulable). `RESCHEDULE_HABIT_INSTANCE` is **always in-place**: it updates `targetTime`, stamps `rescheduledAt`, and appends a `RescheduleEventEntry` to `rescheduleHistory`. The instance keeps its `id`, `status`, and `segments`. Every reschedule is recorded regardless of engagement and surfaces as a "⤴ … {from} → {to} · Rescheduled" row in the engagement log — not as a tag in the Today view. The recurring Todoist task's `due_string` is never touched.

## 7. Habits Library (`/habits`)

Groups active habits into **Habits** and **Micro-gaps** sections (+ collapsible Inactive). Shows a "needs sync" banner for 'habit'-kind entries that are unsynced or whose Todoist task is missing (micro-gaps excluded); the banner **names each affected habit** as a chip (a ⚠ marks a task gone missing in Todoist) and offers, alongside Migrate / Re-sync, a confirm-gated **bulk "Delete habits"** escape hatch for habits the user would rather drop than push to Todoist. It is also the only place re-creation of a vanished task happens (bulk Re-sync, or per-habit recreate). Bulk sync resolves the default project once to avoid duplicate creation, and habit-save is locked out during migration to prevent races.

CRUD (create / edit / pause / delete) and the create/edit/anchor-delete **modal stack** run through the shared `useHabitForms` hook (over `useHabitMutations`), also used by `LifeView`, so the two surfaces share one mutation + form path. The needs-sync banner and bulk-delete modal stay library-only.
