# Orchestrate v4 — Task-Level Data Model Refactor

## Overview

Shift Orchestrate's unit of scheduling and categorization from **intentions** to **Todoist tasks**. Intentions remain as high-level grouping headers, but individual tasks linked during Step 1 mapping become the primary items that are categorized (main/background) in Step 2 and scheduled into sessions in Step 3.

The wizard now has **4 steps** (Intentions → Refine → Schedule → Music). The original Step 3 (Main Schedule) and Step 4 (Background Schedule) were merged into a single unified Schedule step with a two-phase layout. Step 5 (Start Music) became Step 4.

This requires changes to the data model, reducer, all 4 wizard steps, the TodoistPanel, and the dashboard.

### Motivation

The v3 model has several inconsistencies:
- After creating Todoist tasks, the wizard still schedules **intentions** (broad "ideas") rather than the concrete tasks themselves.
- Categorization (main/background) applies to intentions, but a single intention can naturally contain both main and background tasks.
- The user can schedule tasks freely in the Todoist panel during Steps 3–4, but this isn't captured by the data model — Orchestrate only tracks intention-level assignments.

v4 resolves this by making **Todoist tasks the first-class citizens** of categorization and scheduling, with intentions serving as organizational context.

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Task tracking during mapping | "Link"/"Unlink" text buttons in Todoist panel | More reliable than snapshot-diffing; less intrusive than checkboxes; completion button stays visible |
| Scheduling granularity | Tasks grouped under parent intentions | Preserves context about why each task exists |
| Categorization level | Task-level only (remove intention-level type) | An intention can have both main and background tasks |
| Task data storage | Store only Todoist task IDs; fetch titles from API at runtime | Always current; single source of truth in Todoist |
| Stale task handling | Completed tasks preserved with `titleSnapshot` + 🎉; deleted tasks auto-unlinked; greyed out + ⚠ icon for truly stale | Completed tasks remain visible in their scheduled sessions (strikethrough + party emoji). Only deleted/missing non-completed tasks are auto-cleaned. |
| Step 2 layout | Intentions as collapsible headers, tasks underneath | Clear grouping for categorization |

---

## Phase 1: Data Model Changes

**File:** `src/types/index.ts`

### 1.1 — Update `Intention`

Remove fields that now belong to the task level. Add task-linking support.

```ts
export interface Intention {
    id: string;
    title: string;
    // REMOVED: type: 'main' | 'background' | 'unclassified'
    // REMOVED: assignedSessions: string[]
    linkedTaskIds: string[];   // NEW — ordered Todoist task IDs
    completed: boolean;
    brokenDown: boolean;
    isHabit: boolean;
}
```

### 1.2 — Add `LinkedTask`

New type representing a Todoist task linked to an intention within Orchestrate's data model.

```ts
export interface LinkedTask {
    todoistId: string;                                    // Todoist task ID (primary key)
    intentionId: string;                                  // parent intention
    type: 'main' | 'background' | 'unclassified';        // categorization
    assignedSessions: string[];                           // session slot IDs
    completed: boolean;
    isHabit: boolean;
    titleSnapshot?: string;                               // cached title for completed tasks no longer in Todoist
}
```

### 1.3 — Update `DayPlan`

```ts
export interface DayPlan {
    date: string;
    intentions: Intention[];
    linkedTasks: LinkedTask[];                             // NEW — flat array, all tasks across all intentions
    taskSessions: Record<string, string[]>;               // NEW — sessionId → todoistId[]
    // REMOVED: intentionSessions: Record<string, string[]>
    wizardStep: number;
    setupComplete: boolean;
    checkIns: CheckIn[];
}
```

### 1.4 — Runtime Task Resolution (not persisted)

The `useTodoist` hook already holds `tasks: TodoistTask[]` in memory. We expose a memoized lookup map:

```ts
// In useTodoist.ts
const taskMap: Map<string, TodoistTask> = useMemo(
    () => new Map(tasks.map(t => [t.id, t])),
    [tasks]
);
```

Components resolve `linkedTask.todoistId` → display title via this map. If an ID is not found → render a stale indicator (greyed out, ⚠ icon, manual "Remove" button).

---

## Phase 2: Reducer & Context Changes

**File:** `src/context/DayPlanContext.tsx`

### 2.1 — New Actions

| Action | Payload | Behavior |
|--------|---------|----------|
| `LINK_TASK` | `{ intentionId, todoistId }` | Creates `LinkedTask` entry, appends to intention's `linkedTaskIds`. If task is already linked to another intention, moves it. |
| `UNLINK_TASK` | `{ todoistId }` | Removes `LinkedTask`, removes from intention's `linkedTaskIds`, removes from all `taskSessions` |
| `CATEGORIZE_TASK` | `{ todoistId, type }` | Updates `LinkedTask.type` |
| `TOGGLE_TASK_HABIT` | `{ todoistId }` | Toggles `LinkedTask.isHabit` |
| `ASSIGN_TASK` | `{ todoistId, sessionId }` | Adds to `taskSessions[sessionId]`. **Main** tasks: exclusive (removed from other sessions first). **Background** tasks: multi-session allowed. Updates `LinkedTask.assignedSessions`. |
| `UNASSIGN_TASK` | `{ todoistId, sessionId }` | Removes from `taskSessions[sessionId]` and `LinkedTask.assignedSessions` |
| `TOGGLE_TASK_COMPLETE` | `{ todoistId, titleSnapshot? }` | Toggles `LinkedTask.completed`; optionally saves `titleSnapshot` for display after Todoist removal |
| `SYNC_TASK_SNAPSHOTS` | `{ snapshots: Record<string, string> }` | Bulk-updates `titleSnapshot` for matching linked tasks; keeps cached names fresh on every Todoist fetch |
| `REORDER_SESSION_TASKS` | `{ sessionId, taskIds }` | Reorders tasks within a session |

### 2.2 — Removed / Replaced Actions

| Old Action | Replacement |
|------------|-------------|
| `CATEGORIZE_INTENTION` | `CATEGORIZE_TASK` |
| `TOGGLE_HABIT` | `TOGGLE_TASK_HABIT` |
| `ASSIGN_INTENTION` | `ASSIGN_TASK` |
| `UNASSIGN_INTENTION` | `UNASSIGN_TASK` |
| `REORDER_SESSION_INTENTIONS` | `REORDER_SESSION_TASKS` |

**Kept:** `TOGGLE_INTENTION_COMPLETE` — convenience action that marks all linked tasks as complete.

### 2.3 — `freshPlan()` Update

```ts
function freshPlan(): DayPlan {
    return {
        date: todayISO(),
        intentions: [],
        linkedTasks: [],       // NEW
        taskSessions: {},      // NEW (replaces intentionSessions)
        wizardStep: 1,
        setupComplete: false,
        checkIns: [],
    };
}
```

### 2.4 — `migratePlan()` Update

Handle the v3 → v4 migration path:

- **Detection:** Plan has `intentionSessions` but no `taskSessions` / `linkedTasks`
- **Strategy:** Since v3 intentions contain no Todoist task IDs, we cannot auto-create `LinkedTask` entries.
  - Initialize `linkedTasks: []` and `taskSessions: {}`
  - Preserve intentions with their titles and `brokenDown` state
  - Strip removed fields (`type`, `assignedSessions`) from intentions
  - Add `linkedTaskIds: []` to each intention
  - Set a `_migrated: 'v3-to-v4'` flag (or equivalent) for showing a one-time notice
- **Notice:** "This session was saved in an older format. Task links need to be re-established."
- **Chain:** Ensure v1 → v2 → v3 → v4 migration path works end-to-end

### 2.5 — Persistence

`linkedTasks` and `taskSessions` are persisted to localStorage (they contain only IDs, not Todoist data — lightweight and privacy-appropriate).

---

## Phase 3: Wizard Step Changes

### 3.1 — Step 1: Set & Map Intentions

**File:** `src/components/wizard/Step1Intentions.tsx`

**Phase 1 (entering intentions):** No change.

**Phase 2 (sequential mapping):** When the current intention is being mapped:
- The **TodoistPanel** on the right enters **linking mode** (new `linking` prop bundle)
- Each task row shows a **"Link"/"Unlink" text button** on the right (hover-revealed for unlinked, always visible for linked)
- **Link** = linked to the current intention → dispatches `LINK_TASK`
- **Unlink** = removed → dispatches `UNLINK_TASK`
- Tasks already linked to this intention are **highlighted** with accent border (read from `plan.linkedTasks`)
- Tasks linked to **other** intentions show an amber label `"linked to: {intention title}"` and are still linkable (re-linking moves them)
- "Done — next" still marks `MARK_BROKEN_DOWN` and advances to the next intention
- CRUD operations (create/delete tasks) remain available alongside linking
- **Completion button** remains always visible (not hidden during linking mode)

**Navigation & remap controls (implemented post-plan):**
- **"← Want to change intentions?"** — subtle text link above the mapping progress bar, returns to Phase 1 (intention editing)
- **Individual remap** — each mapped intention is clickable to remap individually (sets its `brokenDown` flag back to false)
- **"Want to start over? Restart mapping"** — standalone text link at the bottom of Phase 2, resets all intentions' `brokenDown` flags

### 3.2 — Step 2: Refine

**File:** `src/components/wizard/Step2Refine.tsx` (renamed from `Step2Categorize.tsx`)

Per-intention sequential flow combining categorization, time estimation, and TodoistPanel for sub-task creation. See **v4.1** section below for full specification.

### 3.3 — Step 3: Schedule (Merged Main + Background)

**File:** `src/components/wizard/Step3Schedule.tsx` (formerly `Step3ScheduleMain.tsx` — `Step4ScheduleBackground.tsx` deleted)

Main and background scheduling merged into a single step with a **two-phase layout**:

**Phase 1 — High-level session assignment:**
- **SessionTimelineBar** — reusable proportional timeline component showing sessions as blocks with hour labels. Interactive mode: clicking a session selects it.
- Unassigned main tasks shown as accent chips above the timeline
- Background/nudge tasks shown with session count badges
- **Selected session detail panel** below the timeline:
  - Assigned main tasks (grouped by intention) — click to unassign
  - Assigned background tasks — click to unassign
  - Unassigned main tasks — click to assign (exclusive: removes from other sessions)
  - Unassigned background tasks — click to assign (multi-session allowed)
- "Schedule times →" button transitions to Phase 2 — **disabled until at least one task is assigned to a session**

**Phase gating:**
- **Phase 1 → Phase 2**: blocked until at least one task assignment exists (`hasAnyAssignment` check)
- **Phase 2 → Step 4 (Music)**: the WizardLayout "Continue" button and the Music step pill are both hidden/disabled until phase 2 is reached (`canAdvance={phase === 'time'}`, `hideNext={phase === 'assign'}`)

**Phase 2 — Time scheduling with Todoist + Calendar:**
- "← Edit assignments" link returns to Phase 1
- **Horizontal session summary** — compact cards showing session name, time, and assigned task chips
- **Side-by-side layout:** TodoistPanel (2/5 width, `showFilterToggle defaultFiltered`) + GoogleCalendarEmbed (3/5 width)
- User schedules specific times for tasks in Todoist, reflected in the embedded calendar
- **Estimate-based auto-fill**: when a user enters a start time in the TodoistPanel time picker, the end time is automatically computed from the task's `estimatedMinutes` (if set). The user can still manually adjust it.

**Key behaviors:**
- Main tasks are **exclusive** to one session (assigning removes from other sessions)
- Background tasks can be assigned to **multiple sessions** (nudge pattern)
- Assignment logic is type-based in the reducer, not in the UI

### 3.4 — Step 4: Start Music

**File:** `src/components/wizard/Step4StartMusic.tsx` (formerly `Step5StartMusic.tsx`)

- Minor: update completion counter to count **linked tasks** instead of intentions

---

## Phase 4: Dashboard Changes

### 4.1 — Session Timeline

**File:** `src/components/dashboard/SessionTimeline.tsx`

The `SessionTimeline` export now uses the shared **`SessionTimelineBar`** component (same as the wizard’s Phase 1 timeline) instead of the previous card-based layout. It passes `currentSessionId` for the pulse indicator on the active session.

**`CurrentSession`:** Remains as a detailed card view with `SessionCard`, showing the active session with drag-to-reorder, completion checkboxes, and nudge banners. Uses `TaskRow` component with:
- Display title resolved from Todoist task cache, falling back to `titleSnapshot`, then raw ID
- Completed tasks: 🎉 emoji + strikethrough title (not treated as stale even when absent from Todoist)
- Truly stale tasks (not in Todoist AND not completed): greyed out + ⚠ icon
- Parent intention as a small label/badge
- Checkbox toggles `TOGGLE_TASK_COMPLETE`
- Drag handle for reorder within session
- Type badge (main / background)

### 4.1.1 — SessionTimelineBar (Reusable Component)

**File:** `src/components/ui/SessionTimelineBar.tsx` — **NEW**

Extracted reusable timeline visualization used by both Step 3 (wizard) and SessionTimeline (dashboard):
- Proportionally positioned session blocks on a horizontal track
- Hour labels along the top, track line with session blocks below
- Task chips inside each session block (accent for main, muted for background)
- **Interactive mode** (optional `onSelectSession` + `selectedSessionId`): renders blocks as `<button>` with selection ring
- **Dashboard mode** (optional `currentSessionId`): renders pulse animation on the active session
- Non-interactive mode renders `<div>` blocks
- Internal utilities: `timeToMinutes()`, `formatHour()` for proportional positioning

### 4.2 — Dashboard Layout

**File:** `src/components/dashboard/Dashboard.tsx`

- **Completion counter:** `completed LinkedTasks / total LinkedTasks` (replaces intention-based counter)
- **Section order** (top to bottom):
  1. Playlist selector + Digital clock
  2. Spotify player + Transition tips
  3. **Timeline** (SessionTimelineBar) — moved up from bottom
  4. **Current Session** — moved below timeline
  5. **Task Manager** (Todoist) — collapsible, with **Linked Tasks / All Tasks toggle**
  6. **Calendar** (Google) — collapsible
- **Task Manager filter toggle:** Uses TodoistPanel's built-in `showFilterToggle defaultFiltered` props. Toggle pills rendered inside the panel header. Defaults to "Linked Tasks".

### 4.3 — Saved Sessions

**File:** `src/components/dashboard/SavedSessions.tsx`

- `validateImport()`: accept v4 format (`linkedTasks` / `taskSessions`) alongside v2/v3 formats
- On import of old formats, apply the migration chain

---

## Phase 5: TodoistPanel Enhancement

**File:** `src/components/todoist/TodoistPanel.tsx`

### 5.1 — Linking Mode

Linking props are bundled into a single optional `linking` prop:

```ts
interface LinkingProps {
    linkingIntentionId: string;
    linkedTaskIds: string[];                  // IDs linked to the current intention (highlighted)
    allLinkedTasks: LinkedTask[];             // all linked tasks across intentions (for "linked to: X" labels)
    intentionTitles: Record<string, string>;  // intentionId → title lookup
    onLinkTask: (todoistId: string) => void;
    onUnlinkTask: (todoistId: string) => void;
}

interface TodoistPanelProps {
    mode?: 'compact' | 'full';
    onSetup?: () => void;
    linking?: LinkingProps;
    /** When set, only show projects that contain tasks with these IDs (plus their ancestors). */
    filterToTaskIds?: Set<string>;
    /** Show an "All Tasks / Linked Tasks" toggle in the header. Overrides filterToTaskIds. */
    showFilterToggle?: boolean;
    /** Default state for the filter toggle (default: false = show all). */
    defaultFiltered?: boolean;
}
```

**Behavior in linking mode:**
- Task rows show **"Link"/"Unlink" text buttons** on the right (not checkboxes)
- Linked tasks have a subtle accent highlight/border (`bg-accent/5 border-l-2 border-accent`)
- CRUD operations remain available
- **Completion button stays visible** (always available, not hidden during linking)
- Tasks linked to other intentions show the owner intention's title in amber

### 5.2 — Task Tree Filtering & Internalized Filter Toggle

The `filterToTaskIds?: Set<string>` prop allows external filtering. Additionally, the panel supports a **built-in filter toggle** via `showFilterToggle` and `defaultFiltered` props:

- When `showFilterToggle` is set, the panel renders "All Tasks" / "Linked Tasks" pills in its header bar (next to the Todoist label)
- The panel computes `linkedTaskIds` internally from `plan.linkedTasks` — consumers no longer need to compute and pass this set
- The toggle is only shown when linked tasks exist (`hasLinkedTasks` guard)
- `defaultFiltered` controls the initial toggle state (default: `false` = show all tasks)

**Used by:**
- **Step 1** — `showFilterToggle` (defaults to all tasks)
- **Step 2 (Refine)** — `showFilterToggle` (defaults to all tasks)
- **Step 3 Phase 2** — `showFilterToggle defaultFiltered` (starts filtered to linked tasks)
- **Dashboard Task Manager** — `showFilterToggle defaultFiltered` (starts filtered to linked tasks)

The `filterToTaskIds` prop remains available for cases that need custom external filtering.

### 5.3 — Persistent Linked Task Indicators (post-plan)

Outside of linking mode, the TodoistPanel reads `plan.linkedTasks` and `plan.intentions` directly from `useDayPlan()` context to compute a persistent `todoistId → intention title` map. This is threaded through the component tree (`ProjectTreeNode` → `SectionGroup` → `TaskRow`) as a `persistentLinks` prop.

**Result:** Linked tasks always show their amber "linked to: {intention title}" label and accent highlight — not just during Step 1 mapping, but throughout the day and across reloads.

### 5.4 — Inline Task Editing (post-plan)

Task titles in the TodoistPanel are click-to-edit. Clicking a task title opens an inline text input:
- **Enter** or **blur** → commits the edit (calls `updateTask(taskId, { content })` via Todoist API)
- **Escape** → cancels
- `onEditContent` callback is threaded through the component tree

### 5.5 — Confetti on Task Completion (post-plan)

Completing a task fires a `canvas-confetti` burst originating from the complete button's position. Dependency: `canvas-confetti` package.

### 5.6 — Stale Task Handling (post-plan)

The TodoistPanel handles completed and deleted linked tasks through three mechanisms:

**Proactive title snapshot sync:**
- A `useEffect` runs after every successful Todoist fetch. It iterates `plan.linkedTasks` and, for each task still present in the fetched results, updates `titleSnapshot` to the current `content` via a `SYNC_TASK_SNAPSHOTS` reducer action. This ensures a displayable name is always persisted, even if the task later disappears.

**Completed tasks** are preserved in the plan:
- **`handleCompleteTask`** (in-panel completion): dispatches `TOGGLE_TASK_COMPLETE` with a `titleSnapshot` (from the Todoist cache) before calling the Todoist complete API. The task stays in `plan.linkedTasks` and remains visible in its scheduled sessions with strikethrough + 🎉 emoji.
- **Reactive cleanup** (externally-completed tasks): a one-time `useEffect` runs after the initial fetch and snapshot sync. Linked tasks that are **not in Todoist AND not already marked completed** are presumed externally completed — they are marked completed via `TOGGLE_TASK_COMPLETE` (using the already-persisted `titleSnapshot`) rather than being unlinked. This preserves session tracking.
- **Dashboard checkbox**: the SessionTimeline's completion checkbox passes the already-resolved `title` prop as `titleSnapshot`, ensuring the name is captured regardless of completion path.

**Deleted tasks** are unlinked from the plan:
- **`handleDeleteTask`** wrapper traverses the sub-task tree to find all descendants, then dispatches `UNLINK_TASK` for every affected task (handles cascade deletes).

**Title fallback chain** (used by all rendering paths):
`taskMap.get(id)?.content` → `lt.titleSnapshot` → `lt.todoistId`
This chain is applied in: SessionTimeline `TaskRow`, SessionTimeline nudge banner, `SessionTimelineBar`, Step2Refine `TaskCard`, Step3Schedule `getTaskTitle()`, and CheckInModal.

### 5.7 — Estimate-Based Schedule Auto-Fill (post-plan)

The TodoistPanel maintains an internal `estimateMap` (todoistId → estimatedMinutes) computed from `plan.linkedTasks`. When a user enters a start time in the inline time picker, the end time is automatically computed by adding the task's estimate. The auto-filled value can be manually overridden.

### 5.8 — Expose Task Lookup Map

**File:** `src/hooks/useTodoist.ts`

```ts
// Add to the hook's return value
const taskMap = useMemo(
    () => new Map(tasks.map(t => [t.id, t])),
    [tasks]
);

return { tasks, projects, sections, taskMap, /* ...existing */ };
```

Used by all components that need to resolve `todoistId` → display info.

---

## Phase 6: Migration & Backward Compatibility

### 6.1 — Migration Chain

```
v1 (tasks/taskSessions, 6-step wizard)
  → v2 (intentions/intentionSessions, 5-step wizard)  [existing]
    → v3 (same as v2, but with GoogleCalendarEntry[])  [existing]
      → v4 (linkedTasks/taskSessions, intention.linkedTaskIds, 4-step wizard)  [NEW]

`_wizardSteps` marker: `4`. Migration handles 5→4 step transition (step 4→3, step 5→4) via `migratePlan()`.
```

**v3 → v4 specifics:**
- v3 intentions have no Todoist task IDs — cannot auto-create `LinkedTask` entries
- Preserve intentions with titles and `brokenDown` state
- Initialize `linkedTasks: []`, `taskSessions: {}`
- Show one-time migration notice: *"This session was saved in an older format. Task links need to be re-established."*

### 6.2 — Import Validation

`validateImport()` in `SavedSessions.tsx` must accept all format versions and apply the migration chain on import.

---

## Files Changed

| File | Change Scope |
|------|-------------|
| `src/types/index.ts` | Add `LinkedTask`, modify `Intention`, modify `DayPlan` |
| `src/context/DayPlanContext.tsx` | New actions, remove old actions, migration, persistence |
| `src/components/wizard/Step1Intentions.tsx` | Linking mode integration with TodoistPanel |
| `src/components/wizard/Step2Refine.tsx` | **Complete rewrite** — per-intention flow with categorization + estimation (renamed from `Step2Categorize.tsx`) |
| `src/components/wizard/Step3Schedule.tsx` | **Merged** main + background scheduling with two-phase layout, phase gating (was `Step3ScheduleMain.tsx`) |
| ~~`src/components/wizard/Step4ScheduleBackground.tsx`~~ | **Deleted** — merged into Step3Schedule |
| `src/components/wizard/Step4StartMusic.tsx` | Update completion counter (was `Step5StartMusic.tsx`) |
| `src/components/ui/SessionTimelineBar.tsx` | **NEW** — reusable proportional timeline visualization |
| `src/components/todoist/TodoistPanel.tsx` | Linking mode, persistent link indicators, inline editing, confetti, internalized filter toggle, stale task auto-cleanup, estimate-based auto-fill |
| `src/hooks/useTodoist.ts` | Expose `taskMap`, `updateTask` accepts `content` field |
| `src/components/dashboard/SessionTimeline.tsx` | `SessionTimeline` uses `SessionTimelineBar`; `CurrentSession` keeps `SessionCard`/`TaskRow` |
| `src/components/dashboard/Dashboard.tsx` | Completion counter, reordered layout, Task Manager filter toggle |
| `src/components/dashboard/SavedSessions.tsx` | v4 format validation |
| `src/components/ui/EditableTaskList.tsx` | Update type signature (currently `Intention[]`) |

**No changes needed:** `src/data/sessions.ts`, `src/data/playlists.ts`

---

## Implementation Order

Recommended sequence to minimize broken intermediate states:

1. **Types** — Add `LinkedTask`, update `Intention` and `DayPlan` (everything will show errors until the reducer is updated)
2. **Reducer** — Add new actions, remove old ones, update `freshPlan()` and `migratePlan()`
3. **useTodoist** — Expose `taskMap`
4. **TodoistPanel** — Add linking mode props and checkbox rendering
5. **Step 1** — Wire up linking mode during mapping
6. **Step 2** — Rewrite for task-level categorization
7. **Step 3** — Unified schedule with two-phase layout + `SessionTimelineBar`
8. **Step 4** — Update counter (renamed from Step 5)
9. **Dashboard** — `SessionTimeline` (uses `SessionTimelineBar`), `Dashboard` (reorder + filter toggle), `SavedSessions`
10. **EditableTaskList** — Update type signature
11. **Migration testing** — v3 saved sessions → restore → verify

---

## Verification Checklist

1. **Type safety:** `tsc --noEmit` — zero errors
2. **Migration:** Restore a v3 saved session in v4 → migration notice, intentions preserved, no crash
3. **Linking flow:** Map intention → check 3 tasks → "Done" → verify 3 `LinkedTask` entries with correct `intentionId`
4. **Unlinking:** Uncheck a task during mapping → verify removal from `linkedTasks`
5. **Cross-intention linking:** Link a task to Intention A, then to B → verify it moves
6. **Categorization:** Categorize all tasks in Step 2 → `canAdvance` unblocks
7. **Stale tasks:** Delete task in Todoist → return to Orchestrate → stale indicator visible, manual remove works
8. **Scheduling exclusivity:** Main task exclusive to one session; background task in multiple sessions
9. **Dashboard:** Tasks grouped under intention headers, completion toggles, drag reorder
10. **Save/restore cycle:** Full wizard → save → new day → restore → all links and schedules intact
11. **Lint:** `eslint` — no new warnings

---

## Post-Implementation UX Iterations

The following changes were made after the core v4 implementation, refining the UX based on hands-on usage:

| # | Change | Location | Details |
|---|--------|----------|---------|
| 1 | **Link/Unlink text buttons** | TodoistPanel `TaskRow` | Replaced planned checkboxes with "Link"/"Unlink" text buttons. Less intrusive, hover-revealed for unlinked tasks. Completion button stays always visible. |
| 2 | **Inline task editing** | TodoistPanel `TaskRow` | Click task title to edit in-place. Commits on Enter/blur, cancels on Escape. `useTodoist.updateTask` now accepts `content` field. |
| 3 | **Restart mapping** | Step1Intentions Phase 2 | "Want to start over? Restart mapping" — standalone text link at bottom of Phase 2. Resets all intentions' `brokenDown` flags to `false`. |
| 4 | **Individual remap** | Step1Intentions Phase 2 | Each mapped intention is clickable to individually remap (sets its own `brokenDown` back to `false`). |
| 5 | **Edit intentions navigation** | Step1Intentions Phase 2 | "← Want to change intentions?" subtle text link above mapping progress, returns to Phase 1 for intention editing. |
| 6 | **Confetti on completion** | TodoistPanel `TaskRow` | `canvas-confetti` burst on the complete button click, originating from button position. New dependency: `canvas-confetti`. |
| 7 | **Persistent linked task indicators** | TodoistPanel | Reads `plan.linkedTasks` + `plan.intentions` from `useDayPlan()` context. Computes `persistentLinks` map (todoistId → intention title) via `useMemo`. Threaded through component tree. Amber "linked to: {title}" label and accent highlight show at all times — not just during linking mode. Survives reloads via localStorage persistence. |
| 8 | **Merged Step 3 + Step 4** | Wizard | Combined main and background scheduling into a single Step 3 with a two-phase layout. Wizard reduced from 5 to 4 steps. File renames: `Step3ScheduleMain.tsx` → `Step3Schedule.tsx`, `Step5StartMusic.tsx` → `Step4StartMusic.tsx`. `Step4ScheduleBackground.tsx` deleted. `WizardLayout` updated: `TOTAL_STEPS=4`, labels `['Intentions','Refine','Schedule','Music']`. |
| 9 | **SessionTimelineBar** | `ui/SessionTimelineBar.tsx` | Extracted reusable proportional timeline from Step3Schedule. Used by both the wizard (interactive mode with `onSelectSession`) and the dashboard (read-only with `currentSessionId` pulse). |
| 10 | **TodoistPanel tree filtering** | TodoistPanel | New `filterToTaskIds` prop with `pruneTree()` utility. Prunes project tree to only show projects containing specified task IDs. |
| 11 | **Dashboard layout reorder** | Dashboard | Timeline moved after music rows, Current Session below timeline. Task Manager and Calendar remain collapsible at bottom. |
| 12 | **Internalized filter toggle** | TodoistPanel | "All Tasks" / "Linked Tasks" toggle pills moved into the TodoistPanel header via `showFilterToggle` and `defaultFiltered` props. Panel computes `linkedTaskIds` internally. Consumers (Step1, Step2, Step3, Dashboard) simplified — no longer manage filter state externally. |
| 13 | **Step 2 rename** | Wizard | `Step2Categorize.tsx` → `Step2Refine.tsx`, WizardLayout label "Categorize" → "Refine". Reflects combined categorization + estimation purpose. |
| 14 | **Step 3 phase gating** | Step3Schedule | "Schedule times →" button disabled until tasks are assigned. Music step pill and Continue button hidden until phase 2 is reached. |
| 15 | **Estimate-based auto-fill** | TodoistPanel | When entering a start time in the schedule picker, end time is auto-computed from the task's `estimatedMinutes`. Internal `estimateMap` computed from `plan.linkedTasks`. |
| 16 | **Stale task auto-cleanup** | TodoistPanel | Deleting a task in the panel dispatches `UNLINK_TASK`. Handles sub-task cascade for deletes. |
| 17 | **Completed task preservation** | TodoistPanel, SessionTimeline, types, reducer | Completing a task (via panel, dashboard checkbox, or externally) marks it completed with `titleSnapshot`. Task remains in `plan.linkedTasks` and shows in its scheduled sessions with strikethrough + 🎉. |
| 18 | **Proactive title snapshot sync** | TodoistPanel, DayPlanContext | New `SYNC_TASK_SNAPSHOTS` action bulk-updates `titleSnapshot` for all linked tasks on every Todoist fetch. Title fallback chain (`taskMap` → `titleSnapshot` → `todoistId`) applied across all rendering paths: SessionTimeline, SessionTimelineBar, Step2Refine, Step3Schedule, CheckInModal. Reactive cleanup marks missing non-completed tasks as completed (instead of unlinking) to handle external completions. |

### Dependencies Added

- `canvas-confetti` — lightweight confetti animation library (used for task completion celebration)

---

## Open Considerations

1. ~~**Offline fallback:**~~ **Implemented** — `titleSnapshot` field added to `LinkedTask`. Proactively synced on every Todoist fetch via `SYNC_TASK_SNAPSHOTS` action. Also captured on in-panel completion and from the dashboard checkbox. Used as display fallback across all rendering paths (SessionTimeline, SessionTimelineBar, Step2Refine, Step3Schedule, CheckInModal) when a task is no longer in the Todoist cache.

2. **Re-linking in edit mode:** Returning to Step 1 from the dashboard should reflect current link state and allow modifications without losing scheduling data for unchanged links. Needs careful state management.

3. **Performance:** Memoize `taskMap` computation (`useMemo` on `tasks` array). Link/Unlink button rendering in TodoistPanel should remain efficient for large task lists — avoid re-renders on unrelated state changes.

---
---

# Orchestrate v4.1 — Step 2 Time Estimation & Per-Intention Flow

## Overview

Redesign Step 2 (Categorize) from a flat "categorize all at once" view into a **per-intention sequential flow** that combines categorization, time estimation, and optional task breakdown — with the TodoistPanel on the right for creating sub-tasks on the fly.

### Motivation

The v4 scheduling flow (Step 3) asks users to assign tasks to sessions, but time estimation is implicit — users must mentally gauge whether tasks fit into session slots. This creates friction and often leads to over-packed sessions. By explicitly prompting for time estimates *before* scheduling, users arrive at Step 3 with concrete data that informs better session assignments.

Additionally, tasks estimated at over an hour are likely too coarse-grained for effective scheduling. The new flow nudges users to break these down into smaller parts via the TodoistPanel, which is already available for task creation.

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Breakdown behavior | Original task stays linked; sub-tasks are created alongside | User retains the parent context; sub-tasks become their own schedulable units |
| Estimate storage | Orchestrate only (`LinkedTask.estimatedMinutes`) | Estimates are planning data, not Todoist metadata; avoids API writes |
| Phase structure | Combined per-intention loop | Categorize + estimate together per intention reduces context-switching |
| Background task cap | Max 30 min per estimate | Background tasks are nudges/habits — short by nature; can be scheduled multiple times/day |
| >1hr nudge | Advisory, not blocking | User is invited to break down but can proceed without splitting |
| Estimate input | Quick-select preset pills + custom number input | Presets (15m, 30m, 45m, 1hr) reduce friction; custom covers edge cases |

---

## Phase 1: Data Model Changes

**File:** `src/types/index.ts`

### 1.1 — Extend `LinkedTask`

Add an optional time estimate field:

```ts
export interface LinkedTask {
    todoistId: string;
    intentionId: string;
    type: 'main' | 'background' | 'unclassified';
    assignedSessions: string[];
    completed: boolean;
    isHabit: boolean;
    estimatedMinutes: number | null;              // NEW — null = not yet estimated
    titleSnapshot?: string;                       // cached title for completed tasks no longer in Todoist
}
```

---

## Phase 2: Reducer & Context Changes

**File:** `src/context/DayPlanContext.tsx`

### 2.1 — New Action

| Action | Payload | Behavior |
|--------|---------|----------|
| `SET_TASK_ESTIMATE` | `{ todoistId: string; minutes: number }` | Updates `LinkedTask.estimatedMinutes` for the matching task |

Add to the `Action` union type.

### 2.2 — Update Existing Actions

- **`LINK_TASK`**: Initialize `estimatedMinutes: null` when creating a new `LinkedTask` entry.

### 2.3 — Migration

Existing `LinkedTask` entries (from v4 plans saved before this change) that lack `estimatedMinutes` should default to `null` during `migratePlan()`. Since `null` is the "not yet estimated" sentinel, this is safe — users will be prompted to provide estimates on their next session.

---

## Phase 3: Step 2 Rewrite

**File:** `src/components/wizard/Step2Refine.tsx` (renamed from `Step2Categorize.tsx`)

### 3.1 — Layout

Two-column flex layout mirroring Step 1 Phase 2:

```
┌──────────────────────────────────────────────────────────┐
│  Progress: "Intention 2 of 5"                            │
├────────────────────────┬─────────────────────────────────┤
│  Left panel (40%)      │  Right panel (60%)              │
│                        │                                 │
│  Intention title       │  TodoistPanel                   │
│  ─────────────────     │  (full mode, linking enabled    │
│  Task 1               │   for current intention)        │
│    [Main] [Background] │                                 │
│    ⏱ [15m][30m][45m][1h][__] │                          │
│    ⚠ "Over an hour..." │                                 │
│  Task 2               │                                 │
│    [Main] [Background] │                                 │
│    ⏱ [15m][30m][45m][1h][__] │                          │
│  ...                   │                                 │
│                        │                                 │
│  [← Prev] [Done → Next intention]                       │
└────────────────────────┴─────────────────────────────────┘
```

- **Left panel** (`lg:w-[40%]`): per-intention task list with categorization + estimation
- **Right panel** (`flex-1`): TodoistPanel in full mode with linking enabled for the current intention

### 3.2 — Per-Intention Sequential Flow

Internal state:

```ts
const [currentIntentionIndex, setCurrentIntentionIndex] = useState(0);
```

- **Progress indicator**: "Intention 2 of 5" at the top of the left panel
- **"Done — next intention →"** button advances `currentIntentionIndex`; on last intention, advances to Step 3
- **"← Previous intention"** link to go back (hidden on first intention)

### 3.3 — Left Panel Per Intention

For each linked task under the current intention:

1. **Task title** — resolved from `taskMap`; stale indicator if not found
2. **Main / Background pills** — categorization (existing behavior)
3. **Habit toggle (🔄)** — shown when type is `background` (existing behavior)
4. **Time estimate input**:
   - **Preset pills**: `15m`, `30m`, `45m`, `1hr` — one-click selection
   - **Custom input**: small numeric field for arbitrary minutes
   - Selected preset or custom value is highlighted
   - **Background tasks**: input clamped at max 30 min; if user attempts >30, show validation: *"Background tasks are capped at 30 min per scheduling (they can be scheduled multiple times)"*
   - **Estimate > 60 min**: amber nudge banner below the task — *"This task is over an hour. Consider breaking it into smaller parts using the task panel →"*. Non-blocking — user can proceed.
5. **Stale task handling** — greyed out, ⚠ icon, "Remove" button (existing behavior)

### 3.4 — Right Panel (TodoistPanel)

Same pattern as Step 1 Phase 2:

```tsx
<TodoistPanel
    mode="full"
    onSetup={() => setShowSetup(true)}
    linking={{
        linkingIntentionId: currentIntention.id,
        linkedTaskIds: currentIntention.linkedTaskIds,
        allLinkedTasks: plan.linkedTasks,
        intentionTitles: intentionTitleMap,
        onLinkTask: (todoistId) => dispatch({ type: 'LINK_TASK', intentionId: currentIntention.id, todoistId }),
        onUnlinkTask: (todoistId) => dispatch({ type: 'UNLINK_TASK', todoistId }),
    }}
/>
```

This allows users to:
- **Create new sub-tasks** in Todoist when a task is too large
- **Link newly created tasks** to the current intention
- **See persistent link indicators** for tasks linked to other intentions

### 3.5 — Advancement Logic

The internal "Done — next intention" button validates that all linked tasks for the **current intention** are categorized and estimated before advancing. The WizardLayout's `canAdvance` checks all intentions globally.

```ts
const canAdvanceIntention = currentLinkedTasks.length > 0 &&
    currentLinkedTasks.every(lt => lt.type !== 'unclassified' && lt.estimatedMinutes !== null);

const canAdvanceStep = plan.linkedTasks.length > 0 &&
    plan.linkedTasks.every(lt => lt.type !== 'unclassified' && lt.estimatedMinutes !== null);
```

Intentions with **0 linked tasks**: show *"No tasks linked to this intention"* message with prompt to link tasks via the TodoistPanel on the right.

---

## Phase 4: Step 3 Estimate Display

**File:** `src/components/wizard/Step3Schedule.tsx`

### 4.1 — Assign Phase Enhancements

- **Task chips** in the unassigned pool and session detail show estimated minutes: `"Implement API — 45m"`
- **Session capacity indicator**: For the selected session, show total estimated time for assigned tasks vs. session slot duration (computed from `settings.sessionSlots` start/end times). Example: `"2h 15m / 4h scheduled"`
- **Over-capacity warning**: Soft amber warning when assigned estimates exceed session duration — *"Assigned tasks exceed session time by 45m"*

### 4.2 — Background Task Display

Background task chips show estimate with a `×N` multiplier if assigned to multiple sessions: `"Reading — 30m ×3"`

---

## Phase 5: Dashboard Estimate Display

**Files:** `src/components/dashboard/SessionTimeline.tsx`, `src/components/dashboard/Dashboard.tsx`

### 5.1 — TaskRow in CurrentSession

- Show estimated minutes as a small badge next to the task title: `"45m"`

### 5.2 — Session Header

- Show total estimated time for the session's tasks vs. session slot duration

---

## Files Changed

| File | Change Scope |
|------|-------------|
| `src/types/index.ts` | Add `estimatedMinutes` to `LinkedTask` |
| `src/context/DayPlanContext.tsx` | New `SET_TASK_ESTIMATE` action, update `LINK_TASK` initializer, migration for missing field |
| `src/components/wizard/Step2Refine.tsx` | **Complete rewrite** — per-intention flow with categorization + estimation + TodoistPanel (renamed from `Step2Categorize.tsx`) |
| `src/components/wizard/Step3Schedule.tsx` | Estimate badges on task chips, session capacity indicator, phase gating, estimate auto-fill via TodoistPanel |
| `src/components/dashboard/SessionTimeline.tsx` | Estimate badge on TaskRow |
| `src/components/dashboard/Dashboard.tsx` | Session total estimate display |
| `src/components/todoist/TodoistPanel.tsx` | Internalized filter toggle (`showFilterToggle`/`defaultFiltered`), `estimateMap` for auto-fill, stale task auto-cleanup |

**No changes needed:** `src/hooks/useTodoist.ts` (reuse existing linking mode)

---

## Implementation Order

1. **Types** — Add `estimatedMinutes` to `LinkedTask`
2. **Reducer** — `SET_TASK_ESTIMATE` action, `LINK_TASK` initializer, migration
3. **Step 2** — Complete rewrite with per-intention flow, estimation UI, TodoistPanel integration
4. **Step 3** — Estimate badges and session capacity indicators (parallel with Step 2)
5. **Dashboard** — Estimate display in TaskRow and session headers (parallel with Step 2)

---

## Verification Checklist

1. **Type safety:** `tsc --noEmit` — zero errors
2. **New field initialization:** Link a task in Step 1 → verify `estimatedMinutes: null` in state
3. **Per-intention flow:** Navigate through all intentions in Step 2 → categorization + estimation persists across navigation
4. **Background 30min cap:** Set type to background, enter >30 → verify input clamps with validation message
5. **>1hr nudge:** Enter 75 min estimate → verify amber nudge appears, user can still proceed
6. **Task breakdown:** From the nudge, create sub-tasks in TodoistPanel, link them → verify they appear under the same intention with their own estimate fields
7. **Advancement guard:** Step 2 blocks advancement until all tasks are categorized AND estimated
8. **Step 3 display:** Verify estimate badges on task chips and session capacity indicator
9. **Migration:** Load a v4 plan saved before this change (no `estimatedMinutes` on LinkedTasks) → no errors, estimates default to `null`
10. **Persistence:** Set estimates, refresh page → verify they persist from localStorage
11. **Session capacity:** Assign tasks totaling >session duration → verify soft over-capacity warning
12. **Phase gating:** Cannot advance to phase 2 without task assignments; cannot advance to Music step without reaching phase 2
13. **Schedule auto-fill:** Enter start time for a task with an estimate → verify end time auto-fills based on `estimatedMinutes`
14. **Completed task preservation (in-panel):** Complete a linked task in the TodoistPanel → verify it stays in `plan.linkedTasks` with `completed: true` and `titleSnapshot` set. Verify it shows in its session with strikethrough + 🎉.
15. **Completed task preservation (external):** Complete a linked task in the Todoist app → refresh Orchestrate → verify the task is auto-marked completed (not unlinked), retains `titleSnapshot` from the previous sync, and still shows in its session.
16. **Filter toggle:** Verify "All Tasks" / "Linked Tasks" toggle appears in TodoistPanel header across Step 1, Step 2, Step 3, and Dashboard
17. **Title snapshot sync:** Link tasks, verify `titleSnapshot` is populated after Todoist fetch. Rename a task in Todoist, refresh → verify `titleSnapshot` updates.

## Plan: Orchestrate v4.2 — TodoistProvider Shared Data Layer

Lift `useTodoist` from a standalone hook (N independent fetch cycles) into a single `TodoistProvider` React context with request deduplication, staleness windowing, localStorage cache for offline resilience, and smart focus refresh. Eliminates up to 12 duplicate API calls on Dashboard load.

---

**Steps**

### Phase 1: TodoistContext + Provider (core)
1. Create `src/context/TodoistContext.tsx` — **NEW** file. Split into `TodoistDataContext` (tasks, projects, sections, taskMap, loading, error, isConfigured) and `TodoistActionsContext` (CRUD + refresh functions). Provider holds single `useState` for all data, single fetch lifecycle, single `window.focus` listener.
2. Nest inside DayPlanProvider in App.tsx: `DayPlanProvider > TodoistProvider > AppRoutes`
3. Refactor useTodoist.ts to thin context consumers: `useTodoistData()` for read-only, `useTodoistActions()` for mutations, `useTodoist()` as combined convenience hook. Keep types (`TodoistTask`, `TodoistProject`, `TodoistSection`) and `validateTodoistToken` here.

### Phase 2: Request deduplication + staleness (*built into Phase 1*)
4. `inflightRef` pattern — concurrent calls to the same refresh function return the existing promise instead of firing a duplicate. *Parallel with step 5*
5. `lastFetchedAt` timestamps per resource — skip refresh if last success was <30s ago. `{ force: true }` parameter overrides for manual refresh button.

### Phase 3: localStorage cache (*depends on Phase 1*)
6. Persist `{ tasks, projects, sections, fetchedAt }` to `orchestrate-todoist-cache` after each successful fetch
7. Hydrate from cache on provider mount (instant render). If cache <5min old, skip initial fetch. Otherwise, background fetch **without loading spinner** (stale-while-revalidate).

### Phase 4: Move data reconciliation to provider (*depends on Phase 1*)
8. Move `SYNC_TASK_SNAPSHOTS` effect from TodoistPanel.tsx into `TodoistProvider` — provider has access to both Todoist data and DayPlan `dispatch`
9. Move stale task cleanup (one-time missing-task-as-completed marking) from TodoistPanel into `TodoistProvider`
10. Remove both effects (`hasSyncedSnapshots`, `hasCleanedUp`) from TodoistPanel

### Phase 5: Update consumers (*depends on Phases 1–4*)
11. TodoistPanel.tsx — replace `useTodoist()` with `useTodoistData()` + `useTodoistActions()`. Manual refresh passes `{ force: true }`.
12. Step2Refine.tsx, Step3Schedule.tsx — replace `useTodoist()` with `useTodoistData()` (only needs `taskMap`). *Parallel with steps 13–14*
13. SessionTimeline.tsx (both `SessionTimeline` + `CurrentSession`) — replace with `useTodoistData()`
14. CheckInModal.tsx — replace with `useTodoistData()`

### Phase 6: Smart focus refresh (*built into Phase 1*)
15. Single `window.focus` listener in the provider. Only refreshes **tasks** on focus (projects/sections rarely change mid-session). Respects 30s staleness window. Silent background fetch — no loading spinner if cached data exists.

---

**Relevant files**

- `src/context/TodoistContext.tsx` — **NEW** — provider with shared state, split contexts, cache, dedup, reconciliation effects
- useTodoist.ts — gut implementation → thin re-exports from context; keep types and `validateTodoistToken`
- App.tsx — add `<TodoistProvider>` nesting
- TodoistPanel.tsx — remove reconciliation effects, switch to context consumers
- Step2Refine.tsx — `useTodoist()` → `useTodoistData()`
- Step3Schedule.tsx — `useTodoist()` → `useTodoistData()`
- SessionTimeline.tsx — 2× `useTodoist()` → `useTodoistData()`
- CheckInModal.tsx — `useTodoist()` → `useTodoistData()`
- DayPlanContext.tsx — reference for provider pattern only; **no changes**

**No changes needed:** index.ts, `src/data/*`, wizard logic, DayPlanContext reducer

---

**Verification**

1. `tsc --noEmit` — zero errors
2. Dashboard with Task Manager open → Network tab shows exactly **3 API calls** (not 12)
3. Navigate Step 1 → Step 2 → Step 3 → no additional fetches (shared context)
4. Tab away and back within 30s → no fetch. >30s → single background tasks fetch
5. Manual refresh button → force-fetches all 3 resources regardless of staleness
6. Kill network → reload → cached data renders immediately, no spinner; error banner on failed refresh
7. Complete task in TodoistPanel → SessionTimeline + CurrentSession reflect change immediately
8. Create task in Step 1 → Step 2 shows it without refetch
9. `SYNC_TASK_SNAPSHOTS` fires after fetches (from provider, not panel)
10. Stale task cleanup still marks missing tasks as completed on first load
11. Stale-while-revalidate: with cached data, reload → instant render, silent background refresh
12. Rapid focus events → Network shows only 1 request per resource (dedup)

---

**Decisions**

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Split vs single context | Two contexts (data + actions) | Prevents action ref changes from re-rendering read-only consumers |
| Provider nesting | `TodoistProvider` inside `DayPlanProvider` | Needs `settings` for API token and `dispatch` for snapshot sync |
| Cache TTL | 5min (hydration-skip), 30s (focus-skip) | Reasonably fresh without obsessive fetching |
| Focus refresh scope | Tasks only (not projects/sections) | Projects/sections rarely change mid-session |
| Reconciliation scope | Global (provider-level) | Snapshots should always be fresh, even without TodoistPanel mounted |
| useTodoist.ts | Kept as thin re-export | Backward compat; can inline later |
| Loading spinner | Only when no cached data AND fetch in progress | Stale-while-revalidate avoids loading flash |

---

## v4.3 — Completed Task Visibility in Wizard Steps

### Problem

Completed linked tasks (strikethrough + 🎉) display correctly in the dashboard's `SessionTimeline` and `CurrentSession` components, but the wizard steps have no awareness of completion state:

- **Step 1 (Intentions):** The "X tasks linked" counter doesn't distinguish completed tasks.
- **Step 2 (Refine):** The `TaskCard` renders full categorization/estimation controls for completed tasks. The `canAdvanceStep` and `canAdvanceIntention` checks require _all_ tasks to be categorized and estimated — blocking progress if any completed task hasn't been categorized.
- **Step 3 (Schedule):** Completed tasks appear in the unassigned/assigned chip lists as normal tasks, remaining interactive (assignable/unassignable) even though scheduling a completed task is meaningless.

### Changes

**Step 1: `Step1Intentions.tsx`**
- The "X tasks linked" line in the current mapping intention card now shows a completed count when > 0: `"3 tasks linked (🎉 1 completed)"`.

**Step 2: `Step2Refine.tsx`**
- **Advancement checks:** Both `canAdvanceStep` and `canAdvanceIntention` now exempt completed tasks from the `type !== 'unclassified' && estimatedMinutes !== null` requirement. A completed task always passes the gate.
- **TaskCard:** When `linkedTask.completed` is true, the card renders a compact read-only row (🎉 + strikethrough title + "Completed" badge) instead of the full categorization/estimation form. No main/background pills, no time estimate controls.

**Step 3: `Step3Schedule.tsx`**
- **Task filtering:** `mainTasks` and `backgroundTasks` now exclude completed tasks (`!lt.completed`). A new `completedTasks` list is derived separately.
- **Completed summary:** A "Completed" section renders above the unassigned tasks area, showing completed tasks as strikethrough chips with 🎉 emoji and a green-tinted style.
- **Scheduling exclusion:** Completed tasks do not appear in the session detail panel (assigned/unassigned lists), so they cannot be assigned or unassigned.
- **All-completed edge case:** If every linked task is completed, the wizard allows skipping directly to Step 4 (Music) — the "Continue" button becomes visible and `canAdvance` is true even in Phase 1.

### Verification
1. Complete a linked task in the TodoistPanel during Step 1 → verify "🎉 1 completed" appears in the intention card
2. Navigate to Step 2 → verify completed task shows compact row (strikethrough, no controls)
3. Verify Step 2 advancement is not blocked by completed tasks that lack categorization/estimate
4. Navigate to Step 3 → verify completed tasks appear in the "Completed" summary section with green styling
5. Verify completed tasks do not appear in session assignment panel (cannot be assigned)
6. Complete all linked tasks → verify Step 3 allows direct advancement to Step 4