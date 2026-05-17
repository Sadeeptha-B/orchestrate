# Plan v6.x — Habit-as-Task Decoupling (v6.1) + Intentions Backlog (v6.2) + Habit/Session Decoupling (v6.3)

> Frozen post-implementation plan. The living docs ([synthesis.md](../synthesis.md), [data-model.md](../data-model.md), [architecture.md](../architecture.md), [user-guide.md](../user-guide.md)) reflect the result. This document preserves the *narrative* of how the v6.1 and v6.2 point-releases were designed and what tradeoffs were made.
>
> - **v6.1** — Habit-as-Task Decoupling (below)
> - **v6.2** — Intentions Backlog + Todoist unschedule-on-discard ([jump](#v62--intentions-backlog--todoist-unschedule-on-discard))
> - **v6.3** — Full Habit/Session Decoupling (TodaysHabitInstance) + Task Engagement & Reschedule Records → see [plan_v6.3.md](./plan_v6.3.md). Supersedes v6.1's "stabilizer-as-orphan-LinkedTask" carrier; stabilizers now live on `plan.todaysHabits` as their own type.

# v6.1 — Habit-as-Task Decoupling

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

## Post-implementation hardening

After the initial v6.1 land, a holistic-review pass + a Todoist-integration resilience pass produced the following changes (still under the v6.1 schema marker — no version bump):

### Correctness

- **`SKIP_HABIT_TASK` no longer sets `completed: true`.** The original reducer marked a skipped habit-task as both `skippedForToday` AND `completed`, which inflated the dashboard's done counter and rendered the task with strikethrough + 🎉. Re-injection idempotency was never dependent on `completed` (it dedupes by `sourceHabitId` presence), so the lie wasn't load-bearing. Fix: drop the `completed: true` write — `skippedForToday` alone is the signal. Architecture / data-model invariant docs updated to match.
- **Migration drops deprecated fields from the persisted shape.** `loadLifeContext`'s per-habit migration (now extracted as `migrateHabit`) destructures `autoLinkTodoistId` / `maxBlockMinutes` out of the spread so they don't round-trip back into localStorage on every persist. The fields remain on the `Habit` type as `@deprecated` purely so `IMPORT_BACKUP` of older payloads still parses.
- **`IMPORT_BACKUP` runs the same per-habit migration.** Previously, importing a v6 backup into v6.1 left habits looking unsynced (the `autoLinkTodoistId` → `todoistTaskId` etc. only ran on `loadLifeContext`). The reducer case now maps imported habits through `migrateHabit` too.

### Stale-reference resilience

- **`syncStabilizer` self-heals two stale-reference cases on success.** A single follow-up `UPDATE_HABIT` now patches the habit when: (a) `syncHabitToTodoist` returned a new `todoistTaskId` (handles out-of-band Todoist task deletion — the helper's existing fall-through to the create branch already covered the sync, but the stale id stuck around), or (b) the per-habit `todoistProjectId` referenced a project that no longer exists (`resolveHabitProjectId` silently fell back to default; we clear the dead override here). This addresses the "Habit-task move robustness" item that was originally deferred.
- **`/habits` re-sync banner detects missing tasks, not just missing ids.** `needsSyncStabilizers` includes both `!todoistTaskId` and `todoistTaskId set but absent from taskMap` (guarded by `taskMap.size > 0` to avoid cold-cache false positives). Banner copy and the primary button label adapt:
  - all-new → "*N stabilizers need to be synced*" + "Migrate"
  - all-missing → "*…have a Todoist task that's gone missing*" + "Re-sync"
  - mixed → "*N stabilizers need syncing (X new, Y missing in Todoist)*" + "Re-sync"
  The loop itself is unchanged — `syncHabitToTodoist`'s `taskMap.get(todoistTaskId) === undefined` fall-through to the create branch makes re-sync just work.
- **Refresh-projects affordance on both setup surfaces.** `TodoistSetup` and `HabitForm` each render a `↻ Refresh` button calling `actions.refreshProjects({ force: true })`. Both surfaces also detect stale project ids: the Settings dropdown surfaces a warning + **Clear** button when `habitsTodoistProjectId` doesn't match any current project, and `HabitForm` shows a stale-override warning when `initial.todoistProjectId` doesn't match.
- **Focus refresh extended to projects.** The existing `window.focus` listener now invokes both `refreshTasks` AND `refreshProjects`. Both dedupe via the 30s staleness window, so the cost is near-zero. Sections are still skipped — they're stable enough not to warrant refetching on focus.

### Auth-failure surfacing

- **`TodoistAuthError` + `authFailed` flag.** `apiFetch` throws a typed `TodoistAuthError` on HTTP 401. A single `handleApiError(e, fallback)` helper inside `TodoistProvider` routes 401s to `setAuthFailed(true)` + a "reconnect in Settings" message; non-auth errors fall through to each call-site's specific fallback. `authFailed` resets when the token changes. `TodoistSetup` renders a red top banner when `authFailed && isConnected` and flips the status badge from "Connected" to "Token rejected". This catches token revocation/expiry, which used to disappear silently into the project/section refresh path (which intentionally suppresses generic errors).

### Concurrency

- **Habit-save lockout during migration.** While `handleMigrate` runs, the **New Habit** button and per-row Pause/Edit/Delete buttons are disabled. This eliminates the race where a concurrent `handleCreate` would re-invoke `ensureHabitsProject` in parallel with the loop's resolved id. Confirmed with the user that migration is user-initiated (not a background sync), so the lockout was preferred over a module-level mutex.

### Dead code / consolidation

- **`pickRestCue` removed.** Exported from `src/data/restCues.ts` but never imported — `TrueRestCard` always used index-based cycling.
- **`isHabitDerivedTask` / `getHabitTasksForDay` now have call sites.** Six places previously inlined `Boolean(lt.sourceHabitId)`; they now go through the shared helpers. `Step3Schedule`'s duplicate local `isHabitDerived` arrow was deleted.
- **Stale UI copy.** `AboutContent`, `LifeView`, and `Step2Refine` all carried leftover "auto-inject as intentions" language. Updated to reflect v6.1's session-assigned-task behavior.

## Deferred to later iterations

- **v7 — Modes, Rituals, Recovery**: `DayPlan.mode` field, mode switcher, RitualPlayer with templates, Minimum Viable Day. Still the next iteration.
- **v8 — Reviews, Drift Detection, Hierarchical Views**: `/review` route, `useDriftSignals` hook, `/week` cadence view, expanded `/life`.
- **Step 1 chip → drill-down**: the "N habit tasks scheduled" chip is informational. A click could deep-link to the Step 3 timeline pre-scrolled to the habit's session. Not done in v6.1 to keep the surface change minimal.

---

# v6.2 — Intentions Backlog + Todoist unschedule-on-discard

## Context

v6.1 cleaned up how *habits* relate to tasks; v6.2 fixes three pain points around how *intentions* relate to the day:

1. **Overcommitment realization mid-plan.** At Step 3 the user often realizes the intentions written in Step 1 don't fit the day. v6.1 only offered *delete* (loses the thought) or *keep* (overflows the day). Neither matched the actual user mental model: "I want to do this, just not today."
2. **Mid-day course corrections.** Same problem at a different time: users want to swap an intention for another without losing the deferred one.
3. **Day rollover loses unfinished work.** `loadPlan()` silently discarded a stale plan when the date changed. Yesterday's unfinished intentions evaporated. The plan auto-resetting daily was correct; the silent erasure of unfinished thought was not.

Layered on top: a **latent bug** in `REMOVE_INTENTION` — it scrubbed `plan.linkedTasks` + `plan.taskSessions` but never told Todoist, so deleted intentions left behind orphan scheduled tasks with stale due dates. The new backlog flow exercises the same path, so fixing the bug was bundled into v6.2.

Schema bumps to `6.2` (JSON float).

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| **Storage** | `life.backlog: BacklogEntry[]` — piggybacked on the existing `LifeContext` slice. No new persistence key. | Backlog is durable cross-day state like seasons and habits. Reusing `orchestrate-life-context` reuses `IMPORT_BACKUP`, the persist effect, and the migration entry point. Adding a 5th key was strictly more plumbing for no observable win. |
| **UI surface** | Reuse the existing left-side sidebar — rename `SavedSessions.tsx` → `HistorySidebar.tsx` and split it into two tabs (Sessions / Backlog). Wizard + Dashboard headers initially had two buttons ("Saved Sessions" and "📥 Backlog (N)"), each focusing the sidebar on its tab. **Follow-up collapsed these to a single `Work Items` button** that just toggles the sidebar — the in-panel tab toggle handles Sessions vs Backlog selection. | User asked for the sidebar-with-two-tabs layout explicitly. Saved sessions and the backlog are both "history-shaped" surfaces — different shape, same affordance set. One sidebar with two tabs avoids competing slide-outs. The follow-up consolidation removed the duplicated header-vs-tab affordances pointing at the same panel. |
| **Discard UX** | Replace the single `Remove` button on intention rows with two icon buttons: `📥` (Move to backlog — non-destructive, primary) and `🗑` (Delete — confirm modal). Both unschedule Todoist tasks via the shared `useIntentionRemoval` hook. | The primary failure mode in v6.1 was treating "don't want this today" as "delete forever." Making backlog the visual default + delete a deliberate destructive action correctly biases the user toward recoverable choices. |
| **Where the affordance appears** | Step 1 (via `EditableTaskList` row buttons) **and** Step 3 (via a new "Today's intentions" overview panel at the top of Phase 1, with the same row affordances). | User explicitly called out Step 3 as the "realize-overcommitment" moment. The overview panel doubles as a single-glance "what am I doing today" widget for Phase 1. |
| **Rollover unschedule** | **No** — auto-rollover never touches Todoist. Yesterday's tasks become "overdue" in Todoist, which the user can resolve there. Only *manual* paths (manual move-to-backlog, manual delete, manual discard-from-backlog) unschedule. | Auto-clearing yesterday's due dates would hide the user's incomplete work in their primary task tool. The backlog is Orchestrate's idea, not Todoist's; we don't get to delete signal from Todoist on the user's behalf without an explicit user action. |
| **EoD auto-save** | **Removed in the v6.2 follow-up.** Initial v6.2 wrote an authoritative `Auto: <date>` `SavedDayPlan` at rollover (replacing any same-date manual save). The follow-up dropped this entirely — `SAVE_DAY` is now the only writer to `history`. | Once the backlog persisted the meaningful unfinished portion of yesterday, the full-plan snapshot was redundant. The auto-save was duplicating context the backlog already captured, while adding a "rotating ticker" of auto-rows to the Sessions tab that the user had to mentally filter out. Manual saves remain as deliberate "I want a record of this exact day" snapshots — e.g. before a major reset, or for export. |
| **Completed tasks on backlog entries** | **Strip completed ids from `intention.linkedTaskIds`; preserve titles as `completedTaskTitles: string[]`.** Rendered inline in the Backlog tab as a subtle `✓ Done: …` annotation (single line, muted, truncated with hover tooltip). | The original v6.2 carried *all* `linkedTaskIds` forward and rebuilt them on restore as fresh `unclassified` LinkedTasks with `completed: false`. For tasks that had been completed yesterday, this tripped Step 2's "stale" rendering (completed Todoist tasks are absent from the active REST cache, so `isStale = !todoistTask && !lt.completed` returned true) — the user saw italic + ⚠ + a Remove button on yesterday's *completed* work. Stripping the completed ids at archive time avoids the stale path entirely; preserving titles as text gives useful "what got done" context without re-creating fake LinkedTasks. |
| **Restore from backlog: how do tasks come back?** | Tasks rebuild as fresh `LinkedTask` rows (`type: 'unclassified'`, no estimate, no assignment, not completed). User re-flows them through Step 2 + Step 3. `titleSnapshot` populates from live `taskMap` first, then from `entry.taskSnapshots` (captured at archive time), then as a last resort the todoist id. | Preserving estimates / assignments / type across days is conceptually wrong — yesterday's plan isn't today's plan. Fresh re-categorization forces the user to re-decide consciously. |
| **Schema marker** | `6.2` (JSON float). | Consistent with v6.1's "label tracks marker" choice. JSON floats compare with `<` correctly, so the migration gate stays simple. |

## Architectural shape

No new contexts. Two new pure-function modules + one new hook:

- **`src/lib/backlog.ts`** — `hasUnfinishedWork(intention, plan)`, `buildBacklogEntry(intention, plan, reason)` (splits pending vs completed task ids; the latter become `completedTaskTitles`), `harvestStalePlan(plan)`, `rebuildLinkedTasksForBacklogEntry(entry, taskCache)` (rebuilds only the *pending* ids — completed titles are read-only annotation). Pure helpers used by the reducer and by `loadInitialState`. (`buildAutoSaveEntry` lived here in the initial cut but was removed alongside EoD auto-save in the follow-up.)
- **`src/lib/intentionUnschedule.ts`** — `unscheduleIntentionTasks(...)` (the Todoist-side cleanup) + `useIntentionRemoval()` hook (the shared "unschedule then dispatch" wrapper). The hook is the single source of truth for *all* intention-removal call sites: `EditableTaskList`, `Step3Schedule`, `BacklogTab`.
- **Reducer-side**: four new actions (`MOVE_INTENTION_TO_BACKLOG`, `RESTORE_FROM_BACKLOG`, `DELETE_BACKLOG_ENTRY`, `BACKLOG_HARVEST`). `REMOVE_INTENTION` reducer-case stays pure — Todoist unschedule moves to the call site.
- **Init-side**: `loadPlan` is removed; `loadInitialState` coordinates `peekRawPlan` + `loadLifeContext` + `loadHistory` + `loadSettings`. When the plan's date is stale it appends `harvestStalePlan(plan)` to `life.backlog` and returns a fresh plan. `history` is passed through untouched — manual saves are the only writer. `useReducer(reducer, null, loadInitialState)` replaces the four separate per-slice loaders.

## Schema versioning

Schema bumped from `6.1` (JSON float) to `6.2`. Migrations:

- **`migratePlan` v6.1 → v6.2**: no plan-shape changes. The schema marker is just stamped on persist.
- **`loadLifeContext` v6.1 → v6.2**: `backlog` defaults to `[]` when missing (kept undefined-safe — readers tolerate `undefined`).
- **`IMPORT_BACKUP`**: incoming `life.backlog` merges by entry id (existing entries never overwritten). `life.restCues` now also merges-by-presence (the v6.1 IMPORT_BACKUP case had silently dropped it — fixed as a small drive-by).
- **First cold load after deploy with a stale plan**: triggers `loadInitialState`'s rollover branch. Harvests unfinished intentions into the backlog and returns a fresh plan. Idempotent on re-runs because once the plan resets to today, the date-check short-circuits.

## Cross-slice invariants (changes)

Carried forward from v6.1:
- Activating a season auto-deactivates the previously active one.
- Deleting a season clears its id from any habit's `seasonIds`.
- Anchor habits cannot be deleted while active.
- `INJECT_HABIT_TASKS` idempotency via `sourceHabitId` presence.
- `SKIP_HABIT_TASK` doesn't set `completed`.
- Light-coherent habits never enter `linkedTasks`.

Added in v6.2:
- **`MOVE_INTENTION_TO_BACKLOG`** mirrors `REMOVE_INTENTION`'s plan-side cleanup (scrubs `linkedTasks` + `taskSessions`) and additionally appends a `BacklogEntry` to `life.backlog`. `buildBacklogEntry` partitions linked tasks: completed ids drop from `intention.linkedTaskIds` (their titles go into `completedTaskTitles`); pending ids round-trip with `titleSnapshot`s in `taskSnapshots`.
- **`RESTORE_FROM_BACKLOG`** is idempotent against re-adds: if an intention with the same id is already in `plan.intentions`, the action removes the backlog entry but skips the plan-side append. It also skips any `todoistId` already present in `plan.linkedTasks` (e.g. the same task is linked to a different intention today). `completedTaskTitles` is preserved on the entry but never reconstructed into `LinkedTask` rows — it's strictly context.
- **`DELETE_BACKLOG_ENTRY`** assumes the caller already unscheduled Todoist tasks via `useIntentionRemoval().discardFromBacklog`. The reducer itself stays pure.
- **`BACKLOG_HARVEST`** is a pure append used only by the rollover path; it's exposed as an action for symmetry/testability even though `loadInitialState` writes into the same slice directly.

## Lifecycle

### Day rollover (backlog harvest only)

1. App boot. `loadInitialState()` reads raw `orchestrate-day-plan` via `peekRawPlan()` (which runs `migratePlan` but skips the freshness gate).
2. If `parsed.date === todayISO()`: return the plan as-is alongside the other slices. No-op.
3. Else: stale plan detected. Run `harvestStalePlan(parsed)` to compute `BacklogEntry[]` for intentions where `hasUnfinishedWork()` is true. Empty-linked-task intentions (intentions the user never linked tasks to) are NOT harvested — there's nothing to recover. `buildBacklogEntry` automatically strips completed-task ids and stashes their titles in `completedTaskTitles`.
4. Append harvested entries to `life.backlog`. Return `{ plan: freshPlan(), settings, history: baseHistory, life: updated, editingStep: null }`. **No `SavedDayPlan` is created** — `history` is left untouched.
5. Effects re-persist the four slices on the next render.

### Manual move-to-backlog (Step 1 / Step 3 / EditableTaskList)

1. User clicks `📥`. `EditableTaskList`'s click handler (or Step3Schedule's row handler) calls `useIntentionRemoval().moveToBacklog(intentionId)`.
2. Hook collects the intention's linked task ids from `plan.linkedTasks` (filtering by `intentionId` to exclude orphan habit-tasks defensively).
3. Hook calls `unscheduleIntentionTasks(...)` which, per id: skips habit-derived, missing-from-cache, and already-unscheduled tasks; otherwise fires `actions.updateTask(id, { due_string: 'no date' })`. Calls run in parallel via `Promise.allSettled`; errors are logged but never block.
4. Hook dispatches `MOVE_INTENTION_TO_BACKLOG`. Reducer scrubs plan-side state + appends `BacklogEntry` to `life.backlog`.
5. UI re-renders. Header's `Work Items (N)` count increments. Backlog tab inside the sidebar shows the new entry.

### Delete intention permanently

Same flow as move-to-backlog but: confirm modal first, then `useIntentionRemoval().removeIntention(intentionId)` dispatches the original `REMOVE_INTENTION` after the unschedule. The bug-fix: previously the unschedule never happened. Now it always does.

### Restore from backlog

1. User clicks "Bring to today" inside `BacklogTab`.
2. Handler reads the live Todoist `taskMap` and builds a `taskCache: Record<todoistId, content>`.
3. Dispatches `RESTORE_FROM_BACKLOG { backlogId, taskCache }`.
4. Reducer appends the entry's intention to `plan.intentions` and reconstructs fresh `LinkedTask` rows via `rebuildLinkedTasksForBacklogEntry(entry, taskCache)`. Title snapshot resolution order: `taskCache[id]` → `entry.taskSnapshots?.[id]` → undefined (in which case `getTaskTitle` falls back to the id).
5. Entry is removed from `life.backlog`.
6. If `plan.setupComplete === false`, the handler navigates to `/setup` so the user lands in Step 1 with their restored intention ready to re-flow through Step 2 + Step 3. (If they're already on Dashboard, the restored intention shows up there immediately and they can Edit Plan / Recontextualize at their own pace.)

### Discard backlog entry

1. User clicks "Discard" in `BacklogTab`. Confirm modal.
2. On confirm: `useIntentionRemoval().discardFromBacklog(backlogId)` looks up the entry, calls `unscheduleIntentionTasks(entry.intention.linkedTaskIds, [], actions, taskMap)` (empty `linkedTasks` array is intentional — no habit-task safety check needed since backlog entries only hold intention-bound ids by construction), then dispatches `DELETE_BACKLOG_ENTRY`.

## New / modified files

**Added:**
- `src/lib/backlog.ts` — backlog helpers.
- `src/lib/intentionUnschedule.ts` — Todoist unschedule helper + `useIntentionRemoval` hook.
- `src/components/dashboard/HistorySidebar.tsx` — renamed from `SavedSessions.tsx`; container with tab toggle. Contains both `HistorySidebar` (the controlled-tab container) and `SavedSessionsTab` (the per-row Sessions UI extracted intact).
- `src/components/dashboard/BacklogTab.tsx` — per-row Backlog UI ("Bring to today" / "Discard" with confirm modal).

**Removed:**
- `src/components/dashboard/SavedSessions.tsx` — renamed/refactored into `HistorySidebar.tsx`.

**Modified — core:**
- `src/types/index.ts` — `BacklogEntry` type with `completedTaskTitles?: string[]`; `LifeContext.backlog?`.
- `src/context/DayPlanContext.tsx` — schema → `6.2`; `peekRawPlan` + `loadInitialState`; `emptyLifeContext` includes `backlog: []`; four new actions; `IMPORT_BACKUP` merges backlog entries by id (and now also retains `restCues`); `useReducer` initializer switched to `loadInitialState`. The old `loadPlan` helper was deleted.
- `src/context/TodoistContext.tsx` — `UpdateTaskOpts` `due_*` and `duration*` fields are now `string | null` / `number | null` so callers can pass `null` to clear scheduling. (`apiFetch` already round-trips `null` through `JSON.stringify`.)

**Modified — UI:**
- `src/components/wizard/WizardLayout.tsx` — header gains a single `Work Items` button (post-consolidation; initially shipped as two separate Saved Sessions + Backlog buttons); sidebar shell wraps the new `HistorySidebar` with controlled tab state.
- `src/components/dashboard/Dashboard.tsx` — same.
- `src/components/ui/EditableTaskList.tsx` — intention rows get `📥` / `🗑` icon buttons routed through `useIntentionRemoval`. Delete is confirm-modal-gated.
- `src/components/wizard/Step3Schedule.tsx` — new "Today's intentions ({N})" overview panel at the top of Phase 1 with the same `📥` / `🗑` affordances.

**Docs:**
- `docs/synthesis.md` — `Last updated:` + `Reflects:` bumped to v6.2; §2.1 vocab gains the **Backlog** row; §2.2 wizard step descriptions note the new affordance; §5 data-model essentials mention `life.backlog`; §7 feature inventory adds the backlog feature; bug-fix call-out.
- `docs/architecture.md` — `loadInitialState` description in §5.1; new sidebar component name; `UpdateTaskOpts` `null` support note in §5.2; new §6.8 Intentions Backlog; backlog-tab component in §12 directory structure.
- `docs/data-model.md` — `BacklogEntry` type; `LifeContext.backlog`; schema marker `6.2`; new reducer-action catalog entries; rollover migration prose.
- `docs/user-guide.md` + `src/components/guide/UserGuide.tsx` — backlog mental model + how to defer / bring back / discard, what happens at rollover.
- `docs/history/plan_v6.1.md` renamed to `docs/history/plan_v6.x.md`; this v6.2 section appended.

## Verification performed

- `npm run build` — passes; bundle 526.59 kB (gzip 146.41 kB), up from 511.71 kB in v6.1 (acceptable — new types, helpers, sidebar tabs, modals, Step 3 overview panel).
- `npm run lint` — clean.
- `npx tsc --noEmit` — clean.

End-to-end manual checks (run on first browser session post-deploy):

- **Bug fix E2E**: create an intention, link 2 Todoist tasks, schedule them (Step 3 Phase 2). Click 🗑 → confirm. Confirm in Todoist that both tasks lost their due dates (previously they'd remain scheduled).
- **Manual move-to-backlog E2E**: same setup but click 📥. Confirm intention disappears from `plan.intentions`, appears under the Backlog tab in the sidebar with reason "manual", Todoist tasks unscheduled, header counter increments.
- **Bring back E2E**: open the sidebar's Backlog tab, click "Bring to today". Confirm intention reappears in `plan.intentions` with fresh `LinkedTask` rows (`type: 'unclassified'`, no estimate, no assignment). User can re-flow them through Step 2 + Step 3.
- **Rollover E2E**: change system clock forward one day and reload. Confirm: (a) intentions with uncompleted linked tasks appear in the Backlog tab with reason "rolled over"; (b) any completed tasks from yesterday show up under `✓ Done: …` on the backlog row rather than as fresh tasks; (c) the Sessions tab is untouched (no `Auto: <date>` entry); (d) Todoist due dates untouched.
- **Discard backlog entry E2E**: confirm modal appears; on confirm, entry gone, Todoist tasks unscheduled.
- **Habit-task safety**: spot-check that orphan habit-tasks (`sourceHabitId` set) are never unscheduled by `unscheduleIntentionTasks` — the helper has explicit skip logic. Habits are owned by `syncHabitToTodoist`, not by the intention flow.
- **Backup roundtrip**: full-backup export from a v6.2 instance with backlog entries; import into a fresh v6.2 instance; confirm `life.backlog` (including `completedTaskTitles`) round-trips intact (merge-by-id).
- **Completed-task safety on restore**: park an intention with some completed and some pending tasks. Open the Backlog tab — pending count is N, `✓ Done: …` shows the completed titles. Click "Bring to today" — only the pending ids reappear as fresh `unclassified` LinkedTasks. Step 2 doesn't render any "stale" italic+⚠ rows.

## Notable design notes

- **`due_string: 'no date'` over `due_date: null`.** Both work on the Todoist REST API v1 (the JSON body's `null` is propagated by `JSON.stringify`), but `'no date'` is the documented sentinel and is consistent with other recurring/clearing operations in the Todoist API surface. Either would have been correct.
- **`loadPlan` removed entirely.** `peekRawPlan` does the same parse-and-migrate work but without the date-freshness gate, and `loadInitialState` is the only caller that needs to decide what to do with a stale plan. Keeping `loadPlan` would have been a duplicate of `peekRawPlan` plus a discard — the wrong primitive once the harvest path existed.
- **Why the bug existed for so long.** v6.1 (and prior) treated the reducer as the boundary of correctness. Reducer purity is a virtue, but it meant async side-effects (like clearing a remote due date) had no obvious home — call sites typically dispatched and moved on. v6.2 makes the side-effect explicit by introducing the `useIntentionRemoval` hook as *the* boundary for intention removal. Every call site goes through it; there's nowhere for the bug to hide.

## Post-implementation follow-ups (still under `_schemaVersion: 6.2`)

After the initial v6.2 land, two corrections were made based on user feedback:

### EoD auto-save removed

The original v6.2 wrote an authoritative `SavedDayPlan` with `label: "Auto: {date}"` at rollover, replacing any same-date manual save. In practice this surfaced as noise in the Sessions tab: every rollover added an "Auto:" row that duplicated context the backlog already captured. The user observed that the backlog persists the *meaningful* part of yesterday (unfinished intentions), making the full-plan snapshot redundant.

Fix: drop the auto-save entirely from `loadInitialState`. `history` is now manual-only — `SAVE_DAY` is the sole writer. `buildAutoSaveEntry` was removed from `src/lib/backlog.ts`.

### Completed tasks stripped from backlog entries on archive

The original v6.2 preserved all `linkedTaskIds` on a `BacklogEntry`, regardless of whether the underlying tasks had been completed at archive time. `RESTORE_FROM_BACKLOG` rebuilt every id as a fresh `unclassified` `LinkedTask` with `completed: false`. For tasks that had been completed in Todoist yesterday — and therefore were absent from today's active REST API cache — this tripped Step 2's "stale" rendering: `isStale = !todoistTask && !lt.completed` returned true, producing italic + ⚠ + a Remove button on what should have been done work.

Fix: `buildBacklogEntry` now splits the intention's linked tasks. Completed ids never enter `intention.linkedTaskIds`; instead their `titleSnapshot` is appended to a new optional `BacklogEntry.completedTaskTitles: string[]`. `BacklogTab` renders this as a muted single-line `✓ Done: title1, title2 …` annotation (truncated, with a hover tooltip exposing the full list). `RESTORE_FROM_BACKLOG` only rebuilds LinkedTasks for the pending ids; completed titles stay on the entry as read-only context for as long as the entry lives.

Why text-not-tasks: a completed task on yesterday's intention is not work to redo. Surfacing it as a LinkedTask would either invite a needless re-completion (if rebuilt as `completed: true`) or — worse — would require the user to dismiss it through the wizard (the original v6.2 behavior). The title-as-annotation approach gives the user the context they need to remember progress without polluting the action surface.

The post-fix `BacklogEntry` shape is purely additive — old entries without `completedTaskTitles` still parse and render correctly (they just won't show the annotation line). No migration needed.

### Header surface consolidated to one "Work Items" button

Initial v6.2 added two distinct header buttons next to the existing `HeaderControls` cluster on Dashboard and WizardLayout: `Saved Sessions` (toggles + focuses the sessions tab) and `📥 Backlog (N)` (toggles + focuses the backlog tab). Both opened the same left-side sidebar — the only difference was the initial tab.

This produced two UI surfaces pointing at the same panel: header buttons *and* the in-panel tab toggle. Users had to learn that the header-button's tab selection and the in-panel tab selection were the same lever.

Fix: collapse both header buttons into a single `Work Items` toggle that just opens/closes the sidebar. Sessions vs Backlog selection lives entirely in the in-panel tab toggle (which already existed). The count suffix on the header button reflects backlog size only (e.g. `Work Items (3)`) — that's the actionable signal worth surfacing at header level; sessions count is stable history and doesn't need promotion.

Also folded in here: a lint-clean fix to `HeaderControls.tsx` — the `aboutTriggerRef.current = …` assignment moved from a render-time conditional (which violated `react-hooks/refs`) into a `useEffect` that sets up the ref on mount and clears it on unmount. Welcome's existing onClick-driven access to `aboutTriggerRef.current?.()` runs well after first commit so the effect-based assignment is in place by the time it's called.

## Deferred to later iterations

- **v7 — Modes, Rituals, Recovery**: unchanged from v6.1's deferred list.
- **v8 — Reviews, Drift Detection**: unchanged.
- **Backlog on `/life`**: a dedicated `/life` section mirroring the sidebar's BacklogTab. v6.2 ships only the sidebar surface; adding a `/life` section is a one-component diff if usage warrants it.
- **Auto-prune of old saves**: the user explicitly opted out of automatic history cleanup ("we leave it up to the user can choose to delete old saves to maintain storage discipline"). A future iteration could add a "prune saves older than 30 days" toggle in Settings.
- **Backlog age decay**: backlog entries currently live forever. A staleness signal ("this has been in backlog for 14 days — drop it?") could land in v8's drift-detection work.
