# Plan v6.1 — Habit-as-Task Decoupling

> Frozen post-implementation plan. The living docs ([synthesis.md](../synthesis.md), [data-model.md](../data-model.md), [architecture.md](../architecture.md), [user-guide.md](../user-guide.md)) reflect the result. This document preserves the *narrative* of how v6.1 was designed and what tradeoffs were made.

## Context

In v6, stabilizer habits were forced through a pipeline that didn't fit their semantics: they auto-injected as **Intentions** in Step 1, the user had to map them to a Todoist task in the embedded `TodoistPanel`, and the reducer then locked the task to `'background'` at `LINK_TASK` time. The whole flow treated stabilizers as if they were a special-case intention, which created ceremonial friction for what are conceptually *one-and-done daily items* — wake, meditate, gym, shutdown. There's no decomposition step for "meditate at 7am for 10 minutes": the habit *is* the task.

v6.1 decouples habits from intentions. Creating a stabilizer now creates a recurring Todoist task; on each matching day, the habit's task is surfaced **directly as a session-assigned `LinkedTask` without a parent intention** (`intentionId === undefined`, `sourceHabitId` set). Light-coherent habits and True Rest are unchanged.

The scope was narrow on purpose: this is a structural correction, not a new iteration. The internal label and `_schemaVersion` reflect that (`6.1`, a JSON float).

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Recurrence ownership | **Todoist owns recurrence** via `due_string` (e.g. `"every weekday at 7:00"`); Orchestrate's `habitMatchesDate` still gates client-side surfacing for season scope and the strict-window check. | One source of truth for the next-occurrence advance. Todoist already does this work robustly; we avoid duplicating it and avoid creating a new task per day. |
| "Remaining time" surfacing | Per-habit `windowBehavior: 'strict' | 'lenient'` (default `'lenient'`). Strict hides the habit-task once `now > targetTime + duration`; lenient surfaces while the Todoist task is due today and unchecked. | The user wanted *user choice*, not a single global rule. Default lenient because losing visibility silently is worse than seeing a late-but-still-doable habit. |
| Session assignment | **Auto-assign from Todoist `due.datetime`** → session whose `[startTime, endTime)` contains it. Unmatched habits go into an "Unassigned habits" tray on Step 3. | Reuses data the user already supplies to Todoist. Manual assign-tray covers habits without a fixed time. |
| TodoistPanel | **Leave it alone.** Habits bypass the panel entirely. | Smallest diff; the panel is 1000+ LOC and used in 4 places. Adding a thin "🔁 Habit" label in linking mode is the only TodoistPanel change. |
| LinkedTask shape | **Make `intentionId` optional**; add `sourceHabitId`. | The cleanest break — orphan habit-tasks live in the same array as intention-bound tasks, distinguished by which of the two id fields is set. Grouping sites get a small bucket for `intentionId === undefined`. |
| Schema version | **`6.1` (JSON float)**, not `7`. | The user wanted the storage marker to track the product label. JSON floats compare with `<` correctly, so the migration gate stays simple. |
| `INJECT_HABIT_TASKS` payload | **Precomputed `HabitTaskInjection[]`** prepared by a helper in `lib/habitsTodoistSync.ts`. | Keeps the reducer pure (no Todoist data access). The helper consumes the live `taskMap` + session slots and emits a flat list the reducer just appends. |
| Default Habits project | New `AppSettings.habitsTodoistProjectId`. **Picker in Settings → Integrations**; "Auto-create" defaults to a lazily-created project named `"Habits"`. | The user wanted to drop habit tasks into an existing project (e.g. "Personal" or "Routines") rather than a forced new one. Workspace-level default avoids per-habit ceremony. |
| Per-habit project override | New optional `Habit.todoistProjectId`. Dropdown in the stabilizer Schedule section of `HabitForm`. | Some habits genuinely belong elsewhere (e.g. work-only stabilizers under a "Work" project). Overrides win when set; otherwise the workspace default applies. |
| Project moves | When the resolved project differs from the existing task's `project_id`, **move the task via Sync API `item_move`** rather than delete+recreate. | Preserves Todoist history and the recurring task ID. New `TodoistActionsValue.moveTask(taskId, projectId)`. |

## Architectural shape

No new contexts. The new sync layer is a pure-function module that the existing providers call into.

- **New lib module**: `src/lib/habitsTodoistSync.ts` — `buildDueString(habit)`, `ensureHabitsProject(...)`, `resolveHabitProjectId(habit, defaultProjectId, projects)`, `syncHabitToTodoist({habit, projectId, actions, taskMap})`, `computeHabitTasksToInject(...)`.
- **Reducer actions renamed**: `INJECT_HABIT_INTENTIONS` → `INJECT_HABIT_TASKS` (new payload `entries: HabitTaskInjection[]`); `SKIP_HABIT_INTENTION` → `SKIP_HABIT_TASK { todoistId }`.
- **Reducer signature change**: `ADD_HABIT` now accepts a fully-formed `Habit` (caller generates `id` + `createdAt`) so the caller can run `syncHabitToTodoist` against the same id afterward.
- **`TodoistActionsValue` additions**: `moveTask(taskId, projectId)`; `createTask` and `createProject` return the created entity (or `null` on failure) so the caller can read the new id.
- **`CreateTaskOpts` / `UpdateTaskOpts`** now expose Todoist's native `due_string`, `due_lang`, `duration`, `duration_unit`.

## Schema versioning

Schema bumped from `6` (integer) to `6.1` (JSON float). Migration `migratePlan` v6 → v6.1:

- Build a map `intentionId → sourceHabitId` from any incoming intentions carrying `sourceHabitId`.
- **Drop habit-derived intentions entirely** from the resulting `intentions` array.
- **Re-anchor LinkedTasks** whose `intentionId` referenced a dropped habit-derived intention: clear `intentionId`, set `sourceHabitId = <habit id>`, force `type: 'background'`. Existing `assignedSessions` and `taskSessions` references are preserved (the `todoistId` keys haven't changed).
- Strip `sourceHabitId` and `skippedForToday` from any remaining intentions (defensive).

`loadLifeContext` v6 → v6.1 (stabilizers only):

- If `autoLinkTodoistId` is set and `todoistTaskId` is not, copy across.
- If `maxBlockMinutes` is set and `targetDurationMinutes` is not, copy across.
- If `windowBehavior` is unset, default to `'lenient'`.

The deprecated fields stay on the `Habit` type as `@deprecated` so old localStorage payloads parse without errors; they're read once during migration and then ignored.

`AppSettings.habitsTodoistProjectId` is left undefined; resolved (and persisted) lazily on the first stabilizer save or migrate-banner click.

## Cross-slice invariants (changes)

Carried forward from v6:
- Activating a season auto-deactivates the previously active one.
- Deleting a season clears its id from any habit's `seasonIds`.
- Anchor habits cannot be deleted while active.

Changed in v6.1:
- **`DELETE_HABIT`** no longer needs to clear `sourceHabitId` from intentions (no such intentions exist). Instead it drops any orphan habit-tasks (`sourceHabitId === habitId`) from `plan.linkedTasks` and clears them from `plan.taskSessions`.
- **`LINK_TASK`** lost the "force-to-background-when-target-intention-has-sourceHabitId" branch; new tasks default to `type: 'unclassified'` again.
- **`INJECT_HABIT_TASKS`** is idempotent against habits already present as `LinkedTask.sourceHabitId` (replacing the old "matching intention exists" check).

## Habit-task injection (lifecycle)

1. **Step 1 mount** (`Step1Intentions`): calls `computeHabitTasksToInject({life, plan, taskMap, sessionSlots, now, taskCaps})`. The helper filters to active stabilizers with `todoistTaskId` whose Todoist task is due today and unchecked, honors season scope, and applies the `windowBehavior === 'strict'` gate. Auto-assigns the session whose window contains the Todoist `due.datetime` (falls back to `Habit.targetTime` when the due date has no time-of-day component).
2. Dispatches `INJECT_HABIT_TASKS { entries }`. Reducer appends LinkedTasks (`type: 'background'`, `sourceHabitId`, no `intentionId`) and pushes their ids onto `plan.taskSessions[sessionId]` when set.
3. **Re-fires** when `taskMap.size`, `life.habits`, or `life.activeSeasonId` change. Idempotent at the reducer level.
4. **Step 1 UI**: shows an inline chip — "N habit tasks scheduled for today — see Step 3" — when any orphan habit-tasks exist. No 🔁 badges on intentions anymore (no habit-derived intentions exist).
5. **Step 2**: filters `plan.linkedTasks` to those with `intentionId !== undefined`. Orphan habit-tasks bypass the step.
6. **Step 3 Phase 1**: orphan habit-tasks render under a "🔁 Habits" group inside the selected-session detail; an "Unassigned habits" tray appears above the timeline when any habit-task has `assignedSessions.length === 0`.
7. **Dashboard `CurrentSession`**: groups tasks by `intentionId`, with orphans falling into a synthetic "🔁 Habits" header.

## Habit ↔ Todoist sync (lifecycle)

`HabitsLibrary.handleCreate` / `handleEdit`:

1. Dispatch `ADD_HABIT` / `UPDATE_HABIT` with the full habit (caller generates `id` + `createdAt` for creates).
2. If stabilizer + Todoist configured: call `ensureHabitsProject(...)` once to resolve the workspace default project (creates `"Habits"` lazily if absent), then `resolveHabitProjectId(habit, defaultProjectId, projects)` to honor any per-habit override.
3. Call `syncHabitToTodoist({habit, projectId, actions, taskMap})`:
   - If `habit.todoistTaskId` is set and the cached task exists: update content / `due_string` / `duration`. If the task is in a different project, **move** it via `actions.moveTask` first.
   - Else: create a new recurring task in `projectId`.
   - Returns the resulting `todoistTaskId` (or `null` on failure).
4. If a new id came back, dispatch a follow-up `UPDATE_HABIT` to persist it on the habit.
5. Sync failures show a non-blocking inline message; the habit stays saved locally.

**Migrate banner** (active stabilizers without `todoistTaskId`): resolves the default project **once** before iterating, then loops, passing the same `defaultProjectId` into each `syncStabilizer` call. This fixes a v6.1-internal bug where each iteration would re-read `settings` from the closure, see no cached project id, and re-create a duplicate `"Habits"` project. The fix lives in `HabitsLibrary` (resolve-once pattern), not the helper. The banner also names the destination project inline ("Will sync to <name>") and exposes a **Choose project** ghost button that opens a locally-mounted `SettingsModal` so the user can set their default before kicking off the bulk migrate — avoiding the case where everything would otherwise pile into a freshly auto-created "Habits" project the user didn't pick.

## Project picker

- **Default Habits Project** (Settings → Integrations, only when Todoist is connected): dropdown listing all the user's Todoist projects + an "Auto-create 'Habits' project" option. Persists to `AppSettings.habitsTodoistProjectId`.
- **Per-habit project override** (`HabitForm`'s stabilizer-only Schedule section, only when there are projects available): dropdown listing all projects + "Use default (<project name>)". Persists to `Habit.todoistProjectId`. Changing this on an already-synced habit moves the existing Todoist task on the next save.
- **Resolution order** (in `resolveHabitProjectId`): `habit.todoistProjectId` (when the project still exists) → `defaultProjectId`. If the per-habit project has been deleted in Todoist since being set, silently fall back to the default rather than create an orphan reference.

## New / modified files

**Added:**
- `src/lib/habitsTodoistSync.ts` — sync module (see above).

**Modified — core:**
- `src/types/index.ts` — `Intention` loses `sourceHabitId` / `skippedForToday`; `LinkedTask.intentionId` becomes optional + adds `sourceHabitId` / `skippedForToday`; `Habit` gains `todoistTaskId` / `todoistProjectId` / `targetTime` / `targetDurationMinutes` / `windowBehavior` (and marks `autoLinkTodoistId` / `maxBlockMinutes` `@deprecated`); `AppSettings.habitsTodoistProjectId`; new `HabitTaskInjection` and `HabitWindowBehavior` types.
- `src/context/DayPlanContext.tsx` — schema bumped to `6.1`; v6 → v6.1 migration; new `INJECT_HABIT_TASKS` / `SKIP_HABIT_TASK` actions; `ADD_HABIT` accepts a full `Habit`; `LINK_TASK` lock-to-background branch removed; `DELETE_HABIT` drops orphan habit-tasks.
- `src/context/TodoistContext.tsx` — `CreateTaskOpts` / `UpdateTaskOpts` expose `due_string` / `due_lang` / `duration` / `duration_unit`; `createTask` / `createProject` return the created entity; new `moveTask` action wrapping Sync API `item_move`.
- `src/hooks/useTodoist.ts` — type re-exports updated.
- `src/lib/habits.ts` — `getHabitDerivedIntentionIds` removed; new `isHabitDerivedTask(lt)` and `getHabitTasksForDay(plan)` helpers.
- `src/lib/capacity.ts` — comment update only.

**Modified — UI:**
- `src/components/life/HabitForm.tsx` — new Schedule section (target time, duration, window behavior, project dropdown); removed `autoLinkTodoistId` / `maxBlockMinutes` inputs.
- `src/components/life/HabitsLibrary.tsx` — wires `syncHabitToTodoist` into create/edit; migrate banner for unsynced stabilizers; resolve-once pattern in `handleMigrate`; passes `projects` + `defaultProjectName` into `HabitForm`.
- `src/components/todoist/TodoistSetup.tsx` — new "Default Habits Project" dropdown gated on `isConnected`.
- `src/components/todoist/TodoistPanel.tsx` — `persistentLinks` skips orphan tasks; linking-mode rows for habit-derived tasks render a non-actionable "🔁 Habit" label in place of Link.
- `src/components/wizard/Step1Intentions.tsx` — dispatches `INJECT_HABIT_TASKS` via `computeHabitTasksToInject`; removed `HabitBadge` / `sourceHabitFor` / `autoLinkTodoistId` auto-link block / Skip-for-today button; new "N habit tasks scheduled" chip.
- `src/components/wizard/Step2Refine.tsx` — filters to `intentionId !== undefined`; removed `getHabitDerivedIntentionIds` / `habitLockedIntentionIds` / `lockedToBackground` prop / per-habit cap resolution.
- `src/components/wizard/Step3Schedule.tsx` — `mainTasksByIntention` skips orphans; new `unassignedHabitTasks` tray; `assignedHabitBg` / `assignedManualBg` split inside the selected-session detail (with a "🔁 Habits" header).
- `src/components/dashboard/SessionTimeline.tsx` — `SessionCard` groups orphans under the synthetic `HABIT_GROUP_KEY` ("🔁 Habits"); `isHabitDerived` switches from `intent?.sourceHabitId` to `Boolean(lt.sourceHabitId)`; `SessionTimeline` drops the obsolete `habitDerivedIntentionIds` prop.
- `src/components/ui/SessionTimelineBar.tsx` — drops the `habitDerivedIntentionIds` prop; the 🔁 emoji now reads `lt.sourceHabitId` directly.
- `src/components/settings/CapacitySettings.tsx` — copy update referencing `targetDurationMinutes`.
- `src/components/guide/UserGuide.tsx` — brought to v6.1 to mirror `docs/user-guide.md`.

**Docs:**
- `docs/synthesis.md` — `Last updated`, `Reflects:` line, §2.1 vocab (Intention / LinkedTask / Habit / Stabilizer), §2.2 wizard step descriptions, §5 data-model essentials, §7 Life scaffolding bullets.
- `docs/user-guide.md` — `Reflects:` line, §3 kind copy, §4.2 Stabilizer flow rewrite (target time / duration / project / window behavior), §10 decision tree, §11 typical-day Step 1/2/3 + End-of-day, §12 quick reference.
- `docs/architecture.md` — `_schemaVersion`, migration paragraph, cross-slice invariants, `TodoistActionsContext` (`moveTask`), §6.7 Habit-Task Sync (full lifecycle covering default + per-habit pickers and project moves), wizard step descriptions, `Dashboard` description, `TodoistPanel` linking-mode behavior, §12 directory structure (`habitsTodoistSync.ts`).
- `docs/data-model.md` — `Intention` / `LinkedTask` / `Habit` / `AppSettings` types, new `HabitTaskInjection` type and `HabitWindowBehavior` type alias, schema-marker references bumped, full v6 → v6.1 migration section, ER diagram note, action catalog (`INJECT_HABIT_TASKS` / `SKIP_HABIT_TASK`, `ADD_HABIT` new signature, `DELETE_HABIT` v6.1 behavior, stale `TOGGLE_TASK_HABIT` row removed).
- `CLAUDE.md` — new row in the documentation-discipline table tying `docs/user-guide.md` ↔ `src/components/guide/UserGuide.tsx` as required mirrors.

## Notable bug fix mid-iteration

**Migrate banner duplicated the Habits project per habit.** After landing the migrate flow, manually-triggered bulk migration was observed to create a new Todoist project for every iteration of the loop. Root cause: `handleMigrate` invoked `syncHabitToTodoist` per habit, and each call's `ensureHabitsProject(...)` read `settings` from the React closure captured at handler entry. The `UPDATE_SETTINGS` dispatched by iteration 1 did not flush back into the closure before iteration 2 fired, so the cached `habitsTodoistProjectId` was always undefined and the create branch ran again. Fix: hoist `ensureHabitsProject` to the caller (resolve-once before the loop), pass the resolved `projectId` into a slimmed-down `syncHabitToTodoist({habit, projectId, actions, taskMap})`. This same pattern is now used by `handleCreate` and `handleEdit` (single sync per call still benefits from the explicit resolve, which keeps the helper context-free and easier to reason about).

## Verification performed

- `npm run build` — passes; bundle 511.71 kB (gzip 142.54 kB).
- `npm run lint` — clean.
- `npx tsc --noEmit` — clean.
- Ripgrep sweep for `INJECT_HABIT_INTENTIONS`, `SKIP_HABIT_INTENTION`, `getHabitDerivedIntentionIds`, `Intention.sourceHabitId`, `Intention.skippedForToday` — zero hits in `src/`.

End-to-end manual checks (recommended on first browser session post-deploy):

- **Migration** — open the app with a v6 plan containing a habit-derived intention + linked tasks. After load, confirm: the intention is gone; the linked tasks remain as orphans with `sourceHabitId` set; `_schemaVersion: 6.1` is stamped on the persisted plan.
- **Habit create (E2E)** — create a stabilizer with `targetTime: '07:00'`, `targetDurationMinutes: 10`, daily recurrence, project "Habits" (auto-create). Verify the project appears in Todoist with a recurring task `due_string: "every day at 7:00"`, `duration: 10`.
- **Project picker — default** — Settings → Integrations → "Default Habits Project" lists all Todoist projects. Pick an existing project; create a new stabilizer; verify the recurring task lands in the chosen project.
- **Project picker — per-habit override** — `HabitForm` Schedule section shows project dropdown with "Use default (X)". Override on a new habit; verify the task lands in the override project, not the default.
- **Project picker — move** — edit an existing synced stabilizer's project; save; verify the existing Todoist task is *moved* (same id, new `project_id`), not duplicated.
- **Migrate banner** — with multiple unsynced stabilizers, click "Migrate". Verify Todoist receives **one** project (or none, if the default is already an existing project), and one task per habit. The pre-fix bug would have created N projects.
- **Planning** — start the wizard. Step 1 has no habit-injected intentions but shows the "N habit tasks scheduled" chip. Step 3 has the habit-task pre-assigned to the session containing the Todoist due time. Capacity badge reflects the `targetDurationMinutes`.
- **Window behavior** — set a stabilizer's `windowBehavior` to `strict` and plan after `targetTime + duration`: the habit-task is hidden. Flip to `lenient` and re-plan: the habit-task appears in the unassigned tray (or its session if still in range).
- **Skip** — from Step 3, skip a habit-task. It disappears from the assigned list but the Todoist task is not completed; next day it re-injects.
- **Complete on Dashboard** — check off a habit-task. Confetti fires; Todoist task completes; tomorrow's plan re-surfaces the habit via Todoist's auto-advanced recurrence.
- **Light Pool unchanged** — light-coherent habits still appear in `LightPoolPanel`; logged via `habitLog`; never enter `linkedTasks`.

## Deferred to later iterations

- **v7 — Modes, Rituals, Recovery**: `DayPlan.mode` field, mode switcher, RitualPlayer with templates, Minimum Viable Day. Still the next iteration.
- **v8 — Reviews, Drift Detection, Hierarchical Views**: `/review` route, `useDriftSignals` hook, `/week` cadence view, expanded `/life`.
- **Habit-task move robustness**: if a habit's `todoistTaskId` points to a Todoist task the user has deleted out-of-band, the next sync currently creates a new task but leaves `todoistTaskId` referencing the dead id until the create succeeds. The error path is non-fatal but worth tightening.
- **Step 1 chip → drill-down**: the "N habit tasks scheduled" chip is informational. A click could deep-link to the Step 3 timeline pre-scrolled to the habit's session. Not done in v6.1 to keep the surface change minimal.
