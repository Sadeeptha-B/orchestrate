> **What is this?** The chronological evolution of Orchestrate's requirements, from Iteration 1 through Iteration 6.3. Iterations 1–4 are preserved verbatim from `docs/requirement.md` (pre-refactor on 2026-05-07) so the *why* behind each pivot — Trevor AI iframes, Todoist + Google Calendar, intention-to-task scheduling — remains discoverable. Iterations 5+ are shipped-iteration narratives written at the time the work landed.
>
> For the durable "why" see [../vision.md](../vision.md); for current implementation state see [../synthesis.md](../synthesis.md). Forward-looking proposals (currently v7+) live in [../backlog.md](../backlog.md).
>
> Future shipped iterations should land here as additional entries.

# Orchestrate — Iteration History

## Iteration 1:

I have often found that on a new day, it is essential to contextualize your tasks. Typical task manager programs, while they maintain lists, do not solve the extra friction for contextualization in terms of the new day, which requires going through the todolist and getting a holistic overview of it. What I want to build is mainly a web app that walks you through this contextualization process.

I plan to achieve this through a number of steps

1. The app nudges the user to write down his main priorities for the day; the main tasks that he has

2. Then he invites the user to compare his tasks against his todolist and then if necessary, make the todolist consistent, which further contextualizes his tasks. He is invited to create calendar events, and break down the tasks accordingly

3. Then he is asked to categorize the tasks in terms of main tasks and background tasks. Main tasks are tasks that are the main running threads in the day; eg: implementing a specific feature in code. Background tasks are usually habit based tasks that recur across days. These are tasks like reading, doing c# coding exercises, and so on

4. We can assume that the user works in four time slots, 
- Early morning session -> **6am - 8am**
- Morning Sesion -> **9am - 1pm**
- Afternoon Session -> **2:30pm - 6:30pm**
- Night Session -> **8:30pm - 11pm**

    Based on the time in which starts, the app should loop through the sessions left and tell the user to schedule main tasks within sessions

5. Then the app should invite the user to schedule background tasks accordingly within the day based on his main task allocation

6. Refer to [Music Routine](../roadmap/music_routine.md) that decides on music for the user based on the type of work. The app should then prompt the user to start the "Start work music"

7. Then the app should show all the different playlists detailed in [Music Routine](../roadmap/music_routine.md)  in a format so that it is always visible to the user.

8. Hour by hour the app should prompt the user and ask how his day is going and remind him to recontextualize if necessary. It would also ask him the type of work he's doing and to switch playlists if necessary

The main goal of this proposed app is contextualization and nudging the user towards his tasks, countering task and time blindness. This version is specific to the author's needs. The main todolist and calendar is separate from this app, in external software, no api integration with these software is needed at this stage. This companion app will deal with the tasks that the user provides in the first step, and nudge the user to keep his external todolist and calendar consistent in the second step. Save the app's data in local storage.


## Iteration 2:

In the second iteration, we are changing the app to be more sophisticated. The current "tasks" that we have in the app are to be understood as intentions for the day.

Usually, todo lists tend to be "epics", a pain point we are solving is that todo lists tend to be epics, and when starting a day, we don't tend to think in terms of epics, but in terms of "intentions", of specific goals for the day. The second page should focus on mapping intentions to specific todolists. 

I currently manage my tasks with [Trevor AI](https://app.trevorai.com/app/), we should add a sizeable iframe of this app in the second step. So that it is visible for mapping. In the future, we may migrate to our own inbuilt todolist and calendar management for setup, but for now, this is a preliminary approach. Then, you should loop through each intention and then prompt the user to break down tasks, which he would then do in the corresponding iframe. 

Then the next main tasks section should focus on the user scheduling the tasks into time, in this view also, we will have an iframe, where the user will schedule the tasks he broke down into specific slots, the intentions too ideally should be scheduled, but the way we do this, I need to still decide, you are free to decide on a suitable approach for the time being. 

The background tasks should be nudges/habits. So habits would typically be background tasks, but not all background tasks would be habits. So, what might be a good strategy to schedule the background tasks in? I was thinking being flexible, and frequently nudging the user that these tasks exist, and also allowing a single background task to be scheduled at multiple slots can help. 

You are free to redesign the flow in light of these new requirements, the dashboard should also contain an iframe of the tasks along with the current intention based setup. You are free to make suitable design decisions in the initial iteration of this implementation. 

### Iteration 3 — Todoist + Google Calendar Integration

The Trevor AI iframe approach proved non-functional: Trevor AI sets `X-Frame-Options: DENY` and modern browsers block cross-origin cookies (`SameSite` defaults), preventing embedded login.

**Pivot to Option B:**
- **Todoist REST API (api/v1)**: Direct API integration using a personal API token (no OAuth, no backend). Users paste their token from Todoist Settings → Integrations → Developer. Token is encrypted client-side using AES-GCM via the Web Crypto API before being stored in localStorage.
- **Google Calendar embed**: Official embeddable iframe (`https://calendar.google.com/calendar/embed?src={calendarId}&mode=week`). Read-only, works when the user is logged into Google. User-configurable calendar ID.
- **Data model**: Orchestrate owns the intention-level view. Todoist owns the task-level view. Google Calendar provides time-context. The user's existing Todoist↔Google Calendar sync keeps the latter two in sync automatically.

See [plan_v3.md](./plan_v3.md) for the full implementation plan.

## Iteration 4
Orchestrate has become much more sophisticated. As of v2 and v3, we have migrated tasks to be intentions. The app flow now focuses on setting intentions for the the day, mapping the intentions to tasks on todoist, and then identifying main intentions and background intentions for the day and afterwards, scheduling the tasks accordingly in google calendar. 

There are some inconsistencies in this model. For one, after creating todoist tasks, we are still relying on scheduling the intentions, which are broader "ideas" rather than tasks, though the user can schedule the tasks themselves in the todoist panel during the schedule step. Further, we are still defining the broader intentions to be main tasks and background tasks. 

When mapping intentions to tasks in the todoist panel, we should keep a record of which tasks have been created when each intention is being mapped. Maybe some form of queue would be good? However, keep in mind that the user may create and delete a task during this mapping step. We will need to capture the final result of the user behavior during mapping, and then aggregate them under a specific intention. Then, when setting the main and background tasks, it is these tasks that should be selected as main and background and the actual scheduling should focus on scheduling these tasks into time, though showing the relationship to the intentions would be useful. Keep in mind that a single intention may have both background and main tasks. 

We will have to plan this change well. 

## Iteration 5 — Life scaffolding primitives

Iteration 5 lifts Orchestrate from a day-execution engine to a life-scaffolding companion. The motivation is captured in [orchestrate_life_migration_spec.md](../roadmap/orchestrate_life_migration_spec.md): the user is migrating into a more intentional lifestyle (sleep discipline, weekend degree work, gym, tech growth, side projects) and the app needs to hold context above the day to support that.

This iteration introduces three first-class concepts above the existing daily plan:

- **Seasons** — medium-horizon focus periods (4–12 weeks typically) with a primary theme, supporting goals, explicit non-goals, success criteria, and an optional capacity budget. Exactly one season is active at a time.
- **Habits as first-class entities** — recurring stabilizers separate from `LinkedTask.isHabit` (which is now deprecated). Each habit has a recurrence rule, minimum-viable form, trigger cue, completion rule, failure tolerance, anchor flag, and optional persistent Todoist task to auto-link.
- **LifeContext** — a new persistent state slice (`orchestrate-life-context` localStorage key) holding seasons + habits, owned by the same `DayPlanProvider` so cross-slice invariants stay in the reducer.

When a habit is active, on Step 1 entry it is auto-injected as an intention with `sourceHabitId` set. The user can map it to a Todoist task as normal (or accept the auto-linked task if `autoLinkTodoistId` is set on the habit), or skip it for today. In Step 2, habit-derived linked tasks have their category locked to `background` — honoring the rule that habit-tasks must always be background.

New routes (`/life`, `/season`, `/season/:id`, `/habits`) provide hierarchical planning surfaces above the daily wizard. The Dashboard and WizardLayout headers gain an `ActiveSeasonBadge` for always-visible seasonal context. The Dashboard gains a "Life" button next to "Saved Sessions."

To preserve the no-backend constraint while supporting the much larger surface area of persistent data, this iteration also introduces a "Full Backup" export/import in `SavedSessions` that bundles `{ settings, life, history }` into a single JSON snapshot — the user's manual safety net in lieu of a sync server.

A schema-version marker (`_schemaVersion: 5`) is now stamped on saved plans, settings, and life context. A one-time backfill scans existing intentions/saved-sessions for `isHabit: true` entries and surfaces them as inactive Habit candidates so the user can promote them.

Iterations 6–8 (capacity intelligence, modes/rituals/recovery, reviews/drift detection/hierarchical views) are sketched in [plan_v5.md](./plan_v5.md) but deferred for separate plans.

See [plan_v5.md](./plan_v5.md) for the full implementation plan.

## Iteration 6 — Micro-gap refinement + capacity intelligence

Pre-v6, the `LinkedTask.type: 'background'` bucket conflated two distinct uses: anchor-style stabilizer rituals (meditation, gym, shutdown) and small resumable micro-gap fillers (flashcards, short reading). Both shared a hard 30-min cap and the same auto-injection pipeline, which forced the user to model "I want to do flashcards when I have a free 5 minutes" the same way as "I meditate at 7am every morning." Separately, the previously-planned v6 capacity arithmetic was still in the backlog, and the deprecated `isHabit` flags from v5 were waiting for a v7 removal.

v6 collapses all of this into one coherent iteration:

- **Habit kind discriminator** (`'stabilizer' | 'light-coherent'`) — stabilizers keep the auto-injection pipeline; light-coherent gets a new logged-only pathway.
- **Light Pool** — a Dashboard panel + `/life` section listing today's active light-coherent habits, with per-row Start/Done writing to `plan.habitLog`. The day's task graph stays clean; pulls are opportunistic.
- **True Rest** — a static catalog (`src/data/restCues.ts`) surfaced contextually via `TrueRestCard` in three variants (Dashboard side rail, low-energy check-in, between-session banner). Deliberately non-trackable.
- **Per-task duration caps** — `AppSettings.taskCapDefaults` (per-kind defaults, editable in Settings) plus optional per-habit `maxBlockMinutes` override, replacing the old hard 30-min clamp.
- **Advisory session capacity arithmetic** — `computeSessionCapacity(...)` powering per-session badges and over-capacity banners on Step 3 + Dashboard; banner only at >150% load; never blocks the wizard.
- **Legacy `isHabit` purge** — pulled forward from v7. The `Intention.isHabit` / `LinkedTask.isHabit` fields, the `TOGGLE_TASK_HABIT` action, and the `backfillHabitsFromLegacy` function were all removed; `intention.sourceHabitId` is now the canonical "habit-derived" check.

Schema bumped to `_schemaVersion: 6`. The migration step is mechanical (default `kind` to `'stabilizer'` for pre-v6 habits; initialize `plan.habitLog: []`; inject `taskCapDefaults` and `sessionBufferMinutes` settings defaults).

See [plan_v6.md](./plan_v6.md) for the full implementation plan.

## Iteration 6.1 — Habit-as-task decoupling

In v6, stabilizer habits were forced through a pipeline that didn't fit their semantics: they auto-injected as **Intentions** in Step 1, the user mapped them to a Todoist task in the embedded `TodoistPanel`, and the reducer locked the task to `'background'` at `LINK_TASK` time. The whole flow treated stabilizers as a special-case intention, which created ceremonial friction for what are conceptually one-and-done daily items — wake, meditate, gym, shutdown. There's no decomposition step for "meditate at 7am for 10 minutes": the habit *is* the task.

v6.1 decouples habits from intentions. Saving a stabilizer now syncs a recurring Todoist task (with `due_string` like `"every weekday at 7:00"` and `duration` matching `targetDurationMinutes`); on each matching day, the habit's task is surfaced **directly as a session-assigned `LinkedTask` without a parent intention** (`intentionId === undefined`, `sourceHabitId` set), auto-assigned to the session whose window contains the Todoist `due.datetime`. Light-coherent habits and True Rest are unchanged.

Key user-facing additions:

- **Project picker** (workspace default in Settings → Integrations + per-habit override in `HabitForm`'s Schedule section). The picker drops habit tasks into an existing Todoist project of the user's choice rather than always creating a new "Habits" project. Editing a habit's project moves the existing recurring task via the Sync API (`item_move`).
- **Window behavior** (`'strict' | 'lenient'`, default `'lenient'`). Strict hides the habit-task once the planning time is past `targetTime + duration`; lenient surfaces it as long as the Todoist task is due today and unchecked.
- **"Unassigned habits" tray** above the Step 3 timeline, holding any habit-tasks whose Todoist due time doesn't match a session window.
- **Migrate banner** in `/habits` for pre-v6.1 stabilizers without a `todoistTaskId`, plus a one-time `migratePlan` step that drops habit-derived intentions and re-anchors their LinkedTasks as orphans.

Schema bumped to `6.1` (a JSON float, kept aligned with the product label rather than jumping to `7`). The reducer renames `INJECT_HABIT_INTENTIONS` → `INJECT_HABIT_TASKS` (precomputed payload from `lib/habitsTodoistSync.ts → computeHabitTasksToInject`) and `SKIP_HABIT_INTENTION` → `SKIP_HABIT_TASK`. `LinkedTask.intentionId` becomes optional; `LinkedTask.sourceHabitId` is added.

The scope was deliberately narrow — a structural correction, not a new iteration — so the user-facing label stays at v6.1 rather than v7.

See [plan_v6.1.md](./plan_v6.1.md) for the full implementation plan.

## Iteration 6.2 — Intentions backlog

v6.2 introduces a persistent backlog for parked intentions. Two pressures converged: (a) day rollover was destroying yesterday's unfinished work — `loadPlan` discarded any plan whose date was stale, and `SAVE_DAY` was manual-only, so a missed-save morning erased context; (b) deleting an intention with linked Todoist tasks left those tasks scheduled in Todoist, since `REMOVE_INTENTION` didn't touch Todoist scheduling at all.

The backlog (`life.backlog: BacklogEntry[]`) is the resting place for parked intentions. Manual `📥` (move to backlog) and `🗑` (delete with confirm modal) icon buttons live on every intention row in Step 1 and a new "Today's intentions (N)" overview panel in Step 3 Phase 1. Day rollover harvests unfinished intentions (those with at least one uncompleted intention-bound linked task) automatically with `reason: 'rollover'`. The `HistorySidebar` (renamed from `SavedSessions`) hosts a Backlog tab listing entries with Bring-to-today / Discard affordances.

Completed-task handling on archive: `buildBacklogEntry` strips already-completed task ids from `intention.linkedTaskIds`. Their titles ride along in `BacklogEntry.completedTaskTitles` and render as a `✓ Done: …` annotation under the pending-count line in the Backlog tab. Restore rebuilds `LinkedTask` rows only for the pending ids, so Step 2 never sees a completed task masquerading as fresh `unclassified` work.

Bug fix bundled in: `REMOVE_INTENTION` and all backlog paths now correctly unschedule linked Todoist tasks via `unscheduleIntentionTasks` (`due_string: 'no date'`) through the shared `useIntentionRemoval` hook. Habit-derived orphan tasks (`sourceHabitId` set) are explicitly skipped — they're owned by `syncHabitToTodoist`. Auto-rollover into the backlog is the deliberate exception: yesterday's tasks remain scheduled in Todoist so they show up as overdue.

Schema bumped to `6.2`. No plan-shape changes from v6.1; just stamps the new marker and defaults `life.backlog` to `[]`. The provider's init path consolidates into `loadInitialState()` + `peekRawPlan()` so the rollover-harvest happens in one place.

See [plan_v6.x.md](./plan_v6.x.md) for the full implementation plan (covering both v6.1 and v6.2).

## Iteration 6.3 — Habit/session decoupling + task engagement

v6.3 closes the loop on three intertwined defects in the v6.2 model.

**Stabilizer habits leave `LinkedTask` entirely.** They had been carriers of type `background` with `sourceHabitId` set — orphans alongside intention-bound tasks. The wizard's Step 3 invited users to drop them into sessions ("Unassigned habits" tray; per-session "🔁 Habits" group), conflating recurring rituals with one-shot intention work. v6.3 introduces `TodaysHabitInstance` on `plan.todaysHabits` — its own type with its own lifecycle (planned / engaged / completed / unfinished / skipped). Stabilizers render in a dedicated **habit lane** above the session blocks in `SessionTimelineBar`, positioned by `targetTime`. Untimed habits cluster as "Anytime today" chips above the time axis. They are decoupled from session assignment and excluded from session capacity arithmetic. A new dashboard `HabitInstanceCard` lists today's instances with per-row Start / Stop / Complete / Skip / Reschedule controls.

**Task engagement is explicit.** Each `LinkedTask` and each `TodaysHabitInstance` carries an optional `engagement: { startedAt, endedAt?, totalMinutes? }` record. ▶ and ■ buttons on dashboard rows let the user mark a task or habit instance as engaged; minutes accumulate across Start/Stop cycles. `LinkedTask.status` (`pending | engaged | completed | unfinished`) and `HabitInstanceStatus` (with the additional `planned` and `skipped` states) capture the lifecycle. `TOGGLE_TASK_COMPLETE` writes `status` alongside `completed` and closes any open engagement.

**Engagement is preserved on backlog deferral.** When a user moves an intention with engaged-but-incomplete LinkedTasks to the backlog, the engagement records ride along in `BacklogEntry.unfinishedTaskRecords` (a read-only memo surfaced as a `✱ Engaged earlier: N task(s), Mm` annotation in the Backlog tab). On Bring-to-today, restored LinkedTasks for those ids are stamped with `rescheduledFromTodoistId` + `rescheduledAt`.

**Habits reschedule with engagement-aware branching.** `RESCHEDULE_HABIT_INSTANCE` checks for engagement on the target:
- **No engagement → in-place update.** `targetTime` changes, `rescheduledAt` is stamped, status/id/engagement preserved. No predecessor record because nothing happened to record.
- **Engagement present → clone.** The predecessor flips to terminal `'unfinished'` with its engagement record intact (any open segment is closed first). A fresh `'planned'` successor is appended at the new time with `rescheduledAt` set. Both share `habitId`/`todoistTaskId` and coexist for the rest of the day.

The recurring Todoist task is **never** touched in either path. The dashboard's `HabitInstanceCard` renders unfinished predecessors as historical rows at the original `targetTime` with the engagement-minutes chip and a "rescheduled" tag — preserving the durable in-day record of work done. The Step 3 habits panel filters to active (planned + engaged) instances since planning is the focus there.

Both the dashboard and the Step 3 habits panel (rendered in both Phase 1 and Phase 2) expose a ⤴ Reschedule affordance on every active instance. Habit-form edits to `targetTime` / `durationMinutes` propagate into the existing planned instance via the merge logic in `REFRESH_TODAYS_HABITS` (which preserves the user-chosen time when `rescheduledAt` is set).

The unfinished predecessor is also a **forward-looking foundation**: a future `life.engagementHistory` (or Todoist-comments mirror) can harvest these records into a cross-day engagement log, eventually surfaceable in a `/review` view or external calendar — see [plan_v6.3.md](./plan_v6.3.md) for the suggestion list.

Schema bumped to `6.3`. The migration is one-shot and lossless: any `sourceHabitId`-bearing LinkedTask becomes a synthetic `TodaysHabitInstance` (status inferred from `completed` / `skippedForToday`), is dropped from `linkedTasks`, and its id is pruned from every `taskSessions[sessionId]`. Every remaining LinkedTask gets a `status` mirror of `completed`. The `HabitTaskInjection` type, the `INJECT_HABIT_TASKS` / `SKIP_HABIT_TASK` actions, the `isHabitDerivedTask` helper, and the `HABIT_GROUP_KEY` synthetic grouping are all removed.

See [plan_v6.3.md](./plan_v6.3.md) for the full implementation plan.
