## Plan: Orchestrate v3 — Intentions & Todoist Integration

This plan describes the changes for Iteration 2. The core shift: **tasks become intentions**, the app integrates with **Todoist** (REST API + personal token) and **Google Calendar** (embeddable iframe) to replace the non-functional Trevor AI iframe approach.

Background tasks become flexible nudges/habits with multi-session assignment.

> **Status:** All phases **complete**. Data model migration, reducer updates, wizard flow, terminology migration, Todoist API integration, Google Calendar embed, and Settings wiring are all implemented and verified.

---

### Conceptual Shift

| v1 Concept | v2 Concept |
|-----------|-----------|
| Tasks (generic items) | **Intentions** (specific goals for today, not epics) |
| Step 1: Set intentions + map to todolist | Step 1: **intention entry + todolist mapping** via inline Todoist panel |
| Step 2: Categorize | Step 2: same |
| Step 3: assign main tasks to slots | Step 3: schedule with Google Calendar embed visible for context |
| Background tasks: single-session | Background tasks: **multi-session nudges/habits**, flexible scheduling |
| Dashboard: music + timeline | Dashboard: music + timeline + **Todoist panel** + **Google Calendar embed** |

---

### Integration Architecture (Todoist + Google Calendar)

#### Why not Trevor AI iframe?
Trevor AI sets `X-Frame-Options: DENY` and modern browsers block cross-origin cookies (`SameSite` defaults), making iframe embedding non-functional. Instead, we integrate with the underlying services directly.

#### Todoist API (v1)
- **Auth method**: Personal API token (user pastes from Todoist Settings → Integrations → Developer). No OAuth, no backend.
- **Token storage**: Encrypted in localStorage via AES-GCM with a Web Crypto API-derived key (see Security section).
- **Capabilities used**: List tasks, create tasks, complete tasks, filter by project/label, set due dates/times.
- **API base**: `https://api.todoist.com/api/v1/` (unified API — REST v2 was sunset and returns `410 Gone`)
- **Responses**: Paginated — `GET` endpoints return `{ results: [...], next_cursor: string | null }`
- **Mutations**: Task create via `POST /api/v1/tasks`. Complete/reopen via Sync endpoint (`POST /api/v1/sync` with `item_complete`/`item_uncomplete` commands).
- **CORS**: Supported (`Access-Control-Allow-Origin: *` for authenticated requests). Vite dev proxy (`/api/todoist → api.todoist.com`) used during development for reliability.
- **Rate limits**: 450 requests/min — more than sufficient.

#### Google Calendar Embed
- **Method**: Official embeddable iframe URL: `https://calendar.google.com/calendar/embed?src={id1}&src={id2}&mode=week`
- **Multiple calendars**: Repeating `src` params overlays calendars in different colors within a single embed.
- **Auth**: None needed — works if user is logged into Google in the same browser. Read-only.
- **Configurable**: User adds one or more calendar IDs in settings. Stored as `googleCalendarIds: string[]` (migrated from legacy single-string `googleCalendarId`).
- **Why this works**: Google Calendar explicitly supports embedding (`X-Frame-Options: ALLOWALL` on embed endpoint).

#### Data Flow
```
Orchestrate (intentions, session assignments)  ←→  localStorage
                    ↕ (API calls)
              Todoist API (v1)  →  Todoist tasks (CRUD)
                    ↕ (existing Todoist↔GCal sync)
        Google Calendar embed  →  Visual schedule (read-only)
```

Orchestrate owns the **intention-level** view. Todoist owns the **task-level** view. Google Calendar provides **time-context**. The user's existing Todoist↔Google Calendar integration keeps the latter two in sync automatically.

---

### Security: API Token Storage

The Todoist personal API token is stored in localStorage, encrypted client-side.

#### Approach: AES-GCM encryption via Web Crypto API

1. **Key derivation**: On first token setup, generate a random 256-bit key using `crypto.subtle.generateKey()`. Store the exported key in a separate localStorage entry.
2. **Encryption**: `crypto.subtle.encrypt()` with AES-GCM. Store the encrypted token + IV as base64.
3. **Decryption**: On app load, decrypt the token in memory. Plaintext only held in a JS variable, never persisted unencrypted.
4. **Token validation**: On save, hit `GET /api/v1/projects` to verify validity before storing.
5. **Token removal**: "Disconnect Todoist" button wipes both the encrypted token and the key.

#### Threat Model

| Threat | Mitigation | Residual risk |
|--------|-----------|---------------|
| XSS (script injection) | CSP headers, React's built-in XSS protection, no `dangerouslySetInnerHTML` | If XSS occurs, attacker can call decrypt and steal plaintext. Encryption raises the bar but isn't bulletproof against XSS. |
| Physical device access | Encryption means token isn't readable in DevTools → localStorage | Attacker with DevTools access could still extract the key from the adjacent localStorage entry |
| Network sniffing | All Todoist API calls HTTPS | None |
| Todoist token scope | Personal tokens have full account access | User should be aware. No mitigation possible without OAuth scoped tokens. |

**Bottom line**: Client-side encryption prevents casual exposure (DevTools browsing, localStorage dumps, extensions reading storage) but is not equivalent to server-side token management. Acceptable for a personal-use app.

#### Implementation: `src/lib/crypto.ts`
- `encryptToken(token: string)` → `{ encrypted, iv, key }` (all base64)
- `decryptToken(encrypted, iv, key)` → plaintext string
- Uses Web Crypto API (`AES-GCM`, 256-bit key)

#### New AppSettings fields
```ts
export interface AppSettings {
    notificationPreference: NotificationPreference;
    sessionSlots: SessionSlot[];
    todoistToken?: string;       // encrypted token blob (base64)
    todoistTokenIV?: string;     // AES-GCM IV (base64)
    todoistTokenKey?: string;    // AES key (exported, base64)
    googleCalendarIds?: string[];  // array of calendar IDs to overlay
}
```

---

### Data Model Changes (COMPLETED)

Intention interface, DayPlan updates, migration logic — all implemented.

---

### Reducer Action Changes (COMPLETED)

All actions renamed, multi-session assignment for background, `MARK_BROKEN_DOWN`, `TOGGLE_HABIT` — all implemented.

---

### New Components to Build

#### `src/lib/crypto.ts` — Token encryption utilities
- AES-GCM encrypt/decrypt via Web Crypto API

#### `src/hooks/useTodoist.ts` — Todoist API hook
- Decrypts token from settings on mount
- Exposes: `{ tasks, projects, sections, loading, error, isConfigured, createTask, completeTask, reopenTask, refreshTasks, refreshProjects, refreshSections }`
- `tasks` fetched via `GET /api/v1/tasks` (paginated, extracts `.results`) — includes `section_id`, `parent_id` for hierarchy
- `projects` fetched via `GET /api/v1/projects` (paginated, extracts `.results`) — includes `parent_id` for nesting
- `sections` fetched via `GET /api/v1/sections` (paginated, extracts `.results`) — groups tasks within projects
- `createTask(content, opts?)` → `POST /api/v1/tasks`
- `completeTask(taskId)` → `POST /api/v1/sync` with `item_complete` command
- `reopenTask(taskId)` → `POST /api/v1/sync` with `item_uncomplete` command
- Uses `import.meta.env.DEV` to route through Vite proxy in dev (`/api/todoist/api/v1`) or direct in prod
- Caches tasks in React state; `refreshTasks()` to re-fetch; auto-refresh on window focus
- Returns `isConfigured: false` if no token in settings

#### `src/components/todoist/TodoistPanel.tsx` — Nested project tree panel
- Displays tasks in a **collapsible nested tree** mirroring Todoist's sidebar structure:
  - **Projects** nested via `parent_id` (areas → epics), with Todoist color dots and task count badges
  - **Sections** within projects group related tasks, with collapsible headers
  - **Sub-tasks** rendered recursively under parent tasks via `parent_id`
- Two modes: `compact` (tree only, no create input, hides due dates) and `full` (tree + project picker + create task input)
- Tree sorted by `child_order` / `section_order` at each level
- Top-level projects expanded by default; sub-projects start collapsed
- Create-task input includes a hierarchical project picker dropdown
- Unconfigured state: shows setup prompt linking to Settings
- Styled to match Orchestrate's existing card/border design

#### `src/components/todoist/TodoistSetup.tsx` — Settings section
- Token input (masked), "Test & Save" button, "Disconnect" button
- Google Calendar: add/remove multiple calendar IDs with inline list
- Links to Todoist developer settings page

#### `src/components/todoist/GoogleCalendarEmbed.tsx` — Calendar embed
- Reads `googleCalendarIds` array from settings
- Builds iframe URL with multiple `src=` params to overlay all calendars
- Google Calendar embed iframe, `mode=week`, current date
- Fallback message if no calendar IDs configured

---

### Wizard Flow (5 steps — COMPLETED)

The wizard was originally 6 steps; Step 1 (Set Intentions) and Step 2 (Map to Todolist) were merged into a single step since the todolist provides the epic-level view that aids intention setting. Existing plans are automatically migrated via a `_wizardSteps` version marker.

#### Step 1: Set & Map Intentions (merged from old Steps 1+2)
**Layout**: Split view — left (two-phase intention flow) + right (TodoistPanel)

- Left panel (~40%):
  - **Phase 1 — Set intentions**: Input + editable list (add, edit, drag-reorder, delete). "Start mapping →" button to proceed.
  - **Phase 2 — Sequential mapping**: Intentions presented one at a time. Current intention highlighted with "Done — next/finish". Progress bar tracks completion. New intentions can still be added (queued for later mapping). Reordering disabled during mapping.
- Right panel (~60%): `TodoistPanel` full mode — create/complete/filter tasks inline
- If Todoist not configured: panel shows setup prompt
- Advance condition: at least one intention added and mapping started
- Pill label: **"Intentions"**

#### Step 2: Categorize (was Step 3)

#### Step 3: Schedule Main Intentions (was Step 4)
**Layout**: Split view — left (session scheduling) + right (calendar + tasks)

- Left panel (~50%): session-slot assignment UI
- Right panel (~50%): `TodoistPanel` compact + `GoogleCalendarEmbed` stacked
- Note encouraging user to schedule broken-down tasks via the panel

#### Step 4: Schedule Background / Nudges (was Step 5)

#### Step 5: Start Music (was Step 6)

---

### Dashboard Changes

Replace the Trevor AI collapsible section with:
1. **Task Manager** (collapsed): `TodoistPanel` full mode
2. **Calendar** (collapsed): `GoogleCalendarEmbed`

Both below music panel, above session timeline.

---

### Settings Page

Add **Integrations** section (new settings modal or expand existing):
- Todoist API Token: masked input, test/save/disconnect
- Google Calendar IDs: add/remove list of calendar IDs (overlaid in a single embed)
- Link to: `https://app.todoist.com/app/settings/integrations/developer`

---

### Implementation Order (ALL COMPLETED)

#### Phase 2: Todoist Integration ✅
11. `src/lib/crypto.ts` — AES-GCM encrypt/decrypt
12. `AppSettings` update — Add todoist/calendar fields to types + context
13. `src/hooks/useTodoist.ts` — API hook (migrated to Todoist API v1)
14. `TodoistSetup` component — Settings UI
15. `TodoistPanel` component — Inline task list
16. `GoogleCalendarEmbed` component

#### Phase 3: Wire Integration ✅
17. Step 2 update — Replace Trevor AI iframe with TodoistPanel
18. Step 4 update — Replace iframe with TodoistPanel + GoogleCalendarEmbed
19. Dashboard update — Replace Trevor AI section
20. Settings modal/page — Wire TodoistSetup

---

### Verification

1. Configure Todoist token in settings → tasks load
2. Walk all 6 wizard steps with Todoist panel in Steps 2 and 4
3. Create task in panel → appears in Todoist
4. Complete task → syncs
5. Google Calendar embed shows current week
6. Settings: disconnect → panel shows setup prompt
7. Settings: invalid token → error message
8. Token stored encrypted (DevTools: not plaintext)
9. `vite build` → full flow works
10. Responsive test at 375px, 768px, 1280px

---

### Todoist API Reference (v1 — unified API)

REST v2 (`/rest/v2/`) was sunset by Todoist and returns `410 Gone`. All endpoints migrated to the unified v1 API.

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/v1/projects` | GET | List projects — paginated `{ results, next_cursor }` — includes `parent_id` for hierarchy (also token validation) |
| `/api/v1/sections` | GET | List sections — paginated `{ results, next_cursor }` — optional `project_id` filter |
| `/api/v1/tasks` | GET | List active tasks — paginated `{ results, next_cursor }` — includes `section_id`, `parent_id` (`project_id` param) |
| `/api/v1/tasks` | POST | Create task (JSON body: `{ content, project_id?, ... }`) |
| `/api/v1/tasks/{id}` | POST | Update task |
| `/api/v1/sync` | POST | Sync endpoint for complete (`item_complete`) and reopen (`item_uncomplete`) |

All requests: `Authorization: Bearer {token}`. GET responses paginated JSON. Sync uses `application/x-www-form-urlencoded` with `commands` parameter.

#### Dev Proxy (vite.config.ts)
```
/api/todoist/* → https://api.todoist.com/* (changeOrigin, path rewrite)
```
`useTodoist.ts` uses `/api/todoist/api/v1` in dev, direct `https://api.todoist.com/api/v1` in production.

---

### Decisions

- **Todoist API v1 + personal token** instead of Trevor AI iframe (iframe blocked; REST v2 sunset)
- **Google Calendar embed** for read-only calendar context (officially supported)
- **Client-side token encryption** (AES-GCM via Web Crypto API)
- **No backend** for this phase
- **Parallel data model**: Orchestrate owns intentions/sessions, Todoist owns tasks, GCal provides time context
- **Multi-session assignment**: Only for background intentions
- **Step count reduced from 6 to 5** — intention entry and todolist mapping merged into one step

---

### Iteration 3.1 — Bug Fixes, File Cleanup & Step 1 UX Redesign

#### Bug Fixes (all implemented ✅)

| # | Issue | Severity | Fix |
|---|-------|----------|-----|
| 1 | `useCurrentSession` used `useMemo` with only `[slots]` — never re-evaluated as time passed, so dashboard showed stale session data | **Critical** | Added a `tick` state that increments every 60s, included in `useMemo` deps |
| 2 | `RESTORE_DAY` did `structuredClone` without running `migratePlan` — restoring a v1 import crashed the app | **Critical** | Restore now calls `migratePlan()` on the saved plan |
| 3 | Todoist `refreshTasks`/`refreshProjects` only fetched the first page of paginated results — users with many tasks saw a partial list | Moderate | Added `fetchAllPages<T>()` helper that loops `next_cursor` until exhausted |
| 4 | No React error boundary — any rendering error crashed the entire app with a white screen | Moderate | Added `ErrorBoundary` component wrapping `<DayPlanProvider>` in `App.tsx`, with "Try Again" and "Reset & Reload" recovery |
| 5 | Modal `onKeyDown` for Escape was on the backdrop `<div>` (required focus) — pressing Escape anywhere didn't close modals | Moderate | Replaced with `useEffect` document-level `keydown` listener |
| 6 | No catch-all route — unknown paths rendered blank | Moderate | Added `<Route path="*" element={<Navigate to="/" />} />` |
| 7 | `SAVE_DAY` appended a new entry every time — saving multiple times created duplicates for the same date | Moderate | Now filters out existing snapshots for the same `plan.date` before prepending |
| 8 | `package.json` name was still `"routinify"` from before the rename | Minor | Changed to `"orchestrate"` |
| 9 | `getPlaylistForWorkType` used `as never` cast | Minor | Replaced with `(p.workTypes as string[]).includes(workType)` |
| 10 | `new Date(plan.date)` in Dashboard parsed `YYYY-MM-DD` as UTC midnight — showed wrong day in negative-offset timezones | Minor | Replaced with `parseISO()` from date-fns |

#### File Renames (wizard steps — implemented ✅)

Wizard was reduced from 6 to 5 steps in v3, but file names and export names still reflected the old numbering. Renamed for consistency:

| Old file | New file | Export |
|----------|----------|--------|
| `Step2TodolistSync.tsx` | `Step1Intentions.tsx` | `Step1Intentions` |
| `Step3Categorize.tsx` | `Step2Categorize.tsx` | `Step2Categorize` |
| `Step4ScheduleMain.tsx` | `Step3ScheduleMain.tsx` | `Step3ScheduleMain` |
| `Step5ScheduleBackground.tsx` | `Step4ScheduleBackground.tsx` | `Step4ScheduleBackground` |
| `Step6StartMusic.tsx` | `Step5StartMusic.tsx` | `Step5StartMusic` |

Only consumer is `Wizard.tsx` — all imports updated. No changes outside `wizard/`.

#### Step 1 UX Redesign — Two-Phase Sequential Flow (implemented ✅)

Replaced the flat all-at-once layout with a guided two-phase approach:

**Phase 1 — Set intentions:**
- Input field + `EditableTaskList` (drag-reorder, edit, remove)
- Heading: "What are your intentions for today?"
- "Start mapping →" button appears once at least one intention exists
- "Continue" (footer) is disabled until mapping starts — forces the user through the flow
- Quick Checks section removed (no longer necessary)

**Phase 2 — Sequential mapping (triggered by "Start mapping"):**
- Input stays available for adding more intentions (they queue at the end for mapping)
- Progress bar shows `brokenDown / total`
- Completed intentions collapse into a compact checkmark list
- **Current intention** is highlighted in a prominent bordered card with "Done — next/finish"
- Upcoming count shown: "N more intentions after this"
- Reordering is disabled during mapping (simplifies the sequential flow)
- When all mapped: success message nudging toward the next step
- Auto-enters phase 2 if returning with any already-broken-down intentions

**Rationale:** The previous design showed all intentions and the breakdown checklist simultaneously, which was overwhelming. The sequential approach mirrors the actual workflow — one intention at a time — and reduces cognitive load.
