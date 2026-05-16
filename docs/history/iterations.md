> **What is this?** The chronological evolution of Orchestrate's requirements, from Iteration 1 through Iteration 6.1. Iterations 1–4 are preserved verbatim from `docs/requirement.md` (pre-refactor on 2026-05-07) so the *why* behind each pivot — Trevor AI iframes, Todoist + Google Calendar, intention-to-task scheduling — remains discoverable. Iterations 5+ are shipped-iteration narratives written at the time the work landed.
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

6. Refer to [Music Routine](../music_routine.md) that decides on music for the user based on the type of work. The app should then prompt the user to start the "Start work music"

7. Then the app should show all the different playlists detailed in [Music Routine](../music_routine.md)  in a format so that it is always visible to the user.

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

Iteration 5 lifts Orchestrate from a day-execution engine to a life-scaffolding companion. The motivation is captured in [orchestrate_life_migration_spec.md](../orchestrate_life_migration_spec.md): the user is migrating into a more intentional lifestyle (sleep discipline, weekend degree work, gym, tech growth, side projects) and the app needs to hold context above the day to support that.

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
