> **What is this?** A forward-looking roadmap document — design framing for a feature that is **not yet implemented**. It is not current-state documentation. For the current state see [../synthesis.md](../synthesis.md); for the durable "why" see [../vision.md](../vision.md). Companion roadmap doc: [persistence_and_backend_migration.md](./persistence_and_backend_migration.md).

# Engagement Record Strategy

## 1. Problem

v6.3 gave Orchestrate the ability to track **engagement** — explicit Start/Stop on a `LinkedTask` or a `TodaysHabitInstance`, accumulating minutes across cycles into an `EngagementRecord`. This was a real step: the app now knows not just what the user *planned* but, to some degree, what they *did*.

But that knowledge is **ephemeral**. The engagement record lives on the day's plan, and the plan resets at day rollover. Unless the user manually invokes `SAVE_DAY`, the record of "I worked 18 minutes on the capacity refactor this morning" is gone tomorrow.

Orchestrate records *planning* well. It does not yet durably record *what actually happened*. That gap matters because the v8 vision — weekly and seasonal **reviews**, **drift detection** — is only as good as the history it can look back on. A review with no record of actual engagement can only reflect on intentions, not on execution.

## 2. What we want

A durable, cross-day record of engaged work:

- which task or habit,
- when it was engaged (start/end of each segment),
- for how long (accumulated minutes),
- whether it ended in completion, reschedule, or abandonment.

Ideally this record is eventually **surfaced on a time-axis** — a calendar-like view — so the user can see plan-vs-actual at a glance, and so the v8 review flows have real data to aggregate.

The surface does **not** have to be Google Calendar. That is one option among several. The durable *record* is the primary requirement; the *surface* is secondary and can come later.

## 3. Current state

Engagement is tracked in [`src/context/DayPlanContext.tsx`](../../src/context/DayPlanContext.tsx) via four reducer actions and one helper:

- `START_TASK_ENGAGEMENT` / `STOP_TASK_ENGAGEMENT` — for `LinkedTask` (intention-bound work).
- `START_HABIT_INSTANCE` / `STOP_HABIT_INSTANCE` — for `TodaysHabitInstance` (stabilizer habits).
- `closeEngagement(record, nowISO)` — closes the current segment, accumulates `totalMinutes`.

The `EngagementRecord` shape (`{ startedAt, endedAt?, totalMinutes? }`) lives on both `LinkedTask.engagement` and `TodaysHabitInstance.engagement`.

**Why it's lossy:**

- **Daily reset.** `freshPlan()` wipes the plan every new day. Engagement records on `plan.linkedTasks` and `plan.todaysHabits` go with it.
- **`SAVE_DAY` is manual-only.** Nothing writes to `history` automatically at rollover. A user who forgets to save loses the day's engagement record entirely.
- **The backlog carries only a sliver.** `MOVE_INTENTION_TO_BACKLOG` copies engaged-task records into `BacklogEntry.unfinishedTaskRecords`, but only for *intention tasks* (not habits), and only across a *single* rollover — and the entry is consumed when the intention is restored.
- **The reschedule predecessor is a partial record.** When an engaged habit is rescheduled, v6.3 keeps the predecessor as a terminal `'unfinished'` `TodaysHabitInstance` with its engagement intact. This is a genuine in-day record — but it still lives on `plan.todaysHabits` and dies at rollover.

So today the engagement record is real but transient. The goal is to make it durable.

## 4. Options

Six options. Each is described with its mechanism, pros, cons, and rough effort.

### A. In-app `life.engagementHistory`

**Mechanism.** Add a durable array to `LifeContext` (which already survives day rollover — it holds seasons, habits, backlog). Define an `EngagementLogEntry` (`{ id, sourceType: 'task' | 'habit', sourceId, titleSnapshot, date, segments: EngagementRecord[], outcome: 'completed' | 'rescheduled' | 'abandoned' }`). Every Stop, Complete, and clone-on-reschedule appends an entry. A rollover migration harvests any `'unfinished'` reschedule predecessors and engaged-but-unsaved records before the plan is discarded.

**Pros.** Pure in-app; no external dependency; offline-safe; immediately queryable by a future `/review` route. Works entirely within the current localStorage model — **needs no backend**. The v6.3 `'unfinished'` predecessor is already a natural harvest source.

**Cons.** Grows unbounded — needs a "trim entries older than N weeks" knob (and trimming interacts with the quota concern in the companion doc). Not a time-axis surface by itself; it's a store, not a view.

**Effort.** Low. A new `LifeContext` field, an `EngagementLogEntry` type, a handful of reducer appends, one rollover-migration harvest step, and a trim policy.

### B. Todoist comments

**Mechanism.** On Stop or Complete, POST a comment to the underlying Todoist task — e.g. *"Engaged 18m, 07:00–07:18 (via Orchestrate)"*. The Todoist REST API exposes a comments endpoint; the existing personal API token already covers it (no OAuth).

**Pros.** No new auth. Surfaces the record inside Todoist, where the user already works — useful cross-app visibility. Durable on Todoist's side.

**Cons.** Write-only — Orchestrate posts but never reads them back, so this is a *mirror*, not a store. Todoist is a task manager, not a calendar: comments don't sit on a time-axis. Comment spam accumulates on recurring habit tasks.

**Effort.** Low-to-medium. One API call wired into the Stop/Complete handlers; needs the Todoist comments endpoint added to the actions layer.

### C. Todoist `duration` field

**Mechanism.** On Complete, update the Todoist task's `duration` field to the actual engaged minutes.

**Pros.** Reuses an existing field; visible in Todoist's own time-blocking views.

**Cons.** Semantic mismatch — Todoist's `duration` means *expected* time, not *actual*. For recurring habit tasks the field is overwritten when the recurrence rolls forward. It captures one number, not the segment history. **Not recommended** — listed for completeness.

**Effort.** Low, but low value.

### D. ICS subscription feed

**Mechanism.** Orchestrate emits an ICS (iCalendar) feed of engagement events. The user subscribes to that feed in Google Calendar (or any calendar app). The feed is regenerated as engagement records accumulate.

**Pros.** No OAuth. Delivers the time-axis surface — engaged work shows up as real calendar events on a real calendar. Calendar-app-agnostic.

**Cons.** Needs the ICS feed reachable at a stable URL — which means *somewhere to host it*. A purely local app can't serve a URL the calendar can poll. This pairs naturally with even a tiny self-hosted endpoint (see the companion doc). Calendar subscription refresh latency is hours, not minutes — fine for a retrospective record, not for live tracking.

**Effort.** Medium. ICS generation is simple; the hosting/serving piece is the real work and overlaps with the infrastructure question.

### E. Google Calendar API via OAuth

**Mechanism.** Write real Google Calendar events for engaged work through the Calendar API. There are two materially different ways to do the OAuth, and earlier framing here conflated them. Split out:

#### E1. Browser-only via the GIS token client — *near-term, no backend*

The **Google Identity Services (GIS) token client** (`google.accounts.oauth2.initTokenClient`) — the same flow already proven in a sibling app against the YouTube Data API. This is **not** the auth-code/PKCE model and behaves very differently from the pessimistic read below (E2's predecessor):

- **Client ID injected at build time; no client secret, no backend.** `scope` includes `calendar.events` (write) and `calendar.calendarlist.readonly` (auto-list the user's calendars).
- **Access tokens (~1 hr) returned directly; no refresh token at all — by design.** Renewal is just calling `requestAccessToken({ prompt: '' })` again, which is **silent** when the Google session is alive and consent was already granted. This is *not* a re-consent prompt — the earlier "periodic re-consent" framing was about the auth-code path, not this one.
- **Consent screen stays in "testing" mode** — self-authorized, ≤100 test users — sidestepping Google verification. First consent shows the "Google hasn't verified this app" interstitial; fine for a single-user personal tool.
- **The token lives in memory only** — never persisted, never encrypted (it expires within the hour anyway), so there is no localStorage token-security concern like the Todoist token has.
- **CORS-friendly.** Google's REST endpoints accept browser `Bearer` requests, so no dev proxy is needed (unlike Todoist).

**Pros.** A genuinely robust write path for interactive, browser-open use with zero infrastructure. Engaged work as first-class events on the user's primary calendar; auto-discovers calendars.

**Cons.** Only works while a browser tab is open with a live Google session — no unattended/background writes. Testing-mode tokens can have shorter validity, but silent re-acquisition absorbs that.

**Effort.** Medium. (The auth + write plumbing is being built now — see §6.)

#### E2. Robust via a backend-held refresh token — *future*

The auth-code flow with a server (or self-hosted endpoint) performing the token exchange and holding the long-lived **refresh token**. This is what enables **unattended/background** writes (e.g. a server writing engagement events with no tab open) and removes even the silent-refresh dependency.

- This is the single feature in this document that most clearly *wants* infrastructure — it ties directly into the companion doc, [persistence_and_backend_migration.md](./persistence_and_backend_migration.md).

**Pros.** The richest, most durable surface; works without a browser tab open.

**Cons.** Needs a backend and the token-exchange/refresh machinery.

**Effort.** Medium-high with a self-hosted endpoint already in place; not worth attempting before the infrastructure decision lands.

### F. Defer surfacing to the v8 Reviews iteration

**Mechanism.** Not a storage option — it's the *consumer*. The v8 backlog already plans weekly/seasonal **review flows** and a `/review` route. Engagement records (from option A) become the raw material those flows aggregate: "you planned 5 deep-work blocks this week and engaged 3," "meditation engaged 6/7 days."

**Pros.** Gives the engagement record a concrete, vision-aligned purpose without needing any external surface. In-app, offline, no auth.

**Cons.** Not a time-axis surface; it's a summarized retrospective. Depends on v8 being built.

**Effort.** Part of the v8 Reviews iteration, not separate.

## 5. Comparison

| Option | Durable | Time-axis surface | OAuth | Infrastructure | Offline-safe | Effort |
|---|---|---|---|---|---|---|
| A. `life.engagementHistory` | ✅ | ❌ (store only) | ❌ | none | ✅ | Low |
| B. Todoist comments | ✅ (in Todoist) | ❌ | ❌ | none | ❌ (needs network) | Low–Med |
| C. Todoist `duration` | ⚠️ (lossy) | ❌ | ❌ | none | ❌ | Low |
| D. ICS feed | ✅ | ✅ | ❌ | hosting for the feed | ✅ (read), ❌ (publish) | Med |
| E1. Google Calendar via GIS token client | ✅ | ✅ (richest) | ✅ | none | ❌ (needs tab + session) | Med |
| E2. Google Calendar via backend refresh token | ✅ | ✅ (richest) | ✅ | backend | ❌ | Med-High |
| F. v8 Reviews consumer | — (consumer) | ❌ (retrospective) | ❌ | none | ✅ | Part of v8 |

## 6. Recommendation

A layered approach — these are not mutually exclusive.

- **Foundation, near-term: option A — `life.engagementHistory`.** It is the smallest diff, has no external dependency, is offline-safe, and works entirely within the current localStorage model. Every other option that needs a durable record can read from it. The v6.3 `'unfinished'` reschedule predecessor is already a harvest source. **This can ship as its own small iteration at any time and needs no backend.**
- **Optional mirror: option B — Todoist comments.** A cheap, no-OAuth way to get cross-app visibility once option A exists. Worth a settings toggle, not worth blocking on.
- **Consumer: option F — v8 Reviews.** The engagement history is exactly the input the v8 review flows need. Building option A *now* means v8 has real data to work with when it arrives.
- **Time-axis surface: option E1 now (auth + write plumbing), full feature later.** The **GIS token-client write plumbing (option E1) is being adopted now** as a standalone iteration: OAuth via GIS, auto-listing the user's calendars (replacing the manual calendar-ID config), and a `createEvent` write action — but *no concrete engagement-event write yet*. That waits on the durable record (option A) existing to write *from*. This is deliberately the smallest sufficient step: it unlocks the write path with zero infrastructure, leaving the richer **option E2** (backend-held refresh token, unattended writes) for the infrastructure iteration.
- **Time-axis surface alternative: option D — deferred.** Option D (ICS) is the lighter calendar-surface path and pairs with even a minimal self-hosted endpoint; consider it against the infrastructure decision in the companion doc.
- **Drop option C.** The semantic mismatch isn't worth it.

## 7. Sequencing

1. **Option A** — `life.engagementHistory` — can land independently, anytime, as a small iteration. No dependency on anything else.
2. **Option B** — Todoist comments — a small follow-up once A exists, if cross-app visibility is wanted.
3. **Option F** — consuming the history — happens naturally as part of the v8 Reviews iteration.
4. **Option E1** — Google Calendar OAuth via the GIS token client — is being built now as a standalone iteration: auth + auto-list calendars + a `createEvent` write action (plumbing only; no engagement-event write yet). Needs no backend. Once option A exists, wiring engaged work into `createEvent` is a small follow-up.
5. **Options D / E2** — the *unattended/hosted* time-axis surfaces — depend on the infrastructure direction. See [persistence_and_backend_migration.md](./persistence_and_backend_migration.md): option E2 (backend-held refresh token) is the most concrete near-term feature that benefits from a (preferably self-hosted) backend. Note that **option A needs no backend at all**, so durable engagement records and the calendar-surface question can proceed on independent timelines.
