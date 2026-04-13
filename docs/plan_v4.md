# Orchestrate v4 — Task-Level Data Model Refactor

## Overview

Shift Orchestrate's unit of scheduling and categorization from **intentions** to **Todoist tasks**. Intentions remain as high-level grouping headers, but individual tasks linked during Step 1 mapping become the primary items that are categorized (main/background) in Step 2 and scheduled into sessions in Steps 3–4.

This requires changes to the data model, reducer, all 5 wizard steps, the TodoistPanel, and the dashboard.

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
| Task tracking during mapping | Explicit checkbox selection in Todoist panel | More reliable than snapshot-diffing; handles create/delete cycles cleanly |
| Scheduling granularity | Tasks grouped under parent intentions | Preserves context about why each task exists |
| Categorization level | Task-level only (remove intention-level type) | An intention can have both main and background tasks |
| Task data storage | Store only Todoist task IDs; fetch titles from API at runtime | Always current; single source of truth in Todoist |
| Stale task handling | Greyed out + ⚠ icon; user removes manually | User stays in control; no silent data loss |
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
| `TOGGLE_TASK_COMPLETE` | `{ todoistId }` | Toggles `LinkedTask.completed` |
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
- The **TodoistPanel** on the right enters **linking mode** (new `linkingIntentionId` prop)
- Each task row gains a **checkbox** on the left side
- **Checked** = linked to the current intention → dispatches `LINK_TASK`
- **Unchecked** = unlinked → dispatches `UNLINK_TASK`
- Tasks already linked to this intention are **pre-checked** (read from `plan.linkedTasks`)
- Tasks linked to **other** intentions show a label `"(linked to: {intention title})"` and are still checkable (re-linking moves them)
- "Done — next" still marks `MARK_BROKEN_DOWN` and advances to the next intention
- CRUD operations (create/delete tasks) remain available alongside linking

### 3.2 — Step 2: Categorize

**File:** `src/components/wizard/Step2Categorize.tsx` — **Complete rewrite**

- Intentions render as **collapsible card sections** (heading = intention title)
- Under each intention: list of linked tasks (titles resolved via Todoist task cache)
  - Each task has **main / background** radio pills
  - Background tasks show a **habit toggle** (🔄)
- **Stale tasks** (Todoist ID not found in API response): greyed out, ⚠ icon, "Remove" button
- Intentions with **0 linked tasks**: show "No tasks linked" message with a prompt to go back to Step 1
- **`canAdvance`:** All linked tasks across all intentions must have `type !== 'unclassified'`

### 3.3 — Step 3: Schedule Main Tasks

**File:** `src/components/wizard/Step3ScheduleMain.tsx`

- Filter `plan.linkedTasks` by `type === 'main'`
- Group tasks by parent intention (using `intentionId`)
- **Session cards** show assignable tasks grouped under intention headers
- Main tasks are **exclusive** to one session (assigning to a new session removes from the old one)
- **Layout:** Left panel = session cards with assign/unassign per task. Right panel = TodoistPanel (compact) + GoogleCalendarEmbed below.

### 3.4 — Step 4: Schedule Background Tasks

**File:** `src/components/wizard/Step4ScheduleBackground.tsx`

- Filter `plan.linkedTasks` by `type === 'background'`
- Group tasks by parent intention
- Background tasks can be assigned to **multiple sessions** (nudge pattern)
- Session cards show **main tasks as read-only context** (greyed) plus assignable background tasks
- **Nudge banner** at top: lists all unscheduled background tasks

### 3.5 — Step 5: Start Music

**File:** `src/components/wizard/Step5StartMusic.tsx`

- Minor: update completion counter to count **linked tasks** instead of intentions

---

## Phase 4: Dashboard Changes

### 4.1 — Session Timeline

**File:** `src/components/dashboard/SessionTimeline.tsx`

**`IntentionRow` → `TaskRow` refactor:**
- Resolve display title from Todoist task cache (not from local data)
- Show **stale indicator** if task not found in cache
- Show **parent intention** as a small label/badge
- Checkbox toggles `TOGGLE_TASK_COMPLETE`
- Drag handle for reorder within session
- Type badge (main / background)

**`SessionCard`:**
- Tasks **grouped under intention headers** within each session
- Background nudges banner reads from background tasks (not intentions)

**`CurrentSession`:** Same structure, backed by task-level data.

### 4.2 — Dashboard

**File:** `src/components/dashboard/Dashboard.tsx`

- **Completion counter:** `completed LinkedTasks / total LinkedTasks` (replaces intention-based counter)

### 4.3 — Saved Sessions

**File:** `src/components/dashboard/SavedSessions.tsx`

- `validateImport()`: accept v4 format (`linkedTasks` / `taskSessions`) alongside v2/v3 formats
- On import of old formats, apply the migration chain

---

## Phase 5: TodoistPanel Enhancement

**File:** `src/components/todoist/TodoistPanel.tsx`

### 5.1 — Linking Mode

New props for linking mode:

```ts
interface TodoistPanelProps {
    mode: 'full' | 'compact';
    // NEW — linking mode props
    linkingIntentionId?: string;          // when set, enables checkbox selection mode
    linkedTaskIds?: string[];             // IDs currently linked to this intention (pre-checked)
    allLinkedTasks?: LinkedTask[];         // for showing "(linked to: X)" labels
    onLinkTask?: (todoistId: string) => void;
    onUnlinkTask?: (todoistId: string) => void;
}
```

**Behavior in linking mode:**
- Task rows show checkboxes (left side)
- Linked tasks have a subtle highlight/border
- CRUD operations remain available
- Task completion toggle is hidden (linking is the primary interaction)
- Tasks linked to other intentions show the owner intention's title

### 5.2 — Expose Task Lookup Map

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
      → v4 (linkedTasks/taskSessions, intention.linkedTaskIds)  [NEW]
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
| `src/components/wizard/Step2Categorize.tsx` | **Complete rewrite** — task-level categorization |
| `src/components/wizard/Step3ScheduleMain.tsx` | Schedule tasks (grouped by intention) |
| `src/components/wizard/Step4ScheduleBackground.tsx` | Schedule background tasks |
| `src/components/wizard/Step5StartMusic.tsx` | Update completion counter |
| `src/components/todoist/TodoistPanel.tsx` | Add linking mode (checkboxes, highlighting) |
| `src/hooks/useTodoist.ts` | Expose `taskMap` |
| `src/components/dashboard/SessionTimeline.tsx` | `TaskRow` refactor, intention-grouped layout |
| `src/components/dashboard/Dashboard.tsx` | Update completion counter |
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
7. **Steps 3–4** — Refactor to schedule tasks instead of intentions
8. **Step 5** — Update counter
9. **Dashboard** — `SessionTimeline`, `Dashboard`, `SavedSessions`
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

## Open Considerations

1. **Offline fallback:** When Todoist API is unreachable, linked tasks show only IDs (no titles). Consider adding a `titleSnapshot` field to `LinkedTask` — refreshed on every successful fetch, used as fallback display. Small addition but significantly improves resilience. *Decision deferred to implementation.*

2. **Re-linking in edit mode:** Returning to Step 1 from the dashboard should reflect current link state and allow modifications without losing scheduling data for unchanged links. Needs careful state management.

3. **Performance:** Memoize `taskMap` computation (`useMemo` on `tasks` array). Checkbox rendering in TodoistPanel should remain efficient for large task lists — avoid re-renders on unrelated state changes.
