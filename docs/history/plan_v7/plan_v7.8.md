# Plan v7.8 — Reminders & notifications, wizard reorder, planning QoL

Two threads landed together: (A) a reworked reminder / notification surface, and (B) a setup-wizard
reorder plus a batch of planning quality-of-life changes.

---

## A. Reminders & notifications

### 1. Configurable recontextualization cadence

The hourly check-in (`useHourlyCheckin`) was hardcoded to 60 min. Now:

- New `AppSettings.recontextualizationCadenceMinutes?: number` (additive optional; `DEFAULT_RECONTEXT_CADENCE_MINUTES = 60` in [`src/lib/reminders.ts`](../../../src/lib/reminders.ts)).
- `useHourlyCheckin` takes a `cadenceMinutes` arg. A non-positive value disables the check-in. Firing aligns to the cadence boundary in minutes-since-midnight (`cadence − (minutesOfDay % cadence)`), so 30 → :00/:30 and 60 keeps firing on the hour.
- Edited in Settings → **Configuration → Reminders**.

### 2. Settings: Capacity → Configuration

`CapacitySettings.tsx` → **`ConfigurationSettings.tsx`** — a broader container for Orchestrate config, organized into sub-sections: **Reminders** (new cadence field), **Capacity** (session buffer + per-task caps), **Timeline** (timeline hours). [`SettingsPage.tsx`](../../../src/components/settings/SettingsPage.tsx) tab id `capacity` → `configuration`, label `Capacity` → `Configuration`.

### 3. Engagement-nudge fix + reword

The old focus nudge measured `now − sessionStart`, so it nagged "210 min into <session> without a focus block" even right after stopping a task.

- `useFocusNudge` → **`useEngagementNudge`** (type `FocusNudge` removed).
- New pure helpers in [`src/lib/engagement.ts`](../../../src/lib/engagement.ts): `lastEngagementBoundary(plan)` (latest `endedAt` across today's habit-instance + linked-task segments) and `engagementIdleState(plan, currentSession, nowMs)` (shared idle basis for the nudge + banner).
- The nudge now anchors elapsed time to the last engagement boundary within the current session (falling back to session start when nothing has been engaged yet there); a new boundary re-arms the cadence. Reworded to "It's been <1h 23m> since your last engagement in <session>" — folded into hours via `formatDuration`, no "focus block".
- **Configurable threshold** `AppSettings.engagementNudgeMinutes` (default `DEFAULT_ENGAGEMENT_NUDGE_MINUTES` = 10; `0` = off); repeat stays `ENGAGEMENT_NUDGE_REPEAT_MINUTES` = 30. Edited in Settings → Configuration → Reminders.
- **Persistent dashboard banner** (`useEngagementBanner`, a side-effect-free read with a 30 s tick): the notification fires once at the threshold, then the banner stays on the dashboard until the user re-engages.

### 4. Orchestrate notification banner system

Native browser notifications didn't match the app's visual language, and integration sync errors were mostly invisible outside the Settings page.

- **`NotificationProvider`** ([`src/context/NotificationContext.tsx`](../../../src/context/NotificationContext.tsx)) — toast queue with `notify`/`dismiss`, kinds info/success/warning/error, `dedupeKey` de-duplication, auto-dismiss for info/success (errors persist). Renders **`NotificationViewport`** ([`src/components/ui/NotificationViewport.tsx`](../../../src/components/ui/NotificationViewport.tsx)): fixed **bottom-right**, themed to the app's banner language, light/dark aware. `useNotify` hook for access.
- **`NotificationBridge`** ([`src/components/ui/NotificationBridge.tsx`](../../../src/components/ui/NotificationBridge.tsx)) — headless, mounted under all providers. Runs the engagement nudge app-wide and watches the Todoist / Google Calendar / reconciliation contexts, raising an **error toast on a sync failure** (null→error transition, de-duped per source, with an "Open Integrations" action).
- `useNotifications.sendNotification` now always pushes an in-app toast; native `Notification` survives only as a **background-only fallback** (tab hidden + preference allows browser). Callers (`useEngagementNudge`, `useHourlyCheckin`, `FocusMode`) are unchanged at the call site.

Provider tree (App.tsx): `DayPlanProvider → NotificationProvider → GoogleCalendarProvider → TodoistProvider → ReconciliationProvider → { NotificationBridge, AppRoutes }`.

---

## B. Wizard reorder & planning QoL

### 5. Wizard reorder: Sessions first

Sessions now lead the flow so the day's shape scopes intention planning. New order
(`plan.wizardStep` indexes; `WIZARD_STEPS` labels in [`src/data/wizardSteps.ts`](../../../src/data/wizardSteps.ts)):

| # | Label | File | Component |
|---|---|---|---|
| 1 | Sessions | `Step1Sessions.tsx` | `Step1Sessions` |
| 2 | Intentions | `Step2Intentions.tsx` | `Step2Intentions` |
| 3 | Refine | `Step3Refine.tsx` | `Step3Refine` |
| 4 | Schedule | `Step4Schedule.tsx` | `Step4Schedule` |
| 5 | Ready | `Step5Launch.tsx` | `Step5Launch` |

- Files renamed via `git mv` (history preserved) so names match their new positions — this also
  fixes the long-standing mismatch where the Schedule step lived in `Step3Schedule.tsx` after being
  moved to position 4. Each component's exported name and its `SET_WIZARD_STEP` target were updated;
  [`Wizard.tsx`](../../../src/components/wizard/Wizard.tsx)'s `STEPS` array reordered.
- `Dashboard` entry points: "Edit Plan" → step 1 (now Sessions, the top of the flow); "Recontextualize"
  → step 4 (Schedule, unchanged number).

### 6. Start Music step → "Ready" hand-off

`Step4StartMusic.tsx` is rewritten as `Step5Launch` — a calm "your day is ready" hand-off that keeps the
"Start Work" Spotify playlist embedded as a ramp-in on-ramp (so the transition out of planning isn't a
whiplash jump to the dashboard) but drops the old music-protocol tips. Completes setup (`COMPLETE_SETUP`)
and offers a primary **Go to Dashboard** plus a secondary **Enter Focus Mode** launch; copy varies for the
edit-from-dashboard case.

### 7. Wizard header → Life

[`WizardLayout`](../../../src/components/wizard/WizardLayout.tsx) gains a **Life** ghost button (→ `/life`,
matching the Dashboard), so seasons / habits / templates are reachable mid-wizard.

### 8. Backlog QoL ([`BacklogTab.tsx`](../../../src/components/dashboard/BacklogTab.tsx))

- **Sidebar-pinned discard confirmation.** The discard `ConfirmModal` is replaced by an inline confirm
  strip — names the entry, Cancel / Discard, no modal pop-over. The strip is **pinned at the bottom of
  the sidebar**, outside the scrollable backlog list, so it stays anchored to the sidebar's bottom edge
  regardless of list length or scroll position (an earlier `sticky bottom-0` strip *inside* the list
  floated directly under the clicked card when the list was short). To achieve this the state and the
  strip are **owned by [`HistorySidebar`](../../../src/components/dashboard/HistorySidebar.tsx)**: the
  sidebar lays out as a flex column with a `flex-1` scrollable tab-content region and a `flex-shrink-0`
  footer; the confirmation renders in that footer (backlog tab only) and routes through
  `useIntentionRemoval().discardFromBacklog` (unschedules linked Todoist tasks). `BacklogTab` is now
  controlled — it takes `pendingDiscardId` / `onRequestDiscard` props, signals which entry to discard,
  and rings the pending card. The owning [`Dashboard`](../../../src/components/dashboard/Dashboard.tsx)
  `aside` moved its scroll inward (`overflow-hidden` + flex column) so the footer can pin.
- **Collapsible task list.** The "N pending" count is now a toggle that expands the actual pending task
  titles in place (live Todoist `taskMap` → `taskSnapshots` fallback).

### 9. Season/habits context banner → Step 1

`SeasonFocusBanner` (active-season arc + supporting-goal chips + today's recurring habits) moved from
the Intentions step to **Step 1 (Sessions)** — it's the first step now, so the day's recurring context
should scope session planning. It renders full width **above the step's title** (the old 40%-column
placement compressed it), framing the day before you shape it; the Step 1 heading was warmed to a
start-of-day feel ("Let's shape your day"). `useTodaysHabitsSync` + the `todaysHabits` derivation moved
with it; the Intentions step keeps its own `useTodaysHabitsSync` for the TodoistPanel habit labels but no
longer renders the banner.

### 10. Calendar events on the session editor

When Google Calendar is connected, [`SessionEditorTimeline`](../../../src/components/ui/SessionEditorTimeline.tsx)
surfaces that day's external events as read-only context — essential for deciding where sessions go. The
event-positioning geometry (`packExternalEvents` / `eventWindowMinutes` / `eventTimeRange`) was
**extracted from `SessionTimelineBar` into [`src/lib/timelineEvents.ts`](../../../src/lib/timelineEvents.ts)**
so the read-only bar and the editor share one implementation. Step 1 fetches events via
`useDayCalendarEvents(plan.date)` and passes them (plus `dateISO`) to the editor, gated on
`useGoogleCalendarData().isConnected`.

Events render as chips in a **dedicated rail above the editable track** — kept entirely off the editing
surface so nothing overlaps the session blocks. The rail row-packs (`packExternalEvents`' `rowCount`),
so time-overlapping events stack onto separate rows (`top: row * EVENT_CHIP_ROW_H`) and each stays
individually readable; chips are hoverable (native `title` + the shared `.tl-event-*` hover-expand
styling from [`sessionTimelineBar.css`](../../../src/components/ui/sessionTimelineBar.css), now imported
by the editor too). This replaced an earlier attempt that drew events as faded full-height bars behind
the blocks — they hid behind the (opaque-ish) session blocks and couldn't be hovered, defeating the
"read the day" purpose.

The same editor (and therefore the same calendar rail) is reused by the dashboard's **"Adjust day"**
surface: [`Dashboard.tsx`](../../../src/components/dashboard/Dashboard.tsx) now also calls
`useDayCalendarEvents(plan.date)` + `useGoogleCalendarData()` and passes `externalEvents` / `dateISO`
into `SessionEditorTimeline`, so adjusting sessions on the dashboard shows the same context as the wizard.

### 11. Focus Mode — "Today's shape" session bar to the top of the picker

In `FocusPicker`, the "Today's shape" `SessionTimeline` bar moved out of the cramped left column to a
**full-width band at the top** (above the chooser + engagement-log grid), so the day's session shape
frames the task choice. The timer view (`FocusActive`) is unchanged — its task list and the day-wide
`EngagementTimeline` rail still sit side by side.

---

## Schema

**Bumped 7.5 → 7.6** for the wizard-step remap (§5): `migrateToCurrent` (plan slice) remaps a persisted
`wizardStep` `{1→2, 2→3, 3→1, 4→4, 5→5}` when the stamp is `< 7.6` (`migratePlan_7_5_to_7_6` in
[`src/lib/schema.ts`](../../../src/lib/schema.ts)). Schema-gated so the old numbering is unambiguous;
harmless for already-`setupComplete` plans. Mirrors how v7.1 handled inserting the Sessions step. The new
reminder/nudge settings fields (§1, §3) are additive optionals needing no migration step.

## Files

New: `src/context/NotificationContext.tsx`, `src/hooks/useNotify.ts`,
`src/components/ui/NotificationViewport.tsx`, `src/components/ui/NotificationBridge.tsx`,
`src/hooks/useEngagementNudge.ts`, `src/lib/reminders.ts`,
`src/components/settings/ConfigurationSettings.tsx`, `src/lib/timelineEvents.ts`.

Removed: `src/hooks/useFocusNudge.ts`, `src/components/settings/CapacitySettings.tsx`.

Renamed: `Step3Sessions.tsx` → `Step1Sessions.tsx`, `Step1Intentions.tsx` → `Step2Intentions.tsx`,
`Step2Refine.tsx` → `Step3Refine.tsx`, `Step3Schedule.tsx` → `Step4Schedule.tsx`,
`Step4StartMusic.tsx` → `Step5Launch.tsx` (rewritten as the recap).

Changed: `src/hooks/useNotifications.ts`, `src/hooks/useHourlyCheckin.ts`, `src/lib/engagement.ts`,
`src/types/index.ts`, `src/App.tsx`, `src/components/settings/SettingsPage.tsx`,
`src/components/dashboard/Dashboard.tsx` (dropped inline nudge banner; passes cadence; wizard-entry
comments; §10: feeds calendar events into the "Adjust day" editor; §8: `aside` is a flex column with an
internal scroll region so the sidebar footer can pin),
`src/components/dashboard/HistorySidebar.tsx` (§8: owns the pinned discard confirmation + flex-column
scroll/footer layout), `src/components/wizard/Wizard.tsx`,
`WizardLayout.tsx`, `src/data/wizardSteps.ts`, `src/lib/schema.ts` (bump + remap step),
`src/components/dashboard/BacklogTab.tsx`, `src/components/wizard/Step1Sessions.tsx`, `Step2Intentions.tsx`,
`src/components/ui/SessionEditorTimeline.tsx` (§10: calendar-event rail above the track, imports
`sessionTimelineBar.css`), `src/components/ui/SessionTimelineBar.tsx`
(now imports the extracted geometry), `src/components/focus/FocusMode.tsx`, plus stale step-name
comments in `src/lib/capacity.ts` / `src/context/ReconciliationContext.tsx`.

Docs: `docs/synthesis.md` §5.2, `docs/data-model.md` §4.
