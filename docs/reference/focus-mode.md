# Focus Mode — the execution surface

> Current-state reference for the `/focus` execution surface. For where it sits in the app, see [synthesis.md §3.3](../synthesis.md). For the execution-layer data (`contextTrail`, `EngagementSegment`, `engagementHistory`), see [data-model.md](../data-model.md). Design narrative lives in [history/plan_v7/](../history/plan_v7/) (`plan_v7.4`–`plan_v7.6`).

Focus Mode is Orchestrate's **execution surface**. The dashboard plans (*what* and *when*); Focus executes (*one thing now, where did I leave off*). Everything that only matters once the user has committed to acting — the engagement timer, re-entry breadcrumbs, the activation ramp, the day's engagement log, the music protocol — lives here, not on the planning dashboard.

---

## 1. Entry

Pressing **▶ Start** on a task in the dashboard's Current Session card opens an engagement segment. Where that lands depends on `settings.focusStrict`:

- **Strict** drops straight into `/focus` (the first-action capture happens there).
- **Relaxed** runs the timer **in place** on the dashboard row and exposes a **◎** icon to enter `/focus` on demand.

A **◎ Focus** button in the dashboard *Today* header is the explicit entry when nothing is engaged (it opens the picker rather than a dead-end "No task" screen). The focused target is derived via `findActiveFocusTask(plan)` — the engaged `LinkedTask` with an open segment — so Focus reflects Stop/Complete instantly and survives a reload.

## 2. Two surfaces, one route

`/focus` renders one of two surfaces, chosen by whether anything is engaged:

- **Selection — `FocusPicker`** (nothing engaged). Lists today's incomplete tasks grouped by intention (each with its latest `↩` breadcrumb; **drag-to-reorder** within an intention via `REORDER_INTENTION_TASKS`), the day-context `SessionTimeline` bar, and the day-wide engagement log (`EngagementTimeline`, built by `buildEngagementLog`). Picking a task engages it → the execution surface mounts.
- **Execution — `FocusActive`** (something engaged). The state machine below.

A router `state.pick` lets the execution surface **peek** the picker (a back arrow) without ending the engagement — the timer keeps running, the chooser is hidden while peeking.

## 3. The execution state machine

`FocusActive` is a four-phase machine with exactly one phase owning the centre of the timer:

```
firstAction → ramp → working ⇄ stopping
```

- **`firstAction`** (strict-only, shown when the trail has no `entry` note): captures the concrete first move **inline in the card** via `APPEND_TASK_ENTRY_NOTE`. You cannot skip *out* of this phase in strict mode.
- **`ramp`** is the **default entry phase** — the app always eases in before the timer. It centres the activation-ramp countdown with the task timer de-emphasised beside it. Begin/Skip → `working`; **Stop** → `stopping`.
- **`working`** centres the task count-up (or the Pomodoro block display, §6).
- **`stopping`** swaps the centre for the next-step input. **Continue** returns without committing; **+ Add breadcrumb** appends an `exit` note mid-session (`APPEND_TASK_CONTEXT_NOTE`); **Stop** closes the segment and returns to the picker.

A **shared bottom action bar** runs across `firstAction`/`ramp`/`working` (one Stop button → `stopping`; Complete on ramp/working; Pomodoro toggle only while working), so even the first-move step can Stop.

The in-card **`PhaseStepper`** shows machine position (it drops `firstAction` in relaxed mode) and is **clickable to navigate** — backwards to re-contextualize, or forwards (e.g. `ramp` → Focused / Wrap up) — the only gate being that you can't skip *out* of `firstAction`. Toggling the strict/relaxed pill mid-`firstAction` advances the machine in the same handler so it never strands.

## 4. The timer surface and task list

The timer is an **ambient surface** (no hard card) at dashboard width (`max-w-5xl`), with a compact music panel on top. The card body (`TimerTaskList`) is the **intention's vertical task list**: the focused task expands to host the state machine; the others are compact rows, click to **switch focus** (`switchTo`, note-gated in strict). The header carries the intention name, an **intention carousel** (prev/next browses intentions *without* engaging), and an **✎ Edit toggle** that drops the list into a **drag-to-reorder** view (`REORDER_INTENTION_TASKS`).

## 5. Engagement timeline

Beside the timer, the **`EngagementTimeline`** is the *same* day-wide log shown on the picker (shared `TimelineFrame` primitive), reused here with the **currently-executing task's cards highlighted**. It is an **hourly grid** bounded by the settings day-limits (`timelineStart/EndMinutes`):

- Each engaged hour is a labelled row; runs of empty hours **collapse** into a compact `⋯` gap row.
- Each Start→Stop is **one card** placed in the hour it started, with its start time pinned to the top and end time to the bottom (open segments read "in progress"; closed durations break into hours — "2h 36m").
- `entry`/`exit` notes are **accumulated per engagement** and correlated to each segment by timestamp window; they sit **outside** the card and are **deletable** (`DELETE_TASK_CONTEXT_NOTE`).

The grid behaves like a **transcript** — it anchors to the latest engaged hour (a `[data-latest]` row, not the empty future) and shows a **jump-to-latest** affordance when scrolled away. Hovering a card **portals a popover** (so the scroll container can't clip it) with that intention's tasks in order. The header surfaces the **re-entry metric** (`computeReentryStats`).

## 6. Pomodoro engine

An optional Pomodoro engine (toggle persisted in `localStorage`) turns the task's estimate into a slot schedule via `computeFocusPlan(estimate)`:

- ≥45 min → 20-min work blocks with 5-min breaks
- 30–44 min → 10-min blocks
- <30 min or unestimated → a single session

Blocks render as a vertical `FocusSlotPlan`; when the engine runs (`resolveBlockAt`) it highlights the live block, counts it down, and fires a chime (`lib/sound.ts`) + notification at each work↔break boundary.

## 7. Activation ramp

A bounded **activation ramp** (5/10-min presets, last choice persisted to `localStorage`) is a deliberate, *closing* pre-work window. It counts down, fires a chime + "begin work" notification at zero, and the engagement timer keeps running alongside it. Ramp is a local component feature (mirrors the Pomodoro toggle) — no schema or reducer state.

## 8. Music protocol

Because Focus is the execution surface, the **music protocol lives here**: the shared `MusicProvider` wraps a card-less `PlaylistSelector` + `SpotifyPlayer` above the timer. The dashboard carries no Spotify embed. See [synthesis.md §8](../synthesis.md) for the playlist protocol.

## 9. Note gates (strict vs relaxed)

The re-entry note gates are governed by `settings.focusStrict` (default true):

- **Strict** — re-entry context is mandatory at the session boundaries: you cannot **Start** a context-less task without naming a first concrete action (captured in Focus via `APPEND_TASK_ENTRY_NOTE`), and you cannot **Stop / leave Focus / switch tasks** without a next-step note. The dashboard ▶ lands directly in Focus, and the engaged **■** on a task routes to Focus so Stop is note-gated in one place. The Focus header's **Exit** button is note-gated too.
- **Relaxed** — both notes are optional; the dashboard ▶/■ start and stop the timer in place, and Exit commits any draft as a breadcrumb on the way out.

The strict/relaxed pill is surfaced on both the dashboard *Today* header and the Focus header. It is an additive `settings` field — no schema bump.

## 10. Re-entry breadcrumb + durable history

A per-task **re-entry breadcrumb** is the cumulative `LinkedTask.contextTrail` — a trail of `ContextNote`s (`entry` from the first-action capture, `exit` appended on each Stop/Complete). Focus renders the whole trail correlated to segments (§5) plus a "last worked Xm ago" line read from the durable engagement archive. The latest note (`contextTrail.at(-1)`) is the task's "start here".

Every segment close (Stop/Complete/Skip, tasks *and* habits) is **written through** to `LifeContext.engagementHistory` — a durable `EngagementRecord[]` keyed by a durable source id (`todoistId` / `Habit.id`) so re-entry latency and streaks survive daily rollover, bounded by a 90-day rolling prune. The **re-entry metric** (`computeReentryStats`) is computed from this history. Pure helpers live in `lib/engagementHistory.ts`; full semantics in [data-model.md §1](../data-model.md) (LinkedTask → *Durable archive*).

## 11. Engagement nudge

A separate **engagement nudge** (`useEngagementNudge`, run app-wide by `NotificationBridge`) notifies the user if they've been idle in an active session without engaging anything (and the session still has incomplete work) past a configurable threshold (`settings.engagementNudgeMinutes`, default 10; `0` disables), repeating every 30 min while idle. The elapsed clock is anchored to the **last engagement boundary** (`lastEngagementBoundary` — the most recent Start→Stop today), so it reports "time since you last did something". The notification fires once at the threshold; thereafter a persistent dashboard banner (`useEngagementBanner`) stays visible until the user re-engages. Both share the pure `engagementIdleState` helper in `lib/engagement.ts`.
