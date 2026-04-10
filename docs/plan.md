
## Plan: Orchestrate — Daily Contextualization Web App

A single-page **React + TypeScript** web app that walks you through a daily task contextualization wizard, then serves as a persistent dashboard with music integration and hourly check-ins. No backend — all data in localStorage. Built with **Vite + Tailwind CSS** for fast static deployment.

### Tech Stack
- **React 19 + TypeScript + Vite** — SPA with type safety, fast builds
- **Tailwind CSS v4** — green-accented muted palette via `@theme` custom properties
- **React Router** — wizard ↔ dashboard navigation (non-linear, always accessible)
- **date-fns** — lightweight time utils for session calculations
- **localStorage** — persistence (no backend, no auth)
- **Web Notifications API** — optional browser notifications for check-ins

State managed via React Context + `useReducer` (no heavy library needed).

---

### Architecture

Two views, routed:
- **`/setup`** — 6-step wizard for morning contextualization. Always accessible — can be revisited from the dashboard to edit any step via clickable step pills.
- **`/`** — persistent dashboard (music panel, session timeline, hourly check-ins, saved sessions)

On load: if today's plan exists and setup is complete → Dashboard. Otherwise → Wizard.

**Step pills**: The wizard always displays step navigation pills at the top (Priorities, Todolist Sync, Categorize, Main Tasks, Background Tasks, Music) to contextualize the process. During initial setup, past/current steps are visible but non-clickable, and future steps are grayed out (since they depend on earlier steps). After setup is complete (edit mode), all pills become clickable, allowing direct jumps to any step.

**Edit mode**: From the dashboard, the user can click "Edit Plan" to navigate back to `/setup` in editing mode. The wizard shows step navigation pills allowing direct jumps to any step, plus a "Done" / "Back to Dashboard" button to return. All changes take effect immediately via the shared context.

**Save/Restore**: The user can save the current day plan as a named snapshot. A modal prompts for a session name (defaulting to a human-readable date like "Thursday, Apr 10"). Saved sessions are listed on the dashboard (full view with Delete option) and are also accessible from the wizard setup page via a collapsible "Restore Saved" panel (compact view). Restoring replaces the current plan (with confirmation) and navigates to the dashboard. History is persisted in localStorage under a separate key.

---

### Data Model

- **`DayPlan`**: date, tasks, taskSessions (sessionId → taskId[]), wizardStep (1–6), setupComplete, checkIns, syncChecklist
- **`Task`**: id, title, type (`main` | `background` | `unclassified`), assignedSession, completed
- **`SessionSlot`**: id, name, startTime, endTime (4 fixed slots from requirements, editable in settings)
- **`CheckIn`**: id, timestamp, feeling, currentWorkType, playlistSuggested, notes
- **`Playlist`**: id, name, description, emoji, spotifyUrl, workTypes (static, from music_routine.md)
- **`SavedDayPlan`**: plan (full DayPlan snapshot), savedAt (ISO timestamp), label (human-readable)
- **`AppSettings`**: notificationPreference (`in-app` | `browser` | `both`), sessionSlots

**State shape** (in context reducer):
- `plan: DayPlan` — current day plan
- `settings: AppSettings` — user preferences
- `editingStep: number | null` — non-null when revisiting wizard from dashboard
- `history: SavedDayPlan[]` — saved day snapshots

---

### Project Structure

```
src/
  types/index.ts              — all TypeScript interfaces
  data/playlists.ts           — 6 Spotify playlists with URLs + work-type mappings
  data/sessions.ts            — 4 default session slot definitions
  context/DayPlanContext.tsx   — React context + useReducer, localStorage sync, all actions
  hooks/
    useLocalStorage.ts        — generic typed localStorage hook
    useCurrentSession.ts      — time-aware current/remaining session computation
    useHourlyCheckin.ts       — hourly timer within session boundaries
    useNotifications.ts       — Web Notifications API wrapper
  components/
    ui/Button.tsx             — variant/size button
    ui/Card.tsx               — bordered card wrapper
    ui/ProgressBar.tsx        — step progress indicator
    ui/Modal.tsx              — overlay modal
    ui/EditableTaskList.tsx   — reusable inline-editable task list with native HTML drag-and-drop reordering
    wizard/
      Wizard.tsx              — step router (renders current step component)
      WizardLayout.tsx        — shared layout: progress bar, always-visible step pills (grayed during setup, clickable in edit mode), collapsible restore-from-saved panel, back/next/done nav
      Step1Priorities.tsx     — task entry (uses EditableTaskList)
      Step2TodolistSync.tsx   — external sync nudge + checklist
      Step3Categorize.tsx     — main/background classification (uses EditableTaskList with category buttons via renderRight)
      Step4ScheduleMain.tsx   — assign main tasks to sessions
      Step5ScheduleBackground.tsx — assign background tasks to sessions
      Step6StartMusic.tsx     — Spotify start prompt
    dashboard/
      Dashboard.tsx           — main dashboard layout with edit/save/new-day controls
      SessionTimeline.tsx     — vertical session timeline with task completion toggles
      MusicPanel.tsx          — always-visible playlist panel with transition tips
      SavedSessions.tsx       — saved day history list with restore/delete; reusable in compact mode for wizard
    checkin/
      CheckInModal.tsx        — hourly check-in dialog with feeling + work type + playlist suggestion
  App.tsx                     — router + context provider
  main.tsx                    — entry point with BrowserRouter
  index.css                   — Tailwind import + @theme color definitions
```

---

### Reducer Actions

| Action | Description |
|--------|-------------|
| `ADD_TASK` | Add a new unclassified task |
| `REMOVE_TASK` | Remove a task (and unassign from sessions) |
| `UPDATE_TASK` | Replace a task by id |
| `CATEGORIZE_TASK` | Set task type to main or background |
| `ASSIGN_TASK` | Assign task to a session slot (removes from previous) |
| `UNASSIGN_TASK` | Remove task from a session slot |
| `TOGGLE_TASK_COMPLETE` | Toggle task completion flag |
| `SET_WIZARD_STEP` | Navigate to a specific wizard step |
| `COMPLETE_SETUP` | Mark setup as done |
| `ADD_CHECKIN` | Log an hourly check-in |
| `TOGGLE_SYNC_ITEM` | Toggle a sync checklist item |
| `RESET_DAY` | Clear plan and start fresh |
| `UPDATE_SETTINGS` | Partial-update app settings |
| `SET_EDITING_STEP` | Enter/exit wizard edit mode from dashboard |
| `SAVE_DAY` | Save current plan as a named snapshot in history |
| `RESTORE_DAY` | Replace current plan with a saved snapshot |
| `DELETE_SAVED_DAY` | Remove a saved snapshot from history |
| `REORDER_TASKS` | Reorder tasks by a new ordered list of task IDs (for drag-and-drop) |

---

### Verification

1. Walk through all 6 wizard steps — add tasks, categorize, schedule, trigger music link
2. Start app at different times → verify only remaining sessions offered in Steps 4–5
3. Complete wizard, refresh browser → dashboard loads from localStorage
4. "Start New Day" → wizard restarts with empty state
5. **Edit Plan** → navigates to wizard with step pills; jump directly to any step; "Done" returns to dashboard
6. **Save Day** → name prompt modal appears, snapshot appears in Saved Sessions; **Restore** replaces current plan with confirmation
7. **Wizard Restore** → "Restore Saved" button in wizard header toggles compact saved sessions panel; restoring navigates to dashboard
8. Hourly check-in fires → modal appears, playlist suggestion matches work type
9. Browser notifications work when enabled, graceful fallback when denied
10. Responsive test at 375px, 768px, 1280px
11. `vite build` → serve `dist/` → full flow works

---

### Decisions

- **No Spotify API integration** — playlists open as external links (avoids OAuth complexity)
- **Native HTML Drag and Drop** — task reordering uses the browser's built-in drag-and-drop API (no library); keeps bundle lean
- **Manual "Start New Day"** — no auto-reset
- **Session times editable** in settings, with defaults from requirements
- **Non-linear wizard** — steps always accessible via pills after initial setup; edit mode lets user revisit any step from dashboard
- **Day save/restore** — snapshots stored in localStorage with user-provided name; restore available from both dashboard and wizard setup; replaces current plan with confirmation dialog

### Further Considerations

1. **Task reuse**: Background tasks recur daily — could carry forward yesterday's. Recommendation: defer to v2.
2. **Spotify embed**: iframe embed could play in-app without leaving the page. Tradeoff: complexity + may need Premium. Recommendation: start with links, add embed later.
3. **PWA support**: `vite-plugin-pwa` for installable desktop/mobile app with offline + better notifications. Recommendation: worth adding in Phase 6 — low effort, high value.