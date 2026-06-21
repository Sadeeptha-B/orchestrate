# Plan v7.5 — Dashboard Rescheduling

> Frozen narrative. For current state see [synthesis.md](../synthesis.md) and [data-model.md](../data-model.md).

# Dashboard rescheduling: Anytime tray, task drag-and-drop, session adjustment

## Context

Today, tasks are bound to sessions only through `DayPlan.taskSessions` (a bucket-membership map), and that binding can only be changed inside the wizard's Schedule step. Two real problems follow:

1. **Tasks that don't slot neatly have no home.** A linked task that isn't assigned to any session (`assignedSessions.length === 0`) is simply invisible on the dashboard — there's no surface for "committed but unplaced" work.
2. **Drift forces a wizard round-trip.** As the day runs late, re-placing tasks or shifting a session's clock bounds means leaving the dashboard for the full wizard flow (`Recontextualize → Step 4`), which is heavier than the situation warrants.

This change makes the dashboard the home for *placement* drift while leaving the wizard as the home for *contextualization*. It introduces a first-class **"Anytime today"** state for tasks (derived, not a new field), lets users **drag tasks between sessions and the Anytime tray** (plus a keyboard/mobile-friendly "Move to…" menu), and lets them **adjust today's session times directly on the dashboard** by reusing the wizard's session editor.

**Conceptual model (the task–session relationship):** a session is a soft, ordered *context bucket*, not a clock. A task's placement is one of three orthogonal states:
- **Session-bound** — in one (main, exclusive) or many (background) buckets, ordered within. *(exists)*
- **Anytime today** — linked but in no bucket; derived from `assignedSessions.length === 0`. *(newly surfaced)*
- **Time-anchored** — has a Todoist due time; rendered as the existing `scheduledRange` pill and synced to Calendar. Orthogonal; no in-app task clock. *(exists)*

**Boundary:** Dashboard = placement + today's session shape. Wizard = intentions, links, main/bg categorization, estimates, and session **templates**.

**No schema bump** — reuses existing fields (`assignedSessions`, `taskSessions`, `sessionSlots`) and existing reducer actions.

## Phase 1 — Anytime model + "Move to…" menu (foundation)

Delivers full move capability with no DnD yet (keyboard/mobile-friendly).

- **Selector** — add `unscheduledTasks(plan)` to [src/lib/tasks.ts](src/lib/tasks.ts):
  `plan.linkedTasks.filter(lt => !lt.completed && lt.assignedSessions.length === 0)`.
  (Mirrors the existing derivation at Step3Schedule.tsx:232.)
- **Placement hook** — add `useTaskPlacement()` (new, `src/hooks/`) returning `moveTask(todoistId, fromSessionId | null, toSessionId | null)`:
  - `main`: `to === null` → `UNASSIGN_TASK(from)`; else `ASSIGN_TASK(to)` (exclusive; clears prior session itself).
  - `background`: if `from` → `UNASSIGN_TASK(from)`; if `to` → `ASSIGN_TASK(to)`.
  - No new reducer action — same `UNASSIGN`+`ASSIGN` chain already used in [Step3Schedule.tsx](src/components/wizard/Step3Schedule.tsx#L99).
- **TaskRow "Move to…" menu** — in [src/components/dashboard/SessionTimeline.tsx](src/components/dashboard/SessionTimeline.tsx) (`TaskRow`, ~line 96): add a small dropdown listing `plan.sessionSlots` + an "Anytime" option, calling `moveTask`. Generalize `TaskRow`'s `sessionId: string` to `sessionId: string | null` so it can render in the tray (no within-session reorder drag when `null`).
- **AnytimeTray** — new exported component in `SessionTimeline.tsx` (alongside `CurrentSession`/`SessionTimeline`, reusing `TaskRow`). Renders `unscheduledTasks` grouped by intention; hidden when empty.
- **Dashboard wiring** — render `<AnytimeTray>` in the left column of [src/components/dashboard/Dashboard.tsx](src/components/dashboard/Dashboard.tsx#L207), near `CurrentSession`.

## Phase 2 — Drag-and-drop on the timeline bar

The delightful desktop layer over the same `moveTask`. The bar shows all sessions at once, so it's the natural between-session surface; within-session reorder stays in the `CurrentSession` card (existing `useTaskDrag`).

- **[src/components/ui/SessionTimelineBar.tsx](src/components/ui/SessionTimelineBar.tsx)** — add optional prop `onMoveTask?(todoistId, fromSessionId | null, toSessionId | null)`. When present (mirrors the existing `onSelectSession`-means-interactive pattern at line 357):
  - Task pills (main ~lines 506–513, bg ~514–521) become `draggable`, set `dataTransfer` JSON `{ todoistId, fromSessionId }` on `onDragStart`.
  - Session blocks (~lines 537–553) gain `onDragOver` (`preventDefault`) + `onDrop` → `onMoveTask(payload.todoistId, payload.fromSessionId, session.id)`, with a `dragOverSessionId` highlight state.
  - HTML5 DnD only; no change when `onMoveTask` is absent (Step 3 / read-only usages unaffected).
- **[SessionTimeline.tsx](src/components/dashboard/SessionTimeline.tsx) `SessionTimeline` wrapper (~line 536)** — pass `onMoveTask={moveTask}`.
- **AnytimeTray as drop target** — `onDragOver`/`onDrop` on the tray container → `moveTask(todoistId, fromSessionId, null)`. Tray rows are drag sources (`fromSessionId: null`).
- Note: the bar is `hidden md:block`; the Phase-1 menu is the mobile/keyboard path.

## Phase 3 — Session adjustment on the dashboard ("Adjust day")

Reuse the wizard's editor wholesale (full move/resize/rename/create/delete). Templates stay wizard-only.

- **Dashboard toggle** — an "Adjust day" toggle in the "Today" section of [Dashboard.tsx](src/components/dashboard/Dashboard.tsx) that swaps the read-only `SessionTimeline` bar for [src/components/ui/SessionEditorTimeline.tsx](src/components/ui/SessionEditorTimeline.tsx), wired exactly as in [Step3Sessions.tsx](src/components/wizard/Step3Sessions.tsx#L70):
  - `onAdd → ADD_DAY_SESSION`, `onUpdate → UPDATE_DAY_SESSION`, `onRemove → REMOVE_DAY_SESSION`, plus `timelineStart/EndMinutes` from settings.
  - **No** template apply/save here (that's the wizard's "redefine layout" responsibility).
- **Safety net** — `REMOVE_DAY_SESSION` already prunes `taskSessions`/`assignedSessions`; orphaned tasks fall into the Anytime tray. `UPDATE_DAY_SESSION` keeps the id, so assignments survive a time edit.
- **Reactivity** — `useCurrentSession` (60s tick + recompute on `sessionSlots`) and `computeSessionCapacity` (reads live `taskSessions`/`sessionSlots`) update automatically after edits; no extra plumbing.

## Out of scope / non-goals

- No in-app per-task clock time (precise timing → Todoist due-time → Calendar).
- No new persisted fields, no schema/migration change, no new entity.
- `CheckInModal.onRecontextualize` unchanged (the editable dashboard simply makes it rarely needed).
- Template management stays in the wizard.

## Files

- New: `src/hooks/useTaskPlacement.ts`.
- Edit: `src/lib/tasks.ts` (selector), `src/components/dashboard/SessionTimeline.tsx` (TaskRow menu, AnytimeTray, pass `onMoveTask`), `src/components/ui/SessionTimelineBar.tsx` (DnD), `src/components/dashboard/Dashboard.tsx` (tray + Adjust-day toggle).
- Reuse as-is: `src/components/ui/SessionEditorTimeline.tsx`, reducer actions `ASSIGN_TASK`/`UNASSIGN_TASK`/`REORDER_SESSION_TASKS`/`ADD_/UPDATE_/REMOVE_DAY_SESSION` in `src/context/DayPlanContext.tsx`.
- Docs (same commit, per CLAUDE.md): `docs/data-model.md` (three placement states; Anytime = no assignment; dashboard session editing), `docs/synthesis.md` §5.3 (dashboard placement + Adjust-day; the dashboard/wizard boundary), `src/components/guide/UserGuide.tsx` (Anytime tray, drag/menu to re-place, Adjust day).

## Verification

- `npm run lint` && `npm run build` clean.
- `npm run dev`, complete the wizard with several tasks (assign some, leave ≥1 unassigned), then on the dashboard:
  1. **Anytime**: the unassigned task appears in the Anytime tray; assigned ones don't.
  2. **Menu**: "Move to…" on a tray row → into a session (leaves tray, appears in that block/CurrentSession). "Move to Anytime" on a session task → returns to tray. Background task moved between two sessions ends up only in the target.
  3. **DnD** (≥md width): drag a pill between two blocks on the bar; drag a pill onto the Anytime tray; drag a tray task onto a block. Drop highlight shows.
  4. **Main exclusivity**: a main task dragged to a new session leaves the old one; a background task dragged via DnD-onto-block (additive) vs menu-move behaves as specified.
  5. **Adjust day**: toggle on → move/resize a session; confirm CurrentSession + capacity reflect new bounds and assignments survive. Delete a session with tasks → its tasks land in the Anytime tray.
  6. Reload → all placements and session edits persist (localStorage).
