## Plan: Orchestrate v3 — Intentions & Todoist Integration

This plan describes the changes for Iteration 2. The core shift: **tasks become intentions**, the app integrates with **Todoist** (REST API + personal token) and **Google Calendar** (embeddable iframe) to replace the non-functional Trevor AI iframe approach.

Background tasks become flexible nudges/habits with multi-session assignment.

> **Status:** Data model migration, reducer updates, wizard flow changes, and terminology migration are **complete**. The remaining work is replacing the Trevor AI iframes with the Todoist API integration and Google Calendar embed.

---

### Conceptual Shift

| v1 Concept | v2 Concept |
|-----------|-----------|
| Tasks (generic items) | **Intentions** (specific goals for today, not epics) |
| Step 2: checklist nudge | Step 2: **intention → todolist mapping** via inline Todoist panel |
| Step 4: assign main tasks to slots | Step 4: schedule with Google Calendar embed visible for context |
| Background tasks: single-session | Background tasks: **multi-session nudges/habits**, flexible scheduling |
| Dashboard: music + timeline | Dashboard: music + timeline + **Todoist panel** + **Google Calendar embed** |

---

### Integration Architecture (Todoist + Google Calendar)

#### Why not Trevor AI iframe?
Trevor AI sets `X-Frame-Options: DENY` and modern browsers block cross-origin cookies (`SameSite` defaults), making iframe embedding non-functional. Instead, we integrate with the underlying services directly.

#### Todoist REST API (v2)
- **Auth method**: Personal API token (user pastes from Todoist Settings → Integrations → Developer). No OAuth, no backend.
- **Token storage**: Encrypted in localStorage via AES-GCM with a Web Crypto API-derived key (see Security section).
- **Capabilities used**: List tasks, create tasks, complete tasks, filter by project/label, set due dates/times.
- **API base**: `https://api.todoist.com/rest/v2/`
- **Rate limits**: 450 requests/min — more than sufficient.

#### Google Calendar Embed
- **Method**: Official embeddable iframe URL: `https://calendar.google.com/calendar/embed?src={calendarId}&mode=week`
- **Auth**: None needed — works if user is logged into Google in the same browser. Read-only.
- **Configurable**: User enters their calendar ID (default: `primary`) in settings.
- **Why this works**: Google Calendar explicitly supports embedding (`X-Frame-Options: ALLOWALL` on embed endpoint).

#### Data Flow
```
Orchestrate (intentions, session assignments)  ←→  localStorage
                    ↕ (API calls)
              Todoist REST API  →  Todoist tasks (CRUD)
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
4. **Token validation**: On save, hit `GET /rest/v2/projects` to verify validity before storing.
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
    googleCalendarId?: string;   // e.g. "primary" or user's email
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
- Exposes: `{ tasks, projects, loading, error, isConfigured, createTask, completeTask, reopenTask, updateTask, refreshTasks }`
- `tasks` fetched via `GET /rest/v2/tasks` with optional `project_id` and `filter` params
- `createTask(content, opts?)` → `POST /rest/v2/tasks`
- `completeTask(taskId)` → `POST /rest/v2/tasks/{id}/close`
- `reopenTask(taskId)` → `POST /rest/v2/tasks/{id}/reopen`
- Caches tasks in React state; `refreshTasks()` to re-fetch; auto-refresh on window focus
- Returns `isConfigured: false` if no token in settings

#### `src/components/todoist/TodoistPanel.tsx` — Inline task panel
- Shows Todoist tasks: checkboxes, create-task input, project filter dropdown
- Two modes: `compact` (minimal) and `full` (expanded with project filter)
- Unconfigured state: shows setup prompt linking to Settings
- Styled to match Orchestrate's existing card/border design

#### `src/components/todoist/TodoistSetup.tsx` — Settings section
- Token input (masked), "Test & Save" button, "Disconnect" button
- Google Calendar ID input (default: `primary`)
- Links to Todoist developer settings page

#### `src/components/todoist/GoogleCalendarEmbed.tsx` — Calendar embed
- Accepts `calendarId` prop from settings
- Google Calendar embed iframe, `mode=week`, current date
- Fallback message if no calendar ID configured

---

### Wizard Flow (Steps 2 and 4 need update — rest COMPLETED)

#### Step 2: Map Intentions to Todolist
**Layout**: Split view — left (intentions walkthrough) + right (TodoistPanel)

- Left panel (~40%): intention breakdown checkboxes + sync checklist
- Right panel (~60%): `TodoistPanel` full mode — create/complete/filter tasks inline
- If Todoist not configured: setup prompt

#### Step 4: Schedule Main Intentions
**Layout**: Split view — left (session scheduling) + right (calendar + tasks)

- Left panel (~50%): session-slot assignment UI
- Right panel (~50%): `TodoistPanel` compact + `GoogleCalendarEmbed` stacked
- Note encouraging user to schedule broken-down tasks via the panel

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
- Google Calendar ID: text input, default `primary`
- Link to: `https://app.todoist.com/app/settings/integrations/developer`

---

### Implementation Order (Remaining Work)

#### Phase 2: Todoist Integration (sequential)
11. `src/lib/crypto.ts` — AES-GCM encrypt/decrypt
12. `AppSettings` update — Add todoist/calendar fields to types + context
13. `src/hooks/useTodoist.ts` — API hook (*depends on 11, 12*)
14. `TodoistSetup` component — Settings UI (*depends on 11, 12*)
15. `TodoistPanel` component — Inline task list (*depends on 13*)
16. `GoogleCalendarEmbed` component (*depends on 12*)

#### Phase 3: Wire Integration (parallel after Phase 2)
17. Step 2 update — Replace Trevor AI iframe with TodoistPanel (*depends on 15*)
18. Step 4 update — Replace iframe with TodoistPanel + GoogleCalendarEmbed (*depends on 15, 16*)
19. Dashboard update — Replace Trevor AI section (*depends on 15, 16*)
20. Settings modal/page — Wire TodoistSetup (*depends on 14*)

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

### Todoist API Reference

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/rest/v2/projects` | GET | List projects (also token validation) |
| `/rest/v2/tasks` | GET | List active tasks (`project_id`, `filter` params) |
| `/rest/v2/tasks` | POST | Create task |
| `/rest/v2/tasks/{id}` | POST | Update task |
| `/rest/v2/tasks/{id}/close` | POST | Complete task |
| `/rest/v2/tasks/{id}/reopen` | POST | Reopen task |

All requests: `Authorization: Bearer {token}`. All responses JSON.

---

### Decisions

- **Todoist REST API + personal token** instead of Trevor AI iframe (iframe blocked)
- **Google Calendar embed** for read-only calendar context (officially supported)
- **Client-side token encryption** (AES-GCM via Web Crypto API)
- **No backend** for this phase
- **Parallel data model**: Orchestrate owns intentions/sessions, Todoist owns tasks, GCal provides time context
- **Multi-session assignment**: Only for background intentions
- **Step count stays at 6**
