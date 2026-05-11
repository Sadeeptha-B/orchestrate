> **Start here.** This is the canonical context document for the current state of Orchestrate. Deeper references: [user-guide.md](./user-guide.md) (mental model & how to use the entities — habits, intentions, tasks, Light Pool, True Rest, capacity), [vision.md](./vision.md) (durable "why"), [architecture.md](./architecture.md), [data-model.md](./data-model.md), [backlog.md](./backlog.md) (forward-looking proposals). Frozen historical artifacts live in [history/](./history/) — do not treat them as current state.
>
> **Last updated:** 2026-05-11
> **Reflects:** v6 — **Micro-gap refinement + capacity intelligence**. Splits Habits into `stabilizer` and `light-coherent`; adds a logged-only Light Pool (Dashboard panel + `/life` section + check-in surfacing); introduces a static True Rest cue track (Dashboard side rail, low-energy check-in slot, between-session banner); replaces the hard 30-min background cap with per-kind defaults in AppSettings plus per-habit `maxBlockMinutes`; ships advisory session capacity arithmetic (banner only when load > 150%); drops the deprecated `isHabit` flags, `TOGGLE_TASK_HABIT` action, and `backfillHabitsFromLegacy`. Iteration 7 (modes/rituals/recovery) and iteration 8 (reviews/drift) remain sketched in [history/plan_v5.md](./history/plan_v5.md).

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

The user's day flows through three primary surfaces, with a hierarchical-planning layer above them:

```
Welcome (hub)  ─▶  Wizard (4 steps)  ─▶  Dashboard
   │  ▲                ▲                       │
   │  └────────────────┴── Edit Plan / Recontextualize
   │                                           │
   └────────────┐                  ┌───────────┘
                ▼                  ▼
         /life  ─▶  /season  ─▶  /season/:id
                ▼
              /habits
```

Welcome is a multi-purpose home hub (since v5.1): a "Today" card with the wizard CTA + step timeline, plus a "Life" card surfacing the active season and anchor habits with quick links into `/life` / `/habits` / `/season`. The `/life` family of routes is the scaffolding above the day — where Seasons, Habits, and (in v7+) Rituals and Reviews live. Life routes are reachable directly (no `setupComplete` requirement) so users can edit habits/seasons without first walking through the wizard.

### 2.1 Vocabulary

| Term | Meaning |
|---|---|
| **Intention** | A high-level goal for *today* (e.g. "Finish assignment 3"). Not a todo-list epic — a today-scoped focus area. Owned by Orchestrate. May carry a `sourceHabitId` if auto-injected from a Habit. |
| **LinkedTask** | A specific Todoist task that has been bound to an intention inside Orchestrate's plan. The unit that gets categorized and scheduled. |
| **Main task** | A primary work thread. Exclusive to one session. |
| **Background task** | A habit/nudge task. Can be assigned to multiple sessions in the same day. Capped at 30 min per estimate. |
| **Season** | A medium-horizon focus period (typically 4–12 weeks) with a primary theme, supporting goals, non-goals, success criteria, and an optional capacity budget. Exactly one season is active at a time. |
| **Habit** | A first-class recurring entity. v6: discriminated by `kind` into **stabilizer** and **light-coherent**. Owns its recurrence rule, minimum-viable form, trigger cue, anchor flag, optional auto-link Todoist task, and optional per-habit `maxBlockMinutes`. |
| **Stabilizer** | A `kind: 'stabilizer'` habit. Anchor-style ritual (sleep, meditation, gym, shutdown). Auto-injects as an intention each day it matches; its linked task is locked to `background` in Step 2. |
| **Light-coherent** | A `kind: 'light-coherent'` habit. Small, resumable micro-gap filler (flashcards, short reading, idea capture). Never auto-injects as an intention — surfaces in the **Light Pool**, logged opportunistically via `plan.habitLog`. |
| **Light Pool** | Dashboard panel + `/life` section listing today's active light-coherent habits scoped to the active season. Start/Complete writes a `HabitLogEntry`; never enters today's task plan. |
| **True Rest** | A static catalog of non-task recovery cues (walk, breathe, look out window). Surfaced on the Dashboard side rail, inside the check-in modal for low-energy states, and between sessions when the next slot is within 60 min. |
| **Anchor habit** | A habit flagged as foundational (`isAnchor: true`) — typically (but not necessarily) a stabilizer. Protected from accidental deletion while active; surfaced as the "protect these" set on `/life` and the Welcome Life card. `isAnchor` is **orthogonal to `kind`**: it answers "how protected?", not "what behavior?". See [user-guide.md](./user-guide.md) §6 for the full table. |
| **Session** | A configurable time block in the day (default: early-morning, morning, afternoon, night). Tasks are assigned to sessions. |
| **Session capacity** | v6 advisory arithmetic: `(session length − sessionBufferMinutes) − Σ estimatedMinutes` for assigned tasks. Background tasks count once per assignment. Status flips to `over` only at >150% load — a non-blocking banner appears, the wizard always advances. |
| **Check-in** | An hourly prompt during active sessions asking how the user feels and what kind of work they're doing. Suggests a playlist. When feeling is `struggling`/`stuck` (or work is low-energy/restless), the modal also surfaces 1–2 Light Pool rows and a True Rest cue. `feeling === 'stuck'` adds an "avoidance note" capture. |

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

Three interlocking ideas:

**Intentions own LinkedTasks.** An intention has `linkedTaskIds: string[]` (ordered Todoist IDs). A `LinkedTask` has `intentionId` back-reference + `type` + `estimatedMinutes` + `assignedSessions[]` + `completed` + `titleSnapshot?`. The flat `linkedTasks` array on `DayPlan` is the denormalized list across all intentions.

**Tasks (not intentions) are scheduled.** `DayPlan.taskSessions: Record<sessionId, todoistId[]>` is the source of truth for what runs in each session. `LinkedTask.assignedSessions` is a derived mirror kept in sync by the reducer.

**LifeContext sits above the day.** A separate persistent state slice (`life: LifeContext` on the provider, persisted to `orchestrate-life-context`) holds `seasons[]`, `habits[]`, and `activeSeasonId`. When an intention has `sourceHabitId` set, it was auto-injected from a habit at Step 1 entry; the corresponding linked task's category is locked to `background` in Step 2.

Consequence: **a single intention can have both main and background tasks.** This was the v4 fix — earlier versions categorized at the intention level, which didn't match real workflows.

The plan auto-resets daily (`loadPlan()` checks `parsed.date !== todayISO()`). User preferences (Todoist token, session slots, calendar IDs) survive in `AppSettings`. Completed days can be saved to `history` and restored later.

A migration chain (v1 → v2 → v3 → v4 → v4.1 → v5) handles old saved sessions on load. v3 → v4 cannot reconstruct task links (v3 stored none) so it shows a one-time notice prompting re-mapping. v5 stamps an explicit `_schemaVersion` marker on plan, settings, life, and saved-session payloads. A one-time backfill scans existing intentions/saved-sessions for legacy `isHabit: true` entries and surfaces them as inactive `Habit` candidates in the library.

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
- Welcome hub (v5.1): Today card (plan-status copy + primary CTA + wizard step timeline) and Life card (active season summary, anchor habits, quick links to `/habits` and `/season`). Detects first-visit / resuming / returning.
- Todoist token setup (paste + encrypt) with validation
- Multi-calendar Google Calendar configuration with colors and view mode

**Wizard**
- Step 1: intention entry, sequential mapping to Todoist tasks, individual or wholesale remap, collapsible mapped-intention panels showing linked tasks. **Season focus banner** at the top of Phase 1 surfaces the active season's name + theme and renders each `supportingGoal` as a clickable chip — clicking adds it as an intention via `ADD_INTENTION` (already-added goals render as disabled `✓` chips). Empty-state nudge with "Set up a season" link when no season is active.
- Step 2: per-intention categorization + estimation, preset + custom estimate input, background 30min cap, >60min breakdown nudge with auto-opening task manager, horizontal task cards when panel collapsed
- Step 3: two-phase scheduling — proportional timeline assignment + side-by-side Todoist/Calendar time scheduling with estimate-based end-time auto-fill, phase gating, completed-task short-circuit
- Step 4: Spotify start-work playback + setup completion

**Dashboard**
- **Season context card** rendered as a right-rail companion to the Timeline section: active season name (links to `/season/:id`), primary theme, date range with "Week N of M" pill (when both dates set), first 3 supporting goals with inline "+N more" expand/"Show less" toggle, "Manage" button. Empty-state card prompts "Create a season" with a secondary "Why seasons?" link to `/life`.
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

**Life scaffolding (v5–v6)**
- First-class `Season` entity: name, theme, supporting goals, non-goals, success criteria, optional capacity budget. Exactly one active.
- First-class `Habit` entity (v6 discriminated): `kind: 'stabilizer' | 'light-coherent'`, recurrence, minimum-viable, trigger cue, completion rule, failure tolerance, anchor flag, optional persistent Todoist auto-link, season membership, optional `maxBlockMinutes` per-habit cap.
- Anchor habits get protection from accidental deletion (must deactivate first).
- Stabilizer habits auto-promote as intentions in Step 1 (idempotent on re-entry); habit-derived intentions render with a 🔁 Habit badge and a "Skip for today" affordance. **Light-coherent habits never auto-inject** — they live in the Light Pool instead.
- Habit-derived linked tasks have category locked to `background` in Step 2; the per-task cap resolves from `Habit.maxBlockMinutes` → kind default → `taskCapDefaults.manualBackground` for manually-categorized backgrounds.
- New routes: `/life` (hub, now includes a Light Pool section with weekly cadence rollup), `/season` (list), `/season/:id` (detail), `/habits` (library).
- `ActiveSeasonBadge` in Dashboard + Wizard headers.
- "Life" button in Dashboard header.

**Day-level intelligence (v6)**
- **Light Pool panel** on the Dashboard (between Current Session and Task Manager) — per-row Start/Complete writes to `plan.habitLog`, never enters the task plan.
- **True Rest card** on the Dashboard side rail (rotating cue) + inline cue in the check-in modal when feeling/work-type indicates low resources + a between-session banner when next slot is within 60 min.
- **Session capacity arithmetic** in `src/lib/capacity.ts` — surfaces a per-session `SessionCapacityBadge` on the Step 3 timeline and the Dashboard Current Session card, plus a `SessionCapacityBanner` above the Step 3 timeline when any session is `over` (> 150%). Mid-session calc uses remaining minutes. Background tasks count once per assignment.
- **Per-task duration caps** — `AppSettings.taskCapDefaults` (stabilizer 30 / lightCoherent 20 / manualBackground 30, all tunable in Settings) replace the old hard 30-min background clamp; `Habit.maxBlockMinutes` overrides per-habit.
- **Check-in upgrades** — `feeling === 'stuck'` adds a "What exactly are you avoiding?" capture (persisted as `CheckIn.avoidanceNote`); low-resource states reveal 1–2 Light Pool rows + a True Rest cue.

**Persistence & history**
- Auto-reset of plan when date changes
- Save/restore named day-plans (`SavedDayPlan` history)
- Import/export saved sessions with cross-version migration
- **Full Backup** export/import bundles `{ settings, life, history }` to a single JSON file (merge-by-id on import) — the no-backend safety net for cross-device snapshotting.

**Cross-cutting**
- Light/dark theme with cross-tab sync
- Saved-sessions sidebar in wizard (drag-to-resize)
- Error boundary
- PWA install + offline-tolerant cache
- Stale Todoist task handling: snapshot sync, deleted-task auto-unlink, externally-completed-task auto-mark, fallback display chain
- Todoist data layer with request deduplication, 30s focus-refresh window, 5min cache TTL, stale-while-revalidate
- **In-app user guide** at `/guide` — mirrors [user-guide.md](./user-guide.md); reachable from the About modal on Welcome, Dashboard, and every Wizard step.

---

## 8. What's NOT In Today (Per User Direction)

**The remaining proposals in [backlog.md](./backlog.md) are NOT yet implemented.** Specifically, the following are out of scope for current state:

- **Modes, rituals, recovery mode.** No `DayPlan.mode` field, no ritual templates / `RitualPlayer`, no Minimum Viable Day. (Targeted for v7.)
- **Reviews and drift detection.** No `/review` route, no weekly/seasonal review flows, no drift-signal aggregation. (Targeted for v8.)

Treat these as future work, not current behavior. **First-class habits and Seasons shipped in v5; the Habit.kind split, Light Pool, True Rest, capacity arithmetic, and the legacy `isHabit` purge shipped in v6** (see [history/plan_v5.md](./history/plan_v5.md) and [history/plan_v6.md](./history/plan_v6.md)).

---

## 9. Design Tensions Worth Knowing

- **Single source of truth split.** Todoist owns tasks; Orchestrate owns intentions and the link between intentions and tasks. The `titleSnapshot` field is the bridge — it lets us survive Todoist deletions/completions without losing planning history.
- **No backend, by choice.** Everything is client-side. This shapes everything: the auth model, the encryption-not-security-only-obfuscation reality, the localStorage migration chain, the lack of cross-device sync.
- **Opinionated defaults over configurability.** Default sessions, default playlist set, fixed 4-step wizard. Settings exist (session slots, playlist URLs, calendar IDs, notification preference) but the *shape* of the day is built-in.
- **Personal tool, not a product.** The requirements document is explicit: "This version is specific to the author's needs."
