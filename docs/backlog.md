> **What is this?** Forward-looking feature proposals that are **not yet implemented**. Each item below is a candidate direction, not a committed plan.
>
> When an item ships: write the implementation plan into [history/](./history/) (e.g. `plan_v5.md`), append a narrative entry to [history/iterations.md](./history/iterations.md), update [synthesis.md](./synthesis.md) to reflect the new current state, and remove the item from this file.
>
> See [vision.md](./vision.md) for the durable "why" and [synthesis.md](./synthesis.md) for the current state.

# Orchestrate — Backlog

## First-class habits

**Summary.** Replace the current "background task can be flagged as a habit" model with habits as a separate first-class entity that can be toggled active/inactive and auto-promoted into Step 1 intentions when active.

**Original text** (Iteration 5, `requirement.md` pre-refactor, preserved verbatim):

> Currently, the habit setup in Orchestrate is simplistic. If a task is a background task, the user can select it as a habit.
>
> We should introduce functionality for the user to enter in habits in a separate setting. The earlier model of having background tasks as habits should be revised. Instead, the habits that the user enters in are considered intentions. For each habit, the user should be able to toggle the habit in and out of active state. If in active state, the habit is automatically added as an intention in the Step 1 Wizard, as long as it is in the active stay
>
> Usually, these habit intentions map into a single task, so we can allow the user to map these habits into However, the habit task must always be a background task.

**Open questions** (flagged ambiguities in the original — resolve before implementation):

- *"…as long as it is in the active stay"* — almost certainly intended as **active state**. Confirm.
- *"…we can allow the user to map these habits into However, the habit task must always be a background task."* — the first sentence appears truncated mid-thought. Likely intended along the lines of "…map these habits into a single Todoist task during Step 1 mapping, prefilled or auto-linked." Confirm intent.
- Once habits are first-class, what happens on the *first day* a habit becomes active — does it create a fresh Todoist task, or does the user map it manually the first time and Orchestrate remembers the link?
- Habits are user-defined recurring intentions. Do they replace the existing `isHabit` flag on `LinkedTask` entirely, or coexist?

## Session capacity arithmetic

**Summary.** When the user assigns tasks to a session, sum their estimates and compare against the session's available time (minus a tunable buffer for inefficiencies). Warn when assignments exceed capacity. When the user is currently within a session, compute against *remaining* time, not total.

**Original text** (Iteration 5, `requirement.md` pre-refactor, preserved verbatim):

> The next feature improvement I want is some further sophistication in the estimation and scheduling.
>
> After estimating tasks in step 2, the user is to schedule them into sessions in step3, first at a high level and then into specific slots. So, as the user schedules items into a session, we should compute how much time that is in aggregate and compare that against the total time in the session - 1h (As buffer time for inefficiencies, make the buffer time tunable).
>
> If the time is too much, the user is invited to go back to the previous step and break a task down into two or to move an item to a different session. If the user is currently within a session, the time computation must be intelligent to compute within the remaining time in the session instead of the total time.

**Open questions** (not in the original — flagged for resolution before implementation):

- Default buffer is "1h". Where is the tunable stored — `AppSettings` (per-user persistent) or per-day on the plan?
- Background tasks have estimates capped at 30 min and can be assigned to multiple sessions. Do they count once-per-session against capacity, or are they excluded from capacity arithmetic since they're nudges?
- Is the over-capacity signal blocking (cannot advance) or advisory (warning banner, can proceed)? The Iteration 5 phrasing — *"the user is invited to go back"* — reads advisory.
