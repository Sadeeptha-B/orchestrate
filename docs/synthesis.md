> **Start here.** This is the canonical context document for the current state of Orchestrate. Deeper references: [vision.md](./vision.md) (durable "why"), [architecture.md](./architecture.md), [data-model.md](./data-model.md), [backlog.md](./backlog.md) (forward-looking proposals). Frozen historical artifacts live in [history/](./history/) — do not treat them as current state.
>
> **Last updated:** 2026-05-07
> **Reflects:** v4.5 (Iteration 4 plus post-implementation refinements). Iteration 5 (first-class habits, session capacity arithmetic) is **not yet implemented**.

# Orchestrate — Purpose & Current Feature Set

A self-contained synthesis of what Orchestrate is, what it does today, and the design tensions that shaped it. Intended as handoff context for another agent.

---

## 1. Purpose

Orchestrate is a **single-user, browser-based daily contextualization companion**. It does *not* try to replace the user's todolist or calendar — it sits alongside them and walks the user through a structured, friction-reducing morning ritual that turns a vague "what am I doing today?" into a concrete, scheduled, music-cued plan.

The core problem it targets:
- **Task and time blindness.** Generic todo lists store epics; they don't help on a fresh day when the relevant unit is *intent for today*, not *open work in general*.
- **Contextualization friction.** The mental work of comparing today's goals against an existing todo list, breaking work into actionable tasks, fitting them into available time, and locking into a working state is high-effort and skipped by most apps.
- **Sustained focus.** Once the day starts, drift, fatigue, and context loss erode follow-through. Orchestrate nudges hour-by-hour and ties working state to a music protocol.

The app is **opinionated and personal** to the author's workflow: fixed default session slots (early morning, morning, afternoon, night), a curated 6-playlist Spotify protocol, and integrations with the specific tools the author already uses (Todoist + Google Calendar).

---

## 2. Operating Model

The user's day flows through three surfaces:

```
Welcome  ─▶  Wizard (4 steps)  ─▶  Dashboard
              ▲                       │
              └───── Edit Plan / Recontextualize
```

### 2.1 Vocabulary

| Term | Meaning |
|---|---|
| **Intention** | A high-level goal for *today* (e.g. "Finish assignment 3"). Not a todo-list epic — a today-scoped focus area. Owned by Orchestrate. |
| **LinkedTask** | A specific Todoist task that has been bound to an intention inside Orchestrate's plan. The unit that gets categorized and scheduled. |
| **Main task** | A primary work thread. Exclusive to one session. |
| **Background task** | A habit/nudge task. Can be assigned to multiple sessions in the same day. Capped at 30 min per estimate. |
| **Session** | A configurable time block in the day (default: early-morning, morning, afternoon, night). Tasks are assigned to sessions. |
| **Check-in** | An hourly prompt during active sessions asking how the user feels and what kind of work they're doing. Suggests a playlist. |

### 2.2 The Wizard (4 steps)

Sequential setup that captures the day's plan:

1. **Step 1 — Intentions.** Two phases: (a) write down intentions for the day, (b) sequentially walk through each intention and *map* it to specific Todoist tasks via the embedded TodoistPanel ("Link"/"Unlink" buttons). Mapped intentions become collapsible panels showing their linked tasks; users can remap individually or restart mapping wholesale.

2. **Step 2 — Refine.** Per-intention sequential flow. For each linked task: categorize as **main** or **background**, optionally toggle **habit**, and set an **estimate** (preset pills: 15m / 30m / 45m / 1hr, or custom). Background tasks clamp to 30 min. Tasks > 60 min trigger a non-blocking nudge to break down via the TodoistPanel (collapsed by default; auto-opens on >60min estimates). Cannot advance until every (non-completed) task is categorized AND estimated.

3. **Step 3 — Schedule.** Two phases:
   - **Phase 1 (Assign):** A proportional `SessionTimelineBar` shows sessions as blocks. User clicks a session and assigns tasks to it. Main tasks are exclusive to one session; background tasks can be assigned to multiple. Cannot advance until at least one task is assigned.
   - **Phase 2 (Time):** Side-by-side TodoistPanel + Google Calendar embed. User schedules concrete times in Todoist (which sync to Google Calendar via the user's existing Todoist↔Calendar sync). Estimate-based auto-fill: entering a start time auto-computes end time from `estimatedMinutes`.

4. **Step 4 — Start Music.** Plays the "Start Work" Spotify playlist as a ramp-in trigger, then transitions to the Dashboard.

The user can return to any step from the Dashboard ("Edit Plan" → Step 1, "Recontextualize" → Step 3).

### 2.3 The Dashboard

The operational view for the rest of the day. Layout (top to bottom):

1. **Header** — completion counter (linked tasks done / total), Save / Edit / New Day / Saved Sessions / Settings.
2. **Music row** — `PlaylistSelector` (6 work-type buttons) + live `DigitalClock`.
3. **Player row** — embedded `SpotifyPlayer` iframe + static `TransitionTips` card (the music protocol cheat sheet).
4. **Timeline** — `SessionTimelineBar` (read-only) with a pulse on the active session.
5. **Current Session** — detailed card with the active session's tasks: drag-to-reorder, completion checkboxes (with `canvas-confetti` on completion), nudge banners for background tasks.
6. **Task Manager** — collapsible TodoistPanel, defaulting to "Linked Tasks" filter.
7. **Calendar** — collapsible Google Calendar embed.

Throughout the day:
- **Hourly check-in** modal fires on each whole hour during an active session. Captures feeling (great/okay/struggling/stuck) + work type. The work type maps to a suggested playlist. Optionally sends an OS notification. The check-in can route the user back to Step 3 to recontextualize.
- **`useCurrentSession`** polls every 60s to determine the active session.

---

## 3. Music Protocol

Music is treated as a deliberate state machine, not background ambience. Six curated Spotify playlists are mapped to work types:

| Work type | Playlist | Use |
|---|---|---|
| *(start of day)* | 🚀 Start Work | Ramp-in trigger; 5–10 min then switch |
| Coding / problem solving | 🧠 Deep Focus | Sustained focus |
| Lectures / passive input | 🌊 Lo-Fi Beats | Light work |
| Restless / high energy | 🔥 Brain Food | Stimulating but controlled |
| Low energy / foggy | 🧱 Peaceful Piano | Gentle re-entry |
| Reading / deep cognition | 🔇 White Noise | Or silence — language-heavy work |

Users can override any playlist with a custom Spotify URL. The check-in suggests a playlist based on declared work type. Full protocol (transition rules, volume guidance, when to go silent) is captured in [music_routine.md](./music_routine.md) and surfaced statically in the dashboard's `TransitionTips` card.

---

## 4. External Integrations

| System | Integration | Purpose |
|---|---|---|
| **Todoist** | REST API v1 with personal API token (AES-256-GCM encrypted in localStorage). Full CRUD on tasks/projects, completion via Sync API. Stale-while-revalidate cache (5min hydration / 30s focus). | Source of truth for tasks. Orchestrate stores only Todoist task IDs + a `titleSnapshot` fallback. |
| **Google Calendar** | Read-only embed iframe. Multi-calendar with per-calendar colors. Week / month / agenda view. | Time context. The user's existing Todoist↔Google Calendar sync makes scheduled tasks appear automatically. |
| **Spotify** | Embedded player iframe. 6 curated playlists, custom URL override per playlist. | Music protocol. |

Important nuance: Orchestrate has **no backend**. All persistence is `localStorage`. Todoist API calls are direct from the browser (via Vite dev proxy in development to dodge CORS). The Todoist token is encrypted client-side; key + IV + ciphertext all live in localStorage — protects against casual inspection, not against an attacker with browser-profile access.

---

## 5. Data Model — The Essentials

Two interlocking ideas:

**Intentions own LinkedTasks.** An intention has `linkedTaskIds: string[]` (ordered Todoist IDs). A `LinkedTask` has `intentionId` back-reference + `type` + `estimatedMinutes` + `assignedSessions[]` + `completed` + `titleSnapshot?`. The flat `linkedTasks` array on `DayPlan` is the denormalized list across all intentions.

**Tasks (not intentions) are scheduled.** `DayPlan.taskSessions: Record<sessionId, todoistId[]>` is the source of truth for what runs in each session. `LinkedTask.assignedSessions` is a derived mirror kept in sync by the reducer.

Consequence: **a single intention can have both main and background tasks.** This was the v4 fix — earlier versions categorized at the intention level, which didn't match real workflows.

The plan auto-resets daily (`loadPlan()` checks `parsed.date !== todayISO()`). User preferences (Todoist token, session slots, calendar IDs) survive in `AppSettings`. Completed days can be saved to `history` and restored later.

A migration chain (v1 → v2 → v3 → v4 → v4.1) handles old saved sessions on load. v3 → v4 cannot reconstruct task links (v3 stored none) so it shows a one-time notice prompting re-mapping.

Stale task handling is well-developed: completed tasks stay visible (strikethrough + 🎉) using `titleSnapshot`; deleted tasks auto-unlink; externally-completed tasks are detected and marked complete (not unlinked) so session tracking is preserved.

Full type catalog and reducer action list: [data-model.md](./data-model.md). Historical implementation plan: [history/plan_v4.md](./history/plan_v4.md).

---

## 6. Tech Stack

- **React 19** + TypeScript + **Vite 8**
- **Tailwind CSS v4** with `@theme` CSS custom properties; light/dark themes via `.dark` class on `<html>`
- **React Router v7** (BrowserRouter, basename `/orchestrate/`)
- State: React Context + `useReducer` for the core `DayPlan`; split contexts for Todoist (data vs actions, to avoid render thrash); a small Music context scoped to the dashboard
- Persistence: `localStorage` only — 4 primary keys + 3 auxiliary keys
- Crypto: Web Crypto API (AES-256-GCM) for the Todoist token
- PWA: service worker (network-first, falls back to cache then `index.html`), manifest with maskable icons
- Dependencies of note: `canvas-confetti` (task completion celebration), `date-fns`, `react-router-dom`

---

## 7. What's In Today (Feature Inventory)

**Setup & onboarding**
- Welcome screen with first-visit / resuming / returning detection
- Todoist token setup (paste + encrypt) with validation
- Multi-calendar Google Calendar configuration with colors and view mode

**Wizard**
- Step 1: intention entry, sequential mapping to Todoist tasks, individual or wholesale remap, collapsible mapped-intention panels showing linked tasks
- Step 2: per-intention categorization + estimation, preset + custom estimate input, background 30min cap, >60min breakdown nudge with auto-opening task manager, horizontal task cards when panel collapsed
- Step 3: two-phase scheduling — proportional timeline assignment + side-by-side Todoist/Calendar time scheduling with estimate-based end-time auto-fill, phase gating, completed-task short-circuit
- Step 4: Spotify start-work playback + setup completion

**Dashboard**
- Live current-session detection
- Drag-to-reorder tasks within a session
- Inline task completion with confetti
- Persistent linked-task indicators in the TodoistPanel ("linked to: {intention}" amber labels) at all times, not just during mapping
- Inline task title editing (click → edit → Enter to commit)
- Filter toggle (All / Linked) inside the TodoistPanel header
- 6-playlist selector with per-playlist custom URL override
- Embedded Spotify player and Google Calendar
- Static music transition tips card

**Through-the-day support**
- Hourly check-in modal (feeling + work type + playlist suggestion + recontextualize button)
- OS notification support (with user preference: in-app / browser / both)
- Recontextualize jump back to Step 3 from check-in

**Persistence & history**
- Auto-reset of plan when date changes
- Save/restore named day-plans (`SavedDayPlan` history)
- Import/export saved sessions with cross-version migration

**Cross-cutting**
- Light/dark theme with cross-tab sync
- Saved-sessions sidebar in wizard (drag-to-resize)
- Error boundary
- PWA install + offline-tolerant cache
- Stale Todoist task handling: snapshot sync, deleted-task auto-unlink, externally-completed-task auto-mark, fallback display chain
- Todoist data layer with request deduplication, 30s focus-refresh window, 5min cache TTL, stale-while-revalidate

---

## 8. What's NOT In Today (Per User Direction)

**The proposals in [backlog.md](./backlog.md) are NOT yet implemented.** Specifically, the following are out of scope for current state:

- **First-class habits feature.** Today, "habit" is just a flag on a background `LinkedTask`. The proposed model — habits as a separate entity, toggleable active/inactive, auto-promoted to intentions in Step 1 — does not exist.
- **Session capacity arithmetic.** No automatic computation of "assigned task estimates vs. session duration minus a tunable buffer", no over-capacity warnings prompting break-down or move, no remaining-time-aware computation when the user is mid-session.

Treat these as future work, not current behavior.

---

## 9. Design Tensions Worth Knowing

- **Single source of truth split.** Todoist owns tasks; Orchestrate owns intentions and the link between intentions and tasks. The `titleSnapshot` field is the bridge — it lets us survive Todoist deletions/completions without losing planning history.
- **No backend, by choice.** Everything is client-side. This shapes everything: the auth model, the encryption-not-security-only-obfuscation reality, the localStorage migration chain, the lack of cross-device sync.
- **Opinionated defaults over configurability.** Default sessions, default playlist set, fixed 4-step wizard. Settings exist (session slots, playlist URLs, calendar IDs, notification preference) but the *shape* of the day is built-in.
- **Personal tool, not a product.** The requirements document is explicit: "This version is specific to the author's needs."
