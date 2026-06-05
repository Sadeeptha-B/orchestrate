I’m tracing the concrete object boundaries and update paths now so the guide can explain the system from first principles instead of just restating the findings.

Starting: *Inspect core state flows* (2/5)

I’m pulling the route shell, Todoist hooks, and the main planning surfaces in parallel so I can connect the abstract state model to the actual user actions that mutate it.

Read [](file:///c%3A/Users/SadeepthaBandara/source/repos/orchestrate/src/App.tsx)

Read [](file:///c%3A/Users/SadeepthaBandara/source/repos/orchestrate/src/hooks/useTodoist.ts)

Read [](file:///c%3A/Users/SadeepthaBandara/source/repos/orchestrate/src/components/wizard/Step1Intentions.tsx#1-1), lines 1 to 260

Read [](file:///c%3A/Users/SadeepthaBandara/source/repos/orchestrate/src/components/dashboard/Dashboard.tsx#1-1), lines 1 to 260

Read [](file:///c%3A/Users/SadeepthaBandara/source/repos/orchestrate/src/components/dashboard/BacklogTab.tsx)

I’ve mapped the top-level providers and the main user-facing flows. Next I’m tracing a few concrete mutations end to end: link task, complete task, restore backlog, and habit reconcile.

Searched for regex `TOGGLE_TASK_COMPLETE|START_TASK_ENGAGEMENT|STOP_TASK_ENGAGEMENT|ASSIGN_TASK|UNASSIGN_TASK` (`**/src/components/**`), 8 results

Searched for regex `LINK_TASK|UNLINK_TASK` (`**/src/components/**`), 6 results

Read [](file:///c%3A/Users/SadeepthaBandara/source/repos/orchestrate/src/components/dashboard/SessionTimeline.tsx#1-1), lines 1 to 240

Read [](file:///c%3A/Users/SadeepthaBandara/source/repos/orchestrate/src/components/ui/SessionTimelineBar.tsx#1-1), lines 1 to 260

I’ve traced the main mutations end to end. The remaining work is synthesis: turn this into a mental model of object ownership, data flow, and where the four review findings sit in that pipeline.

Completed: *Inspect core state flows* (2/5)

**Mental Model**

Orchestrate is easiest to understand if you treat it as three layers running at once.

1. The local planning layer lives in DayPlanContext.tsx. This is the app’s authoritative model of today and of the user’s long-lived Orchestrate concepts. It owns DayPlan, settings, history, and life state. That means it owns intentions, linked task metadata, today’s habit instances, session assignments, backlog entries, seasons, habits, engagement segments, and saved sessions.

2. The external task layer lives in TodoistContext.tsx. This is not the source of truth for planning, but it is the source of truth for actual Todoist objects: tasks, projects, sections, completion state, due data, duration, and recurring-task behavior. Orchestrate caches those objects and exposes CRUD operations on them.

3. The repair and projection layer lives in ReconciliationContext.tsx and useTodaysHabitsSync.ts. This layer takes durable Orchestrate state plus current Todoist state and derives what should appear today, especially for habits. It also repairs certain mismatches, such as a habit that should have a recurring Todoist task but no longer does.

At the top level, App.tsx wires those layers in this order: DayPlanProvider, then TodoistProvider, then ReconciliationProvider. That order matters. TodoistProvider needs settings and plan data from DayPlanProvider, and ReconciliationProvider needs both Orchestrate state and Todoist state.

**Who Owns What**

The most important boundary is object ownership.

- Todoist owns the actual task object: title, checked state, due date or due datetime, recurrence, project, section, and child-task tree. The shape is exposed in useTodoist.ts.
- Orchestrate owns the interpretation of those tasks inside a day plan: which intention a task belongs to, whether it is main or background, estimated minutes, assigned sessions, engagement segments, and whether it appears in backlog or history. That model is centered in index.ts and updated in DayPlanContext.tsx.
- Orchestrate also owns durable habit definitions in life.habits. A habit may have a Todoist backing task, but the habit itself is not a Todoist object. Todoist only stores the recurring task used to materialize it.
- DayPlan.todaysHabits is a projection, not the durable habit definition. It is created from life.habits plus current Todoist data. That projection is produced by useTodaysHabitsSync.ts, habitsTodoistSync.ts, and habits.ts.
- Backlog entries are Orchestrate snapshots. They preserve enough about old linked tasks to restore work later even if Todoist state has moved on. That logic lives in backlog.ts and is surfaced by BacklogTab.tsx.

A good shorthand is this: Todoist owns the raw task reality, Orchestrate owns the planning meaning.

**The Core Objects**

The main object relationships are:

- Intention: a today-scoped planning goal.
- LinkedTask: a Todoist task attached to an intention. It stores the Todoist id plus Orchestrate-only fields like task type, estimate, session assignment, and engagement segments.
- Habit: a durable recurring object in the life slice.
- TodaysHabitInstance: today’s manifestation of a habit. This is what the dashboard and timeline render.
- Session assignment: a local mapping from session id to Todoist task ids.
- BacklogEntry: a parked intention snapshot that can later rebuild fresh linked tasks.

The key join fields are simple:

- LinkedTask.todoistId joins a local planned task to a Todoist task.
- Habit.todoistTaskId joins a durable habit to its recurring Todoist task.
- TodaysHabitInstance.habitId joins the daily instance back to the durable habit definition.
- TodaysHabitInstance.todoistTaskId, when present, joins the day-of habit row to the live Todoist recurring task.

**State Flow by User Action**

The cleanest way to see the system is to follow user actions.

1. Creating intentions
Step 1 in Step1Intentions.tsx dispatches ADD_INTENTION into DayPlanContext. This creates purely local planning objects. No Todoist mutation happens here.

2. Linking Todoist tasks to intentions
When the user links a Todoist task in Step 1 or Step 2, the UI dispatches LINK_TASK. The reducer in DayPlanContext.tsx creates or moves a LinkedTask entry and updates the parent intention’s linkedTaskIds. Again, this does not change Todoist. It changes Orchestrate’s mapping of existing Todoist tasks into today’s plan.

3. Refining linked tasks
Step 2 adds local metadata such as main versus background and estimated minutes. This remains entirely in DayPlanContext. Todoist still owns the task, but Orchestrate owns how that task should be treated today.

4. Scheduling tasks
Step 3 assigns tasks to sessions using ASSIGN_TASK and UNASSIGN_TASK. That lives entirely in the local plan. If the user time-blocks through TodoistPanel, Orchestrate may also write due_datetime and duration back to Todoist through updateTask in TodoistContext.tsx.

5. Completing or engaging a linked task
On the dashboard in SessionTimeline.tsx, Orchestrate first updates local state by dispatching TOGGLE_TASK_COMPLETE or START_TASK_ENGAGEMENT or STOP_TASK_ENGAGEMENT. It then calls Todoist actions such as completeTask or reopenTask. This means the UI is optimistic: Orchestrate updates immediately, then asks Todoist to catch up.

6. Archiving to backlog
When an intention is moved to backlog, useIntentionRemoval.ts first unschedules linked Todoist tasks, then dispatches MOVE_INTENTION_TO_BACKLOG. The backlog snapshot is built in backlog.ts, which preserves pending task ids, title snapshots, and engagement records. Bringing it back later dispatches RESTORE_FROM_BACKLOG from BacklogTab.tsx.

7. Creating or editing a habit
Habit edits go through useHabitMutations.ts. The durable habit object is written locally first. If the habit kind is a real habit rather than a micro-gap, Orchestrate then attempts to sync it to Todoist through useSyncHabit.ts and habitsTodoistSync.ts. This is another optimistic pattern: local first, Todoist second.

8. Surfacing today’s habits
The durable habit definition is not rendered directly. Instead, useTodaysHabitsSync.ts computes today’s instances from life.habits plus the Todoist task map, then dispatches REFRESH_TODAYS_HABITS. Step 1 and the dashboard both mount this hook so the two surfaces stay aligned, as seen in Step1Intentions.tsx and Dashboard.tsx.

9. Repairing habit drift
ReconciliationProvider watches the durable habit list and the Todoist task map. It detects two kinds of drift: habits that need a backing Todoist task and habits whose recurring task is overdue and needs to be bumped forward. It then repairs Todoist first and refreshes the projected day-of instances.

**Why This Architecture Exists**

The split is deliberate.

- Orchestrate needs richer planning concepts than Todoist has: intentions, background versus main, backlog, engagement segments, session capacity, recurring focus, true rest.
- Todoist is still needed as the durable task engine: recurring rules, project structure, upstream edits, cross-device task state.
- That means Orchestrate must continuously translate between a planning model and a task system. The translation is where most subtle bugs appear.

**Where the Gaps Sit**

The four user-reachable findings all sit at translation boundaries, not at the basic reducer CRUD layer.

1. Missing-task detection for habits
This sits in the repair layer, specifically habitsTodoistSync.ts. The function findNeedsSyncHabits decides whether a habit’s Todoist task is missing. Today it only flags that case if taskMap.size is greater than zero. Conceptually, that means the code is using non-empty as a proxy for hydrated. But an empty hydrated task list is valid. So the repair layer can fail exactly when Todoist truth is “you have no active tasks.”

2. Empty cache not being persisted
This sits in the Todoist cache boundary at TodoistContext.tsx. The provider refuses to write an all-empty cache snapshot. That means the last non-empty Todoist state can survive in localStorage even after the real Todoist state becomes empty. On reload, the app may trust that stale cache and skip a fetch because the TTL logic still considers it fresh at TodoistContext.tsx. This is not a reducer bug. It is a cache invalidation bug.

3. Stale linked-task cleanup being one-time and non-empty-only
This sits in TodoistProvider’s reconciliation path at TodoistContext.tsx. That effect syncs title snapshots and marks missing linked tasks complete. But it only runs once per provider lifetime and it refuses to run when tasks.length is zero. So it is really a boot-time reconciliation, not a continuing reconciliation. As the day continues, Orchestrate can drift away from real Todoist state.

4. Deleted tasks being treated as completed tasks
This is the semantic bug in the same linked-task reconciliation path at TodoistContext.tsx. The provider currently interprets absence from Todoist as external completion and dispatches TOGGLE_TASK_COMPLETE. But the documented model says deleted tasks should auto-unlink, while externally completed tasks should remain visible through title snapshots. That means the code currently collapses two distinct states into one. It preserves too much when it should sometimes remove the local linkage.

The low-severity reducer issue is different.

5. Intention-level bulk completion path
This lives purely inside DayPlanContext at DayPlanContext.tsx. It updates child tasks less carefully than the normal task completion path. I flagged it because it violates local invariants, but it appears unused. It is a latent local-model bug, not a current cross-system sync bug.

**The Most Important Conceptual Distinction**

The guide becomes simpler if you separate projection bugs from ownership bugs.

- Projection bug: Orchestrate has the right durable data, but it derives the wrong today view from it. Example: a habit instance fails to appear because the repair logic misread an empty hydrated task map.
- Cache bug: Orchestrate is reading old external truth and trusting it too long. Example: the empty Todoist state never overwrites the old cached non-empty state.
- Ownership bug: Orchestrate cannot tell whether a missing Todoist task means completed or deleted, so it applies the wrong local consequence.
- Local invariant bug: Orchestrate’s own reducer updates one field but forgets the related mirrored fields.

That is why most of the findings cluster around TodoistProvider and habit reconciliation rather than around the basic plan reducer.

**A Practical Way to Think About the System**

When debugging Orchestrate, ask these questions in order:

1. Is this object owned by Todoist, Orchestrate, or derived from both?
2. If it is derived, what are the exact inputs: life.habits, plan, taskMap, settings, or all of them?
3. Is the current bug caused by stale external data, incorrect derivation, or the wrong local reaction to external absence?
4. Is the code using empty as a proxy for not loaded? In this codebase, that is a recurring source of subtle bugs.
5. Is the code treating all Todoist absence the same way? It usually should not.

That framing explains all four primary findings cleanly.
