# Plan v7.4 — Execution Layer

> Frozen narrative. For current state see [synthesis.md](../synthesis.md) and [data-model.md](../data-model.md).
>
> Two phases: **Phase 1 — High-Leverage Execution Layer** (below) and **Phase 2 — Make Re-entry Real** (durable engagement history + context trail). Phase 2 completes the iteration.

# Phase 1 — High-Leverage Execution Layer

## Why

Three synthesis documents (`roadmap/problem-statement.md`, `roadmap/orchestrate_life_migration_spec.md`, `reference/philosophy.md`) converged on one conclusion: the acute pain is **not** the absence of a life-OS, it is *execution friction* — task-entry cost, **context-reconstruction cost on re-entry**, activation/stimulation dependency, and attention fragmentation. The problem statement also flags the real risk (§16): building more scaffolding is itself a form of exploration-procrastination.

So v7.4 deliberately did **not** pursue the migration spec's season/week/review/recovery layer. It added the smallest viable intervention on the surface that already exists — **Focus Mode**, the execution surface — plus a low-friction entry that bypasses the 5-step wizard on low-activation days. Success metric: re-entry rate, not features. After shipping, the discipline is to *inhabit* it, not keep building.

## Decisions

- **Schema stamp stayed `7.1` — not bumped.** All new fields are optional; old data stays valid. The load-time guard (`isCurrentSchema`) rejects any slice not stamped exactly `7.1` and treats it as absent, so bumping `SCHEMA_VERSION` would have silently wiped existing seasons/habits/history/plan. "v7.4" is the iteration label only (as v7.2 was). No migration.
- **Quick Start = Hybrid:** seed a minimal plan + assign to the current session + `setupComplete`, then auto-engage the first task and land in `/focus`.
- **Quick Start task source = both on one screen:** a free-type box *and* a Todoist task picker. Free-typed lines become real Todoist tasks (Todoist stays source of truth).
- **Ramp = separate countdown, engagement runs alongside** (mirrors the Pomodoro toggle; no schema/reducer change).

## What landed

**Data model (`src/types/index.ts`):** two optional `LinkedTask` fields — `firstAction`, `reentryNote` (precedence `reentryNote ?? firstAction`).

**Reducer (`src/context/DayPlanContext.tsx`):** `SET_TASK_FIRST_ACTION`, `SET_TASK_REENTRY_NOTE` (trim; empty → cleared), and `QUICK_START` (atomic: "Today" intention + a main LinkedTask per id assigned to the session covering now, seeds `sessionSlots` from settings if empty, sets `setupComplete`). New pure helper `pickSessionIdForTime` in `src/lib/time.ts` (mirrors `useCurrentSession` selection so the reducer can call it).

**Feature 1 — Re-entry breadcrumb:** inline "Next step" input in `FocusMode.tsx` (continuous save → Stop persists it), an arrival hint (`↩ Last left off` / `▸ Start here`), and a truncated `↩` preview on dashboard Current Session rows (`SessionTimeline.tsx`).

**Feature 2 — First concrete action:** optional input on **main** tasks in `Step2Refine.tsx` (`TaskCard`), wired to `SET_TASK_FIRST_ACTION`; never gates advancing.

**Feature 3 — Bounded activation ramp:** 5/10-min presets in `FocusMode.tsx` (last choice persisted to `localStorage`), countdown via a ticking interval that fires `playChime('work')` + a notification at zero; the engagement timer keeps running.

**Feature 4 — Low-friction Quick Start:** new `src/components/QuickStart.tsx` modal (free-type box + a lightweight Todoist checkbox picker, gated on Todoist being configured), opened from a `⚡ Quick start` link on `Welcome.tsx`. On Start it creates Todoist tasks for typed lines, dispatches `QUICK_START` + `START_TASK_ENGAGEMENT`, and navigates to `/focus`.

**Docs:** `synthesis.md` (§3.3, §5.1, §5.2, §6.1, §10), `data-model.md` (LinkedTask fields + Task Actions), in-app `UserGuide.tsx` (Focus Mode re-entry/ramp + Quick Start callout).

## Verification

`npm run build` + `npm run lint` clean. Manual: existing 7.1 data survives load; Quick Start seeds plan + creates Todoist tasks + drops into Focus; breadcrumb round-trips across Stop/Start and reload; first action seeds the "Start here" hint; ramp chimes at zero with the timer still running.

---

## Phase 2 — Make Re-entry Real (durable engagement history + context trail)

### Why

Phase 1 named **re-entry rate** as the success metric (problem-statement §15 Principle 5) but recorded nothing: the breadcrumb was one last-write-wins string, the ramp was ephemeral, and engagement segments died at rollover. You can't regulate a control system you don't measure. Phase 2 makes re-entry measurable — and was unblocked by the floor-and-migrate schema posture (`src/lib/schema.ts`), so the **first schema bump since 7.1** could reshape data instead of bolting on.

### Decisions

- **Schema 7.1 → 7.4** (first real bump since 7.1; floor stays 7.1). Single forward step at the `migrateToCurrent` seam, applied by the live loaders **and** to saved/imported plans (`migrateSavedPlan`).
- **Write-through archive, not single-source-of-truth.** Today's live segments stay on the plan; each *closed* segment is copied into a durable, pruned `life.engagementHistory`. Keyed by a **durable** id (task `todoistId` / `Habit.id`) so re-entry latency + streaks span days.
- **90-day rolling prune** (on load + on append), documented as a transitional bridge until a real backend (`roadmap/persistence_and_backend_migration.md`).
- **Breadcrumb → cumulative trail.** `firstAction`/`reentryNote` collapse into one `LinkedTask.contextTrail: ContextNote[]` (`entry` once, last-write-wins; `exit` appended per session). Latest note = current "start here".
- **Deliberate gates** (added after Phase 2 review): can't **Start** a task with no context (prompts for a first concrete action), can't **Stop** in Focus without a next-step note. Dashboard ■ routes to Focus so Stop is always note-gated in one place.

### What landed

**Schema (`src/lib/schema.ts`):** `SCHEMA_VERSION = 7.4`; `migrateToCurrent` plan step (folds `firstAction`/`reentryNote` → `contextTrail`, drops the scalars) + life step (`engagementHistory: []`).

**Types (`src/types/index.ts`):** `ContextNote`, `EngagementRecord`; `LinkedTask.contextTrail` (replaces the two scalars); `LifeContext.engagementHistory`; `BacklogEntry.contextTrails`.

**Helpers (`src/lib/engagementHistory.ts`, new):** `buildRecordFromClosedSegment` (computes `gapBeforeMinutes`), `appendEngagementRecord` / `pruneEngagementHistory` (90-day window), `computeReentryStats` (median gap + resume count), `lastEndedFor`.

**Reducer (`src/context/DayPlanContext.tsx`):** write-through archive on the five close actions (`STOP_/COMPLETE_/SKIP_HABIT_INSTANCE` via shared `closeHabitInstance`, `STOP_TASK_ENGAGEMENT`, `TOGGLE_TASK_COMPLETE`); `UPSERT_TASK_ENTRY_NOTE` + `APPEND_TASK_CONTEXT_NOTE` (+ `exitNote` on the two task-close actions); load-time prune; saved/imported-plan migration (`migrateSavedPlan`) + `engagementHistory` merge on `IMPORT_BACKUP`. Delete-segment actions stay plan-only (archive not retroactively edited).

**UI:** `SessionTimeline` — start gate (first-concrete-action modal) + ■ routes to Focus + trail preview from `contextTrail.at(-1)`. `FocusMode` — full trail render, "+ Add" mid-session breadcrumb, Stop gated on a next-step note, "last worked Xm ago". `Step2Refine` — first action → `UPSERT_TASK_ENTRY_NOTE`. `EngagementLogCard` — re-entry stat header. `backlog.ts` — capture/restore `contextTrail`.

### Verification

`npm run build` + `npm run lint` clean. Manual: 7.1 data migrates (old breadcrumbs → trail; `engagementHistory` seeded); Start→Stop a task archives one record (durable id) surviving reload; resume sets `gapBeforeMinutes` + "last worked"; re-entry stat shows in the log header; Stop blocked without a next step; Start blocked without a first concrete action; a >90-day record is pruned on load.

---

# Phase 2 — Make Re-entry Real (durable engagement history + context trail)

## Why

Phase 1 declared its success metric as **re-entry rate** (problem-statement §15 Principle 5) but built nothing that *records* a re-entry: the breadcrumb was a single last-write-wins `reentryNote` string, the ramp was an ephemeral countdown, and engagement segments died at rollover. You can't regulate a control system you don't measure. Those compromises were shaped by Phase 1's additive-only schema timidity — which the **floor-and-migrate** posture (`src/lib/schema.ts`, added between phases) removed. Phase 2 makes re-entry measurable and completes the v7.4 iteration.

Scope was **Core-first** (confirmed with the user): context trail + durable engagement history + the re-entry surface + migration. Distraction "park it" capture and ramp-event recording are deferred.

## Decisions

- **Schema = iteration = 7.4** (the first real bump since 7.1; floor stays 7.1). Iteration label and schema number, decoupled for v7.2/v7.4 Phase 1 (label-only), realign here since this is the first schema change.
- **Storage = write-through archive.** Today's live segments stay on the plan (timers/Focus untouched); each *closed* segment is copied into a durable `life.engagementHistory`. No single-source-of-truth refactor.
- **Retention = 90 days**, pruned on load + append. ~1 MB worst case under the ~5 MB localStorage budget. Explicitly transitional — a bridge until a real backend (the move-to-DB trigger: retention needs exceed the budget, or multi-device sync). `life.backlog` / `history` share the eventual pressure but are out of scope.
- **Context trail replaces the two scalars.** Exit notes ride the close action (one breadcrumb per work session); the entry note is a single last-write-wins note from Step 2.

## What landed

**Schema (`src/lib/schema.ts`):** `SCHEMA_VERSION` 7.1 → **7.4**; `migrateToCurrent` 7.1→7.4 step — plan: fold `firstAction`/`reentryNote` → `contextTrail`; life: default `engagementHistory: []`. `loadHistory` + `IMPORT_SESSIONS`/`IMPORT_BACKUP` route saved plans through the shared `migrateSavedPlan` (closing the history-migration gap flagged when the floor-and-migrate seam was added).

**Types (`src/types/index.ts`):** new `ContextNote` (`{ at, text, kind: 'entry'|'exit' }`) and `EngagementRecord` (durable, keyed by `todoistId`/`Habit.id`, with `gapBeforeMinutes` re-entry latency). `LinkedTask.contextTrail` replaces `firstAction`/`reentryNote`; `LifeContext.engagementHistory` + `BacklogEntry.contextTrails` added.

**Helpers (`src/lib/engagementHistory.ts`, new):** `buildRecordFromClosedSegment`, `appendEngagementRecord`, `pruneEngagementHistory` (`RETENTION_DAYS = 90`), `computeReentryStats`, `lastEndedFor` — pure, reusing `lib/engagement.ts` duration math.

**Reducer (`src/context/DayPlanContext.tsx`):** write-through archive on every segment close (`archiveClosedSegment` from the 5 close actions — tasks via STOP/COMPLETE, habits via STOP/COMPLETE/SKIP through the shared `closeHabitInstance`); `UPSERT_TASK_ENTRY_NOTE` (entry note) replaces `SET_TASK_FIRST_ACTION`/`SET_TASK_REENTRY_NOTE`; `STOP_TASK_ENGAGEMENT`/`TOGGLE_TASK_COMPLETE` carry an optional `exitNote` (de-duped append). Load-time prune in `loadLifeContext`. `DELETE_*_ENGAGEMENT_SEGMENT` stay plan-only (archive not retroactively edited). `IMPORT_BACKUP` preserves + merges `engagementHistory`.

**UI:** `FocusMode` — arrival hint from `contextTrail.at(-1)` + "last worked Xm ago"; the "Next step" input commits one exit note on Stop/Complete (no per-keystroke save). `Step2Refine` → `UPSERT_TASK_ENTRY_NOTE`. `SessionTimeline` preview from `contextTrail`. `EngagementLogCard` header surfaces the re-entry metric (`computeReentryStats`, 7-day window). `lib/backlog.ts` captures/restores `contextTrail`.

**Docs:** `synthesis.md` (§3.3, §6.1, §10, §14), `data-model.md` (§3.2 archive + context trail, action tables, §4 migration, §5), `UserGuide.tsx`.

## Verification

`npm run build` + `npm run lint` clean. Manual: existing 7.1 data loads and migrates (old breadcrumb scalars → `contextTrail`; `engagementHistory` seeded `[]`; history saved-plans migrated); Start→Stop a task with a "next step" note → one `EngagementRecord` in `orchestrate-life-context`, exit note in `contextTrail`, both survive reload; resume next session → `gapBeforeMinutes` set, Focus shows "last worked Xm ago", `EngagementLogCard` header shows the re-entry stat; habit Start/Stop archives under `Habit.id`; a hand-aged (>90-day) record is dropped on load.

## Open follow-ups

Deferred (per Core-first): distraction "park it" capture, ramp-event recording, single-source-of-truth engagement refactor, prune/cap policy for `life.backlog`/`history`. Minor: an open segment at rollover isn't archived (only closed segments write through).
