# Plan v7.6 — Focus Mode Execution Improvements

> Frozen narrative. For current state see [synthesis.md](../../synthesis.md) (§3.3) and [data-model.md](../../data-model.md).
>
> Iteration label only — **no `SCHEMA_VERSION` bump** (stayed `7.4`). The only persisted change is the additive optional `settings.focusStrict`; the `contextTrail` shape is unchanged. Reducer surface changed (added/removed actions) but the on-disk shape did not.

## Why

v7.4 turned Focus Mode into the execution surface and made re-entry measurable. v7.6 is the follow-through: make Focus a **first-class, self-contained execution surface** with an explicit, legible state machine — and stop leaking execution-level metadata onto the planning dashboard. The work was highly iterative (a dozen small passes); this document records the **end state**, not the path.

The throughline: the dashboard plans (*what* and *when*); Focus executes (*one thing now, where did I leave off*). Everything that only matters once you've committed to acting (engagement timer, breadcrumbs, ramp, the day's engagement log) belongs to Focus.

## Decisions

- **Focus is an explicit state machine**, surfaced 1:1 in the UI: `firstAction → ramp → working ⇄ stopping`. Exactly one phase owns the centre of the timer at a time.
- **Strictness is configurable** (`settings.focusStrict`, default `true`). Strict requires the first-move note (on Start) and the next-step note (on Stop / Exit / switch); relaxed makes both optional. One toggle, surfaced on both the dashboard *Today* header and the Focus header.
- **`ramp` (ease-in) is the default entry phase** — always warm up before the timer, rather than dropping cold into `working`.
- **Two Focus surfaces, one route** (`/focus`): a **selection** surface (`FocusPicker`) when nothing is engaged, and an **execution** surface (`FocusActive`) when something is. `findActiveFocusTask(plan)` decides; a router `state.pick` lets the timer "peek" the picker without ending the engagement.
- **Notes accumulate per engagement.** Both `entry` (first move) and `exit` (next step) notes append one-per-engagement and correlate to segments by timestamp window. The old single last-write-wins entry note (`UPSERT_TASK_ENTRY_NOTE`) was removed.
- **No schema bump.** `focusStrict` is additive; everything else is view/local-state or reducer-shape (not persisted-shape).

## What landed

### State machine & timer surface ([`FocusMode.tsx`](../../../src/components/focus/FocusMode.tsx))

- **Phases.** `firstAction` (strict-only, when *this engagement's* open segment has no entry note) captures the concrete first move inline — the old dashboard first-action **modal is gone**. `ramp` centres the bounded activation countdown (5/10-min presets, last choice persisted) with the task timer de-emphasised; it's the default entry phase. `working` centres the count-up (or the Pomodoro block display). `stopping` swaps in the next-step input with **Continue** (back, no commit), **+ Add breadcrumb** (`APPEND_TASK_CONTEXT_NOTE`), and **Stop** (closes the segment → back to the picker).
- **`PhaseStepper`** — a slider-style indicator *and* control, in-card. Clickable to navigate **backwards** (re-contextualize) or **forwards** (e.g. `ramp` → Focused / Wrap up); the only gate is you can't skip *out* of `firstAction`. Relaxing strictness mid-`firstAction` advances the machine in the same handler so it never strands.
- **Shared bottom action bar** across `firstAction`/`ramp`/`working` — one Stop button (`goStop`, cancels any ramp → `stopping`); Complete on ramp/working; Pomodoro toggle only while working. (`stopping` owns its own buttons.)
- **Ambient timer** — the hard `Card` chrome was dropped for a soft `rounded-3xl bg-subtle/20` surface; widened to dashboard scale (`max-w-5xl`); the count-up is `text-7xl`. Music is a card-less `PlaylistSelector`+`SpotifyPlayer` above it. The low-value transition-tips card (`InsightCard`) was removed from Focus.
- **Theme toggle** added to the Focus header; **Exit** is note-gated in strict mode (closing the prior escape hatch); a **back arrow** peeks the picker (`state.pick`) without ending the engagement.

### Card body = the intention's task list (`TimerTaskList`)

- The timer card body is the focused task's **intention as a vertical task list**: the focused task **expands to host the state machine**; the others are compact rows (click to switch focus). The header carries the intention name, an **intention carousel** (prev/next browses intentions *without* engaging), and an **✎ Edit toggle** that drops the list into a **drag-to-reorder** view (`REORDER_INTENTION_TASKS`) — reordering "outside the stop flow". (Superseded an earlier standalone `IntentionCarousel` + prev/next `NeighborTask` lines.)
- **Switching** (`switchTo`) closes the current segment (committing the draft note) and engages the target; note-gated in strict (defers to `stopping`, remembers the target, offers **Switch →**).

### Selection surface (`FocusPicker`)

- Shown when nothing is engaged (fresh entry, or right after a Stop — so **no "No task / Exit" dead-end**). Lists today's incomplete tasks grouped by intention (each with its latest `↩` breadcrumb — moved here from the dashboard rows; drag-to-reorder within an intention), the **day-context `SessionTimeline` bar** (moved out of the timer surface), and the day-wide engagement timeline.
- Reachable directly via a **◎ Focus** button in the dashboard header.

### Engagement timeline (`EngagementTimeline`, replaces the dashboard `EngagementLogCard`)

- One component (built on a shared `TimelineFrame`), used on both the picker and the timer surface (timer surface **highlights the focused task's cards**). Reuses `buildEngagementLog`.
- **Hourly grid** bounded by the settings day-limits (`timelineStartMinutes`/`timelineEndMinutes`): each engaged hour is a labelled row; runs of empty hours **collapse** into a compact `⋯` gap row.
- Each **Start→Stop is one card** (one segment = one card) placed in its start hour, with **start time pinned to the top, end time to the bottom** (open → "in progress"). `entry`/`exit` notes sit **outside** the card, correlated to each segment by timestamp window, and are **deletable** (`DELETE_TASK_CONTEXT_NOTE`).
- **Transcript behaviour** — anchors to the latest engaged hour (a `[data-latest]` row, not the empty future) with a jump-to-latest affordance. Hovering a card **portals a popover** (so the scroll container can't clip it) with that intention's tasks in order.
- **Durations** break into hours where suitable (`156 min` → `2h 36m`). The header surfaces the **re-entry metric** (`computeReentryStats`, ported from the old dashboard card).

### Notes model

- **Entry notes accumulate per engagement** like exits: new `APPEND_TASK_ENTRY_NOTE` (dedups identical consecutive). Dispatched by Focus `firstAction` (one per Start) **and** the wizard Step 2 first-action field ([`Step2Refine.tsx`](../../../src/components/wizard/Step2Refine.tsx), seeded from the latest entry note). The last-write-wins `UPSERT_TASK_ENTRY_NOTE` was **removed**.
- **Carry-over:** the entry note for an engagement is captured at its Start; the next engagement's "where you're leaving off" input is seeded from the most recent `exit` note (the end of one engagement primes the next).

### Dashboard tidy-up ([`Dashboard.tsx`](../../../src/components/dashboard/Dashboard.tsx), [`SessionTimeline.tsx`](../../../src/components/dashboard/SessionTimeline.tsx))

- **Strict:** ▶ engages + lands directly in Focus (first-move captured there). **Relaxed:** ▶ runs the timer **in place**; ■ **stops in place** (no pointless trip to Focus); a ◎ icon enters Focus on demand.
- Removed from the dashboard: the engagement log card, the per-row breadcrumb preview (both moved to Focus), and the `EngagementLogCard` usage.
- Added the strict/relaxed pill to the *Today* header and a ◎ Focus header button.

### Shared / infrastructure

- **`Modal` portals to `<body>`** ([`Modal.tsx`](../../../src/components/ui/Modal.tsx)) — fixes modals inheriting `opacity` from a dimmed ancestor (e.g. a past-session card).
- **Settings:** `focusStrict?: boolean` on `AppSettings`, defaulted in `withSettingsDefaults`.
- **Reducer actions:** added `DELETE_TASK_CONTEXT_NOTE`, `APPEND_TASK_ENTRY_NOTE`; removed `UPSERT_TASK_ENTRY_NOTE`.
- **Docs:** `synthesis.md` §3.3 (rewritten), `data-model.md` (AppSettings, action table, `contextTrail` semantics, gates), in-app `UserGuide.tsx` (Focus flow, strict/relaxed, picker, timeline).

## Verification

`npx tsc --noEmit`, `npx eslint src/`, and `npm run build` clean at each step. Manual: strict ▶ lands in Focus and gates first-move/next-step; relaxed ▶/■ start/stop in place; phase stepper navigates both directions; ramp Stop and shared bottom Stop reach `stopping`; switching is note-gated in strict; entry/exit notes accumulate and correlate per segment; the engagement timeline buckets cards into hourly blocks with collapsed gaps and anchors to the latest engagement; deleting notes works; the wizard first-action appends.

## Open threads (not built)

- **Pomodoro as a first-class FSM phase** — make `break` a real phase and derive block position from the segment's durable `startedAt` (reload-safe) instead of a local clock.
- **Multi-task state machine + opportunistic habits/micro-gaps** — generalize the engaged unit from `LinkedTask` to an "engageable" (task | habit-instance | micro-gap), surfacing habits/micro-gaps at transition seams (breaks / the picker) rather than as always-on dashboard cards. This is the path to pulling the remaining execution surfaces off the dashboard.
