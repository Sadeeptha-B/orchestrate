# Orchestrate v6.6 — Unify light-coherent habits into the habit-instance machinery

## Context

Today `kind` ([types/index.ts:218](src/types/index.ts#L218)) silently gates **three** coupled capabilities: Todoist sync, engagement tracking, and scheduling. Stabilizers get all three; light-coherent get none — they're log-only (`HabitLogEntry` on `plan.habitLog`), surfaced in a dedicated dashboard "Light Pool" card, never touch Todoist.

The user wants light-coherent habits ("Read a chapter", "Practice skips") to gain the **same tracking + Todoist sync** as stabilizers. The only surviving difference becomes **scheduling**: stabilizers must have a fixed `targetTime`; light-coherent are always untimed ("anytime"), pulled opportunistically.

Outcome:
- All habits sync to Todoist as recurring tasks and produce `TodaysHabitInstance` rows.
- The unified **"Today's Habits"** card (`HabitInstanceCard`) + **Engagement Log** carry both kinds. The dashboard **Light Pool card is removed**.
- Stabilizers require a target time (enforced in the form); light-coherent never have one.
- True Rest (`RestCue`) is unaffected — still non-tracked.

### Decisions (confirmed with user)
1. **Legacy untimed stabilizers** → show a `NEEDS TIME` badge in the Habits library; no fabricated time. Form blocks saving a stabilizer without a time going forward.
2. **Check-in low-energy surfacing** → repoint from `LightPoolRow` to the top 1–2 *anytime* habit instances with a Start control.
3. **/life `LightPoolSection`** → removed entirely (light-coherent now live in the normal Habits library + dashboard card).

---

## What's already kind-agnostic (no change needed)
Confirmed via exploration — do **not** touch:
- All habit-instance reducer cases (`START/STOP/COMPLETE/SKIP/RESCHEDULE_HABIT_INSTANCE`, `REFRESH_TODAYS_HABITS`) in [DayPlanContext.tsx](src/context/DayPlanContext.tsx) — already operate on instances regardless of kind, already handle absent `targetTime`.
- `SessionTimelineBar` anytime-cluster + lane logic, and `Step3HabitsPanel` ([Step3Schedule.tsx](src/components/wizard/Step3Schedule.tsx)) — already render untimed instances as "anytime".
- `buildDueString` ([habitsTodoistSync.ts:21](src/lib/habitsTodoistSync.ts#L21)) — already emits valid no-time recurrence strings.
- `reconcileOverdueStabilizers` body — the `due_date` (untimed) bump path already works; only its name changes.

---

## Changes

### 1. Generalize the sync/compute/reconcile layer — [lib/habitsTodoistSync.ts](src/lib/habitsTodoistSync.ts)
Remove the `kind === 'stabilizer'` gates so both kinds flow through:
- `syncHabitToTodoist` (~L110): drop `if (habit.kind !== 'stabilizer') return null;`.
- `computeTodaysHabitInstances` (~L204–233):
  - Remove the `kind !== 'stabilizer'` filter.
  - Scope the window gate to stabilizers: `if (habit.kind === 'stabilizer' && habit.windowBehavior === 'strict' && habit.targetTime) {…}`.
  - Force untimed for light-coherent: `const targetTime = habit.kind === 'stabilizer' ? (dueTime ?? habit.targetTime) : undefined;`
  - Duration default becomes kind-aware: `habit.targetDurationMinutes ?? (habit.kind === 'stabilizer' ? taskCaps.stabilizer : taskCaps.lightCoherent)`.
- `findNeedsSyncStabilizers` (~L275) and `findOverdueStabilizers` (~L308): drop the kind gates so light-coherent without a `todoistTaskId` get detected as `never-synced` (→ auto-created by the reconcile provider) and overdue light-coherent get date-bumped.
- **Rename** for clarity: `findNeedsSyncStabilizers → findNeedsSyncHabits`, `findOverdueStabilizers → findOverdueHabits`, `reconcileOverdueStabilizers → reconcileOverdueHabits`, types `OverdueStabilizerInfo → OverdueHabitInfo`, `NeedsSyncStabilizerInfo → NeedsSyncHabitInfo`.

### 2. Rename the per-habit sync hook
[useSyncStabilizer.ts](src/hooks/useSyncStabilizer.ts) → `useSyncHabit`; drop the `kind !== 'stabilizer'` guard (~L27). Update the two callers: [HabitsLibrary.tsx](src/components/life/HabitsLibrary.tsx) and [ReconciliationContext.tsx](src/context/ReconciliationContext.tsx). In `HabitsLibrary.handleCreate/handleEdit`, drop the `newHabit.kind === 'stabilizer'` condition so light-coherent also sync on save.

### 3. Central reconciliation — [ReconciliationContext.tsx](src/context/ReconciliationContext.tsx) + [useStabilizerReconciliation.ts](src/hooks/useStabilizerReconciliation.ts)
Pure rename/copy pass (logic unchanged): `useStabilizerReconciliation → useHabitReconciliation`, update the helper imports to the renamed functions, and generalize user-facing copy in the `HabitsLibrary` banner ("stabilizers need syncing" → "habits need syncing") and the `HabitSyncChip`. Update the consuming import in [HabitsLibrary.tsx](src/components/life/HabitsLibrary.tsx).

### 4. Mandatory time for stabilizers — [HabitForm.tsx](src/components/life/HabitForm.tsx)
- `canSubmit` (~L87): require a valid `targetTime` when `isStabilizer` (e.g. `name.trim() && (!isStabilizer || /^\d{2}:\d{2}$/.test(targetTime.trim()))`). Surface an inline "Stabilizers need a target time" hint when blocked.
- Relabel the input "Target time (optional)" → "Target time" (required) (~L211).
- **Restructure field visibility** so both kinds can sync: move **Duration** and the **Todoist project picker** out of the `isStabilizer`-only block (~L206–310) into a shared section. Keep **target time** + **window behavior** stabilizer-only. In `handleSubmit` (~L118–126), drop the `isStabilizer &&` guard on `todoistProjectId` and `targetDurationMinutes`; keep it on `targetTime` and `windowBehavior`.
- Rewrite the kind-description copy (~L160–164): stabilizer = "Scheduled ritual — synced to Todoist, surfaces on your timeline at its set time (required)."; light-coherent = "Anytime habit — synced & tracked like a stabilizer, but pulled opportunistically with no fixed time."

### 5. Unify the dashboard card — [HabitInstanceCard.tsx](src/components/dashboard/HabitInstanceCard.tsx)
- Light-coherent instances appear automatically once `computeTodaysHabitInstances` emits them (untimed → existing "Anytime" badge + bottom-sorted).
- **Gate the ⤴ Reschedule control** to stabilizers only (look up `habitById.get(i.habitId)?.kind === 'stabilizer'`) — reschedule is meaningless for an unschedulable habit. Start/Stop/Complete/Skip stay for both.
- Engagement Log (`EngagementLogCard`) already includes any instance with segments — no change.

### 6. Remove the Light Pool surface
- **Delete files:** [LightPoolPanel.tsx](src/components/dashboard/LightPoolPanel.tsx), [LightPoolRow.tsx](src/components/dashboard/LightPoolRow.tsx), [LightPoolSection.tsx](src/components/life/LightPoolSection.tsx).
- [Dashboard.tsx](src/components/dashboard/Dashboard.tsx): remove the `<LightPoolPanel />` mount (~L203) + import (~L21) + comment.
- [LifeView.tsx](src/components/life/LifeView.tsx): remove the `LightPoolSection` import + usage (~L6, L73); collapse the grid row it occupied.
- Remove `getLightPoolHabits` from [habits.ts](src/lib/habits.ts) (only callers were LightPoolPanel + CheckInModal, both repointed/removed).

### 7. Check-in repoint — [CheckInModal.tsx](src/components/checkin/CheckInModal.tsx)
Replace the `getLightPoolHabits`/`LightPoolRow`/`plan.habitLog` low-energy block (~L47–58, L179–199) with a read of `plan.todaysHabits` filtered to non-terminal **untimed** (light-coherent) instances, `slice(0,2)`, rendered with a Start button dispatching `START_HABIT_INSTANCE` (and a Complete affordance). Keep the `TrueRestCard`.

### 8. Types + reducer + migration — [types/index.ts](src/types/index.ts), [DayPlanContext.tsx](src/context/DayPlanContext.tsx)
- **types:** remove the `HabitLogEntry` interface and `DayPlan.habitLog`. Keep `TaskCapDefaults.lightCoherent` (now the duration default for light-coherent instances). Update the `HabitKind` doc comment (~L216) to the new semantics.
- **reducer:** remove the `LOG_HABIT_START` / `LOG_HABIT_COMPLETE` / `DELETE_HABIT_LOG_ENTRY` action types + cases; remove `habitLog: []` from `freshPlan()` and the migration init lines that set it.
- **migrateHabit** (~L308–324): for `kind === 'light-coherent'`, strip stray `targetTime` and `windowBehavior` (defensive — they shouldn't carry schedule fields). Existing light-coherent have no `todoistTaskId`, so the reconcile provider auto-creates their recurring tasks on next hydration — no extra migration needed.
- **SCHEMA_VERSION** stays `6.3` (consistent with how v6.4/6.5 were handled — `habitLog` is daily-ephemeral and simply not carried forward; no breaking shape bump). Label the work "v6.6" in comments/docs only.

### 9. Legacy "needs time" badge — [HabitsLibrary.tsx](src/components/life/HabitsLibrary.tsx)
Add a `NEEDS TIME` badge (alongside the existing `UNSYNCED` badge ~L274) when `h.kind === 'stabilizer' && h.active && !h.targetTime`. Update the page subtitle (~L170) and the LIGHT/STABILIZER badge tooltips (~L256–264) to the new semantics.

### 10. Docs + in-app guide (same commit, per CLAUDE.md)
- [docs/synthesis.md](docs/synthesis.md): rewrite the **Stabilizer**/**Light-coherent**/**Light Pool** vocabulary rows (~L91–94), the "light-coherent surface only via Light Pool / never touching todaysHabits" invariant (~L202), and the Habit-Task Sync section (§9) to state both kinds sync + track; stabilizers timed, light-coherent anytime.
- [docs/data-model.md](docs/data-model.md): update the Habit `stabilizer`/`light-coherent` bullets (~L104–106), the `getLightPoolHabits` filter line (~L111), the `DayPlan.habitLog` invariant (~L78), and rename the overdue-reconcile/needs-sync helper references. Note `HabitLogEntry` + the three `*_HABIT_LOG_*` actions are removed.
- [UserGuide.tsx](src/components/guide/UserGuide.tsx) + [AboutContent.tsx](src/components/ui/AboutContent.tsx): rewrite the habit-kind explanations and remove the dedicated "Light Pool" pathway section; reframe light-coherent as "anytime tracked habits" surfaced in Today's Habits.

---

## Verification
1. `npm run build` (TS catches every dangling `habitLog` / `HabitLogEntry` / renamed-helper reference) and `npm run lint`.
2. `npm run dev`, with Todoist connected:
   - Create a **light-coherent** habit (daily) → confirm it syncs to Todoist (a recurring task appears in the Habits project, no time-of-day), and a `NEEDS TIME`-free "anytime" row shows in **Today's Habits** after Step 1 / reconcile.
   - Start/Stop the light-coherent row → live timer ticks; a segment row appears in the **Engagement Log**; confirm **no ⤴ Reschedule** button on that row.
   - Complete it → Todoist occurrence advances; row goes terminal.
   - Try to save a **stabilizer** with no time → submit blocked with the hint; add a time → saves + syncs with `at HH:mm`.
   - Confirm the dashboard **Light Pool card is gone** and `/life` no longer shows the Light Pool section.
   - Trigger a low-energy check-in (feeling = struggling) → top anytime habits appear with Start, plus the True Rest cue.
   - Pre-seed a legacy untimed stabilizer (or migrate one) → `NEEDS TIME` badge shows in the Habits library.
3. Reload mid-day → instances/segments survive; overdue light-coherent from "yesterday" get date-bumped and surface today.
