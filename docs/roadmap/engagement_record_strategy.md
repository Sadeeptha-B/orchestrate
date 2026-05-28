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

**Mechanism.** Write real Google Calendar events for engaged work through the Calendar API.

This is the "proper" calendar integration — and the one deferred during v6.3 as too complex. The realities, laid out honestly:

- **OAuth 2.0, PKCE flow** if done browser-only (no backend). Orchestrate currently authenticates to Todoist with a pasted personal token; Google Calendar's write API has no equivalent — it requires an OAuth consent flow.
- **`calendar.events` is a sensitive/restricted scope.** Google requires the OAuth app to go through **verification** (a consent screen review) before non-test users can grant it. For a personal single-user tool the user can stay in "testing" mode and self-authorize, which sidesteps verification but caps token longevity.
- **Access tokens expire in ~1 hour.** Refreshing them is the hard part. In a pure SPA, refresh tokens are fragile — Google's guidance for browser-only apps discourages long-lived refresh tokens, and testing-mode refresh tokens can expire in days. The practical browser-only outcome is **periodic re-consent**: the user re-authorizes every so often.
- **The token lands in localStorage** — the same client-side-obfuscation situation as the Todoist token today.
- **A small backend or self-hosted endpoint removes most of this friction.** A server can hold the refresh token, perform the token exchange server-side, and keep the integration robust without re-consent. This is the single feature in this document that most clearly *wants* infrastructure — and it ties directly into the companion doc, [persistence_and_backend_migration.md](./persistence_and_backend_migration.md).

**Pros.** The richest surface — engaged work as first-class events on the user's primary calendar, editable, color-coded, on the same time-axis as everything else.

**Cons.** The most complex by a wide margin. Browser-only, it's fragile (re-consent friction); robust, it needs a backend. Either way it's a substantial build.

**Effort.** High browser-only; medium-high with a self-hosted endpoint already in place.

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
| E. Google Calendar API | ✅ | ✅ (richest) | ✅ | none (fragile) / backend (robust) | ❌ | High / Med-High |
| F. v8 Reviews consumer | — (consumer) | ❌ (retrospective) | ❌ | none | ✅ | Part of v8 |

## 6. Recommendation

A layered approach — these are not mutually exclusive.

- **Foundation, near-term: option A — `life.engagementHistory`.** It is the smallest diff, has no external dependency, is offline-safe, and works entirely within the current localStorage model. Every other option that needs a durable record can read from it. The v6.3 `'unfinished'` reschedule predecessor is already a harvest source. **This can ship as its own small iteration at any time and needs no backend.**
- **Optional mirror: option B — Todoist comments.** A cheap, no-OAuth way to get cross-app visibility once option A exists. Worth a settings toggle, not worth blocking on.
- **Consumer: option F — v8 Reviews.** The engagement history is exactly the input the v8 review flows need. Building option A *now* means v8 has real data to work with when it arrives.
- **Time-axis surface: option D or E — deferred.** A genuine calendar surface is desirable but not urgent. Option D (ICS) is the lighter path and pairs with even a minimal self-hosted endpoint. Option E (Google Calendar API) is the richest but is materially easier and more robust *with* a backend — so it should be sequenced against the infrastructure decision in the companion doc rather than attempted browser-only.
- **Drop option C.** The semantic mismatch isn't worth it.

## 7. Sequencing

1. **Option A** — `life.engagementHistory` — can land independently, anytime, as a small iteration. No dependency on anything else.
2. **Option B** — Todoist comments — a small follow-up once A exists, if cross-app visibility is wanted.
3. **Option F** — consuming the history — happens naturally as part of the v8 Reviews iteration.
4. **Options D / E** — the time-axis surface — depend on the infrastructure direction. See [persistence_and_backend_migration.md](./persistence_and_backend_migration.md): option E in particular is the most concrete near-term feature that benefits from a (preferably self-hosted) backend. Note that **option A needs no backend at all**, so durable engagement records and the calendar-surface question can proceed on independent timelines.
