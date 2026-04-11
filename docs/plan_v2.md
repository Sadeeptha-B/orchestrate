## Plan: Orchestrate v2 — Intentions & Todolist Integration

This plan describes the changes needed for Iteration 2, building on top of the existing v1 architecture. The core shift: **tasks become intentions**, and the app gains an embedded Trevor AI iframe for todolist/calendar management. Background tasks become flexible nudges/habits with multi-session assignment.

---

### Conceptual Shift

| v1 Concept | v2 Concept |
|-----------|-----------|
| Tasks (generic items) | **Intentions** (specific goals for today, not epics) |
| Step 2: checklist nudge | Step 2: **intention → todolist mapping** via embedded Trevor AI |
| Step 4: assign main tasks to slots | Step 4: schedule with Trevor AI iframe visible for drag-scheduling |
| Background tasks: single-session | Background tasks: **multi-session nudges/habits**, flexible scheduling |
| Dashboard: music + timeline | Dashboard: music + timeline + **Trevor AI iframe** |

The key insight: todo lists tend to be "epics". Intentions are the day's specific goals that *map to* those epics. Step 2 bridges the gap by having the user break down intentions into actionable tasks in their external todolist.

---

### Data Model Changes

#### Rename: Task → Intention (gradual)

Rename the `Task` interface to `Intention` and update the `type` field to reflect the new semantics:

```ts
export interface Intention {
    id: string;
    title: string;
    type: 'main' | 'background' | 'unclassified';
    assignedSessions: string[];  // was: assignedSession?: string (now array for multi-assign)
    completed: boolean;
    brokenDown: boolean;         // NEW — tracked in Step 2 (user confirms they've broken this down)
    isHabit: boolean;            // NEW — background tasks can optionally be flagged as habits
}
```

**Key changes:**
- `assignedSession?: string` → `assignedSessions: string[]` — allows a single intention (especially background) to appear in multiple session slots.
- `brokenDown: boolean` — the user marks each intention as "broken down" in Step 2 after decomposing it into tasks in Trevor AI. This is a self-reported flag, not validated against the iframe.
- `isHabit: boolean` — distinguishes recurring habits from one-off background tasks. Habits get extra nudge treatment on the dashboard.

#### DayPlan updates

```ts
export interface DayPlan {
    date: string;
    intentions: Intention[];     // was: tasks: Task[]
    intentionSessions: Record<string, string[]>; // was: taskSessions
    wizardStep: number;
    setupComplete: boolean;
    checkIns: CheckIn[];
    syncChecklist: Record<string, boolean>;
}
```

> **Migration note**: On load, if the stored plan has `tasks` instead of `intentions`, map it to the new shape. `assignedSession` (string) → `assignedSessions` (array wrapping the old value). Default `brokenDown: false`, `isHabit: false`.

---

### Reducer Action Changes

| Action | Change |
|--------|--------|
| `ADD_TASK` → `ADD_INTENTION` | Renamed. Creates with `assignedSessions: []`, `brokenDown: false`, `isHabit: false` |
| `REMOVE_TASK` → `REMOVE_INTENTION` | Renamed. Cleans up `intentionSessions` |
| `UPDATE_TASK` → `UPDATE_INTENTION` | Renamed |
| `CATEGORIZE_TASK` → `CATEGORIZE_INTENTION` | Renamed |
| `ASSIGN_TASK` → `ASSIGN_INTENTION` | **Changed behavior**: for `background` type, push to `assignedSessions` without removing from other sessions. For `main` type, keep existing exclusive-session behavior |
| `UNASSIGN_TASK` → `UNASSIGN_INTENTION` | Renamed. Removes session from `assignedSessions` array |
| `TOGGLE_TASK_COMPLETE` → `TOGGLE_INTENTION_COMPLETE` | Renamed |
| `REORDER_TASKS` → `REORDER_INTENTIONS` | Renamed |
| `REORDER_SESSION_TASKS` → `REORDER_SESSION_INTENTIONS` | Renamed |
| **NEW** `MARK_BROKEN_DOWN` | `{ intentionId: string; brokenDown: boolean }` — toggle the breakdown flag in Step 2 |
| **NEW** `TOGGLE_HABIT` | `{ intentionId: string }` — toggle the `isHabit` flag on a background intention |

---

### Wizard Flow Changes

The wizard stays at 6 steps, but Steps 2, 4, 5 are redesigned:

#### Step 1: Set Daily Intentions (was "Priorities")

- **Reword** heading: "What are your intentions for today?" (not "tasks" or "priorities")
- **Subtext** explains the difference: intentions are specific goals, not epics
- Input and `EditableTaskList` remain the same mechanically
- Pill label: **"Intentions"** (was "Priorities")

#### Step 2: Map Intentions to Todolist (major redesign)

**Layout**: Split view — left panel (intentions walkthrough) + right panel (Trevor AI iframe)

- **Left panel** (~40% width):
  - Lists all intentions from Step 1
  - Loops through each intention one-by-one (or shows all with individual "Mark as broken down" checkboxes)
  - For each intention, prompts: *"Break this down into actionable tasks in your todolist →"*
  - Checkbox/button per intention: "I've broken this down" (sets `brokenDown: true`)
  - The existing sync checklist items (review todolist, create events, break down tasks) move here as secondary nudges below the intention list
  
- **Right panel** (~60% width):
  - Sizeable iframe: `<iframe src="https://app.trevorai.com/app/" />`
  - The iframe fills the available height (min ~500px)
  - User interacts with Trevor AI directly in the iframe to break down intentions into tasks and manage their todolist/calendar

- **Advance condition**: All intentions marked as broken down (soft — user can skip)
- Pill label: **"Todolist Sync"** (unchanged)

#### Step 3: Categorize (minor update)

- Reword: "Categorize your intentions" instead of "tasks"
- For background type, add sub-option: "Mark as habit" toggle (small icon or checkbox next to the "Background" pill)
- Otherwise unchanged

#### Step 4: Schedule Main Intentions (redesign)

**Layout**: Split view — left panel (session scheduling UI) + right panel (Trevor AI iframe)

- **Left panel** (~50% width):
  - Same session-slot assignment UI as v1 but with updated wording ("intentions" not "tasks")
  - The user assigns main intentions to session slots
  - Additionally, a note encourages the user to also schedule the broken-down tasks in calendar via the iframe

- **Right panel** (~50% width):
  - Trevor AI iframe again (same URL), so the user can drag their broken-down tasks into time slots in their calendar
  - This is a parallel activity: the app tracks intention-to-session assignments in its own model, while the user handles granular task scheduling in Trevor AI

- Pill label: **"Main Schedule"** (was "Main Tasks")

#### Step 5: Schedule Background / Nudges (redesign)

- **Multi-session assignment**: Background intentions can now be assigned to **multiple** session slots (clicking a session adds to it without removing from others)
- **Habit badge**: Intentions marked as habits show a small recurring icon (🔄)
- **Nudge scheduling explanation**: Subtext explains that background tasks will appear as nudges throughout the day in their assigned sessions, and scheduling them in multiple slots ensures visibility
- No iframe needed here — background tasks are about flexibility, not granular calendar scheduling
- Pill label: **"Nudges"** (was "Background Tasks")

#### Step 6: Start Music (unchanged)

- No changes needed, works as-is

---

### Dashboard Changes

#### Trevor AI Integration

Add a collapsible/resizable Trevor AI iframe section to the dashboard. Placement options:

- **Option A (recommended)**: New row below the music panel rows, above the session timeline. Full-width iframe with a header "Task Manager" and a collapse toggle. Default: collapsed (since the user has already done setup), but one click expands it.
- The iframe URL is `https://app.trevorai.com/app/` — same as in the wizard.

#### Intention-Based Session Timeline

- Rename all "task" labels in the timeline to "intention"
- In each session slot, show:
  - Main intentions (with completion toggles, as before)
  - Background intentions/nudges (with a distinct visual, e.g., lighter weight, 🔄 icon for habits)
  - A background intention appears in every slot it's assigned to

#### Background Nudge Banner

- When a session is active, if there are background intentions assigned to it, show a subtle nudge banner at the top of the current session card: *"Don't forget: Reading, C# exercises"* (listing the background intentions)
- This nudge should be noticeable but not disruptive (in line with user's preference for calm interactions)

#### Check-in Modal

- Update wording from "tasks" to "intentions" where applicable
- Add a nudge in the check-in: *"Background intentions for this session: [list]"*

---

### Layout Strategy for Split Views

Steps 2 and 4 need a split-panel layout with an iframe. Approach:

```
┌─────────────────────────────────────────────────┐
│  WizardLayout (header, pills, nav)              │
├──────────────────────┬──────────────────────────┤
│  Left: Step content  │  Right: Trevor AI iframe │
│  (scrollable)        │  (fills height)          │
│  40-50% width        │  50-60% width            │
└──────────────────────┴──────────────────────────┘
```

- On mobile (< 768px): stack vertically — step content on top, iframe below with a fixed height (~400px) 
- The `WizardLayout` currently constrains content to `max-w-2xl`. For iframe steps, the content area needs to break out to full width. Add an optional `wide` prop to `WizardLayout` that removes the `max-w-2xl` constraint.
- The iframe should have `sandbox="allow-same-origin allow-scripts allow-popups allow-forms"` for security

---

### Implementation Order

1. **Data model migration** — Update `types/index.ts` (Intention interface, DayPlan changes). Add migration logic in `DayPlanContext.tsx` for backward compatibility with stored v1 plans.

2. **Reducer updates** — Rename actions, implement multi-session `ASSIGN_INTENTION` for background type, add `MARK_BROKEN_DOWN` and `TOGGLE_HABIT` actions.

3. **WizardLayout `wide` prop** — Allow full-width content for iframe steps.

4. **Step 1 rewording** — Change copy from "tasks/priorities" to "intentions". Update pill label.

5. **Step 2 redesign** — Split layout with intention walkthrough + Trevor AI iframe.

6. **Step 3 update** — Add habit toggle for background intentions.

7. **Step 4 redesign** — Split layout with scheduling UI + Trevor AI iframe.

8. **Step 5 redesign** — Multi-session assignment for background intentions/nudges.

9. **Dashboard updates** — Add collapsible Trevor AI iframe, update terminology, add nudge banners.

10. **Check-in modal update** — Update wording, add background intention nudges.

---

### Risks & Open Questions

1. **Iframe limitations**: Trevor AI may block embedding via `X-Frame-Options` or CSP headers. If so, fallback to an "Open in new tab" link with a persistent reminder panel instead. Test this early in implementation.

2. **Intention scheduling model**: The requirement says "the intentions too ideally should be scheduled, but the way we do this, I need to still decide". The approach here: intentions are assigned to session slots in Orchestrate's own model (for timeline display and nudging), while granular sub-task scheduling happens in Trevor AI. This is a parallel-track model — Orchestrate handles the high-level view, Trevor AI handles the details.

3. **Background task multi-assign UX**: Allowing a task in multiple sessions changes the existing `ASSIGN_TASK` logic (which currently removes from other sessions). Need to branch on intention type in the reducer.

4. **Terminology migration**: Renaming `Task` → `Intention` throughout the codebase is a large surface area change. Could do it incrementally (rename the type first, then update component-level wording) or all at once. Recommend: rename the type and reducer actions first, then update UI copy in each step's redesign.

5. **Mobile UX for split views**: The iframe-heavy steps (2, 4) will be cramped on mobile. Vertical stacking with a toggle to switch between content and iframe may work better than showing both simultaneously.

---

### Decisions

- **Parallel scheduling model**: Orchestrate tracks intention→session assignments for its own timeline/nudging. Trevor AI handles granular task→time scheduling. No sync between them.
- **Trevor AI iframe URL**: `https://app.trevorai.com/app/` — hardcoded for now, could be made configurable in settings later.
- **Multi-session assignment**: Only for `background` type intentions. `main` intentions stay exclusive to one session (as in v1).
- **Habit flag**: Opt-in per background intention. Habits get 🔄 badge and extra nudge treatment. No functional difference in scheduling — purely a display/nudging distinction.
- **No API integration**: As specified in requirements. Trevor AI is purely an embedded view. All Orchestrate state stays in localStorage.
- **Step count stays at 6**: The wizard flow has the same number of steps; only the content and layout of steps 2, 4, 5 change.
